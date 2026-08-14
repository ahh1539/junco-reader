/**
 * Kokoro TTS worker.
 *
 * Runs model load + synthesis off the main thread so the thread that
 * schedules AudioBufferSourceNode playback is never blocked by
 * eSpeak/tokenizer/ONNX work. See kokoroWorkerClient.js for the RPC client.
 *
 * Natural is WebGPU + fp32 only. A failed GPU load must not fall back to WASM.
 */

import { MODEL_ID, configureModelSource } from './modelCache.js'

let ttsPromise = null
let loadedDevice = null
let loadedDtype = null
let warmedVoice = null
let generationQueue = Promise.resolve()

function post(msg, transfer) {
  if (transfer) self.postMessage(msg, transfer)
  else self.postMessage(msg)
}

async function loadModel({ device, dtype }) {
  if (device !== 'webgpu' || dtype !== 'fp32') {
    throw new Error('Natural voice requires WebGPU with fp32 weights. There is no CPU fallback.')
  }

  const [{ KokoroTTS }, { env: transformersEnv }] = await Promise.all([
    import('kokoro-js'),
    import('@huggingface/transformers'),
  ])

  configureModelSource(transformersEnv)

  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
    device,
    progress_callback: (info) => post({ type: 'progress', info }),
  })

  loadedDevice = device
  loadedDtype = dtype
  return tts
}

function ensureLoaded({ device, dtype }) {
  if (!ttsPromise) {
    ttsPromise = loadModel({ device, dtype }).catch((err) => {
      ttsPromise = null
      throw err
    })
  }
  return ttsPromise
}

function enqueueGeneration(task) {
  const result = generationQueue.then(task, task)
  generationQueue = result.catch(() => {})
  return result
}

self.onmessage = async (event) => {
  const msg = event.data || {}

  if (msg.type === 'load') {
    try {
      await ensureLoaded({ device: msg.device, dtype: msg.dtype })
      post({ type: 'ready', device: loadedDevice, dtype: loadedDtype })
    } catch (err) {
      post({ type: 'load-error', message: err?.message || String(err) })
    }
    return
  }

  if (msg.type === 'warmup') {
    try {
      await enqueueGeneration(async () => {
        const tts = await ttsPromise
        if (tts && warmedVoice !== msg.voice) {
          await tts.generate('Hi.', { voice: msg.voice, speed: 1 })
          warmedVoice = msg.voice
        }
      })
      post({ type: 'warmup-done', voice: msg.voice })
    } catch (err) {
      // Best-effort; never fails the caller.
      post({ type: 'warmup-done', voice: msg.voice, error: err?.message })
    }
    return
  }

  if (msg.type === 'prefetch-voice') {
    try {
      await enqueueGeneration(async () => {
        const tts = await ttsPromise
        if (tts) await tts.generate('.', { voice: msg.voice, speed: 1 })
      })
      post({ type: 'prefetch-done', voice: msg.voice })
    } catch (err) {
      post({ type: 'prefetch-done', voice: msg.voice, error: err?.message })
    }
    return
  }

  if (msg.type === 'synthesize') {
    const { id, text, voice } = msg
    try {
      const raw = await enqueueGeneration(async () => {
        const tts = await ttsPromise
        if (!tts) throw new Error('Kokoro model not loaded')
        return tts.generate(text, { voice, speed: 1 })
      })
      const audio = raw.audio instanceof Float32Array ? raw.audio : new Float32Array(raw.audio)
      post(
        { type: 'result', id, audio, sampling_rate: raw.sampling_rate },
        [audio.buffer],
      )
    } catch (err) {
      post({ type: 'error', id, message: err?.message || String(err) })
    }
  }
}

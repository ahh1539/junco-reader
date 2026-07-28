/**
 * Kokoro TTS worker.
 *
 * Runs model load + synthesis off the main thread so the thread that
 * schedules AudioBufferSourceNode playback is never blocked by
 * eSpeak/tokenizer/ONNX work. See kokoroWorkerClient.js for the RPC client.
 */

import { MODEL_ID, configureModelSource } from './modelCache.js'

let ttsPromise = null
let loadedDevice = null
let loadedDtype = null
let warmedVoice = null

function post(msg, transfer) {
  if (transfer) self.postMessage(msg, transfer)
  else self.postMessage(msg)
}

async function loadModel({ device, dtype }) {
  const [{ KokoroTTS }, { env: transformersEnv }] = await Promise.all([
    import('kokoro-js'),
    import('@huggingface/transformers'),
  ])

  configureModelSource(transformersEnv)

  // ORT WASM defaults to 1 thread unless crossOriginIsolated. vercel.json and
  // vite.config.js dev headers both set COOP/COEP, so this is real most of the time.
  if (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
    transformersEnv.backends.onnx.wasm.numThreads = Math.min(4, cores)
  }

  const load = (dev, dt) =>
    KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: dt,
      device: dev,
      progress_callback: (info) => post({ type: 'progress', info }),
    })

  let tts
  let finalDevice = device
  let finalDtype = dtype
  try {
    tts = await load(device, dtype)
  } catch (err) {
    if (device === 'webgpu') {
      // WebGPU requested but unavailable/broken in this worker context
      // (e.g. no navigator.gpu in this browser's worker impl) -> fall back.
      finalDevice = 'wasm'
      finalDtype = 'q8'
      tts = await load('wasm', 'q8')
    } else {
      throw err
    }
  }

  loadedDevice = finalDevice
  loadedDtype = finalDtype
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
      const tts = await ttsPromise
      if (tts && warmedVoice !== msg.voice) {
        await tts.generate('Hi.', { voice: msg.voice, speed: 1 })
        warmedVoice = msg.voice
      }
      post({ type: 'warmup-done', voice: msg.voice })
    } catch (err) {
      // Best-effort; never fails the caller.
      post({ type: 'warmup-done', voice: msg.voice, error: err?.message })
    }
    return
  }

  if (msg.type === 'prefetch-voice') {
    try {
      const tts = await ttsPromise
      if (tts) await tts.generate('.', { voice: msg.voice, speed: 1 })
      post({ type: 'prefetch-done', voice: msg.voice })
    } catch (err) {
      post({ type: 'prefetch-done', voice: msg.voice, error: err?.message })
    }
    return
  }

  if (msg.type === 'synthesize') {
    const { id, text, voice } = msg
    try {
      const tts = await ttsPromise
      if (!tts) throw new Error('Kokoro model not loaded')
      const raw = await tts.generate(text, { voice, speed: 1 })
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

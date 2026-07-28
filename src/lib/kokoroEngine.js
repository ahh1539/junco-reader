import {
  MODEL_ID,
  configureModelSource,
  markModelReady,
} from './modelCache.js'

let ttsPromise = null
let activeDevice = null
let activeDtype = null

export async function detectDevice() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {
      /* fall through */
    }
  }
  return 'wasm'
}

export function getDeviceLabel(device) {
  return device === 'webgpu' ? 'WebGPU' : 'WASM'
}

/**
 * Load Kokoro once. Explicit user action should call this (download / prepare).
 * @param {{ onProgress?: (p: { status: string, progress?: number, file?: string }) => void }} [opts]
 */
export async function loadKokoro(opts = {}) {
  if (ttsPromise) return ttsPromise

  ttsPromise = (async () => {
    const [{ KokoroTTS }, { env: transformersEnv }] = await Promise.all([
      import('kokoro-js'),
      import('@huggingface/transformers'),
    ])

    configureModelSource(transformersEnv)

    const device = await detectDevice()
    // q8 keeps the one-time download ~85 MB on both WebGPU and WASM.
    const dtype = 'q8'

    activeDevice = device
    activeDtype = dtype

    const load = (dev) =>
      KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device: dev,
        progress_callback: (info) => {
          opts.onProgress?.(info)
        },
      })

    let tts
    try {
      tts = await load(device)
    } catch (err) {
      if (device === 'webgpu') {
        activeDevice = 'wasm'
        tts = await load('wasm')
      } else {
        throw err
      }
    }

    markModelReady()
    return tts
  })().catch((err) => {
    ttsPromise = null
    throw err
  })

  return ttsPromise
}

export function getLoadedMeta() {
  return { device: activeDevice, dtype: activeDtype }
}

export function isEngineLoading() {
  return Boolean(ttsPromise)
}

/**
 * Synthesize a single text chunk.
 * @param {*} tts KokoroTTS instance
 * @param {string} text
 * @param {{ voice: string, speed?: number }} options
 */
export async function synthesizeChunk(tts, text, { voice, speed = 1 }) {
  return tts.generate(text, { voice, speed })
}

/**
 * Play Float32 PCM via Web Audio. Returns a stop handle and a done promise.
 * @param {{ audio: Float32Array, sampling_rate: number }} rawAudio
 * @param {AudioContext} ctx
 */
export async function playRawAudio(rawAudio, ctx) {
  if (ctx.state === 'suspended') await ctx.resume()

  const samples = rawAudio.audio
  const rate = rawAudio.sampling_rate
  const buffer = ctx.createBuffer(1, samples.length, rate)
  buffer.copyToChannel(samples instanceof Float32Array ? samples : new Float32Array(samples), 0)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)

  const done = new Promise((resolve) => {
    source.onended = () => resolve()
  })

  source.start()
  return {
    stop() {
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
    },
    done,
    duration: buffer.duration,
  }
}

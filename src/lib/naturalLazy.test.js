import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Natural voice stays lazy', () => {
  it('does not import Kokoro, Transformers, or ORT from the app entry', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
    const client = readFileSync(new URL('./kokoroWorkerClient.js', import.meta.url), 'utf8')
    const combined = `${app}\n${main}\n${client}`

    expect(combined).not.toMatch(/from ['"]kokoro-js['"]/)
    expect(combined).not.toMatch(/from ['"]@huggingface\/transformers['"]/)
    expect(combined).not.toMatch(/from ['"]onnxruntime-web/)
    expect(client).toMatch(/new Worker\(new URL\('\.\/kokoroWorker\.js'/)
  })

  it('does not enqueue worker synthesis when the Natural voice picker changes', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    const client = readFileSync(new URL('./kokoroWorkerClient.js', import.meta.url), 'utf8')
    const worker = readFileSync(new URL('./kokoroWorker.js', import.meta.url), 'utf8')
    expect(app).toMatch(/await ensureVoiceBinCached\(voiceId\)/)
    expect(app).not.toMatch(/prefetchVoice/)
    expect(app).not.toMatch(/cacheCuratedVoiceBins/)
    expect(client).not.toMatch(/prefetchVoice/)
    expect(worker).not.toMatch(/prefetch-voice/)
  })

  it('defaults to Natural and forbids the quantized runtime policy', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    const engine = readFileSync(new URL('./kokoroEngine.js', import.meta.url), 'utf8')
    const worker = readFileSync(new URL('./kokoroWorker.js', import.meta.url), 'utf8')

    expect(app).toMatch(/useState\('kokoro'\)/)
    expect(engine).toMatch(/dtype: 'fp32'/)
    expect(worker).toMatch(/dtype !== 'fp32'/)
    expect(`${engine}\n${worker}`).not.toMatch(/dtype: 'q8'|dtype !== 'q8'/)
  })
})

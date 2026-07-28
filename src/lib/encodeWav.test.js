import { describe, expect, it } from 'vitest'

import { encodeWav, wavFilenameFromDocumentName } from './encodeWav'

async function readWav(blob) {
  const buffer = await blob.arrayBuffer()
  return new DataView(buffer)
}

describe('encodeWav', () => {
  it('throws when given no chunks', () => {
    expect(() => encodeWav([])).toThrow()
    expect(() => encodeWav(null)).toThrow()
  })

  it('throws on mixed sample rates', () => {
    expect(() =>
      encodeWav([
        { samples: new Float32Array([0]), sampleRate: 24000 },
        { samples: new Float32Array([0]), sampleRate: 22050 },
      ]),
    ).toThrow(/sample rate/i)
  })

  it('writes a well-formed RIFF/WAVE header sized to the PCM data', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1])
    const blob = encodeWav([{ samples, sampleRate: 24000 }])
    const view = await readWav(blob)

    const readAscii = (offset, len) =>
      Array.from({ length: len }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('')

    expect(readAscii(0, 4)).toBe('RIFF')
    expect(readAscii(8, 4)).toBe('WAVE')
    expect(readAscii(12, 4)).toBe('fmt ')
    expect(readAscii(36, 4)).toBe('data')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(24000) // sample rate
    expect(view.getUint16(34, true)).toBe(16) // bits per sample

    const dataSize = samples.length * 2
    expect(view.getUint32(40, true)).toBe(dataSize)
    expect(view.getUint32(4, true)).toBe(36 + dataSize)
    expect(blob.size).toBe(44 + dataSize)
  })

  it('rounds PCM16 samples instead of truncating toward zero', async () => {
    // 0x7fff * (1/3) = 10922.33..., which truncates to 10922 but rounds to 10922 as well;
    // pick a value where truncation and rounding disagree.
    const samples = new Float32Array([0.99999, -0.99999])
    const blob = encodeWav([{ samples, sampleRate: 24000 }])
    const view = await readWav(blob)

    const expectedPos = Math.round(0.99999 * 0x7fff)
    const expectedNeg = Math.round(-0.99999 * 0x8000)
    expect(view.getInt16(44, true)).toBe(expectedPos)
    expect(view.getInt16(46, true)).toBe(expectedNeg)
  })

  it('clamps out-of-range samples to +/-1 before encoding', async () => {
    const samples = new Float32Array([2, -2])
    const blob = encodeWav([{ samples, sampleRate: 24000 }])
    const view = await readWav(blob)

    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })

  it('concatenates multiple chunks in order', async () => {
    const blob = encodeWav([
      { samples: new Float32Array([0, 0]), sampleRate: 24000 },
      { samples: new Float32Array([1]), sampleRate: 24000 },
    ])
    const view = await readWav(blob)
    expect(view.getUint32(40, true)).toBe(3 * 2)
  })
})

describe('wavFilenameFromDocumentName', () => {
  it('strips the original extension and adds .wav', () => {
    expect(wavFilenameFromDocumentName('report.pdf')).toBe('report.wav')
  })

  it('sanitizes special characters and spaces', () => {
    expect(wavFilenameFromDocumentName('My Report (final)!.docx')).toBe('My-Report-final.wav')
  })

  it('falls back to "audio" for empty/nullish names', () => {
    expect(wavFilenameFromDocumentName('')).toBe('audio.wav')
    expect(wavFilenameFromDocumentName(undefined)).toBe('audio.wav')
  })
})

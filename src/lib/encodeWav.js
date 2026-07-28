/**
 * Encode Float32 PCM chunks as a 16-bit mono WAV blob and trigger download.
 * Kokoro emits 24 kHz; we keep whatever sampleRate the chunks share.
 */

/** Cap on collected download length (~43 MB WAV at 24 kHz / 16-bit mono). */
export const MAX_DOWNLOAD_AUDIO_SECONDS = 15 * 60

/**
 * @param {{ samples: Float32Array, sampleRate: number }[]} chunks
 * @returns {Blob}
 */
export function encodeWav(chunks) {
  if (!chunks?.length) {
    throw new Error('No audio to encode.')
  }

  const sampleRate = chunks[0].sampleRate || 24000
  let totalSamples = 0
  for (const chunk of chunks) {
    if (chunk.sampleRate && chunk.sampleRate !== sampleRate) {
      throw new Error('Mixed sample rates cannot be encoded into one WAV.')
    }
    totalSamples += chunk.samples.length
  }

  const bytesPerSample = 2
  const dataSize = totalSamples * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (const chunk of chunks) {
    const samples = chunk.samples
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(offset, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the browser has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * @param {string} documentName
 * @returns {string}
 */
export function wavFilenameFromDocumentName(documentName) {
  const base = String(documentName || 'audio')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return `${base || 'audio'}.wav`
}

/**
 * Encode chunks and trigger a browser download.
 * @param {{ samples: Float32Array, sampleRate: number }[]} chunks
 * @param {string} [documentName]
 */
export function downloadWav(chunks, documentName) {
  const blob = encodeWav(chunks)
  downloadBlob(blob, wavFilenameFromDocumentName(documentName))
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

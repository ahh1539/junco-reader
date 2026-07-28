export function isLikelyMobile() {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export async function hasWebGPU() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return false
  try {
    const adapter = await navigator.gpu.requestAdapter()
    return Boolean(adapter)
  } catch {
    return false
  }
}

/**
 * Soft capability guidance; never hard-blocks.
 */
export async function getCapabilityMessage() {
  const mobile = isLikelyMobile()
  const webgpu = await hasWebGPU()

  if (mobile && !webgpu) {
    return 'Works best on a desktop browser. On phones, synthesis may be slow. The Junco iOS app is built for listening on the go.'
  }
  if (mobile) {
    return 'Works best on desktop. Large model downloads and synthesis are heavier on mobile data and battery.'
  }
  if (!webgpu) {
    return "WebGPU isn't available here, so synthesis will use WASM (slower). Chrome or Edge on desktop usually perform best."
  }
  return null
}

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
export async function getCapabilityMessage({ webgpu: webgpuOverride } = {}) {
  const mobile = isLikelyMobile()
  const webgpu =
    typeof webgpuOverride === 'boolean' ? webgpuOverride : await hasWebGPU()

  if (mobile && !webgpu) {
    return 'Works best on a desktop browser. Natural voice needs WebGPU. The Junco iOS app is built for listening on the go.'
  }
  if (mobile) {
    return 'Works best on desktop. Large model downloads and synthesis are heavier on mobile data and battery.'
  }
  if (!webgpu) {
    return "Natural voice isn't available here (WebGPU required). Use a current desktop browser with hardware acceleration enabled."
  }
  return null
}

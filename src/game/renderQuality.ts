/**
 * Software WebGL detection. SwiftShader, WARP ("Microsoft Basic Render Driver") and llvmpipe
 * rasterise on the CPU (hardware acceleration off, no GPU driver, remote desktop, VMs); the full
 * render path runs at a few frames per second there, so Game switches to a lighter one.
 */

const SOFTWARE_RENDERER = /swiftshader|basic render|llvmpipe|softpipe|software/i;

function release(gl: WebGL2RenderingContext | null): void {
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
}

export function isSoftwareWebGL(): boolean {
  try {
    const plain = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!plain) return false;
    const info = plain.getExtension('WEBGL_debug_renderer_info');
    const name = String(plain.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : plain.RENDERER) ?? '');
    release(plain);
    if (SOFTWARE_RENDERER.test(name)) return true;
    // Browsers refuse a "major performance caveat" context exactly when they would fall back to software.
    const strict = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    release(strict);
    return !strict;
  } catch {
    return false;
  }
}

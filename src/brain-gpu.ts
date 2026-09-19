export interface WebGpuStatus {
  available: boolean;
  message: string;
}

/**
 * Probe GPU availability without changing neural state; the production simulation currently uses the
 * CPU engine.
 */
export async function probeWebGpu(): Promise<WebGpuStatus> {
  const gpu = (globalThis as typeof globalThis & { navigator?: Navigator & { gpu?: { requestAdapter(): Promise<unknown> } } }).navigator?.gpu;
  if (!gpu) return { available: false, message: "WebGPU unavailable; sparse CPU backend active" };
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? { available: true, message: "WebGPU sparse kernel available" } : { available: false, message: "No WebGPU adapter; sparse CPU backend active" };
  } catch {
    return { available: false, message: "WebGPU probe failed; sparse CPU backend active" };
  }
}

// Experimental decay/injection shader sketch; no CSR traversal or complete neural model is implemented
// here. The worker uses the CPU engine, and GPU parity has not been established.
struct Params {
  neuronCount: u32,
  threshold: f32,
  decay: f32,
  inputGain: f32,
};

@group(0) @binding(0) var<storage, read_write> voltage: array<f32>;
@group(0) @binding(1) var<storage, read> retinalDrive: array<f32>;
@group(0) @binding(2) var<storage, read> visualIds: array<u32>;
@group(0) @binding(3) var<storage, read_write> spikes: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(64)
fn decay_and_inject(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= params.neuronCount) { return; }
  voltage[id] = voltage[id] * params.decay;
  if (id < arrayLength(&visualIds)) {
    voltage[visualIds[id]] = voltage[visualIds[id]] + retinalDrive[id] * params.inputGain;
  }
  spikes[id] = select(0u, 1u, voltage[id] >= params.threshold);
}

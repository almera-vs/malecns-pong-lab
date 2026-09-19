# Architecture and experimental boundaries

The application separates neural state, task/body state, and presentation. These boundaries make it possible to locate the source of an observed behavior and to change one component in a controlled experiment.

## Committed simulation cycle

1. `PongGame.render` draws the current committed court to a dedicated sensory canvas.
2. `poolBinocularLuminance` integrates its pixels into 64 channels.
3. The worker receives those channels, previous joint angle/velocity, reward/event labels, side/action, aversive drive, and episode seed.
4. `MaleCnsBrain` integrates the retained graph for four 4 ms ticks by default. Photoreceptor, proprioceptor, and dopamine populations come from annotation mapping. Intrinsic stimulation and motor homeostasis are additional modeled inputs/adaptations.
5. Complete motor-pool counts produce rates averaged across cells and simulated batch duration.
6. `FlyPaddleEmbodiment` advances its filtered rates, activation, adaptive gains, joint state, and paddle targets using the worker's 16 ms duration.
7. `PongGame.step` advances paddles and ball by the same duration and emits a sparse event for the next neural batch.
8. The application records the batch, updates presentation state, and requests the next computation independently of animation refresh.

Ball position/velocity and paddle coordinates stay on the environment side. The side/action labels are nevertheless task-specific teaching information. Both outputs share one connectome. The procedural fly consumes embodiment state solely for display.

## Runtime ownership

| Owner | Persistent state |
| --- | --- |
| Neural worker | Full retained graph, outgoing adjacency, active/pending states, refractory state, RNG keys, intrinsic reservoir, plastic mask, weights, eligibility, teaching queue, homeostatic biases |
| Main thread: body/task | Activation filters, bilateral gain, endpoint bias, joint angles/velocities, ball/paddles, serve RNG, pending event |
| Presentation | Cached anatomy, sampled activity, raster bitmap, interpolated game/body poses, selected-cell inspection |

Display filters do not change the graph. The worker transmits at most 512 spike IDs per batch for display but retains complete internal spike counts. Active-edge telemetry is capped at 384 entries and is not a full transmission log. The anatomy layer retains all known soma coordinates, while the raster bins the worker-sampled IDs.

## Worker protocol

| Request | Effect |
| --- | --- |
| `load` | Read the local manifest, verify declared hashes, validate metadata/CSR, build the interface audit and CPU engine |
| `step` | Advance neural state from a committed observation and return duration, rates, counts, credit diagnostics, and sampled display data |
| `select` | Change the inspection target without advancing simulated time |
| `reset` | Clear neural state, learned weights, eligibility, teaching events, homeostasis, history, and clock |

Responses are `progress`, `ready`, `step`, `selected`, `reset`, or `error`. A failed load is surfaced and retry constructs a new worker. The browser requests its own `data/runtime/manifest.json`; no hosted graph is substituted. The CPU implementation is active regardless of GPU availability. `brain-gpu.ts` is a capability probe and the WGSL file is an incomplete experimental sketch.

## Event-local credit

An event snapshots preceding eligibility before teaching stimulation. A teaching-cell spike within 32 ms gates each queued event once. Side/action masks select structurally reachable routes, which may overlap. Positive gameplay eligibility is multiplied by the event's own sign and immutable base weight. Display dopamine cannot cause repeated updates or determine reward polarity.

Misses request probability-one stimulation for one batch through the annotated dopamine population. This is a virtual aversive gateway; actual spiking and a nonempty population remain necessary. It neither establishes anatomical nociception nor proves that the labeled action caused the outcome.

## Clock and reset semantics

The nominal neural clock is shared with task/body integration, but not every internal process is tick-normalized: retinal adaptation and motor homeostasis update once per batch. Altering batching is a model intervention.

`Reset game` preserves brain weights and most neural state, changes the episode seed, and resets task/body state. `Reset brain` performs the full worker reset as well. Logs can therefore span multiple episodes and neural-time discontinuities; segment them explicitly before plotting. See [methods](NEUROSCIENCE_METHODS.md), [evaluation protocol](EXPERIMENTS.md), and [reproducibility](REPRODUCIBILITY.md).

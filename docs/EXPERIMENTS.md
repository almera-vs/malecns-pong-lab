# Experimental protocol and evidence

## Archived pilot

The [pilot report](../paper/evidence/pilot-learning-evaluation.json) is the complete three-seed run supporting the README and manuscript. Reproduce it after installing the full local runtime:

```powershell
node --experimental-strip-types scripts/learning-evaluation.mjs --seeds=11,29,47 --train-seconds=10 --eval-seconds=10
```

Durations are simulated seconds. Each seed trains one `MaleCnsBrain`, saves its plastic weights, and evaluates trained versus original weights under the same held-out seed `(trainingSeed ^ 0x9e3779b9) >>> 0`. Both arms reset neural, body, and game state. Only the trained arm restores the learned vector. Synaptic plasticity is disabled during evaluation; motor threshold homeostasis and actuator adaptation remain enabled.

The software camera rasterizes the court and calls the application's exact area-pooling function. It does not reproduce browser antialiasing. Only image channels and joint state become sensory observations; reward includes side/action labels. Current training uses sparse hit/miss events with **no alignment-shaping reward**.

| Seed | Train H/M | Distinct changed weights | Trained H/M | Original H/M | Paired rate difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| 11 | 0/5 | 477 | 1/4 | 1/4 | 0 |
| 29 | 3/1 | 436 | 1/3 | 1/3 | 0 |
| 47 | 2/2 | 418 | 0/5 | 0/5 | 0 |

Both evaluation arms have two hits and twelve misses in aggregate. Their mean seed-level hit rate is 0.15; their pooled hit rate is 2/14. These summarize different denominators. All paired differences are zero, with only four or five opportunities per arm/seed. This does not establish statistical equivalence or learning efficacy. A lack of benefit in this short pilot is not a claim about all training durations or configurations.

The report's final `changedWeights` is the number of distinct final weights differing from base. `learningStats.changedWeights` counts cumulative nonzero update operations, possibly repeatedly on the same edge. Applied events measure successful gating, not successful behavior.

## Outcome definitions and boundary effects

Hit rate is `hits / (hits + misses)` or `null` when there are no opportunities. The paired estimator subtracts original-weight rate from trained-weight rate within each seed. The runner counts returned `paddle_hit` and `miss` events on both sides; do not substitute `game.state.hits`, which currently increments on left hits only.

Each segment advances complete batches until its duration threshold is reached, so arbitrary durations may overshoot by one batch. A final generated reward is not flushed into an additional neural batch. The runner constructs a new game rather than calling its reset method; the initial vertical ball velocity is therefore 120 px/s rather than the reset serve distribution. The two evaluation arms share these choices, but browser-reset comparisons must account for them.

The runner labels evidence insufficient unless there are at least three seeds and twenty training/evaluation opportunities per segment and arm. Passing that threshold is only a descriptive flag; it is not a power calculation or significance test.

## Other existing tools

```powershell
node --experimental-strip-types scripts/strict-emergent-smoke.mjs 1000
node --experimental-strip-types scripts/strict-emergent-smoke.mjs 1000 --no-learning
node --experimental-strip-types scripts/strict-emergent-smoke.mjs 1000 --no-recurrence
```

This smoke runner accepts a batch count and uses point-sampled synthetic vision. It verifies runtime activity and logs motor/output diagnostics; it is not interchangeable with the area-pooled learning experiment. `--no-recurrence` blocks transmission from non-external sources, not just cyclic edges. Changing environment variables can also select legacy decay settings; archive the emitted configuration rather than assuming defaults.

`scripts/benchmark-brain.mjs` is a computational-throughput harness with synthetic inputs. Its `--interactive` branch supplies its own overrides, and its `baseline` mode requires a separately retained source file. It is not a task-learning benchmark or a drop-in replication of browser defaults.

## Proposed confirmatory study

Before evaluating efficacy, prespecify training duration, independent seeds, primary outcome, failure handling, and the number of evaluation opportunities. Use the seed, rather than each collision, as the independent replicate. Report paired distributions and justified uncertainty intervals; neither rally events nor two paddles in one connectome are independent subjects.

Required additional controls include stationary paddles, matched random actuator activity, static/shuffled visual input, training with plasticity disabled, and separate controls for intrinsic drive, motor homeostasis, and bilateral/endpoint actuator adaptation. Sensor-map alternatives and sign conventions should be independently justified. Timestep and batch-size sensitivity must address retinal adaptation and homeostasis, which currently depend on batching. These controls are proposed work, not implemented results or UI switches.

## Publication record

Archive source revision and hashes, exact runtime manifest and source-table hashes, complete neural/actuator/task parameters, seed pairs, camera implementation, software/hardware environment, duration, raw event counts, and protocol. The existing pilot report contains neural configuration, selected source hashes, manifest hash, Node version, seeds, aggregate counts, and wall times; the companion audit extends structural/source/host provenance. It does not provide complete event-level trajectories or a replayable learned-weight checkpoint.

Browser logs contain batch observations but are not complete provenance archives. State resets can introduce multiple episodes and time discontinuities. Historical local logs with different source hashes are exploratory records, not evidence for this version. Selected evidence belongs in `paper/evidence/`; working reports remain ignored under `experiments/runs/`.

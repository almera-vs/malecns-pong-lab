# MaleCNS Pong Lab

MaleCNS Pong Lab is a browser-based research platform for inspectable, closed-loop sensorimotor experiments on a connectome-constrained neural model. It connects a simplified Pong environment to selected populations from the adult male Drosophila central-nervous-system dataset, simulates sparse spiking activity over retained anatomical edges, and uses activity in annotated tibia motor pools to control a deliberately simple limb-and-paddle mechanism.

This is not a whole-animal simulation and it does not claim biological fidelity or useful learned control. Its purpose is narrower and more useful for experimentation: make every important bridge between a structural connectome and observable behavior explicit, inspectable, and testable.

## What the project does

The application runs a continuous feedback loop:

~~~mermaid
flowchart LR
    Court[Rendered Pong court] --> Camera[Area-pooled camera image]
    Camera --> Retina[Annotated photoreceptor inputs]
    Retina --> Brain[Sparse connectome dynamics]
    Brain --> Motor[Annotated tibia motor pools]
    Motor --> Plant[Engineered muscle and joint plant]
    Plant --> Paddle[Paddle motion]
    Paddle --> Court
    Plant --> Proprioception[Joint angle and velocity signals]
    Proprioception --> Brain
    Court --> Events[Hit or miss event]
    Events --> Credit[Teaching input and eligibility credit]
    Credit --> Brain
~~~

The browser samples the court as two overlapping image crops and reduces them to 64 luminance channels. Those channels drive annotation-matched photoreceptors; joint position and velocity drive annotation-matched proprioceptor pools. A worker owns the neural state, computes sparse activity, and returns motor-pool rates. The main thread then applies an engineered muscle activation and joint model to move the paddles. Hits and misses can create short-lived, labelled teaching events that update a bounded set of existing sensory-to-motor edges.

The visual scene, neural state, activity display, muscle plant, and experiment controls are kept separate on purpose. This makes it possible to ask whether a result comes from the retained graph, a modelling assumption, a numerical choice, or a display-only feature.

## Scientific scope and current evidence

The retained MaleCNS v1.0 runtime contains 166,700 annotated neurons, 25,582,938 directed neuron-pair edges, and 124,177,617 summed contact counts. These describe the project's converted runtime rather than every object or synapse in the source release. The model stores unresolved-sign connections but does not let them transmit under its deliberately coarse sign convention.

A three-seed pilot established that the event-gated learning path can modify weights: 418 to 477 distinct weights changed across the tested training runs. Under matched held-out evaluations, however, trained and original weights had the same hit and miss counts for each seed. That is evidence of executable machinery, not evidence of a learning benefit, statistical equivalence, or a negative result for longer and better-controlled experiments.

The project is designed to support questions such as:

- Which sensory and motor roles can be justified by released annotations?
- How does incomplete retinal coverage affect an image-to-neuron interface?
- How sensitive is behavior to timestep, batch size, background drive, and actuator parameters?
- Does a structural, event-gated plasticity rule improve held-out behavior over appropriate controls?
- Which observed motions remain when vision, recurrence, or learning is ablated?

## Model boundaries

The graph is a structural constraint, not a complete functional nervous system. The software therefore records the approximations it needs to run:

| Area | Implemented assumption |
| --- | --- |
| Transmission | Acetylcholine is treated as positive, GABA as negative, and selected histaminergic optic inputs as negative; unresolved labels carry no current. |
| Vision | Two overlapping 86%-width crops are area-pooled into 8 by 4 luminance grids. This is a software measurement, not an optical model of an eye. |
| Neural dynamics | A sparse phenomenological spiking engine uses 4 ms ticks, decaying synaptic accumulators, deterministic seeded noise, refractory periods, and sampled background drive. |
| Motor interface | Tibia flexor and extensor pools are selected from metadata. Their filtered spike rates drive an engineered antagonist muscle and joint plant. |
| Learning | Eligibility traces and labelled hit/miss events alter only sampled, existing, sign-resolved edges on bounded sensory-to-motor paths. |
| Embodiment | The fly mesh is illustrative. Paddle movement is a task-specific actuator rather than reconstructed biomechanics. |

These choices are features of the experiment, not hidden implementation details. Changing them can change behavior, so they should be documented with any result.

## Architecture

The worker/main-thread split preserves a clean execution boundary. The worker owns neuron state, edge weights, delayed credit, and deterministic random state. The main thread renders the court, measures the committed frame, integrates the limb plant, and presents activity. Display interpolation never becomes sensory input or task physics.

The active neural engine is MaleCnsBrain in src/brain.ts. It uses target-oriented compressed-sparse-row adjacency and activates only cells with meaningful accumulated input. SparseBrain is a smaller synthetic model used by tests. The WebGPU shader file is an exploratory sketch; the CPU sparse engine is the active backend.

The implementation also makes the following information boundaries explicit:

- Neural vision receives pooled image channels, not direct ball, paddle, or velocity coordinates.
- Joint-angle and velocity signals are supplied as engineered proprioception.
- Side and action labels are available to the learning path, so the system is not accurately described as image-only learning.
- Both paddles are outputs of one shared connectome, not independent agents.
- Activity rendering, soma selection, and population filters are inspection tools and do not modify connectivity.

## Prerequisites

Use Node.js 22.13 or newer, npm, and a current browser with module workers, Canvas, Web Crypto, and gzip DecompressionStream. Python is required only for runtime conversion and optional activity plots. WebGPU is optional.

The source tree contains tests and fixtures that work without the biological runtime. Playing the full experiment additionally requires a locally prepared runtime under public/data/runtime/; large source data and generated runtime files are intentionally excluded from version control.

## Install and run

From the repository root:

~~~powershell
npm ci
npm run check
npm test
~~~

Prepare the data runtime by following public/data/README.md. Then start the application:

~~~powershell
npm run dev
~~~

Open the local URL printed by the launcher, normally http://127.0.0.1:5173. Before a simulation begins, the loader validates the runtime manifest, file hashes, metadata cardinality, and sparse-graph bounds. If a required resource is absent or invalid, the UI reports the error rather than silently substituting a hosted or synthetic graph.

npm run build writes the browser application to dist/. The build includes browser-consumed runtime files only when a local runtime has been installed.

## Running an experiment

Use the live view to inspect retinal input, anatomical activity, motor-pool rates, embodiment pose, reward diagnostics, and simulated versus wall-clock time. Selecting a soma reveals its metadata, connection counts, recent spikes, and membrane trace. Optional SWC morphology is fetched only for inspection.

The main controls have experimental consequences:

| Control | Meaning |
| --- | --- |
| Pause | Stops new requested simulation steps while continuing to show committed state. |
| Reset game | Resets the body and task with a new seed while preserving neural learning state. |
| Reset brain | Resets the body, task, neural state, weights, and eligibility with a new seed. |
| Download run log | Writes batch records for later analysis; preserve data provenance with the log. |
| Population filters and soma selection | Change the inspection view only. |

For a paired learning evaluation after installing the runtime, run:

~~~powershell
node --experimental-strip-types scripts/learning-evaluation.mjs --seeds=11,29,47 --train-seconds=10 --eval-seconds=10
~~~

Each seed is trained, then evaluated with learned and original weights from the same reset state and held-out seed. Plasticity is disabled during evaluation; motor homeostasis and actuator adaptation remain active. Treat this as a small pilot protocol, not a general benchmark.

Useful smoke checks and ablations are:

~~~powershell
node --experimental-strip-types scripts/strict-emergent-smoke.mjs 1000
node --experimental-strip-types scripts/strict-emergent-smoke.mjs 1000 --no-learning
node --experimental-strip-types scripts/strict-emergent-smoke.mjs 1000 --no-recurrence
~~~

The argument is a batch count, not seconds. This legacy runner point-samples its scene and is not the area-pooled evaluation benchmark.

## Verification and reproducibility

Run the complete local verification sequence with:

~~~powershell
npm run check
npm test
npm run build
node --experimental-strip-types scripts/research-audit.mjs
~~~

The test suite covers annotation mapping, data validation failures and recovery, deterministic trajectories, event credit, image pooling, timing behavior, and embodiment limits. Passing these tests establishes software properties, not biological validity.

The research audit records source hashes, runtime-manifest hash, graph and mapping counts, configuration, and host metadata. Save the exact report, runtime manifest, data-source snapshot, source revision, environment details, and experiment protocol alongside any result. Do not compare runs made with different data hashes as if they were measurements of the same model.

## Known limitations

- A connectome does not specify synaptic strengths, all transmission signs, membrane properties, sensory receptive fields, or body mechanics.
- Some retinal mapping is based on mixed annotation and soma-position proxies; coverage is incomplete.
- Background activity, motor homeostasis, bilateral torque normalization, endpoint recovery, and actuator adaptation can influence motion independently of useful visual control.
- The plasticity mask establishes structural reachability, not an exclusive causal path.
- Eligibility has an approximately 200 ms configured time constant. A delayed task event is not guaranteed to have usable residual credit.
- The browser's state.hits display counts left contacts only; scientific paired evaluations count returned hit events from both sides.

These are recorded to make future controls and improvements measurable rather than to imply that the current approximation is complete.

## Repository guide

| Path | Purpose |
| --- | --- |
| src/brain.ts, src/reward-credit.ts | Sparse dynamics, structural plastic mask, and event credit. |
| src/data-loader.ts, src/biological-interface.ts | Runtime validation and annotation-based population mapping. |
| src/retina.ts, src/game.ts, src/fly-embodiment.ts | Observation sampling, Pong task, and actuator model. |
| src/main.ts, src/worker.ts | UI/worker protocol, scheduling, and run logs. |
| src/visualization.ts, src/activity-display.ts, src/fly-*.ts | Anatomy and embodiment inspection views. |
| scripts/prepare-data.mjs, scripts/prepare_runtime.py | Data acquisition checks and runtime conversion. |
| scripts/learning-evaluation.mjs, scripts/research-audit.mjs | Paired evaluation and provenance auditing. |
| data/ | Small source and runtime provenance manifests. |
| docs/ | Architecture, neuroscience methods, experiments, data provenance, visualization, and reproducibility notes. |

## Data and license

Repository software is provided under the MIT License. MaleCNS v1.0 is separate data under CC BY 4.0 and retains its own attribution requirements. Consult data/manifest.example.json and the data provenance documentation before redistributing derived datasets or results.

When citing work built on this project, cite the exact source revision or release, the exact data snapshot, and the recorded experiment configuration. The project intentionally keeps large biological inputs, locally generated runtimes, experiment outputs, and manuscript materials out of Git.

# Reproducibility

## Software verification

Use Node 22.13 or newer and run from the repository root:

```powershell
npm ci
npm run check
npm test
npm run build
```

`npm test` builds the application, runs core assertions and Node integration tests, and runs Vitest when installed. The complete installed suite has 21 Node tests and 27 Vitest tests. Without Vitest it uses a more limited static smoke fallback. `npm run check` checks source invariants; it is not a TypeScript typecheck. The build uses Vite when installed and Node's TypeScript transform otherwise.

The [verification record](../paper/evidence/software-verification.json) records checks performed for this documentation revision. Synthetic fixtures verify software behavior and deterministic trajectories; they do not validate the full biological model.

## Data reproduction

Follow [public/data/README.md](../public/data/README.md) for the complete download and conversion commands, including the required optic-column workbook. Source URLs and hashes are in [data/manifest.example.json](../data/manifest.example.json). [data/runtime-manifest.json](../data/runtime-manifest.json) is the small archived manifest of the runtime used for the pilot; its relative filenames describe files installed under `public/data/runtime/`, not files located alongside the archive.

The converter requires NumPy, pandas, SciPy, PyArrow, and openpyxl. Its pinned dependency file is preserved as supplied. The present publication pass audited the installed converted runtime; it did not reinstall converter dependencies or regenerate the source conversion. Large raw data is not committed.

## Runtime and source audit

```powershell
node --experimental-strip-types scripts/research-audit.mjs experiments/runs/runtime-audit.json
```

The optional path above keeps the published audit unchanged. With no argument, the script writes `paper/evidence/runtime-audit.json`. It loads and validates the installed graph, records source hashes, graph/sign/mapping counts, neural and static embodiment constants, derived time constants, runtime hash, and host metadata. A null revision means no committed HEAD was available; source hashes identify the audited working tree. The audit is not a performance benchmark and does not archive all hidden numerical state.

## Pilot replication

```powershell
node --experimental-strip-types scripts/learning-evaluation.mjs --seeds=11,29,47 --train-seconds=10 --eval-seconds=10
```

Compare deterministic fields against [the archived report](../paper/evidence/pilot-learning-evaluation.json). Wall-clock values are machine-dependent. The evaluation uses software-raster observations, not identical browser pixels. Both arms share the held-out seed and reset state; homeostasis remains enabled. See [EXPERIMENTS.md](EXPERIMENTS.md) for metric definitions and endpoint effects.

## Publishing a stable snapshot

Keep the source tree, lockfile, source manifest, runtime manifest, evidence files, and study protocol together. Add the actual GitHub repository URL and a release commit/tag when assigned; no URL, DOI, affiliation, or release history is invented here. The current source tree began without a committed HEAD. A manuscript claim tied only to an ignored historical run cannot be reproduced from GitHub.

The paper build uses LaTeX and BibTeX as documented in [paper/README.md](../paper/README.md). LaTeX was unavailable in the editing environment, so typeset PDF output and visual layout were not verified. Optional plotting consumes browser logs; segment resets first and do not interpret the asymmetric browser `hits` counter as all contacts.

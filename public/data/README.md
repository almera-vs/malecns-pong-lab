# Runtime data

The full MaleCNS v1.0 tables and the locally generated runtime are installed under `public/data/runtime/` and intentionally git-ignored. At startup the application requires that directory's `manifest.json`. A missing or invalid runtime produces a visible failure; there is no hosted-graph fallback. The small [archived manifest](../../data/runtime-manifest.json) describes the pilot data but does not contain the graph itself.

The page reports manifest, metadata, compressed chunk, checksum, CSR validation, and final neuron/edge counts before beginning the experiment.

To rebuild the local runtime, install the pinned converter dependencies into the ignored project-local environment, then run:

```powershell
python -m pip install --target public/data/runtime/python-libs -r scripts/requirements-runtime.txt
node scripts/prepare-data.mjs data/manifest.example.json
python scripts/prepare_runtime.py `
  --annotations public/data/runtime/body-annotations-male-cns-v1.0-minconf-0.5.feather `
  --neurotransmitters public/data/runtime/body-neurotransmitters-male-cns-v1.0.feather `
  --weights public/data/runtime/connectome-weights-male-cns-v1.0-minconf-0.5.feather `
  --optic-columns public/data/runtime/optic-column-type-assignments-v1.0.xlsx `
  --output public/data/runtime
```

Run these commands from the repository root. The pip command installs converter dependencies; `prepare-data.mjs` downloads and verifies the four source files using pinned URLs and SHA-256 values. The downloader writes an acquisition manifest to the same runtime path, so complete conversion before starting the application. The Python converter replaces it with the actual browser CSR manifest. Do not run acquisition alone over an installed runtime and expect its temporary manifest to load as a graph.

The converter preserves annotation fields and assigns R7/R8 receptors from the published optic-column supplement. R1–R6 cells inherit the column of their strongest assigned L1 partner. This is a structural mapping, not calibrated fly visual angles. The full EM volume is unnecessary. Conversion requires substantially more disk and memory than the approximately 84.5 MB compressed browser payload; no minimum converter-memory figure has been benchmarked here.

The pinned converter dependencies are preserved as supplied. This documentation pass audited the installed runtime but did not reinstall dependencies or repeat conversion. Run the separate normalization checks after installation:

```powershell
python scripts/prepare_runtime_test.py
```

After conversion, run `node --experimental-strip-types scripts/research-audit.mjs experiments/runs/runtime-audit.json` to verify the graph and record annotation coverage. A checksum mismatch requires the expected artifact; do not bypass checking to make a different release appear equivalent. Data remains separately CC BY 4.0 with attribution described in [data provenance](../../docs/DATA_PROVENANCE.md).

# Data provenance and attribution

The primary resource is the [MaleCNS v1.0 download service](https://male-cns.janelia.org/download/) and its associated [Cell paper](https://doi.org/10.1016/j.cell.2026.08.015). The runtime uses body annotations, consensus transmitter predictions, directed contact counts, and the optic-column workbook pinned in [data/manifest.example.json](../data/manifest.example.json). Raw EM imagery and synapse-location tables are not required for normal application execution.

## Conversion contract

`scripts/prepare_runtime.py` retains records with a non-null superclass, removes duplicate body identifiers, excludes edges outside the retained population, and aggregates directed contacts into target-oriented CSR arrays. It preserves original annotation fields in compressed metadata and records source-file hashes. R7/R8 mapping comes from the workbook; R1–R6 mapping uses the strongest assigned L1 partner. These mappings are structural proxies without angular calibration.

The audited conversion contains 166,700 annotated neurons, 25,582,938 directed edges, and 124,177,617 contacts. These are conversion-specific counts. The original weight table contains segmentation objects outside the retained annotated population.

## Installed versus archived manifests

The application reads the **locally generated and git-ignored** `public/data/runtime/manifest.json`. It does not use a hosted fallback. The small [archived manifest](../data/runtime-manifest.json) records the exact pilot runtime without redistributing its binary graph. Filenames inside that archive are relative to the runtime directory. The [audit](../paper/evidence/runtime-audit.json) records its SHA-256 and source/host context.

The loader verifies compressed metadata/chunk hashes declared by the manifest, decompresses gzip data, validates CSR lengths, monotonic offsets, source bounds, and positive contact counts, and normalizes metadata. It then reports annotation coverage. Valid checksums establish artifact integrity, not biological accuracy or a complete functional sensorimotor pathway.

## Coordinates and transmission uncertainty

The loader preserves available 8 nm soma positions and derives a common centered display transform. The 27,038 cells lacking positions remain in the graph without invented soma coordinates. Optional official SWC files are requested only for inspected cells.

Transmitter signs are approximate. Unresolved labels remain zero-current sources, including receptor-ambiguous glutamate. The stored graph and the effective transmission graph consequently differ. The [methods](NEUROSCIENCE_METHODS.md) describe these assumptions and the audit counts.

## Licensing and release

MaleCNS data is CC BY 4.0 with attribution to its scientific contributors. Repository materials retain the existing [MIT license](../LICENSE). The project does not apply its software license to the dataset. Keep source URLs, hashes, conversion procedure, and dataset citation with derived releases. Raw data and generated working outputs stay ignored; the small selected manifests and pilot evidence are included for scientific review.

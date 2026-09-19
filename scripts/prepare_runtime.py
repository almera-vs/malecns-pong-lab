"""Preserve annotated structural evidence in a checksummed browser CSR resource.

Local source tables define the retained population, contact counts, and mapping
proxies. Source hashes make the conversion auditable without acquiring EM images.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

# Resolve pinned converter libraries from a project-local directory so data preparation dependencies
# remain isolated.
LOCAL_PYTHON_LIBS = Path(__file__).resolve().parents[1] / "public" / "data" / "runtime" / "python-libs"
if LOCAL_PYTHON_LIBS.is_dir():
    sys.path.insert(0, str(LOCAL_PYTHON_LIBS))

import numpy as np
import pandas as pd


SYNAPSE_CURRENT_MV = 0.0275


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--neurotransmitters", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--optic-columns", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset", default="male-cns:v1.0")
    args = parser.parse_args()
    from scipy import sparse
    args.output.mkdir(parents=True, exist_ok=True)

    annotations = pd.read_feather(args.annotations)
    neurotransmitters = pd.read_feather(args.neurotransmitters)
    weights = pd.read_feather(args.weights)
    body_col = choose(annotations, "bodyId", "body_id", "body")
    source_col = choose(weights, "body_pre", "source", "body_source")
    target_col = choose(weights, "body_post", "target", "body_target")
    weight_col = choose(weights, "weight", "weight_m", "count")
    if "superclass" not in annotations:
        raise ValueError("annotations must contain superclass; refusing an unannotated retained set")

    annotations = annotations[annotations["superclass"].notna()].copy()
    annotations["bodyId"] = pd.to_numeric(annotations[body_col], errors="raise").astype(np.uint64)
    annotations = annotations.drop_duplicates("bodyId", keep="first").reset_index(drop=True)
    body_to_id = pd.Series(np.arange(len(annotations), dtype=np.uint32), index=annotations["bodyId"])
    l1_positions_by_body, receptor_positions_by_body = load_optic_column_assignments(args.optic_columns)
    l1_positions_by_id = {
        int(body_to_id.loc[body_id]): position
        for body_id, position in l1_positions_by_body.items()
        if body_id in body_to_id.index
    }
    retinal_positions_by_id = {
        int(body_to_id.loc[body_id]): (position, side)
        for body_id, (position, side) in receptor_positions_by_body.items()
        if body_id in body_to_id.index
    }

    weights["source_id"] = pd.to_numeric(weights[source_col], errors="coerce").map(body_to_id)
    weights["target_id"] = pd.to_numeric(weights[target_col], errors="coerce").map(body_to_id)
    weights = weights.dropna(subset=["source_id", "target_id", weight_col]).copy()
    weights["source_id"] = weights["source_id"].astype(np.uint32)
    weights["target_id"] = weights["target_id"].astype(np.uint32)
    weights[weight_col] = weights[weight_col].astype(np.uint32)

    # Read R7/R8 positions from published column assignments; infer R1-R6 positions through the
    # strongest annotated L1 connection. The latter is a structural proxy, not a measured visual field.
    r1_r6_ids = set(annotations.index[annotations["type"].astype("string").eq("R1-R6")].astype(np.uint32).tolist())
    l1_ids = set(l1_positions_by_id)
    r1_l1_edges = weights.loc[
        weights["source_id"].isin(r1_r6_ids) & weights["target_id"].isin(l1_ids),
        ["source_id", "target_id", weight_col],
    ]
    best_l1 = r1_l1_edges.sort_values([weight_col, "target_id"], ascending=[False, True]).drop_duplicates("source_id")
    for source_id, target_id in best_l1[["source_id", "target_id"]].itertuples(index=False, name=None):
        if int(source_id) not in retinal_positions_by_id:
            retinal_positions_by_id[int(source_id)] = l1_positions_by_id[int(target_id)]

    matrix = sparse.coo_matrix((weights[weight_col], (weights["target_id"], weights["source_id"])), shape=(len(annotations), len(annotations))).tocsr()

    offsets = matrix.indptr.astype(np.uint32)
    sources = matrix.indices.astype(np.uint32)
    counts = matrix.data.astype(np.uint32)
    offsets_files = [write_gzip(args.output / "offsets-000.bin.gz", offsets.tobytes())]
    sources_files = write_chunks(args.output, "sources", sources)
    counts_files = write_chunks(args.output, "counts", counts)

    nt = neurotransmitters.copy()
    nt_body = choose(nt, "bodyId", "body_id", "body")
    nt_name = choose(nt, "consensusNT", "consensus_nt", "neurotransmitter", "nt")
    nt_map = dict(zip(nt[nt_body].astype(str), nt[nt_name].astype(str)))
    metadata = []
    mapped_r1_r6 = 0
    mapped_direct_receptors = 0
    for node_id, values in enumerate(annotations.to_dict(orient="records")):
        body_id = str(values["bodyId"])
        nt_name_value = nt_map.get(body_id, "unclear")
        retinal_assignment = retinal_positions_by_id.get(node_id)
        retinal_position = None
        retinal_side = None
        if retinal_assignment:
            retinal_position, retinal_side = retinal_assignment
            source_side = normalize_side(first(values, "side", "somaSide", "rootSide"))
            if source_side and source_side != retinal_side:
                raise ValueError(f"optic-column side {retinal_side} conflicts with annotation side {source_side} for bodyId {body_id}")
            if str(first(values, "type", default="")) == "R1-R6":
                mapped_r1_r6 += 1
            else:
                mapped_direct_receptors += 1
        record = {key: clean_json_value(value) for key, value in values.items() if clean_json_value(value) is not None}
        record.update({
            "bodyId": body_id,
            "type": str(first(values, "type", "cell_type", default="unknown")),
            "superclass": str(values["superclass"]),
            "side": str(first(values, "side", "somaSide", "rootSide", default="")),
            "consensusNT": nt_name_value,
            "sign": fast_sign(nt_name_value, values.get("superclass")),
            "position8nm": position8nm(values),
            "retinalPosition": retinal_position,
            "retinalPositionSource": "optic-column-lattice" if retinal_assignment else None,
            "retinalEyeSide": retinal_side,
        })
        metadata.append(record)
    metadata_file = write_gzip(args.output / "neurons.json.gz", json.dumps(metadata, separators=(",", ":")).encode())
    all_files = offsets_files + sources_files + counts_files + [metadata_file]
    manifest = {
        "dataset": args.dataset,
        "sourceFiles": [source_record(path) for path in (args.annotations, args.neurotransmitters, args.weights, args.optic_columns)],
        "neurons": len(annotations),
        "graphEdges": len(sources),
        "synapses": int(counts.sum()),
        "metadata": "neurons.json.gz",
        "metadataSha256": metadata_file["sha256"],
        "arrays": [
            {"name": "offsets", "length": len(offsets), "dtype": "uint32", "parts": offsets_files},
            {"name": "sources", "length": len(sources), "dtype": "uint32", "parts": sources_files},
            {"name": "counts", "length": len(counts), "dtype": "uint32", "parts": counts_files},
        ],
        "files": all_files,
        "opticColumnMapping": {
            "source": args.optic_columns.name,
            "mappedR7R8Cells": mapped_direct_receptors,
            "mappedR1R6ViaStrongestAssignedL1Partner": mapped_r1_r6,
            "positionProjection": "normalized optic-column lattice to 8x4 image bins; angular calibration unavailable",
        },
        "assumptions": ["ACh +1 and GABA -1 as coarse fast-sign conventions; annotated ol_sensory histamine photoreceptors use -1 based on established inhibitory feed-forward signaling. Glutamate, glycine, and other transmitters map to 0 because neuron-level transmitter predictions do not identify postsynaptic receptor polarity.", f"{SYNAPSE_CURRENT_MV} mV per synapse."],
        "metadataPreserved": "All original neuron annotation fields are retained in each neuron record.",
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def choose(frame: pd.DataFrame, *names: str) -> str:
    for name in names:
        if name in frame.columns:
            return name
    raise ValueError(f"missing one of required columns: {', '.join(names)}")


def load_optic_column_assignments(path: Path) -> tuple[dict[int, tuple[tuple[float, float], str]], dict[int, tuple[tuple[float, float], str]]]:
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True)
    columns: list[tuple[str, int, int, int | None, int | None, int | None]] = []
    for sheet_name in ("Left OL", "Right OL"):
        worksheet = workbook[sheet_name]
        rows = worksheet.iter_rows(values_only=True)
        headers = next(rows)
        indexes = {str(name): index for index, name in enumerate(headers) if name is not None}
        for row in rows:
            match = re.fullmatch(r"ME_([LR])_col_(\d+)_(\d+)", str(row[indexes["column"]] or ""))
            if not match:
                continue
            side, raw_x, raw_y = match.groups()
            x, y = int(raw_x), int(raw_y)
            columns.append((side, x, y, body_id_or_none(row[indexes["L1"]]), body_id_or_none(row[indexes["R7"]]), body_id_or_none(row[indexes["R8"]])))
    workbook.close()
    if not columns:
        raise ValueError(f"no ME_[LR]_col_x_y records found in {path}")

    ranges: dict[str, tuple[int, int, int, int]] = {}
    for side in ("L", "R"):
        xs = [column[1] for column in columns if column[0] == side]
        ys = [column[2] for column in columns if column[0] == side]
        if xs and ys:
            ranges[side] = (min(xs), max(xs), min(ys), max(ys))

    l1_positions: dict[int, tuple[tuple[float, float], str]] = {}
    receptor_positions: dict[int, tuple[tuple[float, float], str]] = {}
    for side, x, y, l1, r7, r8 in columns:
        min_x, max_x, min_y, max_y = ranges[side]
        position = (
            0.5 if min_x == max_x else (x - min_x) / (max_x - min_x),
            0.5 if min_y == max_y else (y - min_y) / (max_y - min_y),
        )
        if l1 is not None:
            l1_positions[l1] = (position, side)
        for receptor in (r7, r8):
            if receptor is not None:
                receptor_positions[receptor] = (position, side)
    return l1_positions, receptor_positions


def body_id_or_none(value: object) -> int | None:
    if value is None:
        return None
    try:
        body_id = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return body_id if body_id > 0 else None


def normalize_side(value: object) -> str | None:
    side = str(value or "").strip().lower()
    if side in ("l", "left") or side.endswith("_l"):
        return "L"
    if side in ("r", "right") or side.endswith("_r"):
        return "R"
    return None


def fast_sign(name: str, superclass: object = None) -> int:
    name = name.lower()
    if "acetylcholine" in name or name == "ach":
        return 1
    if "gaba" in name:
        return -1
    if "histamine" in name and str(superclass) == "ol_sensory":
        # Assign inhibitory polarity to ol_sensory histaminergic cells under the declared
        # photoreceptor-transmission convention.
        return -1
    return 0


def position8nm(values: dict[str, object]) -> list[float] | None:
    raw = values.get("somaLocation8nm", values.get("somaLocation", values.get("soma")))
    if isinstance(raw, (list, tuple, np.ndarray)) and len(raw) >= 3:
        position = [float(raw[0]), float(raw[1]), float(raw[2])]
        return position if all(np.isfinite(value) for value in position) else None
    coordinates = [first(values, axis) for axis in ("soma_x", "soma_y", "soma_z")]
    if any(value is None for value in coordinates):
        return None
    position = [float(value) for value in coordinates]
    return position if all(np.isfinite(value) for value in position) else None


def first(values: dict[str, object], *names: str, default: object = None) -> object:
    for name in names:
        value = values.get(name)
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if isinstance(value, (float, np.floating)) and np.isnan(value):
            continue
        return value
    return default


def clean_json_value(value: object) -> object | None:
    if value is None:
        return None
    if isinstance(value, np.ndarray):
        return [clean_json_value(item) for item in value.tolist()]
    if isinstance(value, (list, tuple)):
        return [clean_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): clean_json_value(item) for key, item in value.items()}
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (str, int)):
        return value
    return str(value)


def write_chunks(output: Path, prefix: str, values: np.ndarray, chunk_size: int = 2_000_000) -> list[dict[str, object]]:
    files = []
    for index, start in enumerate(range(0, len(values), chunk_size)):
        name = f"{prefix}-{index:03d}.bin.gz"
        files.append(write_gzip(output / name, values[start:start + chunk_size].tobytes(), name=name))
    return files


def write_gzip(path: Path, payload: bytes, name: str | None = None) -> dict[str, object]:
    path.write_bytes(gzip.compress(payload, mtime=0))
    data = path.read_bytes()
    return {"file": name or path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def source_record(path: Path) -> dict[str, object]:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"file": path.name, "sha256": digest.hexdigest()}


if __name__ == "__main__":
    main()

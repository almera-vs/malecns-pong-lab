"""Plot observed batch activity and rally length from an exported run log."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path, required=True, help="JSON emitted by Download run log")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    import matplotlib.pyplot as plt

    log = json.loads(args.run.read_text(encoding="utf-8"))
    frames = log.get("frames", [])
    if not frames:
        raise ValueError("run log contains no frames")
    args.output.mkdir(parents=True, exist_ok=True)
    time = [frame["neuralTimeMs"] for frame in frames]
    spikes = [frame["totalSpikes"] for frame in frames]
    rallies = [frame["rally"] for frame in frames]
    fig, axes = plt.subplots(2, 1, figsize=(8, 5), sharex=True)
    axes[0].plot(time, spikes, color="#1596a8", linewidth=1)
    axes[0].set_ylabel("batch spikes")
    axes[1].plot(time, rallies, color="#c86b35", linewidth=1)
    axes[1].set_ylabel("rally length")
    axes[1].set_xlabel("neural time (ms)")
    fig.suptitle("MaleCNS Pong Lab activity from saved run log")
    fig.tight_layout()
    fig.savefig(args.output / "activity-and-rally.png", dpi=180)
    plt.close(fig)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Summarize probe JSONL without treating missing measurements as zero or mixing sizes/runs."""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


def distribution(values):
    if not values:
        return {"n": 0, "p50": None, "p95": None, "p99": None}
    values = sorted(values)
    return {"n": len(values), **{f"p{p}": values[max(0, math.ceil(p / 100 * len(values)) - 1)] for p in (50, 95, 99)}}


def summarize(rows):
    groups = defaultdict(list)
    errors = []
    for row in rows:
        if row.get("event") == "transfer":
            if row.get("integrity_verified") is not True or row.get("native_aware_path") is not True:
                raise ValueError("Transfer lacks integrity/path evidence")
            size = row["bytes_each_direction"]
            if not isinstance(size, int) or not 1 <= size <= 100_000_000:
                raise ValueError("Invalid transfer size")
            for key in ("upload_with_ack_ms", "download_with_ack_ms", "round_trip_transfer_ms"):
                value = row[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                    raise ValueError("Invalid elapsed time")
            groups[(row["run"], row["mode"], size)].append(row)
        elif row.get("event", "").endswith(("failed", "timeout", "exception", "unavailable")):
            errors.append({k: row[k] for k in ("run", "event", "elapsed_ms") if k in row})
    output = []
    for (run, mode, size), samples in sorted(groups.items()):
        elapsed = [r["round_trip_transfer_ms"] for r in samples]
        output.append({"run": run, "mode": mode, "bytes_each_direction": size,
            "round_trip_transfer_ms": distribution(elapsed),
            "upload_with_ack_mbps": distribution([size * 8 / r["upload_with_ack_ms"] / 1000 for r in samples]),
            "download_with_ack_mbps": distribution([size * 8 / r["download_with_ack_ms"] / 1000 for r in samples]),
            "successive_round_trip_difference_ms": distribution([abs(b-a) for a,b in zip(elapsed, elapsed[1:])]),
            "tail_sample_warning": len(samples) < 100})
    return {"schema": 1, "groups": output, "failures": errors,
            "rf_packet_loss": None, "one_way_latency": None, "offline_conditions_verified": None,
            "note": "Application transfer durations include hashing and acknowledgments; not pure network RTT or RF loss. No success percentage without a declared attempt denominator."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", nargs="+", type=Path)
    args = parser.parse_args()
    rows = [json.loads(line) for path in args.logs for line in path.read_text().splitlines() if line.strip()]
    print(json.dumps(summarize(rows), indent=2, allow_nan=False))

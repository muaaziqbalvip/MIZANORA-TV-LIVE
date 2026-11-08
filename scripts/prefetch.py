#!/usr/bin/env python3
"""Auto-download / cache every HLS manifest before the playout needs it.

"Workflow auto hi sara saman download ker ke ready ho jaye": is step me har
M3U8 source ka manifest fetch kar ke docs/data/manifests/ me save hota hai.
Phir HLS stitcher network na ho to bhi cached manifest se live.m3u8 bana deta hai.
Video files khud repo me nahi aati (GitHub file-size limits) — sirf chhote text
manifests + segment URLs.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hls import HlsStitcher  # noqa: E402
from lib_playout import DOCS_DIR, UTC, iso, load_config  # noqa: E402
from media_probe import collect  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--timeout", type=int, default=8)
    args = ap.parse_args()
    g, cfg = load_config()
    g = dict(g)
    g["hls"] = dict(g.get("hls", {}))
    g["hls"]["fetch_timeout"] = args.timeout
    stitcher = HlsStitcher(g, online=not args.offline)
    now = dt.datetime.now(UTC)
    sources = [s["url"] for s in collect(g, cfg)
               if s["url"].endswith(".m3u8") or ".m3u8?" in s["url"] or s["kind"] in ("m3u8", "hls")]
    report = []
    for url in sources:
        segs = stitcher.segments(url)
        cache = DOCS_DIR / "data" / "manifests" / (hashlib.sha1(url.encode()).hexdigest() + ".m3u8")
        report.append({"url": url, "cached": cache.exists(), "segments": len(segs),
                       "bytes": cache.stat().st_size if cache.exists() else 0,
                       "duration": round(sum(s["dur"] for s in segs), 1)})
        print(f"[PREFETCH] {'OK ' if segs else 'MISS'} {len(segs):4d} segs  {url[:78]}")
    out = {"generated_at": iso(now), "mode": "offline" if args.offline else "online",
           "sources": len(report), "cached": sum(1 for r in report if r["cached"]),
           "total_segments": sum(r["segments"] for r in report), "manifests": report}
    path = DOCS_DIR / "data" / "manifest-cache.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"[PREFETCH] {out['cached']}/{out['sources']} manifests ready | {out['total_segments']} segments mapped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

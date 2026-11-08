#!/usr/bin/env python3
"""Pre-flight media check: har source link zinda hai ya nahi.

Workflow isko playout se pehle chalata hai; dead links `media-health.json` me
aate hain aur player unhe skip kar ke fallback ident chalata hai.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_playout import DOCS_DIR, UTC, iso, load_config  # noqa: E402


def collect(g: dict, cfg: dict) -> list[dict]:
    seen: dict[str, dict] = {}

    def add(entry: dict, owner: str):
        src = str(entry.get("src", ""))
        if not src.startswith(("http://", "https://")):
            return
        if src not in seen:
            seen[src] = {"url": src, "kind": entry.get("kind", ""), "title": entry.get("title", ""), "owners": []}
        seen[src]["owners"].append(owner)

    for c in cfg.get("channels", []):
        for e in c.get("segments", []) + c.get("ads", []) + c.get("trailers", []):
            add(e, c.get("id", ""))
    for label in ("ads", "trailers", "idents"):
        for e in g.get("library", {}).get(label, []):
            add(e, f"library.{label}")
    return list(seen.values())


def probe(url: str, timeout: int) -> dict:
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=method, headers={
                "User-Agent": "MIZANORA-MediaProbe/2.0", "Range": "bytes=0-0", "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return {"ok": True, "status": resp.status, "method": method,
                        "content_type": resp.headers.get("Content-Type", ""),
                        "content_length": resp.headers.get("Content-Length", "")}
        except urllib.error.HTTPError as exc:
            if method == "GET" or exc.code not in (403, 405, 501):
                return {"ok": exc.code in (200, 206), "status": exc.code, "method": method, "error": str(exc)}
        except Exception as exc:
            if method == "GET":
                return {"ok": False, "status": 0, "method": method, "error": type(exc).__name__}
    return {"ok": False, "status": 0, "error": "unreachable"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--timeout", type=int, default=6)
    args = ap.parse_args()
    g, cfg = load_config()
    sources = collect(g, cfg)
    now = dt.datetime.now(UTC)
    results = []
    for s in sources:
        r = {"ok": None, "status": 0, "note": "not checked (offline mode)"} if args.offline else probe(s["url"], args.timeout)
        results.append({**s, **r, "checked_at": iso(now)})
    ok = sum(1 for r in results if r.get("ok"))
    report = {"generated_at": iso(now), "mode": "offline" if args.offline else "online",
              "summary": {"total": len(results), "ok": ok, "failed": 0 if args.offline else len(results) - ok,
                          "unchecked": len(results) if args.offline else 0},
              "sources": results}
    path = DOCS_DIR / "data" / "media-health.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"[PROBE] {len(results)} sources | ok={ok} | failed={len(results)-ok} | -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

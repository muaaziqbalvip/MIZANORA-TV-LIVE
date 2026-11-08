#!/usr/bin/env python3
"""MIZANORA serverless playout — one tick of the 24/7 engine.

Run locally:      python3 scripts/playout.py --offline
Run in Actions:   python3 scripts/playout.py --channel mizanora --site-url "$SITE_URL"

Writes every generated artifact into docs/ (which is the GitHub Pages root):
  channels/<id>/{live.m3u8,backup.m3u8,schedule.json,now-next.json,epg.json,epg.xml,status.json,config.json}
  data/{channels.json,heartbeat.json,health.json,incidents.json,epg.xml,mizanora-tv.m3u,hls-report.json}
  master.m3u8
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib_playout import DOCS_DIR, UTC, PlayoutEngine, iso, load_config  # noqa: E402
from hls import HlsStitcher  # noqa: E402
from validate_config import validate  # noqa: E402


WRITES = 0
SKIPS = 0


def dump(path: Path, data):
    """Content-aware write: unchanged files are not touched (keeps git lean)."""
    global WRITES, SKIPS
    content = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == content:
                SKIPS += 1
                return
        except Exception:
            pass
    path.write_text(content, encoding="utf-8")
    WRITES += 1


def merge_incidents(path: Path, new: list[dict], limit: int = 60) -> list[dict]:
    old = []
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(old, dict):
                old = old.get("incidents", [])
        except Exception:
            old = []
    return (old + new)[-limit:]


def public_config(ch: dict) -> dict:
    """Everything the browser needs; no secrets live in this repo anyway."""
    return json.loads(json.dumps(ch))


def main() -> int:
    ap = argparse.ArgumentParser(description="MIZANORA 24/7 serverless playout tick")
    ap.add_argument("--channel", default="", help="only regenerate one channel id")
    ap.add_argument("--now", default="", help="override UTC now (ISO) for reproducible tests")
    ap.add_argument("--site-url", default=os.environ.get("MIZANORA_SITE_URL", ""))
    ap.add_argument("--offline", action="store_true", help="skip all network calls (HLS fallback mode)")
    ap.add_argument("--no-hls", action="store_true", help="skip HLS stitching")
    ap.add_argument("--strict", action="store_true", help="fail the tick on config errors")
    ap.add_argument("--reason", default="tick", help="cron | dispatch | watchdog | recovery | manual")
    args = ap.parse_args()

    if args.site_url:
        os.environ["MIZANORA_SITE_URL"] = args.site_url

    g, cfg = load_config()
    errors, warnings = validate(g, cfg)
    for w in warnings:
        print(f"[WARN ] {w}")
    if errors:
        for e in errors:
            print(f"[ERROR] {e}")
        if args.strict:
            return 2
        print("[WARN ] continuing in fault-tolerant mode (see docs/data/health.json)")

    now = dt.datetime.fromisoformat(args.now.replace("Z", "+00:00")).astimezone(UTC) if args.now else dt.datetime.now(UTC)
    engine = PlayoutEngine(g, cfg, now=now)
    all_channels = [c for c in cfg["channels"] if c.get("enabled", True)]
    if args.channel:
        all_channels = [c for c in all_channels if c["id"] == args.channel]
        if not all_channels:
            print(f"[ERROR] unknown channel: {args.channel}")
            return 2

    built = []
    diagnostics: list[dict] = []
    hls_reports = []
    stitcher = HlsStitcher(g, diagnostics, online=not args.offline)

    for ch in all_channels:
        b = engine.build_channel(ch)
        built.append(b)
        out = DOCS_DIR / "channels" / ch["id"]
        out.mkdir(parents=True, exist_ok=True)
        dump(out / "schedule.json", b["schedule"])
        dump(out / "now-next.json", b["now_next"])
        dump(out / "epg.json", b["epg"])
        dump(out / "config.json", public_config(ch))
        dump(out / "epg.xml", engine.xmltv([b]))

        if not args.no_hls:
            live, backup, report = stitcher.build(b, now)
            dump(out / "live.m3u8", live)
            dump(out / "backup.m3u8", backup)
            hls_reports.append(report)
        status = dict(b["status"])
        status["tick_reason"] = args.reason
        status["errors"] = [d for d in diagnostics if d.get("level") == "warn" and ch["id"] in str(d)]
        dump(out / "status.json", status)
        print(f"[ ON AIR ] {ch['id']:<22} slot #{status['slot']}  now={status['now'][:46]}  prime={status['prime']}")

    # ---- network-level data (only rewrite when a full tick) ---------------- #
    if not args.channel:
        full = engine.build_all()
        index = engine.channel_index(full)
        dump(DOCS_DIR / "data" / "channels.json", index)
        dump(DOCS_DIR / "data" / "epg.xml", engine.xmltv(full))
        dump(DOCS_DIR / "master.m3u8", engine.bouquet_master(full))
        dump(DOCS_DIR / "data" / g.get("pages", {}).get("playlist_name", "mizanora-tv.m3u"), engine.iptv_playlist(full))

        heartbeat = {
            "generated_at": iso(now), "epoch": int(now.timestamp()), "reason": args.reason,
            "version": g.get("version", ""), "tick_minutes": g.get("tick_minutes", 30),
            "channels": [c["id"] for c in cfg["channels"] if c.get("enabled", True)],
            "state": "ON AIR", "engine": "serverless-playout-v2",
            "note": "deterministic schedule: player keeps running even if a workflow tick is missed",
        }
        dump(DOCS_DIR / "data" / "heartbeat.json", heartbeat)

        health = {
            "generated_at": iso(now), "state": "OK" if not errors else "DEGRADED",
            "config_errors": errors, "config_warnings": warnings,
            "hls": hls_reports, "diagnostics": diagnostics[-40:],
            "channels_on_air": len(all_channels),
            "checks": {"config": not errors, "schedule": True, "epg": True, "hls": bool(hls_reports), "heartbeat": True},
        }
        dump(DOCS_DIR / "data" / "health.json", health)
        dump(DOCS_DIR / "data" / "hls-report.json", {"generated_at": iso(now), "reports": hls_reports})

        incidents = []
        for e in errors:
            incidents.append({"at": iso(now), "level": "error", "source": "config", "message": e})
        for d in diagnostics:
            if d.get("level") == "warn":
                incidents.append({"at": iso(now), "level": "warn", "source": d.get("source", d.get("channel", "hls")), "message": d.get("message", "")})
        path = DOCS_DIR / "data" / "incidents.json"
        dump(path, {"generated_at": iso(now), "incidents": merge_incidents(path, incidents, int(g.get("watchdog", {}).get("incident_limit", 60)))})

    log = DOCS_DIR / "data" / "broadcast.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as fh:
        fh.write(f"{iso(now)} | {args.reason:<9} | channels={len(all_channels)} | hls={len(hls_reports)} | errors={len(errors)} | offline={args.offline}\n")
    lines = log.read_text(encoding="utf-8").splitlines()
    if len(lines) > 400:
        log.write_text("\n".join(lines[-400:]) + "\n", encoding="utf-8")

    print(f"[ DONE  ] {iso(now)} | {len(all_channels)} channel(s) | HLS reports: {len(hls_reports)} | "
          f"files written={WRITES} unchanged={SKIPS} | docs/ updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

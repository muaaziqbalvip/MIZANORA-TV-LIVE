#!/usr/bin/env python3
"""24/7 restart / self-heal watchdog.

Heartbeat purana ho jaye (cron miss, runner queue, API outage) to ye
`repository_dispatch` se playout workflow ko dobara chala deta hai. Har recovery
incident log me jati hai aur `--max` ke baad circuit-breaker lag jata hai.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_playout import DOCS_DIR, UTC, iso  # noqa: E402


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stale-minutes", type=int, default=45)
    ap.add_argument("--max", type=int, default=3, dest="max_dispatches")
    ap.add_argument("--dispatch", action="store_true", help="actually trigger the workflow")
    ap.add_argument("--now", default="")
    args = ap.parse_args()

    now = dt.datetime.fromisoformat(args.now.replace("Z", "+00:00")).astimezone(UTC) if args.now else dt.datetime.now(UTC)
    hb = read_json(DOCS_DIR / "data" / "heartbeat.json", {})
    epoch = int(hb.get("epoch", 0))
    age = (now.timestamp() - epoch) / 60 if epoch else 999999
    incidents_path = DOCS_DIR / "data" / "incidents.json"
    incidents = read_json(incidents_path, {"incidents": []}).get("incidents", [])

    channel_states = []
    for status_file in sorted((DOCS_DIR / "channels").glob("*/status.json")):
        s = read_json(status_file, {})
        h = int(s.get("heartbeat_epoch", 0))
        channel_states.append({"channel": s.get("id", status_file.parent.name), "on_air": s.get("on_air", False),
                               "stale_minutes": round((now.timestamp() - h) / 60, 1) if h else None})

    stale = age > args.stale_minutes or any((c["stale_minutes"] or 9999) > args.stale_minutes * 2 for c in channel_states)
    recent = [i for i in incidents if i.get("source") == "watchdog" and
              (now - dt.datetime.fromisoformat(i["at"].replace("Z", "+00:00"))).total_seconds() < 3600]
    allowed = len(recent) < args.max_dispatches

    action = "none"
    if stale:
        message = f"heartbeat {age:.0f} min old (limit {args.stale_minutes} min)"
        incidents.append({"at": iso(now), "level": "warn", "source": "watchdog", "message": message, "action": "pending"})
        if args.dispatch and allowed:
            repo = os.environ.get("GITHUB_REPOSITORY", "muaaziqbalvip/MIZANORA-TV-LIVE")
            payload = json.dumps({"event_type": "mizanora-tick",
                                  "client_payload": {"reason": "watchdog", "channel": "all", "message": message}})
            env = dict(os.environ)
            env.setdefault("GH_TOKEN", env.get("GITHUB_TOKEN", ""))
            proc = subprocess.run(["gh", "api", f"repos/{repo}/dispatches", "--method", "POST", "--input", "-"],
                                  input=payload, text=True, capture_output=True, env=env)
            action = "dispatched" if proc.returncode == 0 else f"dispatch-failed:{proc.stderr.strip()[:120]}"
            incidents[-1]["action"] = action
        else:
            action = "circuit-breaker" if not allowed else "report-only"
            incidents[-1]["action"] = action

    incidents_path.parent.mkdir(parents=True, exist_ok=True)
    incidents_path.write_text(json.dumps({"generated_at": iso(now), "incidents": incidents[-60:]}, ensure_ascii=False), encoding="utf-8")
    report = {"checked_at": iso(now), "heartbeat_age_minutes": round(age, 1), "stale": stale,
              "action": action, "stale_minutes_limit": args.stale_minutes,
              "recent_recoveries": len(recent), "channels": channel_states,
              "note": "player is deterministic — a missed tick never stops the channel"}
    (DOCS_DIR / "data" / "watchdog.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Config linter — runs in CI and on every playout tick."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from lib_playout import SUPPORTED_KINDS, load_config  # noqa: E402

TOKENS = {"trailer", "ad", "segment", "filler"}
REQUIRED_CHANNEL = ("id", "name", "logo", "timezone", "slot_minutes", "segments")


def _check_media(entry: dict, label: str, errors: list, warnings: list):
    if not entry.get("id"):
        errors.append(f"{label}: missing id")
    if not entry.get("title"):
        errors.append(f"{label}: missing title")
    kind = str(entry.get("kind", "")).lower()
    src = str(entry.get("src", ""))
    if not src:
        warnings.append(f"{label}: empty src — playout will use fallback ident")
    elif not (src.startswith(("http://", "https://", "data:", "assets/", "./", "/"))):
        warnings.append(f"{label}: src should be an absolute URL or a repo-relative path ({src[:48]})")
    if kind and kind not in SUPPORTED_KINDS:
        errors.append(f"{label}: unsupported kind '{kind}' (allowed: {', '.join(sorted(SUPPORTED_KINDS))})")
    dur = entry.get("duration")
    if dur is not None and (not isinstance(dur, (int, float)) or dur <= 0):
        errors.append(f"{label}: duration must be a positive number")
    if kind in ("mp4", "mkv", "mov", "webm", "m4v", "m3u8", "mpd") and not src.startswith(("http://", "https://")) and src:
        warnings.append(f"{label}: local media path '{src}' — browsers need it under docs/")


def validate(g: dict, cfg: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    for key in ("version", "brand", "anchor_utc", "library", "hls", "playout"):
        if key not in g:
            errors.append(f"global.json: missing '{key}'")
    if not g.get("site_url"):
        warnings.append("global.json: site_url missing — using default GitHub Pages URL (set MIZANORA_SITE_URL in Actions)")
    try:
        from datetime import datetime
        datetime.fromisoformat(g["anchor_utc"].replace("Z", "+00:00"))
    except Exception:
        errors.append("global.json: anchor_utc must be an ISO datetime")
    if int(g.get("tick_minutes", 30)) < 5:
        warnings.append("global.json: tick_minutes < 5 — GitHub cron minimum is 5 minutes")
    if int(g.get("schedule_days", 7)) > 14:
        warnings.append("global.json: schedule_days > 14 makes schedule.json large")

    channels = cfg.get("channels", [])
    if not channels:
        errors.append("channels.json: no channels defined")
    ids = [c.get("id") for c in channels]
    if len(ids) != len(set(ids)):
        errors.append("channels.json: duplicate channel ids")
    for c in channels:
        cid = c.get("id", "<no-id>")
        for key in REQUIRED_CHANNEL:
            if key not in c:
                errors.append(f"{cid}: missing '{key}'")
        try:
            ZoneInfo(c.get("timezone", "UTC"))
        except (ZoneInfoNotFoundError, ValueError):
            errors.append(f"{cid}: invalid timezone '{c.get('timezone')}'")
        slot = int(c.get("slot_minutes", 60))
        if slot < 5 or slot > 720:
            errors.append(f"{cid}: slot_minutes must be between 5 and 720")
        if 1440 % slot:
            warnings.append(f"{cid}: slot_minutes={slot} does not divide a day evenly (day boundary drift, still supported)")
        order = c.get("break_order", [])
        if "segment" not in order:
            errors.append(f"{cid}: break_order must contain 'segment'")
        for t in order:
            if t not in TOKENS:
                errors.append(f"{cid}: unknown break_order token '{t}' (allowed: {', '.join(sorted(TOKENS))})")
        if "filler" not in order:
            warnings.append(f"{cid}: no 'filler' token — short programmes will leave dead air")
        if not c.get("segments"):
            errors.append(f"{cid}: segments pool is empty")
        for label, pool in (("segments", c.get("segments", [])), ("ads", c.get("ads", [])), ("trailers", c.get("trailers", []))):
            for entry in pool:
                _check_media(entry, f"{cid}.{label}.{entry.get('id', '?')}", errors, warnings)
        for label, pool in (("ads", g.get("library", {}).get("ads", [])),
                            ("trailers", g.get("library", {}).get("trailers", [])),
                            ("idents", g.get("library", {}).get("idents", []))):
            for entry in pool:
                _check_media(entry, f"library.{label}.{entry.get('id', '?')}", errors, warnings)
        prime = c.get("prime_time", {})
        if prime.get("enabled"):
            for key in ("start", "end"):
                try:
                    h, m = str(prime.get(key, "19:00")).split(":")
                    assert 0 <= int(h) < 24 and 0 <= int(m) < 60
                except Exception:
                    errors.append(f"{cid}: prime_time.{key} must be HH:MM")
        audio = c.get("audio", {})
        pitch = float(audio.get("pitch", 1.0))
        if not 0.5 <= pitch <= 2.0:
            warnings.append(f"{cid}: audio.pitch={pitch} outside 0.5–2.0")
        nxt = c.get("chain_next")
        if nxt and nxt not in ids:
            errors.append(f"{cid}: chain_next '{nxt}' is not a known channel id")
    return errors, warnings


def main() -> int:
    g, cfg = load_config()
    errors, warnings = validate(g, cfg)
    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print(f"\n{len(cfg.get('channels', []))} channels | {len(errors)} errors | {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

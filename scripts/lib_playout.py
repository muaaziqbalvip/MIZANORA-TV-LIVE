"""MIZANORA Serverless Playout — core scheduling engine.

Deterministic virtual-transmission engine: the same (channel, slot index) pair
always produces the same schedule on every runner, every tick, and in the
browser. That is what makes a static GitHub Pages site behave like a 24/7
linear TV channel even when no workflow is currently running.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
DOCS_DIR = ROOT / "docs"
UTC = dt.timezone.utc

SUPPORTED_KINDS = {"mp4", "mkv", "mov", "webm", "m4v", "m3u8", "hls", "mpd", "ts", "mp3",
                   "image", "audio", "reel"}


# --------------------------------------------------------------------------- #
# deterministic pseudo-random selection (mirrored in docs/assets/js/core.js)
# --------------------------------------------------------------------------- #
def fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def pick(pool: list, key: str, exclude: set[str] | None = None):
    """Stable pick from a pool, with a simple linear probe to avoid repeats."""
    if not pool:
        return None
    exclude = exclude or set()
    n = len(pool)
    start = fnv1a(key) % n
    for step in range(n):
        candidate = pool[(start + step) % n]
        if str(candidate.get("id", "")) not in exclude:
            return candidate
    return pool[start]


def weighted_pick(pool: list, key: str, exclude: set[str] | None = None):
    """Weighted ads: expand weights into a virtual list, then stable-pick."""
    if not pool:
        return None
    expanded = []
    for item in pool:
        for _ in range(max(1, int(item.get("weight", 1)))):
            expanded.append(item)
    return pick(expanded, key, exclude)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def iso(when: dt.datetime) -> str:
    return when.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def hhmm(value: str) -> tuple[int, int]:
    h, m = value.split(":")[:2]
    return int(h), int(m)


def in_window(local: dt.datetime, start: str, end: str) -> bool:
    sh, sm = hhmm(start)
    eh, em = hhmm(end)
    cur = local.hour * 60 + local.minute
    a, b = sh * 60 + sm, eh * 60 + em
    return (a <= cur < b) if a <= b else (cur >= a or cur < b)


def source_kind(entry: dict) -> str:
    kind = str(entry.get("kind", "")).lower()
    if kind in SUPPORTED_KINDS:
        return kind
    src = str(entry.get("src", "")).split("?")[0].lower()
    for ext in ("m3u8", "mpd", "mkv", "webm", "mov", "m4v", "ts", "mp3", "jpg", "png", "mp4"):
        if src.endswith("." + ext):
            return {"jpg": "image", "png": "image", "m3u8": "m3u8"}.get(ext, ext)
    return "mp4"


def utc_offset(when: dt.datetime, tz_name: str) -> str:
    return when.astimezone(ZoneInfo(tz_name)).strftime("%z")


def xmltv_time(when: dt.datetime, tz_name: str) -> str:
    return when.astimezone(ZoneInfo(tz_name)).strftime("%Y%m%d%H%M%S %z")


def esc(value) -> str:
    return (str(value).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;"))


def clamp(value, low, high):
    return max(low, min(high, value))


# --------------------------------------------------------------------------- #
# engine
# --------------------------------------------------------------------------- #
class PlayoutEngine:
    def __init__(self, global_cfg: dict, channels_cfg: dict, now: dt.datetime | None = None):
        self.g = global_cfg
        self.cfg = channels_cfg
        self.now = (now or dt.datetime.now(UTC)).astimezone(UTC)
        self.channels = [c for c in channels_cfg.get("channels", []) if c.get("enabled", True)]
        self.site_url = os.environ.get(
            "MIZANORA_SITE_URL", global_cfg.get("site_url", "https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE")
        ).rstrip("/")
        self.anchor = dt.datetime.fromisoformat(global_cfg["anchor_utc"].replace("Z", "+00:00")).astimezone(UTC)
        self.library = global_cfg.get("library", {})
        self.playout = global_cfg.get("playout", {})
        self.diagnostics: list[dict] = []

    # -- slot construction -------------------------------------------------- #
    def _slot(self, ch: dict, index: int) -> dict:
        slot_sec = int(ch.get("slot_minutes", 60)) * 60
        start = self.anchor + dt.timedelta(seconds=index * slot_sec)
        end = start + dt.timedelta(seconds=slot_sec)
        tz = ch.get("timezone", self.g.get("timezone_default", "UTC"))
        local = start.astimezone(ZoneInfo(tz))

        prime_cfg = ch.get("prime_time", {})
        prime = bool(prime_cfg.get("enabled")) and in_window(local, prime_cfg.get("start", "19:00"), prime_cfg.get("end", "23:00"))
        pool_name = prime_cfg.get("pool", "prime") if prime else "regular"
        segments = [s for s in ch.get("segments", []) if s.get("pool", "regular") == pool_name]
        if not segments:
            segments = list(ch.get("segments", []))

        ads = ch.get("ads") or self.library.get("ads", [])
        trailers = ch.get("trailers") or self.library.get("trailers", [])
        idents = self.library.get("idents", [])

        program = pick(segments, f"{ch['id']}|{index}|segment")
        if program is None:
            program = {"id": "offline", "title": "MIZANORA — Station Ident", "src": "assets/brand/ident-studio.jpg",
                       "kind": "image", "duration": slot_sec, "genre": "Ident", "rating": "U", "description": "Fallback ident."}

        ad_target = int(ch.get("ads_per_break", self.playout.get("min_ads_per_break", 1)))
        if prime:
            ad_target = min(int(self.playout.get("max_ads_per_break", 4)),
                            ad_target * int(prime_cfg.get("ad_multiplier", self.playout.get("prime_ad_multiplier", 2))))

        order = ch.get("break_order") or ["trailer", "ad", "trailer", "segment", "filler"]
        used: set[str] = set()
        items: list[dict] = []
        cursor = start
        budget = slot_sec

        def add(entry: dict | None, item_type: str, title: str | None = None, duration: int | None = None,
                offset: int = 0, extra: dict | None = None) -> int:
            nonlocal cursor, budget
            if entry is None or budget <= 0:
                return 0
            dur = int(duration if duration is not None else entry.get("duration", 15))
            dur = max(1, min(dur, budget))
            item = {
                "id": f"{ch['id']}-{index}-{len(items):02d}",
                "slot": index,
                "type": item_type,
                "title": title or entry.get("title", item_type.upper()),
                "src": entry.get("src", ""),
                "kind": source_kind(entry),
                "duration": dur,
                "source_duration": int(entry.get("duration", dur)),
                "offset": int(offset),
                "start": iso(cursor),
                "end": iso(cursor + dt.timedelta(seconds=dur)),
                "prime": prime,
                "poster": entry.get("poster", ""),
                "meta": {
                    "advertiser": entry.get("advertiser", ""),
                    "genre": entry.get("genre", ""),
                    "rating": entry.get("rating", ""),
                    "cast": entry.get("cast", []),
                    "description": entry.get("description", ""),
                    "audio_pitch": entry.get("audio_pitch", 1.0),
                    "promo": entry.get("type", ""),
                },
            }
            if extra:
                item.update(extra)
            items.append(item)
            cursor += dt.timedelta(seconds=dur)
            budget -= dur
            return dur

        ad_count = 0
        for position, token in enumerate(order):
            if budget <= 0:
                break
            if token == "trailer":
                tr = pick(trailers, f"{ch['id']}|{index}|trailer|{position}", used)
                if tr:
                    used.add(str(tr.get("id")))
                    add(tr, "trailer", duration=min(int(tr.get("duration", 15)), budget))
            elif token == "ad":
                for j in range(ad_target):
                    if budget <= 0:
                        break
                    ad = weighted_pick(ads, f"{ch['id']}|{index}|ad|{j}", used)
                    if ad:
                        used.add(str(ad.get("id")))
                        add(ad, "ad", duration=min(int(ad.get("duration", 15)), budget))
                        ad_count += 1
            elif token == "segment":
                # The main program. If it is shorter than the remaining budget,
                # "filler" below fills the gap with ads / trailers / idents.
                declared = int(program.get("duration", slot_sec))
                add(program, "segment", duration=min(declared, budget),
                    extra={"program_id": program.get("id"), "program": program.get("title")})
            elif token == "filler":
                # A short programme leaves a gap. Instead of one 40-minute frozen
                # ident, build a compact LOOPING trailer/ad reel: one schedule item
                # carrying a rotation of real clips. The player loops the reel
                # until the next slot starts — exactly like a real continuity break.
                if budget > 0 and ch.get("gap_fill", True) is False:
                    add({"src": "assets/brand/ident-studio.jpg", "kind": "image", "duration": budget,
                         "title": "MIZANORA — Interstitial"}, "filler_ident", duration=budget)
                elif budget > 0:
                    ident_dur = int(ch.get("ident_duration", self.playout.get("ident_duration", 15)))
                    reel_ids: list[str] = []
                    reel_seconds = 0
                    for j in range(6):
                        ad = weighted_pick(ads, f"{ch['id']}|{index}|reel|ad|{j}")
                        if ad and ad.get("id"):
                            reel_ids.append(str(ad["id"]))
                            reel_seconds += max(1, int(ad.get("duration", 15)))
                    for j in range(4):
                        tr = pick(trailers, f"{ch['id']}|{index}|reel|tr|{j}")
                        if tr and tr.get("id"):
                            reel_ids.append(str(tr["id"]))
                            reel_seconds += max(1, int(tr.get("duration", 15)))
                    if idents and idents[0].get("id"):
                        reel_ids.append(str(idents[0]["id"]))
                        reel_seconds += ident_dur
                    if not reel_ids:
                        reel_ids, reel_seconds = ["standby"], budget
                    add({"src": "", "kind": "reel", "duration": budget, "title": "MIZANORA — Trailer & Ad Reel"},
                        "filler_reel", duration=budget,
                        extra={"reel": reel_ids, "loop": True, "reel_duration": reel_seconds,
                               "gap_fill": True})

        slot = {
            "index": index,
            "start": iso(start),
            "end": iso(end),
            "local_start": local.isoformat(timespec="seconds"),
            "duration": slot_sec,
            "timezone": tz,
            "utc_offset": utc_offset(start, tz),
            "prime": prime,
            "prime_label": prime_cfg.get("label", "PRIME TIME") if prime else "",
            "break_order": order,
            "ad_count": ad_count,
            "program": program.get("title", ""),
            "program_id": program.get("id", ""),
            "genre": program.get("genre", ch.get("genre", "")),
            "rating": program.get("rating", "U"),
            "description": program.get("description", ""),
            "poster": program.get("poster", ""),
            "cast": program.get("cast", []),
            "audio_pitch": program.get("audio_pitch", 1.0),
            "gap_filled": sum(i["duration"] for i in items if i["type"].startswith("filler")),
            "items": items,
        }
        return slot

    def slots_for(self, ch: dict, days: int | None = None) -> list[dict]:
        days = int(days or self.g.get("schedule_days", 7))
        slot_sec = int(ch.get("slot_minutes", 60)) * 60
        current = math.floor((self.now - self.anchor).total_seconds() / slot_sec)
        per_day = max(1, 86400 // slot_sec)
        first = current - per_day  # one day of look-back for catch-up / EPG now-line
        last = current + per_day * days
        return [self._slot(ch, k) for k in range(first, last)]

    def epg_slots_for(self, ch: dict) -> list[dict]:
        """Day-aligned EPG window: rewrites epg.xml/epg.json only once per day."""
        days = int(self.g.get("epg_days", 7))
        slot_sec = int(ch.get("slot_minutes", 60)) * 60
        per_day = max(1, 86400 // slot_sec)
        day_start = self.now.replace(hour=0, minute=0, second=0, microsecond=0)
        first = math.floor((day_start - self.anchor).total_seconds() / slot_sec) - per_day
        last = first + per_day * (days + 1)
        return [self._slot(ch, k) for k in range(first, last)]

    # -- now / next --------------------------------------------------------- #
    @staticmethod
    def locate(slots: list[dict], now: dt.datetime):
        flat = [i for s in slots for i in s["items"]]
        for pos, item in enumerate(flat):
            start = dt.datetime.fromisoformat(item["start"].replace("Z", "+00:00"))
            end = dt.datetime.fromisoformat(item["end"].replace("Z", "+00:00"))
            if start <= now < end:
                slot = next((s for s in slots if s["index"] == item["slot"]), None)
                return item, flat[pos + 1] if pos + 1 < len(flat) else None, slot, flat[pos + 1:pos + 6]
        return None, (flat[0] if flat else None), (slots[0] if slots else None), flat[:5]

    def build_channel(self, ch: dict) -> dict:
        slots = self.slots_for(ch)
        current, nxt, slot, upcoming = self.locate(slots, self.now)
        tz = ch.get("timezone", self.g.get("timezone_default", "UTC"))
        local = self.now.astimezone(ZoneInfo(tz))
        elapsed = remaining = progress = 0.0
        if current:
            start = dt.datetime.fromisoformat(current["start"].replace("Z", "+00:00"))
            elapsed = clamp((self.now - start).total_seconds(), 0, current["duration"])
            remaining = max(0, current["duration"] - elapsed)
            progress = round(elapsed / current["duration"] * 100, 2)

        now_next = {
            "channel": {"id": ch["id"], "name": ch["name"], "short": ch.get("short", ""), "logo": ch.get("logo", ""),
                        "number": ch.get("number", 0), "genre": ch.get("genre", ""), "theme": ch.get("theme", {}),
                        "timezone": tz, "utc_offset": utc_offset(self.now, tz), "clock": ch.get("clock", {})},
            "server_time": iso(self.now),
            "local_time": local.isoformat(timespec="seconds"),
            "slot_minutes": ch.get("slot_minutes", 60),
            "break_order": ch.get("break_order", []),
            "current": current,
            "next": nxt,
            "up_next": upcoming,
            "slot": slot,
            "progress": progress,
            "elapsed": round(elapsed),
            "remaining": round(remaining),
            "prime": bool(slot and slot.get("prime")),
            "prime_label": (slot or {}).get("prime_label", ""),
            "gap_filled": (slot or {}).get("gap_filled", 0),
            "on_air": True,
            "tick_minutes": self.g.get("tick_minutes", 30),
            "version": self.g.get("version", ""),
        }

        status = {
            "id": ch["id"], "name": ch["name"], "on_air": True, "state": "ON AIR",
            "heartbeat": iso(self.now), "heartbeat_epoch": int(self.now.timestamp()),
            "encoder": "SERVERLESS-HLS-STITCHER", "mode": "linear-24x7",
            "playlist": f"channels/{ch['id']}/live.m3u8",
            "epg": f"channels/{ch['id']}/epg.xml",
            "slot": slot["index"] if slot else None,
            "now": current["title"] if current else "",
            "next": nxt["title"] if nxt else "",
            "prime": bool(slot and slot.get("prime")),
            "chain_next": ch.get("chain_next", ""),
            "errors": [], "retries": 0,
            "fallback_active": False,
            "uptime_policy": "deterministic-schedule + workflow heartbeat + client playout",
            "version": self.g.get("version", ""),
        }

        epg_programmes = []
        epg_slots = self.epg_slots_for(ch)
        for s in epg_slots:
            epg_programmes.append({
                "channel": ch["id"], "start": s["start"], "stop": s["end"],
                "start_local": s["local_start"], "title": s["program"], "sub_title": s["genre"],
                "desc": s["description"], "genre": s["genre"], "rating": s["rating"],
                "cast": s["cast"], "poster": s["poster"], "prime": s["prime"],
                "prime_label": s["prime_label"], "ad_breaks": 1 if s["ad_count"] else 0,
                "ad_count": s["ad_count"], "gap_filled": s["gap_filled"],
                "break_order": s["break_order"], "slot": s["index"],
                "audio_pitch": s["audio_pitch"], "language": ch.get("language", "ur"),
                "timezone": s["timezone"],
            })

        # Compact, deterministic artifacts: only a small window is written to
        # schedule.json. The full 7-day EPG is compact (no nested items), and
        # every file is content-hashed before writing, so a 30-minute tick does
        # not bloat git history. The browser can rebuild any slot from `anchor_utc`.
        center = slot["index"] if slot else (slots[0]["index"] if slots else 0)
        window = [s for s in slots if center - 1 <= s["index"] <= center + 4]
        schedule = {
            "anchor_utc": iso(self.anchor), "window_start": window[0]["index"] if window else center,
            "channel": ch["id"], "timezone": tz, "slot_minutes": ch.get("slot_minutes", 60),
            "break_order": ch.get("break_order", []), "days": self.g.get("schedule_days", 7),
            "site_url": self.site_url, "version": self.g.get("version", ""),
            "deterministic": True,
            "reel_sources": self.reel_sources(ch),
            "slots": window,
        }
        return {
            "config": ch,
            "slots": slots,
            "schedule": schedule,
            "now_next": now_next,
            "status": status,
            "epg": {"days": self.g.get("epg_days", 7), "window_start": epg_slots[0]["index"] if epg_slots else 0,
                    "channel": {"id": ch["id"], "name": ch["name"], "logo": ch.get("logo", "")},
                    "programmes": epg_programmes},
        }

    def reel_sources(self, ch: dict) -> dict:
        """One lookup table for every clip referenced by a looping filler reel."""
        sources = {"standby": {"src": "assets/brand/ident-studio.jpg", "kind": "image",
                               "title": "MIZANORA — Please Stand By", "duration": 15, "role": "ident"}}
        pools = [(self.library.get("ads", []), "ad"), (self.library.get("trailers", []), "trailer"),
                 (self.library.get("idents", []), "ident"), (ch.get("ads", []), "ad"),
                 (ch.get("trailers", []), "trailer")]
        ident_override = int(ch.get("ident_duration", self.playout.get("ident_duration", 15)))
        for pool, role in pools:
            for e in pool:
                if e.get("id"):
                    dur = ident_override if role == "ident" else max(1, int(e.get("duration", 15)))
                    sources[str(e["id"])] = {"src": e.get("src", ""), "kind": source_kind(e),
                                             "title": e.get("title", role), "duration": dur, "role": role}
        return sources

    def build_all(self) -> list[dict]:
        return [self.build_channel(ch) for ch in self.channels]

    # -- XMLTV -------------------------------------------------------------- #
    def xmltv(self, built: list[dict]) -> str:
        lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
                 f'<tv generator-info-name="MIZANORA Serverless Playout {self.g.get("version", "")}" source-info-name="Mizanora Broadcast Network">']
        for b in built:
            ch = b["config"]
            logo = self._abs(ch.get("logo_url") or ch.get("logo", ""))
            lines.append(f'  <channel id="{esc(ch["id"])}">')
            lines.append(f'    <display-name lang="{esc(ch.get("language", "ur"))}">{esc(ch["name"])}</display-name>')
            lines.append(f'    <icon src="{esc(logo)}" />')
            lines.append('  </channel>')
        for b in built:
            ch = b["config"]
            tz = ch.get("timezone", "UTC")
            for p in b["epg"]["programmes"]:
                start = dt.datetime.fromisoformat(p["start"].replace("Z", "+00:00"))
                stop = dt.datetime.fromisoformat(p["stop"].replace("Z", "+00:00"))
                lines.append(f'  <programme start="{xmltv_time(start, tz)}" stop="{xmltv_time(stop, tz)}" channel="{esc(ch["id"])}">')
                lines.append(f'    <title lang="{esc(ch.get("language", "ur"))}">{esc(p["title"])}</title>')
                lines.append(f'    <sub-title lang="en">{esc(p["sub_title"])}</sub-title>')
                lines.append(f'    <desc lang="{esc(ch.get("language", "ur"))}">{esc(p["desc"])}</desc>')
                lines.append(f'    <category lang="en">{esc(p["genre"])}</category>')
                lines.append(f'    <rating><value>{esc(p["rating"])}</value></rating>')
                for actor in p["cast"]:
                    lines.append(f'    <credits><actor>{esc(actor)}</actor></credits>')
                if p["poster"]:
                    lines.append(f'    <icon src="{esc(self._abs(p["poster"]))}" />')
                if p["prime"]:
                    lines.append(f'    <category lang="en">{esc(p["prime_label"])}</category>')
                lines.append('    <live />' if p["genre"] == "Live" else '    <previously-shown />')
                lines.append('  </programme>')
        lines.append('</tv>')
        return "\n".join(lines) + "\n"

    def _abs(self, url: str) -> str:
        if not url:
            return ""
        if url.startswith(("http://", "https://", "data:")):
            return url
        return f"{self.site_url}/{url.lstrip('/')}"

    # -- IPTV / bouquet playlists ------------------------------------------- #
    def iptv_playlist(self, built: list[dict]) -> str:
        lines = ['#EXTM3U url-tvg="' + self.site_url + '/data/epg.xml" x-tvg-url="' + self.site_url + '/data/epg.xml"',
                 '# MIZANORA Broadcast Network — auto generated by scripts/playout.py']
        for b in built:
            ch = b["config"]
            logo = self._abs(ch.get("logo_url") or ch.get("logo", ""))
            lines.append(f'#EXTINF:-1 tvg-id="{ch["id"]}" tvg-name="{ch["name"]}" tvg-logo="{logo}" '
                         f'tvg-country="PK" tvg-language="{ch.get("language", "ur")}" '
                         f'group-title="MIZANORA NETWORK",{ch["name"]}')
            lines.append(f'#KODIPROP:inputstream.adaptive.license_type=clear')
            lines.append(f'{self.site_url}/channels/{ch["id"]}/live.m3u8')
        return "\n".join(lines) + "\n"

    def bouquet_master(self, built: list[dict]) -> str:
        lines = ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS",
                 "# MIZANORA NETWORK MASTER — har channel ek variant hai (player me switch karein)"]
        for b in built:
            ch = b["config"]
            lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH=2500000,AVERAGE-BANDWIDTH=1800000,'
                         f'RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",NAME="{esc(ch["name"])}",'
                         f'CHANNEL="{ch.get("number", 0)}"')
            lines.append(f'channels/{ch["id"]}/live.m3u8')
        return "\n".join(lines) + "\n"

    def channel_index(self, built: list[dict]) -> dict:
        return {
            "generated_at": iso(self.now), "version": self.g.get("version", ""),
            "network": self.g["brand"]["network"], "brand": self.g["brand"],
            "global": {k: self.g[k] for k in ("anchor_utc", "schedule_days", "epg_days", "tick_minutes",
                                              "timezone_default", "hls", "watchdog", "playout", "site_url")
                       if k in self.g},
            "library": self.library,
            "channels": [
                {"id": b["config"]["id"], "name": b["config"]["name"], "long_name": b["config"].get("long_name", ""),
                 "short": b["config"].get("short", ""), "number": b["config"].get("number", 0),
                 "genre": b["config"].get("genre", ""), "logo": b["config"].get("logo", ""),
                 "logo_url": b["config"].get("logo_url", ""), "theme": b["config"].get("theme", {}),
                 "timezone": b["config"].get("timezone", "UTC"), "slot_minutes": b["config"].get("slot_minutes", 60),
                 "prime": b["status"]["prime"], "now": b["status"]["now"], "next": b["status"]["next"],
                 "playlist": f"channels/{b['config']['id']}/live.m3u8",
                 "epg": f"channels/{b['config']['id']}/epg.xml",
                 "status": f"channels/{b['config']['id']}/status.json",
                 "chain_next": b["config"].get("chain_next", ""),
                 "on_air": True}
                for b in built
            ],
        }


def load_config(path: Path | None = None):
    path = path or CONFIG_DIR
    with (path / "global.json").open(encoding="utf-8") as fh:
        g = json.load(fh)
    with (path / "channels.json").open(encoding="utf-8") as fh:
        c = json.load(fh)
    return g, c

"""HLS stitcher: turns a virtual linear schedule into a playable live M3U8.

GitHub Pages is static — it cannot run an encoder. This module instead *stitches*
segment URIs from the source HLS playlists into one continuous live media
playlist, with #EXT-X-DISCONTINUITY between programmes. MP4/MKV/WebM/MOV sources
are played by the browser playout engine; for third-party IPTV players those
slots are bridged with the network ident HLS feed (or transcoded locally when
`hls.transcode_non_hls` is enabled in a workflow with ffmpeg).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

from lib_playout import DOCS_DIR, UTC, iso

TAG_STREAM = "#EXT-X-STREAM-INF"
HLS_KINDS = {"m3u8", "hls"}


def resolve(uri: str, base: str) -> str:
    if uri.startswith(("http://", "https://", "data:")):
        return uri
    return urllib.parse.urljoin(base, uri)


def absolutise_tag(line: str, base: str) -> str:
    def repl(match):
        return f'URI="{resolve(match.group(1), base)}"'
    return re.sub(r'URI="([^"]+)"', repl, line)


class HlsStitcher:
    def __init__(self, global_cfg: dict, diagnostics: list[dict] | None = None, online: bool = True):
        self.cfg = global_cfg.get("hls", {})
        self.g = global_cfg
        self.online = online
        self.timeout = int(self.cfg.get("fetch_timeout", 8))
        self.retries = int(self.cfg.get("fetch_retries", 2))
        self.diagnostics = diagnostics if diagnostics is not None else []
        self.cache: dict[str, list[dict]] = {}
        self.failures: set[str] = set()

    def fetch(self, url: str) -> str | None:
        cache = DOCS_DIR / "data" / "manifests" / (hashlib.sha1(url.encode()).hexdigest() + ".m3u8")
        if cache.exists():
            try:
                return cache.read_text(encoding="utf-8")
            except Exception:
                pass
        if not self.online or not url.startswith(("http://", "https://")):
            return None
        for attempt in range(self.retries + 1):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": "MIZANORA-Playout/2.0 (+github-actions)",
                    "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
                })
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    text = resp.read().decode("utf-8", errors="replace")
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(text, encoding="utf-8")
                    return text
            except Exception as exc:  # network offline, CORS-less HEAD, 404, timeout...
                if attempt == self.retries:
                    self.failures.add(url)
                    self.diagnostics.append({"level": "warn", "source": url, "message": f"playlist fetch failed: {type(exc).__name__}"})
        return None

    def segments(self, url: str, depth: int = 0) -> list[dict]:
        """Return [{dur, tags, uri}] for a media playlist; resolve masters once."""
        if url in self.cache:
            return self.cache[url]
        text = self.fetch(url)
        if not text:
            self.cache[url] = []
            return []
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if any(l.startswith(TAG_STREAM) for l in lines) and depth < 2:
            for i, line in enumerate(lines):
                if line.startswith(TAG_STREAM) and i + 1 < len(lines) and not lines[i + 1].startswith("#"):
                    variant = resolve(lines[i + 1], url)
                    result = self.segments(variant, depth + 1)
                    self.cache[url] = result
                    return result
        out: list[dict] = []
        pending: list[str] = []
        duration = None
        for line in lines:
            if line.startswith("#EXTINF"):
                try:
                    duration = float(line.split(":", 1)[1].split(",")[0])
                except (ValueError, IndexError):
                    duration = 6.0
            elif line.startswith("#EXT-X-DISCONTINUITY"):
                pending.append("#EXT-X-DISCONTINUITY")
            elif line.startswith(("#EXT-X-KEY", "#EXT-X-MAP", "#EXT-X-BYTERANGE")):
                pending.append(absolutise_tag(line, url))
            elif not line.startswith("#"):
                if duration is not None:
                    out.append({"dur": duration, "tags": list(pending), "uri": resolve(line, url)})
                duration = None
                pending = []
            elif line.startswith("#EXT-X-DISCONTINUITY-SEQUENCE") or line.startswith("#EXT-X-MEDIA-SEQUENCE") or line.startswith("#EXT-X-PROGRAM-DATE-TIME"):
                pass
        self.cache[url] = out
        return out

    def build(self, built: dict, now: dt.datetime) -> tuple[str, str, dict]:
        ch = built["config"]
        hls_cfg = self.cfg
        target = int(hls_cfg.get("target_duration", 10))
        window_minutes = int(hls_cfg.get("window_minutes", 60))
        max_segments = int(hls_cfg.get("window_segments", 24)) * 15
        fallback_hls = hls_cfg.get("non_hls_fallback_hls", "")
        items = [i for s in built["slots"] for i in s["items"]]

        future = []
        for item in items:
            end = dt.datetime.fromisoformat(item["end"].replace("Z", "+00:00"))
            if end > now:
                future.append(item)

        segments: list[tuple[list[str], float, str]] = []
        bridged = 0
        media_seq = int(now.timestamp() // max(1, target))
        total = 0.0
        first_time = iso(now)

        for item in future:
            if total >= window_minutes * 60 or len(segments) >= max_segments:
                break
            start = dt.datetime.fromisoformat(item["start"].replace("Z", "+00:00"))
            cursor = max(now, start)
            elapsed_in_item = max(0.0, (cursor - start).total_seconds())
            seek = float(item.get("offset", 0)) + elapsed_in_item
            room = float(item["duration"]) - (elapsed_in_item if cursor == now else 0.0)
            if room <= 0:
                continue

            src = item.get("src", "")
            kind = str(item.get("kind", ""))
            use_src = src if (kind in HLS_KINDS or src.endswith(".m3u8")) else ""
            if not use_src:
                bridged += 1
                use_src = fallback_hls
                seek = 0.0
            segs = self.segments(use_src) if use_src else []
            if not segs:
                continue

            # seek into the source, then loop it until the item's room is filled
            source_len = sum(s["dur"] for s in segs) or 1.0
            pos = seek % source_len
            idx = 0
            acc = 0.0
            for i, s in enumerate(segs):
                if acc + s["dur"] > pos:
                    idx = i
                    break
                acc += s["dur"]
            emitted_item = 0.0
            first_of_item = True
            while emitted_item < room and total < window_minutes * 60 and len(segments) < max_segments:
                s = segs[idx % len(segs)]
                tags = [t for t in s["tags"] if not t.startswith("#EXT-X-DISCONTINUITY")]
                if first_of_item and segments:
                    tags = ["#EXT-X-DISCONTINUITY"] + tags
                segments.append((tags, s["dur"], s["uri"]))
                emitted_item += s["dur"]
                total += s["dur"]
                first_of_item = False
                idx += 1

        if not segments:
            # OFFLINE MODE: still a 100% valid HLS file (a master playlist).
            backup = fallback_hls or "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
            live = ("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n"
                    "# MIZANORA: stitcher offline -> emergency HLS master fallback\n"
                    "# Control Room / watch.html isko local schedule se 24/7 chalata rehta hai.\n"
                    f'#EXT-X-STREAM-INF:BANDWIDTH=2500000,AVERAGE-BANDWIDTH=1800000,RESOLUTION=1280x720,NAME="MIZANORA NETWORK FEED"\n'
                    f"{backup}\n")
            mode = "master-fallback"
        else:
            target_real = max(target, int(max(s[1] for s in segments)) + 1)
            lines = ["#EXTM3U", "#EXT-X-VERSION:6", f"#EXT-X-TARGETDURATION:{target_real}",
                     f"#EXT-X-MEDIA-SEQUENCE:{media_seq}", "#EXT-X-INDEPENDENT-SEGMENTS",
                     f"#EXT-X-PROGRAM-DATE-TIME:{first_time}",
                     f"# MIZANORA LIVE 24/7 | channel={ch['id']} | now={built['status']['now']}",
                     f"# window={window_minutes}min | segments={len(segments)} | non-HLS bridged slots={bridged}",
                     "# regenerated by .github/workflows/playout.yml"]
            for tags, dur, uri in segments:
                lines.extend(tags)
                lines.append(f"#EXTINF:{dur:.3f},")
                lines.append(uri)
            live = "\n".join(lines) + "\n"  # no ENDLIST => LIVE playlist
            mode = "stitch"

        backup = ("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n"
                  "# MIZANORA EMERGENCY BACKUP FEED\n"
                  '#EXT-X-STREAM-INF:BANDWIDTH=2500000,AVERAGE-BANDWIDTH=1800000,RESOLUTION=1280x720,NAME="MIZANORA BACKUP"\n'
                  f"{fallback_hls or 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'}\n")

        report = {"channel": ch["id"], "mode": mode, "segments": len(segments),
                  "window_minutes": window_minutes, "bridged_slots": bridged,
                  "failed_sources": sorted(self.failures), "target_duration": target}
        self.diagnostics.append({"level": "info", "channel": ch["id"], "message": f"HLS {mode}: {len(segments)} segments"})
        return live, backup, report

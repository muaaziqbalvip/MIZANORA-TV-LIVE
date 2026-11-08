#!/usr/bin/env python3
"""Unit tests — no network needed. Run: python3 -m unittest discover -s tests -v"""
from __future__ import annotations

import datetime as dt
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from hls import HlsStitcher  # noqa: E402
from lib_playout import UTC, PlayoutEngine, fnv1a, load_config, pick  # noqa: E402
from validate_config import validate  # noqa: E402

NOW = dt.datetime(2026, 11, 8, 15, 12, 30, tzinfo=UTC)  # 20:12 PKT -> prime time


class TestConfig(unittest.TestCase):
    def setUp(self):
        self.g, self.cfg = load_config()

    def test_config_valid(self):
        errors, _ = validate(self.g, self.cfg)
        self.assertEqual(errors, [], f"config errors: {errors}")

    def test_all_channels_enabled_with_chain(self):
        ids = {c["id"] for c in self.cfg["channels"]}
        for c in self.cfg["channels"]:
            self.assertIn(c["chain_next"], ids)


class TestDeterminism(unittest.TestCase):
    def setUp(self):
        self.g, self.cfg = load_config()

    def test_fnv1a_stable(self):
        self.assertEqual(fnv1a("mizanora|1|segment"), fnv1a("mizanora|1|segment"))
        self.assertNotEqual(fnv1a("mizanora|1|segment"), fnv1a("mizanora|2|segment"))

    def test_pick_stable(self):
        pool = [{"id": f"x{i}"} for i in range(7)]
        a = pick(pool, "same-key")["id"]
        b = pick(pool, "same-key")["id"]
        self.assertEqual(a, b)

    def test_repeatable_schedule(self):
        e1 = PlayoutEngine(self.g, self.cfg, NOW)
        e2 = PlayoutEngine(self.g, self.cfg, NOW)
        ch = self.cfg["channels"][0]
        self.assertEqual(e1.slots_for(ch, 2), e2.slots_for(ch, 2))


class TestSchedule(unittest.TestCase):
    def setUp(self):
        self.g, self.cfg = load_config()
        self.engine = PlayoutEngine(self.g, self.cfg, NOW)
        self.ch = self.cfg["channels"][0]

    def test_no_dead_air_every_slot_full(self):
        for slot in self.engine.slots_for(self.ch, 2):
            total = sum(i["duration"] for i in slot["items"])
            self.assertEqual(total, slot["duration"], f"slot {slot['index']} has {slot['duration']-total}s of dead air")

    def test_break_order_trailer_ad_trailer_segment_filler(self):
        slot = self.engine.slots_for(self.ch, 1)[0]
        types = [i["type"] for i in slot["items"]]
        seg = types.index("segment")
        self.assertEqual(types[0], "trailer")
        self.assertIn("ad", types[:seg])
        self.assertEqual(types[seg - 1], "trailer")
        self.assertTrue(any(t.startswith("filler") for t in types), "short programme must be gap-filled")

    def test_short_program_is_gap_filled(self):
        slot = self.engine.slots_for(self.ch, 1)[0]
        segment = next(i for i in slot["items"] if i["type"] == "segment")
        self.assertLess(segment["duration"], slot["duration"])
        self.assertGreater(slot["gap_filled"], 0)

    def test_prime_time_detected_at_20h_pkt(self):
        slots = self.engine.slots_for(self.ch, 1)
        self.assertTrue(any(s["prime"] for s in slots))
        self.assertTrue(any(s["prime_label"] == "PRIME TIME" for s in slots))

    def test_now_next_consistency(self):
        built = self.engine.build_channel(self.ch)
        cur = built["now_next"]["current"]
        self.assertIsNotNone(cur)
        start = dt.datetime.fromisoformat(cur["start"].replace("Z", "+00:00"))
        end = dt.datetime.fromisoformat(cur["end"].replace("Z", "+00:00"))
        self.assertLessEqual(start, NOW)
        self.assertGreater(end, NOW)
        self.assertGreaterEqual(built["now_next"]["progress"], 0)
        self.assertLessEqual(built["now_next"]["progress"], 100)

    def test_every_channel_has_items(self):
        for ch in self.cfg["channels"]:
            b = self.engine.build_channel(ch)
            self.assertTrue(b["slots"])
            self.assertTrue(b["schedule"]["slots"])
            self.assertTrue(b["epg"]["programmes"])
            self.assertTrue(b["now_next"]["current"])
            self.assertIn("reel_sources", b["schedule"])

    def test_every_item_supported_kind(self):
        from lib_playout import SUPPORTED_KINDS
        for ch in self.cfg["channels"]:
            for slot in self.engine.build_channel(ch)["slots"]:
                for item in slot["items"]:
                    self.assertIn(item["kind"], SUPPORTED_KINDS)

    def test_compact_window(self):
        b = self.engine.build_channel(self.ch)
        self.assertLessEqual(len(b["schedule"]["slots"]), 6)
        self.assertNotIn("items", b["schedule"])
        self.assertGreater(len(b["epg"]["programmes"]), 100)


class TestOutputs(unittest.TestCase):
    def setUp(self):
        self.g, self.cfg = load_config()
        self.engine = PlayoutEngine(self.g, self.cfg, NOW)
        self.built = self.engine.build_all()

    def test_xmltv_parses(self):
        root = ET.fromstring(self.engine.xmltv(self.built))
        self.assertEqual(root.tag, "tv")
        self.assertEqual(len(root.findall("channel")), len(self.built))
        self.assertGreater(len(root.findall("programme")), len(self.built) * 100)

    def test_iptv_playlist(self):
        text = self.engine.iptv_playlist(self.built)
        self.assertTrue(text.startswith("#EXTM3U"))
        for b in self.built:
            self.assertIn(f"channels/{b['config']['id']}/live.m3u8", text)

    def test_bouquet_master(self):
        text = self.engine.bouquet_master(self.built)
        self.assertIn("#EXT-X-STREAM-INF", text)
        self.assertEqual(text.count("#EXT-X-STREAM-INF"), len(self.built))

    def test_hls_offline_fallback_is_valid_hls(self):
        st = HlsStitcher(self.g, online=False)
        live, backup, report = st.build(self.built[0], NOW)
        self.assertTrue(live.startswith("#EXTM3U"))
        self.assertIn("#EXT-X-STREAM-INF", live)
        self.assertEqual(report["mode"], "master-fallback")
        self.assertTrue(backup.startswith("#EXTM3U"))

    def test_channel_index(self):
        idx = self.engine.channel_index(self.built)
        self.assertEqual(len(idx["channels"]), len(self.built))
        self.assertIn("library", idx)

    def test_hls_stitch_from_cached_manifest(self):
        """Offline runner + cached playlist = real stitched live media playlist."""
        import hashlib
        import tempfile
        import hls as hls_mod
        url = "https://cdn.example.com/channel/master.m3u8"
        text = ("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:10\n"
                "#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:10.0,\nseg1.ts\n#EXTINF:10.0,\nseg2.ts\n"
                "#EXTINF:10.0,\nseg3.ts\n")
        with tempfile.TemporaryDirectory() as tmp:
            old = hls_mod.DOCS_DIR
            hls_mod.DOCS_DIR = Path(tmp)
            try:
                cache = Path(tmp) / "data" / "manifests" / (hashlib.sha1(url.encode()).hexdigest() + ".m3u8")
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(text)
                g = dict(self.g)
                g["hls"] = dict(g["hls"])
                g["hls"]["non_hls_fallback_hls"] = url
                g["hls"]["window_minutes"] = 2
                st = HlsStitcher(g, online=False)
                live, backup, report = st.build(self.built[0], NOW)
                self.assertEqual(report["mode"], "stitch")
                self.assertGreater(report["segments"], 0)
                self.assertIn("#EXT-X-TARGETDURATION", live)
                self.assertIn("#EXT-X-MEDIA-SEQUENCE", live)
                self.assertNotIn("#EXT-X-ENDLIST", live)
                self.assertIn("seg1.ts", live)
            finally:
                hls_mod.DOCS_DIR = old


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Build animated 3D channel idents / logo bugs from the real MIZANORA brand.

Brand research (Mizanora-org/MIZANORA): emerald tile #0B6B45 -> #04361F,
gold crescent + 8-point star #F2C766, night background #03130D.
Har channel ka apna accent + apna animated SVG logo yahan se banta hai.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_playout import DOCS_DIR, load_config  # noqa: E402

TEMPLATE = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" role="img" aria-label="{label} logo">
<title>{label} — MIZANORA Broadcast Network</title>
<style>
  .spin,.spin-rev,.glow,.twinkle,.pulse,.float,.sheen,.scan,.orbit{{transform-box:fill-box;transform-origin:center}}
  .spin{{animation:mz-spin {spin}s linear infinite}}
  .spin-rev{{animation:mz-spin {spin_rev}s linear infinite reverse}}
  @keyframes mz-spin{{to{{transform:rotate(360deg)}}}}
  .glow{{animation:mz-glow 3.4s ease-in-out infinite}}
  @keyframes mz-glow{{0%,100%{{opacity:.35;transform:scale(.92)}}50%{{opacity:.9;transform:scale(1.08)}}}}
  .twinkle{{animation:mz-twinkle 2.6s ease-in-out infinite}}
  .twinkle.d1{{animation-delay:.7s}} .twinkle.d2{{animation-delay:1.4s}} .twinkle.d3{{animation-delay:2.1s}}
  @keyframes mz-twinkle{{0%,100%{{opacity:.15;transform:scale(.6)}}50%{{opacity:1;transform:scale(1.15)}}}}
  .pulse{{animation:mz-pulse 1.6s ease-in-out infinite}}
  @keyframes mz-pulse{{0%,100%{{opacity:1;transform:scale(1)}}50%{{opacity:.4;transform:scale(.65)}}}}
  .float{{animation:mz-float 6s ease-in-out infinite alternate}}
  @keyframes mz-float{{from{{transform:translateY(-4px) rotate(-2deg)}}to{{transform:translateY(5px) rotate(2deg)}}}}
  .sheen{{animation:mz-sheen 6s ease-in-out infinite}}
  @keyframes mz-sheen{{0%,60%{{transform:translateX(-360px)}}100%{{transform:translateX(360px)}}}}
  .scan{{animation:mz-scan 5s linear infinite}}
  @keyframes mz-scan{{0%{{transform:translateY(0);opacity:0}}10%{{opacity:.35}}90%{{opacity:.35}}100%{{transform:translateY(300px);opacity:0}}}}
  .live{{fill:{live};animation:mz-live 1.4s ease-in-out infinite}}
  @keyframes mz-live{{0%,100%{{opacity:1}}50%{{opacity:.35}}}}
  .word{{font:700 25px Arial,Helvetica,sans-serif;letter-spacing:5px;fill:{gold_light}}}
  .sub{{font:600 10px Arial,Helvetica,sans-serif;letter-spacing:3.4px;fill:{gold};opacity:.85}}
  @media (prefers-reduced-motion: reduce){{.spin,.spin-rev,.glow,.twinkle,.pulse,.float,.sheen,.scan{{animation:none!important}}}}
</style>
<defs>
  <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{primary}"/><stop offset=".5" stop-color="{deep}"/><stop offset="1" stop-color="{night}"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{gold_light}"/><stop offset=".5" stop-color="{gold}"/><stop offset="1" stop-color="{gold_deep}"/>
  </linearGradient>
  <radialGradient id="aura"><stop offset="0" stop-color="{gold}" stop-opacity=".6"/><stop offset="1" stop-color="{gold}" stop-opacity="0"/></radialGradient>
  <radialGradient id="orb" cx=".35" cy=".28" r=".8">
    <stop offset="0" stop-color="{primary}" stop-opacity=".9"/><stop offset=".55" stop-color="{deep}"/><stop offset="1" stop-color="{night}"/>
  </radialGradient>
  <mask id="crescent"><rect width="320" height="320" fill="#fff"/><circle cx="182" cy="128" r="49" fill="#000"/></mask>
  <filter id="soft"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="drop" x="-40%" y="-40%" width="180%" height="180%">
    <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity=".55"/>
  </filter>
  <clipPath id="tile-clip"><rect x="8" y="8" width="304" height="304" rx="56"/></clipPath>
</defs>
<g clip-path="url(#tile-clip)">
  <rect x="8" y="8" width="304" height="304" rx="56" fill="{night}"/>
  <rect x="8" y="8" width="304" height="304" rx="56" fill="url(#tile)" opacity=".96"/>
  <circle class="glow" cx="160" cy="150" r="132" fill="url(#aura)" filter="url(#soft)"/>
  <g opacity=".22" stroke="{gold}" fill="none">
    <path d="M0 60H320M0 120H320M0 180H320M0 240H320M0 300H320"/>
    <path d="M40 0V320M100 0V320M160 0V320M220 0V320M280 0V320"/>
  </g>
  <rect class="scan" x="8" y="0" width="304" height="3" fill="{gold_light}" opacity=".3"/>
  <g class="sheen" opacity=".14"><rect x="-60" y="-20" width="46" height="380" fill="{gold_light}" transform="rotate(18 0 0)"/></g>
</g>
<g fill="none" stroke="{gold}" stroke-opacity=".55">
  <circle cx="160" cy="152" r="126" stroke-width="1.2" stroke-dasharray="2 9"/>
  <g class="spin"><circle cx="160" cy="152" r="112" stroke-width="2" stroke-dasharray="34 18 6 18"/></g>
  <g class="spin-rev"><circle cx="160" cy="152" r="100" stroke-width="1" stroke-dasharray="3 13" stroke="{gold_light}"/></g>
  <circle cx="160" cy="152" r="84" stroke-width="1" stroke-opacity=".3"/>
</g>
<g class="twinkle" fill="{gold_light}"><path d="M62 92l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/></g>
<g class="twinkle d1" fill="{gold}"><path d="M258 86l2.5 7 7 2.5-7 2.5-2.5 7-2.5-7-7-2.5 7-2.5z"/></g>
<g class="twinkle d2" fill="{gold_light}"><path d="M252 224l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></g>
<g class="twinkle d3" fill="{gold}"><path d="M70 224l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></g>
<g filter="url(#drop)">
  <circle cx="160" cy="152" r="72" fill="url(#orb)" stroke="{gold}" stroke-opacity=".65" stroke-width="2"/>
  <circle cx="160" cy="152" r="64" fill="none" stroke="{gold_light}" stroke-opacity=".22"/>
  <g class="float">
    <circle cx="158" cy="150" r="48" fill="url(#gold)" mask="url(#crescent)"/>
    <path d="M196 96 L202 114 L220 120 L202 126 L196 144 L190 126 L172 120 L190 114 Z" fill="url(#gold)"/>
    <path d="M196 106 L199 116 L209 120 L199 124 L196 134 L193 124 L183 120 L193 116 Z" fill="{gold_light}" opacity=".55"/>
  </g>
</g>
<g transform="translate(0,246)">
  <rect x="30" y="0" width="260" height="52" rx="14" fill="{night}" opacity=".78" stroke="{gold}" stroke-opacity=".5"/>
  <text class="word" x="160" y="26" text-anchor="middle">{word}</text>
  <text class="sub" x="160" y="42" text-anchor="middle">{sub}</text>
</g>
<g transform="translate(24,26)"><circle class="live" cx="0" cy="0" r="6"/><text x="14" y="4" font="700 11px Arial" letter-spacing="2" fill="{gold_light}">LIVE</text></g>
</svg>
'''


def build_one(channel: dict, out: Path) -> str:
    theme = channel.get("theme", {})
    gold = theme.get("accent", "#F2C766")
    primary = theme.get("primary", "#12905C")
    label = channel.get("name", "MIZANORA")
    word = channel.get("short", label[:8])
    svg = TEMPLATE.format(
        label=label.replace("&", "&amp;"), word=word.replace("&", "&amp;"),
        sub=("MIZANORA NETWORK  ·  HD  ·  24/7" if len(word) <= 6 else "MIZANORA NETWORK"),
        primary=primary, deep=theme.get("bg", "#04361F"), night="#03130D",
        gold=gold, gold_light="#FFF3D0", gold_deep="#B8860B", live="#FF5470",
        spin=channel.get("animation", {}).get("rotation_speed", 26),
        spin_rev=channel.get("animation", {}).get("rotation_speed", 26) + 8,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    return str(out)


def main() -> int:
    _, cfg = load_config()
    brand = DOCS_DIR / "assets" / "brand"
    for ch in cfg.get("channels", []):
        name = ch["id"].replace("mizanora-", "") if ch["id"] != "mizanora" else "mizanora"
        path = brand / f"logo-{name}.svg"
        print("[LOGO]", build_one(ch, path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

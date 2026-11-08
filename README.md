# 📡 MIZANORA · 24/7 LIVE TV on GitHub Actions + GitHub Pages

> **Shop Smart. Shop Halal.** — Mizanora Broadcast Network · Kasur, Punjab, Pakistan
> Serverless virtual transmission: **4 channels · 4 workflows · 1 control room · 24/7 auto playout**

| | |
|---|---|
| **Control Room** | `https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/` |
| **Clean TV Viewer** | `https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/watch.html` |
| **Live M3U8 (flagship)** | `https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/channels/mizanora/live.m3u8` |
| **All channels M3U** | `https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/data/mizanora-tv.m3u` |
| **XMLTV EPG (7 days)** | `https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/data/epg.xml` |
| **Network master** | `https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/master.m3u8` |

> ✅ **Status (08 Nov 2026, 17:18 UTC):** PR #1 `main` me **merge** ho chuka hai, Pages **ON** hai (`main /docs`). Magar pehla Pages build `building`/`queued` tha — wajah aur fix neeche **[🩺 Troubleshooting](#-troubleshooting-workflows-queued--pages-build-cancelled)** me hai. Branch-based Pages build complete hone par ye links live honge.

---

## 🔥 Sabse pehle: kya ye sach me 24/7 hai? (seedhi baat)

**Haan — channel 24/7 chalta hai, lekin smart tareeqe se.** GitHub par koi bhi "true realtime video encoder" 24/7 nahi chala sakti:

* GitHub Actions ka ek job **max 6 ghante**, cron **min 5 minute**, free tier **~2000 minute/month**.
* GitHub Pages **sirf static files** serve karta hai — wahan `ffmpeg` stream nahi chalta.
* Repo me video files rakhna mana hai (**100 MB/file, ~1 GB repo limit**), bandwidth bhi limited.

Is liye system aisa banaya gaya hai jo **in sab ke bawajood 24/7 linear TV** deta hai:

```
GitHub Actions (har 30 min)  →  schedule + EPG + live.m3u8 + heartbeat + health  →  git push docs/
GitHub Pages (static)        →  M3U8 / JSON / XMLTV / Control Room HTML
Browser playout engine       →  deterministic schedule se WAQT ke hisaab se clip chun-ta hai,
                                MP4/MKV/M3U8/MPD chalata hai, ads/trailers se gap bharta hai,
                                error → 3D ident → retry, aur KABHI nahi rukta
```

**Key idea:** schedule `*deterministic*` hai — `(channel id + slot number)` se hamesha wahi program nikalta hai. Is liye agar workflow 1 ghanta, 1 din ya hamesha ke liye band bhi ho jaye, **browser apne aap agla segment, agla ad, agla trailer, agla slot chala deta hai**. Actions sirf "heartbeat + fresh M3U8 + EPG + health" ke liye hai, channel chalane ke liye nahi. Yehi is system ki sabse badi strength hai.

Third-party IPTV players (VLC, Tivimate, Kodi) ke liye `live.m3u8` har tick par **agle 60 minute ka HLS window** rakhti hai (remote HLS playlists ke segments stitch karke). Agar aapko *sach me* 24/7 externally-encoded stream chahiye to neeche **[True 24/7 upgrade](#-true-247-upgrade-optional)** dekhein.

---

## ✅ Jo kuch bhi manga tha — sab yahan hai

| Aapki demand | Implementation |
|---|---|
| GitHub Actions se live system, 24/7 restart/loop logic | `playout.yml` cron `0,30 * * * *` (48 ticks/day, ~1440 min/month), `watchdog.yml` auto re-dispatch, `recovery` job, channel handoff chain with hop-limit loop protection |
| GitHub Pages se live M3U8 | `docs/channels/<id>/live.m3u8` + `backup.m3u8` + `master.m3u8` + `data/mizanora-tv.m3u` (HLS stitcher, valid HLS, 60-min rolling window) |
| Professional 3D control room, HTML digital 3D line animation | `docs/index.html` + `control-room.css` + `visuals.js` (rotating 3D wireframe globe, perspective grid, particles, hologram rings, scanlines, aurora, glass panels, corner brackets) |
| Channel logo animations, logo neeche 3D time | Animated SVG logos (real MIZANORA brand: emerald tile + gold crescent + 8-point star, rotating rings/twinkle/sheen/scan) + CSS 3D rotating logo bug + 3D flip clock + date + timezone + Hijri + UTC |
| Logo link se set karo | `logo_url` field in config AND right-rail **BRAND → CHANNEL LOGO LINK (URL)**; `onerror` auto fallback to local animated SVG |
| Date / time / timezone / format sab settings | **CLOCK** tab: timezone (10 zones + custom), 12/24h, seconds, date, Hijri (Intl Islamic calendar), UTC clock, date format, custom label (PKT wagera) |
| Segment 1 hour / 30 min / jitna bhi | **GENERAL → SEGMENT LENGTH**: 15/30/45/60/90/120 min (ya raw JSON me koi bhi value) |
| Next segment dekhein / hide karein | **BRAND → SHOW UP NEXT PREVIEW**, `H` shortcut, `next_preview` thumbnail toggle |
| Ads set karo, MP4 links, har tarah ki media | **ADS / MEDIA** tabs: add/edit/delete ads, trailers, segments; `MP4 · MKV · MOV · WebM · M4V · M3U8/HLS · MPD/DASH · TS · MP3 · IMAGE` |
| 1 ghante ka slot, 20–30 min ki video → baqi ads/trailers | Deterministic **BREAK ORDER**: `TRAILER → ADS → TRAILER → SEGMENT → GAP-FILL REEL`. Chhote program ke baad looping ad+trailer reel slot ke end tak chalti hai (frozen "Please Stand By" nahi) |
| Break tartib: trailer → ads → trailer → segment | Configurable order chips (click to remove, dropdown to add, reset). Prime time me ads auto ×2/×3 |
| Prime time, naye channels, audio pitch, XL EPG | `prime_time` window (cross-midnight bhi), 4 channels, WebAudio-free gain/pitch/duck via `playbackRate` + `preservesPitch=false`, 7-day **XL EPG** grid + XMLTV with cast/rating/poster/ad-breaks/gap-fill |
| MIZANORA Documentary / Movies alag alag workflow, auto handoff | `channel-main.yml` → `channel-documentary.yml` → `channel-movies.yml` → `channel-noor.yml` → loop complete. Har workflow apna media prefetch + tick karta hai aur **close hote hi agla auto dispatch** karta hai |
| Workflow auto samaan download ker ke ready | `media-prefetch.yml` + `scripts/prefetch.py` sab HLS manifests `docs/data/manifests/` me cache karta hai; stitcher offline bhi unse playlist bana leta hai |
| 3D animation / video search karke tayyar | Brand research: `Mizanora-org/MIZANORA` se asli brand (emerald `#0B6B45`, gold `#F2C766`, crescent + 8-point star) → 4 animated SVG logos + 2 AI-generated 3D ident backdrops (`ident-studio.jpg`, `ident-cinematic.jpg`) |
| All errors & channel handling | Config linter, 19 unit tests, media probe, source timeout/retry, black-screen guard → 3D ident, `incidents.json`, `health.json`, `watchdog.json`, broadcast log, recovery workflow |
| Har tarah ka control | 9 settings tabs (GENERAL/BRAND/CLOCK/PLAYOUT/ADS/MEDIA/AUDIO/EPG/SYSTEM), JSON raw editor, import/export, localStorage persistence, keyboard shortcuts, GitHub save/dispatch (optional PAT), PiP, fullscreen, mute, gain/pitch sliders |

---

## 🚀 Quick start (5 minute)

### Step 1 — Branch → `main` ✅ HO GAYA
PR #1 merge ho chuka hai (`6e26176`). **Scheduled workflows sirf default branch (`main`) se chalte hain** — is liye aage ki har fix bhi PR se `main` me jani chahiye.

### Step 2 — GitHub Pages ON (0 Actions minutes) ✅ HO GAYA
`Settings → Pages → Deploy from a branch → main /docs` set hai (`build_type: legacy`, `status: building`).
`docs/.nojekyll` bhi add hai taake Jekyll build skip ho aur JSON/M3U8 files waise ki waise serve hon.

> ⛔ **Sirf EK deploy mechanism.** `pages.yml` ab **manual-only** hai (sirf `workflow_dispatch`). Pehle usme `push` trigger tha → do deploy ek saath chal kar cancel/queue ho rahe the. Agar aap Actions UI me "MIZANORA · Pages Deploy" ya "MIZANORA · Retry Pages Build" ko `push` par wapas chalayenge to wahi problem lautegi.

### Step 3 — Workflow permissions
`Settings → Actions → General → Workflow permissions → **Read and write permissions**` ✅ (bot ko `docs/` push karna hai).

### Step 4 — Pehla tick chalao
`Actions → MIZANORA · 24/7 Playout Engine → Run workflow`:
| input | value |
|---|---|
| `channel` | `all` |
| `reason` | `manual` |
| `chain` | **`true`** ← 4 channel workers auto chain me chalenge |

Ya CLI se:
```bash
gh workflow run playout.yml -f reason=manual -f chain=true -f channel=all
```

### Step 5 — Verify
```bash
curl -s https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/channels/mizanora/live.m3u8 | head -12
curl -s https://muaaziqbalvip.github.io/MIZANORA-TV-LIVE/data/heartbeat.json
```
Phir Control Room kholein → `⚙ MASTER CONTROL` me apne asli media links daalein → `APPLY & RE-SYNC`.

---

## 🧠 Architecture

```
config/global.json ─┐
config/channels.json ─┴─► scripts/lib_playout.py  (deterministic engine)
                              │
        ┌─────────────────────┼──────────────────────────┐
        ▼                     ▼                          ▼
 scripts/hls.py      scripts/playout.py          docs/assets/js/core.js
 (HLS stitcher)      (writes docs/)              (SAME maths in browser)
        │                     │                          │
        ▼                     ▼                          ▼
 live.m3u8          schedule.json / epg.json    MZ.Playout → video/hls.js/dash.js
 backup.m3u8        now-next.json / status.json      │
 master.m3u8        epg.xml / heartbeat.json          ├─► gap-fill reel
 data/*.json        incidents / health / logs         ├─► error → 3D ident
                              │                       └─► 24/7 auto advance
                              ▼
              GitHub Pages (static /docs)  ◄── Control Room + Viewer
                              ▲
 .github/workflows/ ─────────┘
   playout.yml …………… cron 0,30 · matrix-ready · reusable (workflow_call)
   channel-{main,documentary,movies,noor}.yml … handoff chain
   watchdog.yml ………… stale heartbeat → repository_dispatch → restart
   media-prefetch.yml  daily manifest download / cache
   pages.yml ……………… MANUAL "Retry Pages Build" (koi auto push trigger NAHI)
   ci.yml …………………… config lint + 19 tests + JS syntax
```

### Determinism (kyun zaroori hai)
`fnv1a("mizanora|7474|segment")` → hamesha wahi program. Python aur JavaScript dono me **ek hi algorithm** hai. Slot `k` ka start = `anchor_utc + k × slot_minutes`. Is liye:
* koi bhi runner, koi bhi browser, koi bhi waqt → same EPG, same now/next.
* tick miss ho to bhi channel nahi rukta; watchdog bas heartbeat fresh karta hai.
* `schedule.json` me sirf 6 slots ka window likha jata hai; files **content-hashed** hain (unchanged → rewrite nahi) taake git history na phoole.

---

## ⚙️ Config guide — asli media kaise lagayein

Sab kuch **`config/channels.json`** aur **`config/global.json`** me hai. Control Room se bhi edit kar sakte hain (browser me + optional GitHub save).

```jsonc
{
  "id": "mizanora",
  "slot_minutes": 60,                              // 1 ghanta
  "break_order": ["trailer","ad","trailer","segment","filler"],
  "logo_url": "https://cdn.example.com/mizanora-logo.png",  // koi bhi link
  "timezone": "Asia/Karachi",
  "prime_time": { "enabled": true, "start": "19:00", "end": "23:00", "ad_multiplier": 2 },
  "ads_per_break": 2,
  "gap_fill": true,                               // false = single ident
  "audio": { "gain": 1.0, "pitch": 1.0, "duck_ads_db": -6 },
  "segments": [
    { "id":"doc-1", "title":"Meri Documentary", "src":"https://cdn.example.com/a.mp4",
      "kind":"mp4", "duration":1800, "pool":"regular", "genre":"Documentary",
      "poster":"https://…/poster.jpg", "description":"…", "audio_pitch":1.0 }
  ]
}
```

| Field | Kya karta hai |
|---|---|
| `duration` | **seconds** me. Ye declared runtime hai; is se chhota program → baqi slot reel se bharega |
| `kind` | `mp4` `mkv` `mov` `webm` `m4v` `m3u8` `hls` `mpd` `ts` `mp3` `image` |
| `pool` | `regular` ya `prime` — prime time window me `prime` pool se program chun-ta hai |
| `ads` / `trailers` | Channel-level; khali chhorne par `global.json → library` use hoti hai |
| `chain_next` | Agla channel workflow (auto handoff) |
| `clock.*` | 12/24h, seconds, date, Hijri, UTC, label |
| `animation.*` | 3D logo / lines / particles / flip clock / intensity / reduced motion |
| `ui.*` | next preview, logo bug, ticker, progress, EPG, ticker text |
| `errors.*` | retries, timeout, fallback, black-screen guard |

**Demo links replace karna zaroori hai.** Abhi `config/global.json` aur `config/channels.json` me public test videos (Google sample bucket, Mux test stream, Apple HLS sample) hain taake system foran chal ke dikhe. Apni **owned / licensed** media URLs daalein. ⚖️ Copyright ka khayal rakhein.

**Local testing:**
```bash
python3 scripts/validate_config.py
python3 -m unittest discover -s tests -v
python3 scripts/playout.py --offline --reason manual
python3 -m http.server 8000 --directory docs     # http://localhost:8000
```

---

## 📺 Channels & live links

| # | Channel | Slot | Prime | Workflow | Live M3U8 |
|---|---|---|---|---|---|
| 1 | MIZANORA (flagship) | 60 min | 19:00–23:00 | `channel-main.yml` | `channels/mizanora/live.m3u8` |
| 2 | MIZANORA DOCS | 30 min | 20:00–22:00 | `channel-documentary.yml` | `channels/mizanora-documentary/live.m3u8` |
| 3 | MIZANORA MOVIES | 120 min | 21:00–01:00 | `channel-movies.yml` | `channels/mizanora-movies/live.m3u8` |
| 4 | MIZANORA NOOR | 30 min | 04:30–06:30 Fajr | `channel-noor.yml` | `channels/mizanora-noor/live.m3u8` |

Har channel ka apna `epg.xml`, `epg.json`, `now-next.json`, `schedule.json`, `status.json`, `config.json`, `backup.m3u8`.

---

## 🛡️ Error handling & self-healing

| Problem | System kya karta hai |
|---|---|
| Source link dead / CORS / 404 | `media_probe.py` report → player timeout → retry → **3D ident fallback** → agla item |
| Video slot se pehle khatam | Trailer/ad reel loop, `loopGuard`, aur slot end par agla item |
| HLS/CDN down | `backup.m3u8` (emergency master) + `prefetch` cached manifests + offline master fallback |
| Config ghalat | `validate_config.py` CI me fail karta hai; runtime fault-tolerant mode + `health.json` |
| Workflow tick fail | `recovery` job offline artifacts banata hai + `repository_dispatch` se naya tick |
| Cron miss / runner queue | `watchdog.yml` heartbeat age check → auto re-dispatch (max 3/hour circuit breaker) |
| Infinite dispatch loop | `hop` counter + `concurrency` groups + content-aware writes |
| Browser autoplay block | Mute karke auto-play, pehle click par sound restore, toast message |
| Black screen | `black_screen_guard`: hamesha animated 3D ident zinda rehta hai |

---

## 📉 Honest limits (aur inka hal)

| Limit | Asar | Hal is repo me |
|---|---|---|
| Actions job 6h / cron ≥5 min / ~2000 min free | True 24/7 encoder impossible | Deterministic browser playout + 30-min heartbeat (~1440 min/month) |
| Pages static only | Server-side stitch nahi | Client-side HLS stitcher (remote segment URLs) + cached manifests |
| Repo 100 MB/file, ~1 GB | Video commit nahi | Sirf text playlists; media external CDN |
| Pages bandwidth ~100 GB/mo soft | Heavy traffic | Cloudflare in front of Pages |
| Cron default branch par | Arena branch par schedule nahi chalega | PR → `main` merge (Step 1) |
| MP4/MKV in HLS playlist | HLS spec allows only TS/fMP4 segments | Browser plays them natively; `live.m3u8` un slots ko network ident HLS se bridge karta hai (config: `hls.non_hls_fallback_hls`) |
| MKV in browser | Aksar browsers MKV decode nahi karte | Auto fallback ident; transcode path (`hls.transcode_non_hls`) ya MP4/HLS me convert karein |
| CORS | Kuch CDNs browser me block | Same-origin / CORS-enabled CDN use karein |
| Copyright | Demo test videos | Apni licensed media lagayein |

### 🔌 True 24/7 upgrade (optional)
Agar aapko **real HLS encoder** chahiye jo VLC me bina ruke 24/7 chale:
1. Ek cheap VPS / Cloudflare R2 + ffmpeg (`OBS` ya `ffmpeg -re -i playlist.txt -f hls …`) chalayein.
2. `config/global.json → hls.non_hls_fallback_hls` aur channel `src` ko us CDN se replace karein.
3. Ye repo tab bhi **schedule, EPG, control room, branding, ads** ka brain rahega — sirf video delivery external ho jayegi.

---

## 🗂️ Repo map

```
.github/workflows/     playout · 4 channel workers · watchdog · prefetch · pages · ci
config/                global.json + channels.json  ← YAHAN EDIT KAREIN
scripts/               lib_playout · playout · hls · media_probe · prefetch ·
                       watchdog · validate_config · build_assets
tests/                 19 unit tests (schedule, gap-fill, prime, XMLTV, HLS, determinism)
docs/                  GitHub Pages root
  index.html           CONTROL ROOM (3D UI)
  watch.html           clean TV viewer
  assets/css|js|brand  styling · engines · animated logos · 3D idents
  channels/<id>/       live.m3u8 · backup · schedule · now-next · epg · status · config
  data/                channels · heartbeat · health · incidents · epg.xml ·
                       mizanora-tv.m3u · media-health · watchdog · manifests/
```

## ⌨️ Shortcuts
`SPACE` play/pause · `N` next · `M` mute · `F` fullscreen · `R` re-sync · `H` show/hide UP NEXT · `E` EPG · `L` logs · `S` settings · `1–9` channel · `ESC` close modal

---

## 🩺 Troubleshooting: workflows QUEUED / Pages build CANCELLED

### Kya dekha gaya (real data, 08 Nov 2026 ~17:03–17:18 UTC)

| Time (UTC) | Run | Result |
|---|---|---|
| 17:03:16 | `MIZANORA · Config & Code CI` (push `main`) | queued → **cancelled 17:13:09**, `steps: []` |
| 17:03:16 | `MIZANORA · Pages Deploy (optional)` (push `main`) | queued → **cancelled 17:13:26**, `steps: []` |
| 17:09:51 | `pages build and deployment` (dynamic, branch source) | queued → **cancelled 17:13:48** |
| 17:14:22 | `pages build and deployment` (#42503951979) | **queued**, job `build` = `ubuntu-latest`, `runner_id: 0`, `steps: 0` |
| — | `GET /pages` | `{"status":"building","build_type":"legacy","source":{"branch":"main","path":"/docs"}}` |
| — | `GET /actions/runs/{id}/pending_deployments` | `[]` (koi approval nahi atka) |
| — | `github-pages` environment | branch policy = `main` ✅ (galat branch ka masla nahi) |
| — | `docs/index.html` on `main` | ✅ maujood (11 KB) |

`steps: []` + `runner_id: 0` ka matlab: **job ko runner hi nahi mila** (queue me baitha tha), config ya code fail nahi hua.

### 2 wajahain

1. **Double deployment (asli config bug).** Pages source `Deploy from a branch → main /docs` (legacy) **aur** `pages.yml` Actions-based `actions/deploy-pages` — dono ek hi push par trigger hue, ek hi `github-pages` environment / ek hi site par likh rahe the. GitHub ek waqt me sirf ek Pages build rakhta hai; naya build purane ko cancel karta hai. Isi liye 17:03–17:13 wale runs cancel hue aur 17:14 wala naya build queue me hai.
2. **GitHub-hosted runner queue.** Us waqt account ki doosri repos me bhi queued runs thin (`Mizanoram3ucatchtv: 4`, `MIZANORATVCAST: 1`), aur free tier par 20 concurrent jobs ki cap hoti hai. 2–10 min ka `queued` normal hai; `cancelled` tab aata hai jab naya build request ya manual cancel ho. Ye **code ki galti nahi**.

### ✅ Code me fix (is branch par, PR se `main` me jayega)

* `pages.yml` → **sirf `workflow_dispatch`**, koi `push:` trigger nahi. Ab wo "Retry Pages Build" ka manual button hai jo `POST /pages/builds` se branch-based build ko dobara request karta hai (purana stuck build auto cancel).
* `docs/.nojekyll` → Jekyll skip, tez aur clean static build.
* `README` me ye section.

> ℹ️ Sandbox ka GitHub token **read-only** hai Actions/Pages admin endpoints par (`403 Resource not accessible by integration`), is liye main API se workflow disable / build request / dispatch nahi kar saka. **Neeche wale 3 steps aapko UI/CLI se karne honge** (ya GitHub connection ko write scope ke sath reconnect karein).

### 🔧 Aapke 3 manual steps (2 minute)

1. **Stuck run cancel ya supersede karein** — koi bhi ek:
   * `Actions → pages build and deployment → #42503951979 → Cancel run`, phir `Re-run all jobs`, **ya**
   * is fix wali PR ko `main` me **merge** karein → naya push → naya Pages build → purana queued build auto cancel, **ya**
   * `Actions → MIZANORA · Retry Pages Build (manual) → Run workflow`.
2. **Actions UI me confirm karein** ke `MIZANORA · Pages Deploy (optional)` / `Retry Pages Build` **sirf manual** hai; agar purana `push` trigger wala run dikhe to use disable kar dein. Pages source **sirf** `Deploy from a branch → main /docs` rahe.
3. **Workflow permissions**: `Settings → Actions → General → Workflow permissions → Read and write permissions` ✅ — warna `playout.yml` bot `docs/` push nahi kar payega (ye 24/7 heartbeat ke liye zaroori hai).

### ⏰ "24/7 workflow abhi kyun nahi chala?"

* `playout.yml` cron `0,30 * * * *` → pehla scheduled run merge ke baad **agli :00 ya :30** par (17:30 UTC / 22:30 PKT). Abhi tak koi `playout`/`watchdog` run hona hi nahi tha — ye **normal** hai, koi failure nahi.
* `watchdog.yml` `17 */3 * * *` → agla 20:17 UTC. `media-prefetch.yml` roz 03:23 UTC.
* Chahein to foran test karein: `Actions → 24/7 Playout Engine → Run workflow` me `chain=true`.

### Site live hai ya nahi check karein
```bash
gh api repos/muaaziqbalvip/MIZANORA-TV-LIVE/pages --jq '{status,source}'
gh api repos/muaaziqbalvip/MIZANORA-TV-LIVE/pages/builds/latest --jq '{status,commit,error}'
# status "built" aana chahiye
```
*(Sandboxes me `*.github.io` outbound blocked ho sakta hai — `curl` yahan `000` dega, ye site down hone ki nishani nahi; API status hi sach hai.)*

---

## 🧭 Ab aapko kya karna baqi hai (clean checklist)

1. ✅ **Branch → `main` merge** — PR #1 done.
2. ✅ **Pages ON**: `main /docs` — done (build complete hone ka intezaar hai).
3. 🔲 **Workflow permissions**: Read & Write — confirm karein.
4. 🔲 **Upar wale 3 troubleshooting steps** → stuck Pages build ko naya build dein.
5. 🔲 **Run** `playout.yml` with `chain=true` (ya 17:30 UTC ka cron ka intezaar).
6. 🔲 **Apne asli media links** daalein (demo test videos replace karein) — `config/channels.json`.
7. 🔲 **Apna logo** `logo_url` ya `docs/assets/brand/` me.
8. 🔲 **Channel names / prime windows / timezone** apne hisaab se.
9. 🔲 (optional) **R2/CDN + ffmpeg** agar third-party IPTV players me true continuous 24/7 chahiye.
10. 🔲 (optional) Custom domain + Cloudflare caching.

---

Built for **Muaaz Iqbal / MIZANORA** · brand research: `Mizanora-org/MIZANORA` · engine v2.0 · MIT-friendly, no build step, no server, no secrets required.

/* ==========================================================================
   MZ.Settings — every control in the master control panel.
   Changes are saved to localStorage, merged over the server config, and pushed
   into the deterministic engine instantly. Export / import / GitHub write.
   ========================================================================== */
(function () {
  'use strict';
  const MZ = window.MZ = window.MZ || {};
  let tabsEl = null, bodyEl = null, active = 'GENERAL', draft = {};
  const TABS = ['GENERAL', 'BRAND', 'CLOCK', 'PLAYOUT', 'ADS', 'MEDIA', 'AUDIO', 'EPG', 'SYSTEM'];
  const TZ = ['Asia/Karachi', 'UTC', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Europe/London',
              'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney'];
  const PRESETS = {
    emerald: { primary: '#12B981', accent: '#F2C766', bg: '#03130D' },
    sapphire: { primary: '#38BDF8', accent: '#E8C77A', bg: '#041018' },
    royal: { primary: '#C084FC', accent: '#F2C766', bg: '#0D0618' },
    gold: { primary: '#F2C766', accent: '#38E8A0', bg: '#0A1208' },
    crimson: { primary: '#FF5470', accent: '#FFEFC4', bg: '#170409' },
  };
  const KINDS = ['mp4', 'mkv', 'mov', 'webm', 'm4v', 'm3u8', 'hls', 'mpd', 'ts', 'mp3', 'image'];

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cfg() { return MZ.getConfig(); }
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a && a[k] !== undefined ? a[k] : undefined; }, o); }
  function patchFor(path, value) {
    const parts = path.split('.'), out = {}; let cur = out;
    parts.forEach(function (k, i) { if (i === parts.length - 1) cur[k] = value; else { cur[k] = {}; cur = cur[k]; } });
    return out;
  }
  function set(path, value) {
    MZ.setOverride(MZ.state.activeId, patchFor(path, value));
    const refresh = /^(theme|ui|animation|clock|logo|timezone|slot_minutes|break_order|prime_time|ads_per_break|gap_fill|ident_duration|segments|ads|trailers|audio|epg)/.test(path);
    if (refresh) MZ.emit('ui:refresh');
    MZ.log('info', 'SET ' + path + ' = ' + (typeof value === 'object' ? '[object]' : value));
  }
  function val(path, fallback) { const v = getPath(cfg(), path); return v === undefined ? (fallback === undefined ? '' : fallback) : v; }

  /* ------------------------------ field builders ------------------------------ */
  function field(label, inner, hint) {
    return '<div class="field"><label>' + label + '</label>' + inner + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }
  function fText(label, path, hint, type) {
    return field(label, '<input type="' + (type || 'text') + '" data-path="' + path + '" value="' + esc(val(path)) + '" />', hint);
  }
  function fNum(label, path, hint, min, max) {
    return field(label, '<input type="number" data-num="1" data-path="' + path + '" min="' + (min || 0) + '" max="' + (max || 99999) + '" value="' + esc(val(path, 0)) + '" />', hint);
  }
  function fSelect(label, path, options, hint) {
    const cur = String(val(path));
    const opts = options.map(function (o) {
      const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === cur ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
    return field(label, '<select data-path="' + path + '">' + opts + '</select>', hint);
  }
  function fToggle(label, path, hint) {
    const on = !!val(path, false);
    return '<div class="toggle-row"><span>' + label + '</span><div class="switch' + (on ? ' on' : '') + '" data-toggle="' + path + '"></div></div>' +
      (hint ? '<div class="hint" style="margin-bottom:6px">' + hint + '</div>' : '');
  }
  function fRange(label, path, min, max, scale, def, hint) {
    const v = Number(val(path, def));
    return field(label, '<div class="range-row"><input type="range" data-range="' + path + '" data-scale="' + scale + '" min="' + min + '" max="' + max + '" value="' + Math.round(v * scale) + '" /><b data-range-label="' + path + '">' + v.toFixed(2) + '</b></div>', hint);
  }
  function fColors() {
    const t = cfg().theme || {};
    return field('THEME COLORS', '<div class="color-row">' +
      '<input type="color" data-color="theme.primary" value="' + esc(t.primary || '#12B981') + '" title="Primary" />' +
      '<input type="color" data-color="theme.accent" value="' + esc(t.accent || '#F2C766') + '" title="Accent" />' +
      '<input type="color" data-color="theme.bg" value="' + esc(t.bg || '#03130D') + '" title="Background" />' +
      fSelInline('theme.preset', Object.keys(PRESETS), String(t.preset || 'emerald')) + '</div>',
      'Preset chunne par teen colors auto set hote hain.');
  }
  function fSelInline(path, options, cur) {
    return '<select data-path="' + path + '" style="flex:1">' + options.map(function (o) {
      return '<option value="' + o + '"' + (o === cur ? ' selected' : '') + '>' + o.toUpperCase() + '</option>';
    }).join('') + '</select>';
  }
  function fBreakOrder() {
    const order = cfg().break_order || ['trailer', 'ad', 'trailer', 'segment', 'filler'];
    return field('BREAK ORDER (click chip to remove)', '<div class="break-chips">' +
      order.map(function (t, i) { return '<span class="break-chip" data-break-remove="' + i + '" title="remove">' + esc(t.toUpperCase()) + ' ✕</span>'; }).join('') + '</div>' +
      '<div class="break-add">' + fSelInline('__breakadd', ['trailer', 'ad', 'segment', 'filler'], 'trailer') +
      '<button class="btn ghost" data-break-add="1">+ ADD</button><button class="btn ghost" data-break-reset="1">↺</button></div>' +
      '<div class="hint">Default: TRAILER → ADS → TRAILER → SEGMENT → GAP FILL REEL</div>');
  }
  function fMedia(key, label, withPool) {
    const arr = draft[key] || (draft[key] = MZ.clone(cfg()[key] || []));
    let html = '<div class="section-head"><span>' + label + ' (' + arr.length + ')</span><button class="btn ghost" data-add="' + key + '">+ ADD SOURCE</button></div>';
    arr.forEach(function (it, i) {
      html += '<div class="media-row"><div class="mr-head"><b>#' + (i + 1) + ' · ' + esc(it.id || 'new') + '</b>' +
        '<button data-del="' + key + '" data-i="' + i + '" title="delete">✕</button></div>' +
        '<input data-media="' + key + '" data-i="' + i + '" data-f="title" value="' + esc(it.title) + '" placeholder="Title" />' +
        '<input data-media="' + key + '" data-i="' + i + '" data-f="src" value="' + esc(it.src) + '" placeholder="https://…/video.mp4 | .mkv | .m3u8" />' +
        '<div class="mr-grid">' +
        '<select data-media="' + key + '" data-i="' + i + '" data-f="kind">' + KINDS.map(function (k) { return '<option value="' + k + '"' + (it.kind === k ? ' selected' : '') + '>' + k.toUpperCase() + '</option>'; }).join('') + '</select>' +
        '<input type="number" data-media="' + key + '" data-i="' + i + '" data-f="duration" value="' + esc(it.duration || 600) + '" placeholder="seconds" />' +
        (withPool ? '<select data-media="' + key + '" data-i="' + i + '" data-f="pool">' + ['regular', 'prime'].map(function (p) { return '<option value="' + p + '"' + (it.pool === p ? ' selected' : '') + '>' + p.toUpperCase() + '</option>'; }).join('') + '</select>' : '') +
        '<input data-media="' + key + '" data-i="' + i + '" data-f="genre" value="' + esc(it.genre || '') + '" placeholder="Genre" />' +
        '</div>' +
        (withPool ? '<input data-media="' + key + '" data-i="' + i + '" data-f="poster" value="' + esc(it.poster || '') + '" placeholder="Poster / thumbnail URL" />' +
                    '<input type="number" step="0.01" data-media="' + key + '" data-i="' + i + '" data-f="audio_pitch" value="' + esc(it.audio_pitch || 1) + '" placeholder="Audio pitch 0.5–2.0" />' : '') +
        '</div>';
    });
    return html + '<div class="hint">Har tarah ki media: MP4 · MKV · MOV · WebM · M3U8/HLS · MPD/DASH · TS · MP3 · IMAGE. Duration seconds me.</div>';
  }

  /* ------------------------------ tabs ------------------------------ */
  function tabGENERAL() {
    const ids = (MZ.state.index.channels || []).map(function (c) { return [c.id, c.name]; });
    return fText('CHANNEL NAME', 'name') + fText('SHORT LABEL', 'short') + fText('GENRE', 'genre') +
      fNum('CHANNEL NUMBER', 'number') +
      fSelect('TIMEZONE', 'timezone', TZ, 'Broadcast clock aur prime time isi zone me chalte hain.') +
      fSelect('SEGMENT / SLOT LENGTH', 'slot_minutes', [['15', '15 MIN'], ['30', '30 MIN'], ['45', '45 MIN'], ['60', '1 HOUR'], ['90', '1.5 HOUR'], ['120', '2 HOURS']],
        'Har slot itna lamba hoga. Chhota program ho to baqi waqt ads/trailers se auto fill.') +
      fSelect('AUTO CHAIN → NEXT CHANNEL', 'chain_next', ids, 'Workflow handoff: jab ye channel apna tick close kare to agla auto dispatch.') +
      fBreakOrder();
  }
  function tabBRAND() {
    return fText('CHANNEL LOGO LINK (URL)', 'logo_url', 'Koi bhi https logo link dein — khali chhorne par local animated 3D SVG logo use hoga.') +
      fText('LOCAL LOGO PATH', 'logo') + fColors() +
      '<div class="field"><label>LOGO PREVIEW</label><div style="display:flex;gap:8px;align-items:center"><img id="logoPreview" src="' + esc(MZ.logoUrl(cfg())) + '" style="width:64px;height:64px;border-radius:14px;border:1px solid var(--line)" onerror="this.src=\'assets/brand/logo-mizanora.svg\'" /><div class="hint">3D rotation CSS + animated SVG rings, twinkle, sheen, scan line.</div></div></div>' +
      fToggle('3D LOGO ANIMATION', 'animation.logo3d') +
      fToggle('3D LINE ART / HOLOGRAM', 'animation.lines') +
      fToggle('PARTICLES', 'animation.particles') +
      fToggle('3D FLIP CLOCK', 'animation.clock3d') +
      fSelect('ANIMATION INTENSITY', 'animation.intensity', ['low', 'medium', 'high']) +
      fRange('LOGO ROTATION SPEED', 'animation.rotation_speed', 8, 60, 1, 26) +
      fToggle('REDUCE MOTION', 'animation.reduced_motion') +
      fToggle('SHOW LOGO BUG (ON SCREEN)', 'ui.show_logo_bug') +
      fToggle('SHOW UP NEXT PREVIEW', 'ui.show_next', 'Next segment dekhein ya hide karein — dono option.') +
      fToggle('NEXT CARD THUMBNAIL', 'ui.next_preview') +
      fToggle('SHOW TICKER TAPE', 'ui.show_ticker') +
      fToggle('SHOW PROGRESS BAR', 'ui.show_progress') +
      fToggle('SHOW XL EPG', 'ui.show_epg') +
      fText('TICKER TEXT', 'ui.ticker_text');
  }
  function tabCLOCK() {
    return fSelect('TIMEZONE', 'timezone', TZ) + fText('CLOCK LABEL', 'clock.label', 'Jaise PKT, GST, UTC') +
      fToggle('24-HOUR FORMAT', 'clock.format24') +
      fToggle('SHOW SECONDS', 'clock.show_seconds') +
      fToggle('SHOW DATE', 'clock.show_date') +
      fToggle('SHOW HIJRI DATE', 'clock.show_hijri', 'Intl Islamic (Umm al-Qura) calendar.') +
      fToggle('SHOW UTC CLOCK', 'clock.show_utc') +
      fText('DATE FORMAT', 'clock.date_format', 'DD MMM YYYY / YYYY-MM-DD') +
      '<div class="field"><label>LIVE PREVIEW</label><div class="hint" id="clockPreview">--:--:-- · -- --- ----</div></div>';
  }
  function tabPLAYOUT() {
    return fRange('ADS PER BREAK', 'ads_per_break', 0, 8, 1, 1) +
      fRange('IDENT DURATION (sec)', 'ident_duration', 5, 60, 1, 15) +
      fToggle('GAP FILL (SHORT PROGRAM → REEL)', 'gap_fill',
        'OFF karne par baaqi slot ek station ident se bharega. ON = trailer/ad reel loop.') +
      fToggle('PRIME TIME MODE', 'prime_time.enabled') +
      fText('PRIME START', 'prime_time.start', 'HH:MM — local timezone.') +
      fText('PRIME END', 'prime_time.end', 'Raat ke paar bhi chalega, jaise 21:00 → 01:00.') +
      fText('PRIME LABEL', 'prime_time.label') +
      fRange('PRIME AD MULTIPLIER', 'prime_time.ad_multiplier', 1, 5, 1, 2) +
      fSelect('PRIME POOL', 'prime_time.pool', ['prime', 'regular']) +
      fToggle('PRIME BADGE ON SCREEN', 'prime_time.badge') +
      fRange('SOURCE RETRIES', 'errors.retries', 0, 8, 1, 3) +
      fRange('SOURCE TIMEOUT (sec)', 'errors.source_timeout', 4, 60, 1, 12) +
      fSelect('ON SOURCE FAIL', 'errors.on_source_fail', ['next', 'ident', 'reload']) +
      fSelect('FALLBACK TYPE', 'errors.fallback', ['ident', 'filler', 'next']) +
      fToggle('BLACK SCREEN GUARD', 'errors.black_screen_guard', 'Kabhi kala screen nahi — hamesha 3D ident.');
  }
  function tabADS() {
    return fRange('AD DUCKING (dB)', 'audio.duck_ads_db', -20, 0, 1, -6) +
      fToggle('MUTE ADS', 'audio.mute_ads') +
      fToggle('NORMALIZE AUDIO', 'audio.normalize') +
      fMedia('ads', 'AD ROTATION POOL', false) +
      '<div class="hint">Ads global library se bhi aati hain (config/global.json → library.ads). Yahan channel-specific ads add karein; weight field JSON editor se set karein.</div>';
  }
  function tabMEDIA() {
    return fMedia('segments', 'PROGRAM SEGMENTS', true) + fMedia('trailers', 'TRAILERS / PROMOS / IDENTS', false) +
      '<div class="hint">Agar segment 30 min ka hai aur slot 60 min ka, to baqi 30 min auto ad/trailer reel chalegi. HLS sources seedhe live.m3u8 me stitch hote hain.</div>';
  }
  function tabAUDIO() {
    return fRange('MASTER GAIN', 'audio.gain', 0, 200, 100, 1, 'Browser 100% se upar volume cap karta hai — WebAudio path optional.') +
      fRange('AUDIO PITCH / RATE', 'audio.pitch', 50, 200, 100, 1, '0.5× se 2.0× — preservesPitch OFF, asli pitch shift.') +
      fToggle('NORMALIZE', 'audio.normalize') +
      fRange('AD DUCKING', 'audio.duck_ads_db', -20, 0, 1, -6) +
      fToggle('MUTE DURING ADS', 'audio.mute_ads') +
      '<div class="hint">Transport bar me GAIN / PITCH sliders bhi hain — live changes foran apply hote hain.</div>';
  }
  function tabEPG() {
    return fToggle('EPG ENABLED', 'epg.enabled') +
      fSelect('EPG DAYS', 'epg.days', [['3', '3 DAYS'], ['7', '7 DAYS (XL)'], ['14', '14 DAYS']]) +
      fToggle('XL EPG (RICH METADATA)', 'epg.xl') +
      fToggle('DESCRIPTIONS', 'epg.descriptions') +
      fToggle('SHOW AD BREAKS IN EPG', 'epg.show_ad_breaks') +
      fText('DEFAULT RATING', 'epg.rating') +
      fText('LANGUAGE CODE', 'language') +
      '<div class="hint">XMLTV: <code>data/epg.xml</code> · Channel EPG: <code>channels/' + esc(MZ.state.activeId) + '/epg.xml</code></div>';
  }
  function tabSYSTEM() {
    const id = MZ.state.activeId;
    const links = [
      ['LIVE M3U8', 'channels/' + id + '/live.m3u8'], ['BACKUP M3U8', 'channels/' + id + '/backup.m3u8'],
      ['NOW / NEXT', 'channels/' + id + '/now-next.json'], ['SCHEDULE', 'channels/' + id + '/schedule.json'],
      ['STATUS HEARTBEAT', 'channels/' + id + '/status.json'], ['EPG JSON', 'channels/' + id + '/epg.json'],
      ['EPG XMLTV', 'channels/' + id + '/epg.xml'], ['NETWORK M3U', 'data/' + ((MZ.state.global.pages || {}).playlist_name || 'mizanora-tv.m3u')],
      ['NETWORK MASTER', 'master.m3u8'], ['HEALTH', 'data/health.json'], ['MEDIA HEALTH', 'data/media-health.json'],
      ['WATCHDOG', 'data/watchdog.json'], ['INCIDENTS', 'data/incidents.json'],
    ];
    const base = (MZ.state.global.site_url || location.origin + location.pathname).replace(/\/$/, '');
    return '<div class="field"><label>PUBLIC LINKS (GitHub Pages)</label>' + links.map(function (l) {
      const full = base + '/' + l[1];
      return '<div class="link-box"><input readonly value="' + esc(full) + '" /><button class="btn ghost" data-copy="' + esc(full) + '">COPY</button><a class="btn ghost" target="_blank" rel="noopener" href="' + esc(l[1]) + '">OPEN</a></div>';
    }).join('') + '</div>' +
      '<div class="field"><label>GITHUB REMOTE CONTROL</label>' +
      '<input type="text" id="ghBranch" value="main" placeholder="branch" data-nosave />' +
      '<input type="password" id="ghToken" placeholder="fine-grained PAT (session only, save nahi hota)" data-nosave style="margin-top:5px" />' +
      '<div class="hint">Token <b>kabhi localStorage me save nahi hota</b>. Zarurat na ho to chhor dein — config push ya workflow dispatch kaafi hai.</div>' +
      '<div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">' +
      '<button class="btn ghost" data-gh="save">☁ SAVE CONFIG</button>' +
      '<button class="btn ghost" data-gh="dispatch">▶ DISPATCH TICK</button>' +
      '<button class="btn ghost" data-gh="workflows">↗ OPEN ACTIONS</button></div></div>' +
      '<div class="field"><label>WORKFLOW TOPOLOGY</label><div class="hint">' +
      'playout.yml (cron 0,30 · matrix 4 channels) → channel-*.yml (alag alag workflow, auto handoff) → watchdog.yml (stale heartbeat → repository_dispatch) → pages.yml (docs/ deploy) → media-prefetch.yml (link health).' +
      '</div></div>' +
      '<div class="field"><label>SHORTCUTS</label><div class="hint">' +
      'SPACE play/pause · N next · M mute · F fullscreen · E EPG · L logs · S settings · 1–9 channel · R re-sync · H hide/show next' +
      '</div></div>';
  }

  /* ------------------------------ binding ------------------------------ */
  function afterChange(path) {
    if (/^(theme|ui|animation|clock)/.test(path)) MZ.emit('ui:refresh');
  }
  function bind(root) {
    root.querySelectorAll('[data-path]').forEach(function (el) {
      if (el.dataset.path === '__breakadd') return;
      el.addEventListener('change', function () {
        let v = el.value;
        if (el.dataset.num) v = Number(v);
        if (el.dataset.path === 'theme.preset' && PRESETS[v]) {
          MZ.setOverride(MZ.state.activeId, { theme: Object.assign({ preset: v }, PRESETS[v]) });
          render(); return;
        }
        set(el.dataset.path, v);
      });
    });
    root.querySelectorAll('[data-toggle]').forEach(function (el) {
      el.onclick = function () {
        const p = el.dataset.toggle, v = !getPath(cfg(), p);
        el.classList.toggle('on', v);
        set(p, v);
      };
    });
    root.querySelectorAll('[data-range]').forEach(function (el) {
      const p = el.dataset.range, scale = Number(el.dataset.scale || 1);
      el.addEventListener('input', function () {
        const b = root.querySelector('[data-range-label="' + p + '"]');
        if (b) b.textContent = (Number(el.value) / scale).toFixed(2);
      });
      el.addEventListener('change', function () { set(p, Number(el.value) / scale); });
    });
    root.querySelectorAll('[data-color]').forEach(function (el) {
      el.addEventListener('change', function () { set(el.dataset.color, el.value); });
    });
    root.querySelectorAll('[data-break-remove]').forEach(function (el) {
      el.onclick = function () {
        const a = MZ.clone(cfg().break_order || []); a.splice(Number(el.dataset.breakRemove), 1);
        if (!a.includes('segment')) a.push('segment');
        set('break_order', a); render();
      };
    });
    root.querySelector('[data-break-add]') && (root.querySelector('[data-break-add]').onclick = function () {
      const sel = root.querySelector('[data-path="__breakadd"]');
      const a = MZ.clone(cfg().break_order || []); a.push(sel.value);
      set('break_order', a); render();
    });
    root.querySelector('[data-break-reset]') && (root.querySelector('[data-break-reset]').onclick = function () {
      set('break_order', ['trailer', 'ad', 'trailer', 'segment', 'filler']); render();
    });
    root.querySelectorAll('[data-media]').forEach(function (el) {
      el.addEventListener('change', function () {
        const key = el.dataset.media, i = Number(el.dataset.i), f = el.dataset.f;
        let v = el.value;
        if (f === 'duration') v = Math.max(1, Number(v) || 1);
        if (f === 'audio_pitch') v = Number(v) || 1;
        draft[key][i][f] = v;
        set(key, MZ.clone(draft[key]));
      });
    });
    root.querySelectorAll('[data-add]').forEach(function (el) {
      el.onclick = function () {
        const key = el.dataset.add, a = MZ.clone(draft[key] || []);
        a.push({ id: key + '-' + Date.now().toString(36), title: 'NEW ' + key.toUpperCase(),
                 src: '', kind: 'mp4', duration: key === 'segments' ? 1800 : 15,
                 pool: 'regular', genre: '', poster: '', audio_pitch: 1 });
        draft[key] = a; set(key, a); render(); MZ.toast('Source added — URL bhar ke APPLY karein');
      };
    });
    root.querySelectorAll('[data-del]').forEach(function (el) {
      el.onclick = function () {
        const key = el.dataset.del, a = MZ.clone(draft[key] || []);
        if (a.length <= 1) { MZ.toast('Kam se kam ek source chahiye', 'bad'); return; }
        a.splice(Number(el.dataset.i), 1); draft[key] = a; set(key, a); render();
      };
    });
    root.querySelectorAll('[data-copy]').forEach(function (el) {
      el.onclick = function () { copy(el.dataset.copy); MZ.toast('Copied: ' + el.dataset.copy, 'good'); };
    });
    root.querySelectorAll('[data-gh]').forEach(function (el) {
      el.onclick = function () {
        const token = (document.getElementById('ghToken') || {}).value || '';
        const branch = (document.getElementById('ghBranch') || {}).value || 'main';
        if (el.dataset.gh === 'workflows') { window.open('https://github.com/muaaziqbalvip/MIZANORA-TV-LIVE/actions', '_blank'); return; }
        if (!token) { MZ.toast('Pehle fine-grained PAT paste karein (ya config push karein)', 'bad'); return; }
        if (el.dataset.gh === 'save') ghSave(token, branch); else ghDispatch(token, branch);
      };
    });
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
    else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  }

  /* ------------------------------ github ------------------------------ */
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
  async function ghSave(token, branch) {
    const repo = 'muaaziqbalvip/MIZANORA-TV-LIVE';
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' };
    try {
      const meta = await fetch('https://api.github.com/repos/' + repo + '/contents/config/channels.json?ref=' + encodeURIComponent(branch), { headers: headers });
      if (!meta.ok) throw new Error('GET ' + meta.status + ' (branch / token check karein)');
      const sha = (await meta.json()).sha;
      const body = { message: 'chore(control-room): update channels.json from UI', content: b64(MZ.Settings.exportText()), branch: branch, sha: sha };
      const r = await fetch('https://api.github.com/repos/' + repo + '/contents/config/channels.json', { method: 'PUT', headers: headers, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('PUT ' + r.status);
      MZ.toast('✅ config/channels.json pushed → workflow auto tick chalega', 'good');
      MZ.log('info', 'GitHub config pushed to ' + branch);
    } catch (e) { MZ.toast('GitHub save failed: ' + e.message, 'bad'); MZ.log('error', 'GitHub save: ' + e.message); }
  }
  async function ghDispatch(token, branch) {
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' };
    try {
      const r = await fetch('https://api.github.com/repos/muaaziqbalvip/MIZANORA-TV-LIVE/actions/workflows/playout.yml/dispatches', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ ref: branch, inputs: { reason: 'control-room', channel: MZ.state.activeId } }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      MZ.toast('▶ Workflow dispatched — naya tick 1–2 min me', 'good');
    } catch (e) { MZ.toast('Dispatch failed: ' + e.message, 'bad'); }
  }

  /* ------------------------------ render / api ------------------------------ */
  function render() {
    if (!bodyEl) return;
    draft = {};
    const map = { GENERAL: tabGENERAL, BRAND: tabBRAND, CLOCK: tabCLOCK, PLAYOUT: tabPLAYOUT,
                  ADS: tabADS, MEDIA: tabMEDIA, AUDIO: tabAUDIO, EPG: tabEPG, SYSTEM: tabSYSTEM };
    bodyEl.innerHTML = (map[active] || tabGENERAL)();
    if (tabsEl) {
      tabsEl.innerHTML = '';
      TABS.forEach(function (t) {
        const b = document.createElement('button');
        b.textContent = t; b.className = t === active ? 'active' : '';
        b.onclick = function () { active = t; render(); };
        tabsEl.appendChild(b);
      });
    }
    bind(bodyEl);
  }
  MZ.Settings = {
    init: function (opts) { tabsEl = opts.tabs; bodyEl = opts.body; render(); MZ.on('channel:changed', function () { draft = {}; render(); MZ.emit('ui:refresh'); }); },
    render: render,
    setTab: function (t) { if (TABS.includes(t)) { active = t; render(); } },
    exportObject: function () {
      return { version: (MZ.state.global || {}).version || '2.0.0',
               channels: (MZ.state.index.channels || []).map(function (c) { return MZ.getConfig(c.id); }) };
    },
    exportText: function () { return JSON.stringify(MZ.Settings.exportObject(), null, 2); },
    importObject: function (obj) {
      const list = obj.channels || (Array.isArray(obj) ? obj : [obj]);
      list.forEach(function (c) {
        if (!c || !c.id) return;
        MZ.state.settings.overrides[c.id] = c;
      });
      MZ.saveSettings(); render(); MZ.emit('ui:refresh'); MZ.emit('config:changed', {});
      MZ.toast('Config imported — ' + list.length + ' channel(s)', 'good');
    },
    importCurrent: function (obj) {
      if (!obj || typeof obj !== 'object') throw new Error('not an object');
      MZ.state.settings.overrides[MZ.state.activeId] = obj;
      MZ.saveSettings(); render(); MZ.emit('ui:refresh'); MZ.emit('config:changed', {});
    },
    copy: copy,
    ghSave: ghSave, ghDispatch: ghDispatch,
  };
})();

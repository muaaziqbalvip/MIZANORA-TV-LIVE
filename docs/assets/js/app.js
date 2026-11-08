/* ==========================================================================
   MZ.app — Control Room bootstrap, OSD rendering, clocks, racks, modals.
   ========================================================================== */
(function () {
  'use strict';
  const MZ = window.MZ = window.MZ || {};
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const pad = function (n) { return String(n).padStart(2, '0'); };
  let lastUpdate = null, lastTimelineSlot = null, lastMinute = null, refreshTimer = null;

  /* ---------------------------- boot ---------------------------- */
  MZ.boot = async function () {
    MZ.log('info', 'MIZANORA control room booting…');
    try { await MZ.loadAll(); }
    catch (e) { MZ.log('error', 'data/channels.json load failed: ' + e.message + ' — offline mode'); }
    if (!MZ.state.index) MZ.state.index = { channels: [{ id: 'mizanora', name: 'MIZANORA', logo: 'assets/brand/logo-mizanora.svg', theme: {} }], global: {}, library: {} };
    if (!MZ.state.activeId) MZ.state.activeId = (MZ.state.index.channels[0] || {}).id || 'mizanora';

    buildIdents();
    applyUI();
    renderRack(); renderChain(); renderHealth(); renderDiagnostics(); renderLogs();
    MZ.Visuals.start($('viz'), { primary: (MZ.getConfig().theme || {}).primary, accent: (MZ.getConfig().theme || {}).accent,
                                 intensity: intensity(), reduced: reducedMotion() });
    MZ.Playout.init({ video: $('player') });
    MZ.Settings.init({ tabs: $('settingsTabs'), body: $('settingsBody') });
    MZ.EPG.render($('epgGrid'), $('epgToolbar'), MZ.state.activeId);
    wire();
    tickClocks(); setInterval(tickClocks, 1000);
    refreshTimer = setInterval(refreshServer, 120000);
    subscribe();
    MZ.log('info', 'ON AIR · 4 channels · deterministic 24/7 playout active');
    MZ.toast('MIZANORA LIVE · control room ready', 'good');
  };

  /* ---------------------------- visuals / theme ---------------------------- */
  function intensity() { const a = (MZ.getConfig().animation || {}).intensity; return a === 'low' ? 0.5 : a === 'high' ? 1.5 : 1; }
  function reducedMotion() { return !!(MZ.getConfig().animation || {}).reduced_motion || MZ.state.settings.ui.reduced === true; }
  function logoImg(ch, cls) {
    return '<img class="' + (cls || '') + '" src="' + esc(MZ.logoUrl(ch)) + '" alt="' + esc(ch.name) + ' logo" onerror="this.onerror=null;this.src=\'assets/brand/logo-mizanora.svg\'" />';
  }
  function buildIdents() {
    const bars = $('identBars');
    bars.innerHTML = '';
    for (let i = 0; i < 34; i++) {
      const b = document.createElement('i');
      b.style.animationDelay = (i * 0.055) + 's';
      b.style.animationDuration = (0.7 + (i % 7) * 0.13) + 's';
      bars.appendChild(b);
    }
  }
  function applyUI() {
    const ch = MZ.getConfig(), ui = ch.ui || {};
    MZ.applyTheme(ch);
    $('topLogo').innerHTML = logoImg(ch);
    $('bugLogo').innerHTML = logoImg(ch);
    $('identLogo').innerHTML = logoImg(ch);
    $('identChannel').textContent = (ch.short || ch.name || 'NETWORK').toUpperCase();
    $('tzLabel').textContent = (ch.clock || {}).label || 'PKT';
    $('tapeInner').textContent = ui.ticker_text || 'MIZANORA · SHOP SMART · SHOP HALAL · LIVE 24/7 ·';
    $('bugStack').classList.toggle('hide', ui.show_logo_bug === false);
    $('tape').classList.toggle('hide', ui.show_ticker === false);
    $('progressFill').parentElement.style.display = ui.show_progress === false ? 'none' : '';
    $('identLayer').classList.toggle('hidden', false);
    MZ.Visuals.setTheme((ch.theme || {}).primary, (ch.theme || {}).accent);
    MZ.Visuals.setIntensity(intensity());
    MZ.Visuals.setReduced(reducedMotion());
    const showNext = MZ.state.settings.ui.showNext === null || MZ.state.settings.ui.showNext === undefined ? ui.show_next !== false : MZ.state.settings.ui.showNext;
    $('nextCard').classList.toggle('hide', !showNext || ui.next_preview === false);
    $('monitorCh').textContent = 'CH ' + pad(ch.number || 1);
    document.title = (ch.name || 'MIZANORA') + ' · LIVE CONTROL ROOM';
    const prev = $('clockPreview');
    if (prev) prev.textContent = 'Clock: ' + (ch.clock || {}).label + ' · ' + ch.timezone + ' · ' + ((ch.clock || {}).format24 === false ? '12H' : '24H');
  }

  /* ---------------------------- clocks ---------------------------- */
  function tickClocks() {
    const ch = MZ.getConfig(), c = ch.clock || {}, tz = ch.timezone || 'Asia/Karachi';
    const now = new Date(), p = MZ.localParts(now, tz), u = MZ.localParts(now, 'UTC');
    const f24 = c.format24 !== false;
    let h = parseInt(p.hour, 10) % 24;
    const hh = f24 ? h : (h % 12 || 12);
    const suffix = f24 ? '' : (h < 12 ? ' AM' : ' PM');
    const localTime = pad(hh) + ':' + p.minute + (c.show_seconds !== false ? ':' + p.second : '') + suffix;
    const utcTime = u.hour + ':' + u.minute + (c.show_seconds !== false ? ':' + u.second : '');
    const dateStr = (c.show_date === false ? '' : p.weekday.toUpperCase() + ' · ' + p.day + ' ' + p.month.toUpperCase() + ' ' + p.year);
    const dateFmt = (c.date_format || '').toLowerCase().includes('yyyy-') ? p.year + '-' + p.day + '-' + p.month.toUpperCase() : dateStr;
    $('clockLocal').textContent = localTime;
    $('clockUtc').textContent = utcTime;
    $('dateLocal').textContent = dateFmt || '—';
    $('dateUtc').textContent = u.day + ' ' + u.month.toUpperCase() + ' ' + u.year;
    $('clockHijri').textContent = c.show_hijri ? MZ.hijri(now).slice(0, 22) : 'DISABLED';
    $('tzOffset').textContent = MZ.utcOffsetLabel(now, tz);
    $('chipClock').textContent = localTime;
    $('bugClock').textContent = pad(hh) + ':' + p.minute + (c.show_seconds !== false && (ch.animation || {}).clock3d !== false ? ':' + p.second : '') + suffix;
    $('bugDate').textContent = dateFmt || '—';
    $('bugZone').textContent = (c.label || 'LOCAL') + ' · ' + MZ.utcOffsetLabel(now, tz);
    if (lastMinute !== p.minute) {
      lastMinute = p.minute;
      const fc = $('bugClock'); fc.style.animation = 'none'; void fc.offsetWidth; fc.style.animation = '';
    }
    // add log heartbeat line every 5 minutes
  }

  /* ---------------------------- OSD ---------------------------- */
  function roleLabel(role) {
    if (!role) return 'NOW PLAYING';
    if (role === 'segment') return 'NOW PLAYING · SEGMENT';
    if (role === 'ad' || role === 'filler_ad') return 'AD BREAK';
    if (role === 'trailer' || role === 'filler_trailer') return 'TRAILER / PROMO';
    if (role === 'filler_reel') return 'GAP FILL · REEL';
    if (role === 'ident' || role === 'filler_ident') return 'STATION IDENT';
    return role.toUpperCase();
  }
  function renderOSD(d) {
    lastUpdate = d;
    const ch = d.ch, ui = ch.ui || {}, loc = d.loc, clip = d.clip;
    if (!loc.current) return;
    const cur = loc.current, slot = loc.slot || {};
    const role = clip.role || cur.type;
    $('ltKicker').textContent = roleLabel(role);
    $('ltGenre').textContent = (cur.meta && cur.meta.genre) || slot.genre || ch.genre || 'MIZANORA';
    $('ltTitle').textContent = clip.title || cur.title || slot.program || 'MIZANORA';
    $('ltTime').textContent = MZ.fmtTime(loc.elapsed) + ' / ' + MZ.fmtTime(cur.duration);
    $('ltDesc').textContent = (cur.meta && cur.meta.description) || slot.description || '';
    $('ltRating').textContent = (cur.meta && cur.meta.rating) || slot.rating || 'U';
    $('progressFill').style.width = loc.progress + '%';
    $('osdTag').textContent = roleLabel(role).split(' · ')[0];
    $('osdSrc').textContent = (clip.kind || '—').toUpperCase() + ' · ' + (d.fallback ? 'IDENT FALLBACK' : 'DECODING') + ' · ' + MZ.fmtTime(loc.elapsed);
    $('monitorMode').textContent = d.mode || 'SERVERLESS';
    $('chipState').textContent = d.fallback ? 'FALLBACK' : (MZ.state.paused ? 'PAUSED' : 'AUTO');
    $('chipState').className = 'chip ' + (d.fallback ? '' : 'ok');

    // ad-break banner
    const isAd = /ad/.test(role) && !/trailer/.test(role);
    $('breakBanner').classList.toggle('show', isAd);
    if (isAd) $('breakCount').textContent = MZ.fmtTime(clip.remaining);
    // prime badge
    const pt = ch.prime_time || {};
    $('primeBadge').classList.toggle('show', !!slot.prime && pt.badge !== false);
    $('primeBadge').textContent = '★ ' + (slot.prime_label || pt.label || 'PRIME TIME');
    // next card
    const nxt = loc.next;
    if (nxt) {
      $('nextTitle').textContent = nxt.title || '—';
      $('nextIn').textContent = MZ.fmtTime(loc.remaining);
      $('nextThumb').style.backgroundImage = 'url(' + (nxt.poster || (cur.meta && cur.meta.poster) || 'assets/brand/ident-cinematic.jpg') + ')';
      $('nextMeta').textContent = (nxt.kind || '').toUpperCase() + ' · ' + MZ.fmtTime(nxt.duration) + (nxt.prime ? ' · PRIME' : '');
    }
    const showNext = MZ.state.settings.ui.showNext === null || MZ.state.settings.ui.showNext === undefined ? ui.show_next !== false : MZ.state.settings.ui.showNext;
    $('nextCard').classList.toggle('hide', !showNext || ui.next_preview === false);
    // progress ad markers
    if (slot.items) {
      const ad = slot.items.find(function (i) { return /ad|filler/.test(i.type) && Date.parse(i.start) > Date.now() + (MZ.state.timeOffsetMs || 0); });
      if (ad && slot.start) {
        const pct = (Date.parse(ad.start) - Date.parse(slot.start)) / (slot.duration * 1000) * 100;
        $('progressAds').style.left = Math.max(0, Math.min(99, pct)) + '%';
        $('progressAds').style.display = '';
      } else $('progressAds').style.display = 'none';
    }
    // LEDs
    setLed('encoder', 'ok'); setLed('playlist', 'ok'); setLed('epg', (MZ.state.epg[ch.id] || ch.epg || {}).enabled === false ? 'warn' : 'ok');
    setLed('ads', isAd ? 'warn' : 'ok'); setLed('fallback', d.fallback ? 'warn' : 'ok');
    if (slot.index !== lastTimelineSlot) { lastTimelineSlot = slot.index; renderTimeline(d); renderQueue(d); }
  }
  function setLed(key, state) {
    const el = document.querySelector('[data-led="' + key + '"]');
    if (!el) return;
    el.classList.remove('warn', 'bad');
    if (state !== 'ok') el.classList.add(state);
  }
  function renderTimeline(d) {
    const slot = d.loc.slot; if (!slot) return;
    const track = $('timelineTrack');
    track.innerHTML = slot.items.map(function (i) {
      return '<div class="tl-item ' + esc(i.type) + (i.id === d.loc.current.id ? ' active' : '') + '" style="flex:' + Math.max(1, i.duration) + '" title="' + esc(i.title) + ' · ' + MZ.fmtTime(i.duration) + '">' +
        '<b>' + esc(i.title) + '</b><small>' + MZ.fmtTime(i.duration) + ' · ' + esc(i.type) + '</small></div>';
    }).join('') + '<div class="tl-now" style="left:' + ((d.loc.elapsed + (Date.parse(d.loc.current.start) - Date.parse(slot.start)) / 1000) / slot.duration * 100) + '%"></div>';
    $('timelineNote').textContent = 'SLOT #' + slot.index + ' · ' + slot.duration / 60 + ' min · BREAK: ' +
      (slot.break_order || []).join(' → ').toUpperCase() + ' · GAP FILLED ' + Math.round((slot.gap_filled || 0) / 60) + ' min · ' +
      (slot.prime ? slot.prime_label : 'REGULAR') + ' · deterministic anchor ' + (MZ.state.global.anchor_utc || '');
  }
  function renderQueue(d) {
    const list = $('queueList');
    list.innerHTML = (d.loc.upcoming || []).map(function (i, k) {
      return '<div class="queue-item"><div class="q-top"><span>#' + (k + 1) + ' · ' + esc(i.type.toUpperCase()) + '</span><span>' + esc(i.start.slice(11, 16)) + '</span></div>' +
        '<div class="q-title">' + esc(i.title) + '</div><div class="q-meta">' + esc(i.kind.toUpperCase()) + ' · ' + MZ.fmtTime(i.duration) + (i.prime ? ' · PRIME' : '') + '</div></div>';
    }).join('') || '<div class="hint">Queue empty</div>';
  }

  /* ---------------------------- racks / health ---------------------------- */
  function renderRack() {
    const list = $('channelList');
    list.innerHTML = (MZ.state.index.channels || []).map(function (c) {
      const st = MZ.state.status[c.id] || {}, nn = MZ.state.nowNext[c.id] || {};
      const now = (nn.current || {}).title || st.now || 'AUTO PLAYLIST';
      return '<div class="ch-card' + (c.id === MZ.state.activeId ? ' active' : '') + '" data-ch="' + esc(c.id) + '">' +
        '<div class="ch-num">' + pad(c.number || 0) + '</div><div class="ch-logo">' + logoImg(c) + '</div>' +
        '<div class="ch-info"><div class="ch-name">' + esc(c.name) + '</div><div class="ch-now">' + esc(now) + '</div>' +
        '<div class="ch-line"><i class="ch-dot"></i><span class="ch-meta">' + (c.slot_minutes || 60) + ' MIN SLOT · ' + esc((c.timezone || '').split('/').pop().toUpperCase()) + '</span>' +
        (st.prime || nn.prime ? '<span class="ch-prime">PRIME</span>' : '') + '</div></div></div>';
    }).join('');
    $('channelCount').textContent = pad((MZ.state.index.channels || []).length);
    list.querySelectorAll('[data-ch]').forEach(function (node) {
      node.onclick = function () { switchChannel(node.dataset.ch); };
    });
  }
  function switchChannel(id) {
    if (id === MZ.state.activeId) return;
    MZ.setActive(id);
    applyUI(); renderRack(); renderChain();
    MZ.EPG.reset(); MZ.EPG.render($('epgGrid'), $('epgToolbar'), id);
    MZ.log('info', 'Switched to ' + id);
    MZ.toast('CH ' + pad(MZ.getConfig().number || 1) + ' · ' + MZ.getConfig().name, 'good');
  }
  function renderChain() {
    const channels = MZ.state.index.channels || [];
    const first = channels[0] || {}, seen = new Set(), order = [];
    let cur = first.id;
    while (cur && !seen.has(cur) && order.length < channels.length + 2) {
      seen.add(cur); order.push(cur);
      const c = MZ.getConfig(cur); cur = c.chain_next;
    }
    $('chainBox').innerHTML = order.map(function (id, i) {
      const c = MZ.getConfig(id);
      return '<div class="chain-row' + (id === MZ.state.activeId ? ' active' : '') + '">' +
        (i ? '<span class="arrow">↓</span>' : '<span class="arrow">●</span>') + '<span>' + esc(c.name || id) + '</span>' +
        '<span style="margin-left:auto;font-size:8px">' + (c.slot_minutes || 60) + 'm</span></div>';
    }).join('') + '<div class="hint" style="margin-top:6px">Har channel ka apna workflow; tick close hone par agla auto dispatch hota hai, phir wapas pehla — 24/7 loop.</div>';
  }
  function renderHealth() {
    const h = MZ.state.health || {}, mh = MZ.state.mediaHealth || {}, wd = MZ.state.watchdog || {}, hb = MZ.state.heartbeat || {};
    const age = hb.epoch ? Math.round((Date.now() / 1000 - hb.epoch) / 60) : '—';
    const ms = mh.summary || {};
    const cells = [
      ['CHANNELS', (MZ.state.index.channels || []).length + ' / ' + (MZ.state.index.channels || []).length, h.state === 'DEGRADED' ? 'var(--warn)' : ''],
      ['HEARTBEAT', age === '—' ? '—' : age + ' min', age !== '—' && age > 45 ? 'var(--danger)' : ''],
      ['MEDIA OK', (ms.ok === undefined ? '—' : ms.ok + '/' + ms.total), ''],
      ['INCIDENTS', ((MZ.state.incidents || {}).incidents || []).length, ''],
      ['WATCHDOG', (wd.action || 'idle').toUpperCase(), wd.stale ? 'var(--warn)' : ''],
      ['ENGINE', (MZ.state.global || {}).version || 'v2', ''],
    ];
    $('healthBox').innerHTML = cells.map(function (c) {
      return '<div class="hcell"><b style="' + (c[2] ? 'color:' + c[2] : '') + '">' + esc(c[1]) + '</b><span>' + esc(c[0]) + '</span></div>';
    }).join('');
    $('netState').textContent = h.state || (hb.state || 'OK');
    setLed('heartbeat', age !== '—' && age > 45 ? 'bad' : 'ok');
  }
  function renderDiagnostics() {
    const g = MZ.state.global || {}, h = MZ.state.health || {}, mh = MZ.state.mediaHealth || {}, wd = MZ.state.watchdog || {};
    const cards = [
      ['PLAYOUT ENGINE', [['version', g.version], ['anchor', g.anchor_utc], ['tick', g.tick_minutes + ' min'], ['schedule', g.schedule_days + ' days']]],
      ['HEALTH', [['state', h.state], ['config errors', (h.config_errors || []).length], ['channels', h.channels_on_air], ['hls reports', (h.hls || []).length]]],
      ['HLS STITCHER', [['target', (g.hls || {}).target_duration + 's'], ['window', (g.hls || {}).window_minutes + ' min'], ['remote stitch', (g.hls || {}).stitch_remote_hls], ['transcode', (g.hls || {}).transcode_non_hls]]],
      ['MEDIA PROBE', [['total', (mh.summary || {}).total], ['ok', (mh.summary || {}).ok], ['failed', (mh.summary || {}).failed], ['mode', mh.mode]]],
      ['WATCHDOG', [['checked', wd.checked_at], ['stale', wd.stale], ['age', wd.heartbeat_age_minutes], ['action', wd.action]]],
      ['SUPPORTED MEDIA', [['video', 'MP4 · MKV · MOV · WebM · M4V'], ['stream', 'M3U8/HLS · MPD/DASH · TS'], ['other', 'MP3 · JPG/PNG ident'], ['fallback', '3D ident · never black']]],
    ];
    $('diagGrid').innerHTML = cards.map(function (c) {
      return '<div class="diag-card"><h4>' + esc(c[0]) + '</h4>' + c[1].map(function (kv) {
        return '<p>' + esc(kv[0]) + ': <b>' + esc(kv[1]) + '</b></p>';
      }).join('') + '</div>';
    }).join('');
  }
  function renderLogs() {
    $('logConsole').innerHTML = MZ.state.logs.slice(-160).map(function (l) {
      return '<div class="l-' + l.level + '"><b>' + l.at.toISOString().slice(11, 19) + '</b> ' + esc(l.msg) + '</div>';
    }).join('');
    const n = $('logConsole'); n.scrollTop = n.scrollHeight;
  }

  /* ---------------------------- server refresh ---------------------------- */
  async function refreshServer() {
    const id = MZ.state.activeId;
    const paths = { status: 'channels/' + id + '/status.json', nowNext: 'channels/' + id + '/now-next.json',
                    health: 'data/health.json', mediaHealth: 'data/media-health.json', watchdog: 'data/watchdog.json',
                    heartbeat: 'data/heartbeat.json', incidents: 'data/incidents.json' };
    let changed = false;
    for (const key of Object.keys(paths)) {
      try { MZ.state[key] = await MZ.getJSON(paths[key], true); changed = true; }
      catch (e) { /* Pages cache / offline */ }
    }
    if (changed) { renderHealth(); renderDiagnostics(); renderRack(); MZ.log('info', 'Heartbeat refreshed from GitHub Pages'); }
  }

  /* ---------------------------- modals ---------------------------- */
  function openModal(title, body, buttons) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = body;
    const foot = $('modalFoot'); foot.innerHTML = '';
    (buttons || []).forEach(function (b) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || 'ghost'); btn.textContent = b.label;
      btn.onclick = function () { b.fn($('modalBody'), closeModal); };
      foot.appendChild(btn);
    });
    $('modalBackdrop').hidden = false;
  }
  function closeModal() { $('modalBackdrop').hidden = true; }
  function linksModal() {
    const base = ((MZ.state.global || {}).site_url || (location.origin + location.pathname)).replace(/\/$/, '');
    const rows = (MZ.state.index.channels || []).map(function (c) {
      const u = base + '/channels/' + c.id + '/live.m3u8';
      return '<div class="link-box"><input readonly value="' + esc(u) + '" /><button class="btn ghost" data-copy="' + esc(u) + '">COPY</button><a class="btn ghost" target="_blank" href="channels/' + esc(c.id) + '/live.m3u8">OPEN</a></div>';
    }).join('');
    openModal('LIVE M3U8 LINKS', '<div class="hint" style="margin-bottom:10px">Ye links VLC / IPTV / hls.js players me chalte hain. Playlist har 30 min me Actions regenerate karta hai aur agle 60 min ka window rakhti hai.</div>' + rows +
      '<div class="kv"><b>NETWORK M3U</b><code>' + esc(base + '/data/mizanora-tv.m3u') + '</code></div>' +
      '<div class="kv"><b>XMLTV EPG</b><code>' + esc(base + '/data/epg.xml') + '</code></div>' +
      '<div class="kv"><b>MASTER</b><code>' + esc(base + '/master.m3u8') + '</code></div>' +
      '<div class="kv"><b>VIEWER</b><code>' + esc(base + '/watch.html?channel=' + MZ.state.activeId) + '</code></div>',
      [{ label: 'CLOSE', fn: function () { closeModal(); } }]);
    $('modalBody').querySelectorAll('[data-copy]').forEach(function (b) {
      b.onclick = function () { MZ.Settings.copy(b.dataset.copy); MZ.toast('Copied', 'good'); };
    });
  }
  function helpModal() {
    openModal('CONTROL ROOM · HELP',
      '<div class="kv"><b>SPACE</b><span>Play / Pause</span></div><div class="kv"><b>N</b><span>Skip to next item (operator preview)</span></div>' +
      '<div class="kv"><b>M</b><span>Mute / unmute</span></div><div class="kv"><b>F</b><span>Fullscreen player</span></div>' +
      '<div class="kv"><b>R</b><span>Re-sync deterministic schedule</span></div><div class="kv"><b>H</b><span>Show / hide UP NEXT</span></div>' +
      '<div class="kv"><b>1–9</b><span>Channel switch</span></div><div class="kv"><b>E / L / S</b><span>EPG / Logs / Settings tab</span></div>' +
      '<hr style="border:0;border-top:1px solid var(--line);margin:14px 0">' +
      '<p><b>ARCHITECTURE</b><br>GitHub Actions = scheduler + HLS stitcher + heartbeat + watchdog. GitHub Pages = static M3U8 / EPG / JSON / control room. Browser = real 24/7 linear playout (deterministic schedule), is liye workflow ke rukne par bhi channel nahi rukta.</p>' +
      '<p><b>MP4 / MKV / MOV / WebM</b> browser player me seedhe chalte hain. <b>M3U8 / MPD</b> hls.js / dash.js se. Koi bhi source fail ho to 3D ident + retry + ad reel.</p>' +
      '<p><b>BREAK ORDER</b> default: trailer → ads → trailer → segment → gap-fill reel. 60-min slot me 20-min program ho to baqi 40 min trailers + ads loop.</p>' +
      '<p><b>LIMITS</b> GitHub Actions free tier ~2000 min/month, job max 6h, cron min 5 min, Pages static + 100MB/file repo limits. Is liye true realtime encoding ke liye external encoder/CDN chahiye — ye system uske baghair maximum possible 24/7 linear channel deta hai.</p>',
      [{ label: 'GOT IT', cls: 'gold', fn: function () { closeModal(); } }]);
  }
  function jsonModal() {
    const text = JSON.stringify(MZ.getConfig(), null, 2);
    openModal('RAW CONFIG · ' + MZ.state.activeId.toUpperCase(),
      '<div class="hint" style="margin-bottom:8px">Poora channel config yahan edit karein. SAVE = browser me apply, DOWNLOAD = JSON file, phir <code>config/channels.json</code> me push karein (ya SYSTEM tab se GitHub save).</div>' +
      '<textarea id="rawJson" spellcheck="false"></textarea>',
      [{ label: 'SAVE / APPLY', cls: 'gold', fn: function (body, close) {
          try { const obj = JSON.parse(body.querySelector('#rawJson').value); MZ.Settings.importCurrent(obj); close(); MZ.toast('Raw config applied', 'good'); }
          catch (e) { MZ.toast('JSON error: ' + e.message, 'bad'); }
        } },
       { label: '↓ DOWNLOAD', fn: function () { download('mizanora-' + MZ.state.activeId + '.json', $('rawJson').value); } },
       { label: 'CLOSE', fn: function () { closeModal(); } }]);
    $('rawJson').value = text;
  }
  function importModal() {
    openModal('IMPORT CONFIG',
      '<div class="hint" style="margin-bottom:8px">Pura <code>channels.json</code> ya ek channel object paste karein / file chunein.</div>' +
      '<input type="file" id="importFile" accept=".json,application/json" class="btn ghost wide" />' +
      '<textarea id="importText" spellcheck="false" placeholder="{ \"channels\": [ ... ] }"></textarea>',
      [{ label: 'IMPORT', cls: 'gold', fn: function (body, close) {
          try { MZ.Settings.importObject(JSON.parse(body.querySelector('#importText').value)); close(); applyUI(); renderRack(); }
          catch (e) { MZ.toast('Import failed: ' + e.message, 'bad'); }
        } }, { label: 'CLOSE', fn: function () { closeModal(); } }]);
    $('importFile').onchange = function (e) {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = function () { $('importText').value = r.result; }; r.readAsText(f);
    };
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------------------------- wiring ---------------------------- */
  function wire() {
    // transport
    $('btnPlay').onclick = function () { const p = MZ.Playout.togglePlay(); $('btnPlay').textContent = p ? '▶' : '❚❚'; $('btnPlay').classList.toggle('active', !p); };
    $('btnMute').onclick = function () { const m = !MZ.Playout.isMuted(); MZ.Playout.setMuted(m); $('btnMute').textContent = m ? '🔇' : '🔊'; };
    $('volRange').oninput = function () { MZ.Playout.setVolume(Number(this.value) / 100); $('volLabel').textContent = this.value + '%'; };
    $('gainRange').oninput = function () { const v = Number(this.value) / 100; $('gainLabel').textContent = v.toFixed(2); MZ.Playout.setGain(v); };
    $('pitchRange').oninput = function () { const v = Number(this.value) / 100; $('pitchLabel').textContent = v.toFixed(2); MZ.Playout.setPitch(v); };
    $('btnSync').onclick = function () { MZ.Playout.sync(); };
    $('btnNext').onclick = function () { MZ.Playout.skip(); };
    $('btnFallback').onclick = function () { MZ.Playout.forceFallback(); };
    $('btnPip').onclick = function () { MZ.Playout.pip(); };
    $('btnScreen').onclick = function () { fullscreen($('screen')); };
    $('btnFull').onclick = function () { fullscreen(document.documentElement); };
    $('btnWatch').onclick = function () { window.open('watch.html?channel=' + encodeURIComponent(MZ.state.activeId), '_blank'); };
    $('btnLinks').onclick = linksModal;
    $('btnHelp').onclick = helpModal;
    $('btnJson').onclick = jsonModal;
    $('btnImport').onclick = importModal;
    $('btnExport').onclick = function () { download('mizanora-channels.json', MZ.Settings.exportText()); MZ.toast('Config exported', 'good'); };
    $('btnReset').onclick = function () { if (confirm('Saari local settings reset karein?')) { MZ.resetSettings(); location.reload(); } };
    $('btnApply').onclick = function () { applyUI(); MZ.Playout.sync(); MZ.EPG.render($('epgGrid'), $('epgToolbar'), MZ.state.activeId); MZ.toast('Applied & re-synced', 'good'); };
    $('btnGithub').onclick = function () { MZ.Settings.setTab('SYSTEM'); $('railRight').scrollTop = $('railRight').scrollHeight; MZ.toast('SYSTEM tab → GitHub remote control'); };
    $('modalClose').onclick = closeModal;
    $('modalBackdrop').onclick = function (e) { if (e.target === $('modalBackdrop')) closeModal(); };
    // dock tabs
    $('dockTabs').querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        $('dockTabs').querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
        $('tab-' + b.dataset.tab).classList.add('active');
        if (b.dataset.tab === 'epg') MZ.EPG.render($('epgGrid'), $('epgToolbar'), MZ.state.activeId);
      };
    });
    // initial slider values
    const a = (MZ.getConfig().audio || {});
    $('gainRange').value = Math.round((a.gain || 1) * 100); $('gainLabel').textContent = (a.gain || 1).toFixed(2);
    $('pitchRange').value = Math.round((a.pitch || 1) * 100); $('pitchLabel').textContent = (a.pitch || 1).toFixed(2);
    $('volRange').value = Math.round((MZ.state.settings.ui.volume || 1) * 100); $('volLabel').textContent = $('volRange').value + '%';
    $('btnMute').textContent = MZ.Playout.isMuted() ? '🔇' : '🔊';
    // keyboard
    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'spacebar') { e.preventDefault(); $('btnPlay').click(); }
      else if (k === 'n') MZ.Playout.skip();
      else if (k === 'm') $('btnMute').click();
      else if (k === 'f') $('btnScreen').click();
      else if (k === 'r') MZ.Playout.sync();
      else if (k === 'h') { const s = MZ.state.settings.ui; s.showNext = !(s.showNext === null || s.showNext === undefined ? MZ.getConfig().ui.show_next !== false : s.showNext); MZ.saveSettings(); applyUI(); MZ.toast('UP NEXT ' + (s.showNext ? 'shown' : 'hidden')); }
      else if (k === 'e') $('dockTabs').querySelector('[data-tab="epg"]').click();
      else if (k === 'l') $('dockTabs').querySelector('[data-tab="logs"]').click();
      else if (k === 's') { MZ.Settings.setTab('GENERAL'); $('railRight').scrollTop = 0; }
      else if (/^[1-9]$/.test(k)) { const c = (MZ.state.index.channels || [])[Number(k) - 1]; if (c) switchChannel(c.id); }
      else if (k === 'escape') closeModal();
    });
  }
  function fullscreen(node) {
    try { if (document.fullscreenElement) document.exitFullscreen(); else node.requestFullscreen(); }
    catch (e) { MZ.toast('Fullscreen blocked: ' + e.message, 'bad'); }
  }

  /* ---------------------------- events ---------------------------- */
  function subscribe() {
    MZ.on('playout:update', renderOSD);
    MZ.on('schedule:rebuilt', function () { lastTimelineSlot = null; });
    MZ.on('ui:refresh', function () { applyUI(); if (lastUpdate) renderOSD(lastUpdate); });
    MZ.on('channel:changed', function () { applyUI(); if (lastUpdate) renderOSD(lastUpdate); });
    MZ.on('config:changed', function () { /* Playout already re-ticks */ });
    MZ.on('log', function (line) {
      const n = $('logConsole');
      n.innerHTML += '<div class="l-' + line.level + '"><b>' + line.at.toISOString().slice(11, 19) + '</b> ' + esc(line.msg) + '</div>';
      n.scrollTop = n.scrollHeight;
    });
    MZ.on('toast', function (t) {
      const d = document.createElement('div');
      d.className = 'toast ' + (t.kind || ''); d.textContent = t.msg;
      $('toastStack').appendChild(d);
      setTimeout(function () { d.remove(); }, 3600);
    });
    MZ.on('led', function (l) { setLed(l.key, l.state); });
    MZ.on('ident:show', function (d) {
      $('identLayer').classList.remove('hidden');
      $('identSub').textContent = d.reason ? 'FALLBACK · ' + String(d.reason).toUpperCase() + ' · AUTO RECOVERY' : 'ON AIR · 24/7 · AUTO PLAYOUT';
      $('player').classList.remove('live');
    });
    MZ.on('ident:hide', function () { $('identLayer').classList.add('hidden'); });
    MZ.on('ident:background', function (src) {
      $('screen').style.backgroundImage = src ? 'url(' + src + ')' : '';
      $('screen').style.backgroundSize = 'cover';
      $('screen').style.backgroundPosition = 'center';
    });
    MZ.on('epg:select', function (p) {
      openModal('EPG · ' + esc(p.title || 'PROGRAMME'),
        '<div class="kv"><b>TIME</b><span>' + esc(p.start) + ' → ' + esc(p.stop) + '</span></div>' +
        '<div class="kv"><b>GENRE</b><span>' + esc(p.genre) + '</span></div>' +
        '<div class="kv"><b>RATING</b><span>' + esc(p.rating) + '</span></div>' +
        '<div class="kv"><b>ADS</b><span>' + esc(p.ad_count) + '</span></div>' +
        '<div class="kv"><b>GAP FILL</b><span>' + Math.round((p.gap_filled || 0) / 60) + ' min</span></div>' +
        '<div class="kv"><b>BREAK</b><span>' + esc((p.break_order || []).join(' → ')) + '</span></div>' +
        '<p style="margin-top:12px">' + esc(p.desc || 'MIZANORA Broadcast Network') + '</p>' +
        (p.prime ? '<p style="color:var(--danger)">★ ' + esc(p.prime_label || 'PRIME TIME') + '</p>' : ''),
        [{ label: 'CLOSE', fn: function () { closeModal(); } }]);
    });
    MZ.on('incident', function (i) {
      if (!MZ.state.incidents) MZ.state.incidents = { incidents: [] };
      if (!MZ.state.incidents.incidents) MZ.state.incidents.incidents = [];
      MZ.state.incidents.incidents.push(i);
    });
    window.addEventListener('resize', function () { /* canvas handles it */ });
  }
})();

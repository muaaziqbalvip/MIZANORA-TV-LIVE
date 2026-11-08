/* ==========================================================================
   MZ.watch — clean 24/7 TV viewer. Same engine as the control room, minimal
   chrome. ?channel=<id> selects a channel; persists in localStorage.
   ========================================================================== */
(function () {
  'use strict';
  const MZ = window.MZ = window.MZ || {};
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const pad = function (n) { return String(n).padStart(2, '0'); };
  let lastMinute = null, idleTimer = null;

  MZ.bootViewer = async function () {
    try { await MZ.loadAll(); } catch (e) { MZ.log('warn', 'Viewer offline mode: ' + e.message); }
    if (!MZ.state.index) MZ.state.index = { channels: [{ id: 'mizanora', name: 'MIZANORA', logo: 'assets/brand/logo-mizanora.svg' }], global: {}, library: {} };
    const q = new URLSearchParams(location.search).get('channel');
    if (q && MZ.state.configs[q]) MZ.state.activeId = q;
    buildBars();
    applyUI();
    MZ.Visuals.start($('viz'), { primary: (MZ.getConfig().theme || {}).primary, accent: (MZ.getConfig().theme || {}).accent,
                                 intensity: 1.2, reduced: !!(MZ.getConfig().animation || {}).reduced_motion });
    MZ.Playout.init({ video: $('player') });
    renderChSwitch();
    wire();
    subscribe();
    clock(); setInterval(clock, 1000);
    MZ.EPG.render($('epgGrid'), $('epgToolbar'), MZ.state.activeId);
    MZ.log('info', 'Viewer ON AIR · ' + MZ.state.activeId);
    chromePulse();
  };

  function logo(ch) { return '<img src="' + esc(MZ.logoUrl(ch)) + '" alt="logo" onerror="this.onerror=null;this.src=\'assets/brand/logo-mizanora.svg\'" />'; }
  function buildBars() {
    const b = $('identBars'); b.innerHTML = '';
    for (let i = 0; i < 40; i++) { const x = document.createElement('i'); x.style.animationDelay = (i * 0.05) + 's'; x.style.animationDuration = (0.7 + (i % 8) * 0.12) + 's'; b.appendChild(x); }
  }
  function applyUI() {
    const ch = MZ.getConfig(), ui = ch.ui || {};
    MZ.applyTheme(ch);
    $('bugLogo').innerHTML = logo(ch); $('identLogo').innerHTML = logo(ch);
    $('identChannel').textContent = (ch.short || ch.name || 'NETWORK').toUpperCase();
    $('chShort').textContent = ch.short || 'LIVE';
    $('tape').textContent = ui.ticker_text || 'MIZANORA · SHOP SMART · SHOP HALAL · LIVE 24/7 ·';
    $('tape').parentElement.style.display = ui.show_ticker === false ? 'none' : '';
    $('bug').style.display = ui.show_logo_bug === false ? 'none' : '';
    $('next').style.display = ui.show_next === false ? 'none' : '';
    document.title = (ch.name || 'MIZANORA') + ' · LIVE TV';
    MZ.Visuals.setTheme((ch.theme || {}).primary, (ch.theme || {}).accent);
  }
  function clock() {
    const ch = MZ.getConfig(), c = ch.clock || {}, tz = ch.timezone || 'Asia/Karachi';
    const now = new Date(), p = MZ.localParts(now, tz);
    const f24 = c.format24 !== false; let h = parseInt(p.hour, 10) % 24;
    const hh = f24 ? h : (h % 12 || 12), suffix = f24 ? '' : (h < 12 ? ' AM' : ' PM');
    $('bugClock').textContent = pad(hh) + ':' + p.minute + (c.show_seconds !== false ? ':' + p.second : '') + suffix;
    $('bugDate').textContent = c.show_date === false ? '' : (p.weekday.toUpperCase() + ' · ' + p.day + ' ' + p.month.toUpperCase() + ' ' + p.year + (c.show_hijri ? ' · ' + MZ.hijri(now).slice(0, 14) : ''));
    $('bugZone').textContent = (c.label || 'LOCAL') + ' · ' + MZ.utcOffsetLabel(now, tz);
    if (lastMinute !== p.minute) { lastMinute = p.minute; const f = $('bugClock'); f.style.animation = 'none'; void f.offsetWidth; f.style.animation = ''; }
  }
  function role(r) {
    if (r === 'segment') return 'NOW PLAYING · SEGMENT';
    if (/ad/.test(r || '') && !/trailer/.test(r || '')) return 'AD BREAK';
    if (/trailer/.test(r || '')) return 'TRAILER / PROMO';
    if (/filler/.test(r || '')) return 'GAP FILL · TRAILER & AD REEL';
    if (/ident/.test(r || '')) return 'STATION IDENT';
    return 'NOW PLAYING';
  }
  function renderOSD(d) {
    const cur = d.loc.current, slot = d.loc.slot || {}, clip = d.clip, ch = d.ch;
    if (!cur) return;
    $('kicker').textContent = role(clip.role || cur.type);
    $('genre').textContent = (cur.meta && cur.meta.genre) || slot.genre || ch.genre || 'MIZANORA';
    $('title').textContent = clip.title || cur.title || slot.program;
    $('timing').textContent = MZ.fmtTime(d.loc.elapsed) + ' / ' + MZ.fmtTime(cur.duration);
    $('desc').textContent = (cur.meta && cur.meta.description) || slot.description || '';
    $('progFill').style.width = d.loc.progress + '%';
    $('prime').classList.toggle('show', !!slot.prime && (ch.prime_time || {}).badge !== false);
    $('prime').textContent = '★ ' + (slot.prime_label || 'PRIME TIME');
    if (d.loc.next) { $('nextTitle').textContent = d.loc.next.title; $('nextIn').textContent = MZ.fmtTime(d.loc.remaining); }
  }
  function renderChSwitch() {
    $('chSwitch').innerHTML = (MZ.state.index.channels || []).map(function (c) {
      return '<button data-id="' + esc(c.id) + '" class="' + (c.id === MZ.state.activeId ? 'active' : '') + '">' + esc(c.short || c.name) + '</button>';
    }).join('');
    $('chSwitch').querySelectorAll('[data-id]').forEach(function (b) {
      b.onclick = function () {
        MZ.setActive(b.dataset.id); applyUI(); renderChSwitch(); MZ.EPG.reset();
        MZ.EPG.render($('epgGrid'), $('epgToolbar'), MZ.state.activeId);
        history.replaceState(null, '', '?channel=' + encodeURIComponent(MZ.state.activeId));
        MZ.toast('CH ' + (MZ.getConfig().number || 1) + ' · ' + MZ.getConfig().name);
      };
    });
  }
  function chromePulse() {
    $('chrome').classList.add('show');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { $('chrome').classList.remove('show'); }, 4200);
  }
  function wire() {
    $('btnMute').onclick = function () { const m = !MZ.Playout.isMuted(); MZ.Playout.setMuted(m); this.textContent = m ? '🔇' : '🔊'; };
    $('btnPip').onclick = function () { MZ.Playout.pip(); };
    $('btnFull').onclick = function () { try { document.fullscreenElement ? document.exitFullscreen() : $('tv').requestFullscreen(); } catch (e) {} };
    $('btnEpg').onclick = function () { const p = $('epgPanel'); p.hidden = !p.hidden; if (!p.hidden) MZ.EPG.render($('epgGrid'), $('epgToolbar'), MZ.state.activeId); };
    $('epgClose').onclick = function () { $('epgPanel').hidden = true; };
    $('tv').addEventListener('pointermove', chromePulse);
    document.addEventListener('keydown', function (e) {
      const k = e.key.toLowerCase();
      if (k === 'm') $('btnMute').click();
      else if (k === 'f') $('btnFull').click();
      else if (k === 'e') $('btnEpg').click();
      else if (k === ' ') { e.preventDefault(); MZ.Playout.togglePlay(); }
      else if (k === 'n') MZ.Playout.skip();
      else if (k === 'escape') $('epgPanel').hidden = true;
      else if (/^[1-9]$/.test(k)) { const b = $('chSwitch').querySelectorAll('button')[Number(k) - 1]; if (b) b.click(); }
      else if (k === 'c') location.href = 'index.html';
    });
  }
  function subscribe() {
    MZ.on('playout:update', renderOSD);
    MZ.on('ident:show', function (d) { $('ident').classList.remove('hidden'); $('identSub').textContent = d.reason ? 'FALLBACK · ' + String(d.reason).toUpperCase() : 'ON AIR · 24/7 · AUTO PLAYOUT'; });
    MZ.on('ident:hide', function () { $('ident').classList.add('hidden'); });
    MZ.on('channel:changed', applyUI);
    MZ.on('toast', function (t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t.msg; $('toastStack').appendChild(d); setTimeout(function () { d.remove(); }, 3200); });
    MZ.on('epg:select', function (p) { MZ.toast(p.title + ' · ' + (p.genre || '')); });
  }
})();

/* ==========================================================================
   MZ.core — deterministic playout maths, config state, persistence, utils.
   Mirrors scripts/lib_playout.py so the browser can keep broadcasting 24/7
   even if GitHub Actions is paused, rate-limited or out of minutes.
   ========================================================================== */
(function () {
  'use strict';
  const MZ = window.MZ = window.MZ || {};
  const KINDS = ['mp4','mkv','mov','webm','m4v','m3u8','hls','mpd','ts','mp3','image','audio','reel'];
  const SUPPORTED = new Set(KINDS);
  const SETTINGS_KEY = 'mizanora.control-room.v2';

  /* ---------------------------- event bus ---------------------------- */
  const bus = {};
  MZ.on = function (evt, fn) { (bus[evt] = bus[evt] || []).push(fn); return fn; };
  MZ.emit = function (evt, data) { (bus[evt] || []).forEach(function (f) { try { f(data); } catch (e) { console.error('[MZ]', evt, e); } }); };

  /* ---------------------------- state ---------------------------- */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* private mode */ }
    return { active: '', overrides: {}, ui: { volume: 1, muted: false, showNext: null, reduced: null }, token: '' };
  }
  MZ.state = {
    index: null, global: null, library: {}, configs: {}, schedule: {}, nowNext: {}, epg: {}, status: {},
    health: null, mediaHealth: null, watchdog: null, incidents: [],
    activeId: '', settings: loadSettings(), logs: [], tickCount: 0,
    paused: false, fallback: false, clip: null, mode: 'IDLE', retries: 0,
  };
  MZ.saveSettings = function () {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(MZ.state.settings)); } catch (e) {}
    MZ.emit('settings:changed', MZ.state.settings);
  };
  MZ.resetSettings = function () {
    localStorage.removeItem(SETTINGS_KEY);
    MZ.state.settings = { active: '', overrides: {}, ui: { volume: 1, muted: false, showNext: null, reduced: null }, token: '' };
    MZ.emit('settings:changed', MZ.state.settings);
  };

  /* ---------------------------- utils ---------------------------- */
  MZ.deepMerge = function deepMerge(base, over) {
    if (Array.isArray(over)) return over.map(function (x) { return x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x; });
    if (!over || typeof over !== 'object') return over === undefined ? base : over;
    const out = (base && typeof base === 'object') ? JSON.parse(JSON.stringify(base)) : {};
    Object.keys(over).forEach(function (k) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) out[k] = deepMerge(out[k] || {}, over[k]);
      else out[k] = over[k];
    });
    return out;
  };
  MZ.fnv1a = function (text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };
  MZ.pick = function (pool, key, exclude) {
    if (!pool || !pool.length) return null;
    exclude = exclude || new Set();
    const n = pool.length, start = MZ.fnv1a(key) % n;
    for (let s = 0; s < n; s++) {
      const c = pool[(start + s) % n];
      if (!exclude.has(String(c.id || ''))) return c;
    }
    return pool[start];
  };
  MZ.weightedPick = function (pool, key, exclude) {
    if (!pool || !pool.length) return null;
    const expanded = [];
    pool.forEach(function (it) { const w = Math.max(1, parseInt(it.weight || 1, 10)); for (let i = 0; i < w; i++) expanded.push(it); });
    return MZ.pick(expanded, key, exclude);
  };
  MZ.sourceKind = function (entry) {
    const k = String(entry.kind || '').toLowerCase();
    if (SUPPORTED.has(k)) return k;
    const src = String(entry.src || '').split('?')[0].toLowerCase();
    const m = src.match(/\.(m3u8|mpd|mkv|webm|mov|m4v|ts|mp3|jpg|jpeg|png|mp4)$/);
    if (m) return m[1] === 'jpg' || m[1] === 'jpeg' || m[1] === 'png' ? 'image' : m[1];
    return 'mp4';
  };
  MZ.iso = function (ms) { return new Date(ms).toISOString().replace('.000Z', 'Z'); };
  MZ.asset = function (url) {
    if (!url) return '';
    if (/^(https?:|data:|\/)/.test(url)) return url;
    return url.replace(/^\.\//, '');
  };
  MZ.fmtTime = function (sec, withHours) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = function (x) { return String(x).padStart(2, '0'); };
    return (withHours || h ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
  };
  MZ.localParts = function (date, tz) {
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false,
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const p = {}; fmt.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
      return { weekday: p.weekday, day: p.day, month: p.month, year: p.year,
               hour: p.hour, minute: p.minute, second: p.second,
               minutes: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
    } catch (e) { return { weekday: '---', day: '01', month: 'Jan', year: '2026', hour: '00', minute: '00', second: '00', minutes: 0 }; }
  };
  MZ.hijri = function (date) {
    try {
      const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
      return f.format(date);
    } catch (e) { return '—'; }
  };
  MZ.utcOffsetLabel = function (date, tz) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(date).find(function (x) { return x.type === 'timeZoneName'; });
      return (p && p.value) || 'UTC';
    } catch (e) { return 'UTC'; }
  };
  MZ.inWindow = function (local, start, end) {
    const a = start.split(':').map(Number), b = end.split(':').map(Number);
    const cur = local.minutes, x = a[0] * 60 + a[1], y = b[0] * 60 + b[1];
    return x <= y ? (cur >= x && cur < y) : (cur >= x || cur < y);
  };
  MZ.log = function (level, msg) {
    const line = { at: new Date(), level: level, msg: msg };
    MZ.state.logs.push(line);
    if (MZ.state.logs.length > 300) MZ.state.logs.shift();
    MZ.emit('log', line);
    if (level === 'error' || level === 'warn') console[level]('[MIZANORA] ' + msg);
  };
  MZ.toast = function (msg, kind) { MZ.emit('toast', { msg: msg, kind: kind || '' }); };
  MZ.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* ---------------------------- network ---------------------------- */
  async function getJSON(path, fresh) {
    const url = MZ.asset(path) + (fresh ? '?_=' + Date.now() : '');
    const r = await fetch(url, { cache: fresh ? 'no-store' : 'default' });
    if (!r.ok) throw new Error(path + ' → HTTP ' + r.status);
    return r.json();
  }
  MZ.getJSON = getJSON;
  MZ.loadAll = async function () {
    const idx = await getJSON('data/channels.json', true);
    MZ.state.index = idx;
    MZ.state.global = idx.global || {};
    MZ.state.library = idx.library || {};
    const channels = (idx.channels || []);
    const results = await Promise.all(channels.map(async function (c) {
      const id = c.id; const base = 'channels/' + id + '/';
      const out = { config: null, schedule: null, nowNext: null, epg: null, status: null };
      const jobs = [
        ['config', getJSON(base + 'config.json')],
        ['schedule', getJSON(base + 'schedule.json')],
        ['nowNext', getJSON(base + 'now-next.json', true)],
        ['epg', getJSON(base + 'epg.json')],
        ['status', getJSON(base + 'status.json', true)],
      ];
      await Promise.all(jobs.map(async function (j) {
        try { out[j[0]] = await j[1]; } catch (e) { MZ.log('warn', 'Missing ' + j[0] + ' for ' + id + ' — using local engine'); }
      }));
      return [id, out];
    }));
    results.forEach(function (r) {
      MZ.state.configs[r[0]] = r[1].config || MZ.clone((channels.find(function (c) { return c.id === r[0]; }) || {}));
      MZ.state.schedule[r[0]] = r[1].schedule;
      MZ.state.nowNext[r[0]] = r[1].nowNext;
      MZ.state.epg[r[0]] = r[1].epg;
      MZ.state.status[r[0]] = r[1].status;
    });
    for (const key of ['health', 'mediaHealth', 'watchdog', 'heartbeat', 'incidents']) {
      try { MZ.state[key] = await getJSON('data/' + (key === 'heartbeat' ? 'heartbeat' : key === 'incidents' ? 'incidents' : key === 'mediaHealth' ? 'media-health' : key) + '.json', true); }
      catch (e) { MZ.state[key] = null; }
    }
    MZ.state.activeId = MZ.state.settings.active && MZ.state.configs[MZ.state.settings.active]
      ? MZ.state.settings.active : (channels[0] && channels[0].id);
    return idx;
  };

  /* ---------------------------- config access ---------------------------- */
  MZ.getConfig = function (id) {
    id = id || MZ.state.activeId;
    const base = MZ.state.configs[id] || {};
    const over = (MZ.state.settings.overrides || {})[id] || {};
    return MZ.deepMerge(base, over);
  };
  MZ.setOverride = function (id, patch, save) {
    const s = MZ.state.settings;
    s.overrides[id] = MZ.deepMerge(s.overrides[id] || {}, patch);
    if (save !== false) MZ.saveSettings();
    MZ.emit('config:changed', { id: id, config: MZ.getConfig(id) });
  };
  MZ.activeIndex = function () {
    return (MZ.state.index && MZ.state.index.channels || []).find(function (c) { return c.id === MZ.state.activeId; }) || {};
  };
  MZ.setActive = function (id) {
    MZ.state.activeId = id;
    MZ.state.settings.active = id;
    MZ.saveSettings();
    MZ.emit('channel:changed', id);
  };

  /* ---------------------------- deterministic schedule ---------------------------- */
  MZ.reelSources = function (ch) {
    const lib = MZ.state.library || {};
    const sources = { standby: { src: 'assets/brand/ident-studio.jpg', kind: 'image', title: 'MIZANORA — Please Stand By', duration: 15, role: 'ident' } };
    const identOverride = parseInt(ch.ident_duration || (MZ.state.global.playout || {}).ident_duration || 15, 10);
    [[lib.ads || [], 'ad'], [lib.trailers || [], 'trailer'], [lib.idents || [], 'ident'],
     [ch.ads || [], 'ad'], [ch.trailers || [], 'trailer']].forEach(function (pair) {
      pair[0].forEach(function (e) {
        if (e.id) sources[e.id] = { src: e.src || '', kind: MZ.sourceKind(e), title: e.title || pair[1],
          duration: pair[1] === 'ident' ? identOverride : Math.max(1, parseInt(e.duration || 15, 10)),
          role: pair[1], advertiser: e.advertiser || '' };
      });
    });
    return sources;
  };
  MZ.anchorMs = function () {
    const a = (MZ.state.global && MZ.state.global.anchor_utc) || '2026-01-01T00:00:00Z';
    return Date.parse(a);
  };
  MZ.buildSlot = function (ch, index) {
    const g = MZ.state.global || {}, playout = g.playout || {}, lib = MZ.state.library || {};
    const slotSec = (parseInt(ch.slot_minutes || 60, 10)) * 60;
    const start = MZ.anchorMs() + index * slotSec * 1000, end = start + slotSec * 1000;
    const tz = ch.timezone || 'Asia/Karachi';
    const local = MZ.localParts(new Date(start), tz);
    const pt = ch.prime_time || {};
    const prime = !!pt.enabled && MZ.inWindow(local, pt.start || '19:00', pt.end || '23:00');
    const poolName = prime ? (pt.pool || 'prime') : 'regular';
    let segments = (ch.segments || []).filter(function (s) { return (s.pool || 'regular') === poolName; });
    if (!segments.length) segments = ch.segments || [];
    const ads = ch.ads && ch.ads.length ? ch.ads : (lib.ads || []);
    const trailers = ch.trailers && ch.trailers.length ? ch.trailers : (lib.trailers || []);
    const idents = lib.idents || [];
    const program = MZ.pick(segments, ch.id + '|' + index + '|segment') ||
      { id: 'offline', title: 'MIZANORA — Station Ident', src: 'assets/brand/ident-studio.jpg', kind: 'image', duration: slotSec };
    let adTarget = parseInt(ch.ads_per_break === undefined ? (playout.min_ads_per_break || 1) : ch.ads_per_break, 10);
    if (prime) adTarget = Math.min(parseInt(playout.max_ads_per_break || 4, 10), adTarget * parseInt(pt.ad_multiplier || playout.prime_ad_multiplier || 2, 10));
    const order = ch.break_order || ['trailer', 'ad', 'trailer', 'segment', 'filler'];
    const used = new Set(), items = [];
    let cursor = start, budget = slotSec;

    function add(entry, type, title, duration, offset, extra) {
      if (!entry || budget <= 0) return;
      let dur = Math.max(1, Math.min(duration === undefined ? parseInt(entry.duration || 15, 10) : duration, budget));
      const item = {
        id: ch.id + '-' + index + '-' + String(items.length).padStart(2, '0'), slot: index, type: type,
        title: title || entry.title || type.toUpperCase(), src: entry.src || '', kind: MZ.sourceKind(entry),
        duration: dur, source_duration: parseInt(entry.duration || dur, 10), offset: offset || 0,
        start: MZ.iso(cursor), end: MZ.iso(cursor + dur * 1000), prime: prime, poster: entry.poster || '',
        meta: { advertiser: entry.advertiser || '', genre: entry.genre || '', rating: entry.rating || '',
                cast: entry.cast || [], description: entry.description || '', audio_pitch: entry.audio_pitch || 1,
                promo: entry.type || '' },
      };
      if (extra) Object.assign(item, extra);
      items.push(item); cursor += dur * 1000; budget -= dur;
    }
    let adCount = 0;
    order.forEach(function (token, position) {
      if (budget <= 0) return;
      if (token === 'trailer') {
        const tr = MZ.pick(trailers, ch.id + '|' + index + '|trailer|' + position, used);
        if (tr) { used.add(String(tr.id)); add(tr, 'trailer', undefined, Math.min(parseInt(tr.duration || 15, 10), budget)); }
      } else if (token === 'ad') {
        for (let j = 0; j < adTarget && budget > 0; j++) {
          const ad = MZ.weightedPick(ads, ch.id + '|' + index + '|ad|' + j, used);
          if (ad) { used.add(String(ad.id)); add(ad, 'ad', undefined, Math.min(parseInt(ad.duration || 15, 10), budget)); adCount++; }
        }
      } else if (token === 'segment') {
        add(program, 'segment', undefined, Math.min(parseInt(program.duration || slotSec, 10), budget), 0,
            { program_id: program.id, program: program.title });
      } else if (token === 'filler' && budget > 0 && ch.gap_fill === false) {
        add({ src: 'assets/brand/ident-studio.jpg', kind: 'image', duration: budget,
              title: 'MIZANORA — Interstitial' }, 'filler_ident', undefined, budget);
      } else if (token === 'filler' && budget > 0) {
        const reel = [], identDur = parseInt(ch.ident_duration || playout.ident_duration || 15, 10);
        let reelSeconds = 0;
        for (let j = 0; j < 6; j++) {
          const ad = MZ.weightedPick(ads, ch.id + '|' + index + '|reel|ad|' + j);
          if (ad && ad.id) { reel.push(String(ad.id)); reelSeconds += Math.max(1, parseInt(ad.duration || 15, 10)); }
        }
        for (let j = 0; j < 4; j++) {
          const tr = MZ.pick(trailers, ch.id + '|' + index + '|reel|tr|' + j);
          if (tr && tr.id) { reel.push(String(tr.id)); reelSeconds += Math.max(1, parseInt(tr.duration || 15, 10)); }
        }
        if (idents[0] && idents[0].id) { reel.push(String(idents[0].id)); reelSeconds += identDur; }
        if (!reel.length) { reel.push('standby'); reelSeconds = budget; }
        add({ src: '', kind: 'reel', duration: budget, title: 'MIZANORA — Trailer & Ad Reel' }, 'filler_reel',
            undefined, budget, 0, { reel: reel, loop: true, reel_duration: reelSeconds, gap_fill: true });
      }
    });
    return {
      index: index, start: MZ.iso(start), end: MZ.iso(end), local_start: local, duration: slotSec,
      timezone: tz, prime: prime, prime_label: prime ? (pt.label || 'PRIME TIME') : '', break_order: order,
      ad_count: adCount, program: program.title, program_id: program.id, genre: program.genre || ch.genre || '',
      rating: program.rating || 'U', description: program.description || '', poster: program.poster || '',
      cast: program.cast || [], audio_pitch: program.audio_pitch || 1,
      gap_filled: items.reduce(function (a, i) { return a + (i.type.indexOf('filler') === 0 ? i.duration : 0); }, 0),
      items: items,
    };
  };
  MZ.buildWindow = function (ch, now, back, forward) {
    const ms = now ? now.getTime() : Date.now();
    const slotSec = (parseInt(ch.slot_minutes || 60, 10)) * 60;
    const current = Math.floor((ms - MZ.anchorMs()) / (slotSec * 1000));
    const out = [];
    for (let k = current - (back === undefined ? 1 : back); k <= current + (forward === undefined ? 4 : forward); k++) out.push(MZ.buildSlot(ch, k));
    return out;
  };
  MZ.locate = function (slots, now) {
    const ms = now ? now.getTime() : Date.now();
    const flat = [];
    slots.forEach(function (s) { s.items.forEach(function (i) { flat.push(i); }); });
    for (let p = 0; p < flat.length; p++) {
      const st = Date.parse(flat[p].start), en = Date.parse(flat[p].end);
      if (st <= ms && ms < en) {
        const slot = slots.find(function (s) { return s.index === flat[p].slot; }) || null;
        const elapsed = Math.max(0, (ms - st) / 1000);
        return { current: flat[p], next: flat[p + 1] || null, slot: slot,
                 upcoming: flat.slice(p + 1, p + 6), elapsed: elapsed,
                 remaining: Math.max(0, flat[p].duration - elapsed),
                 progress: Math.min(100, Math.round(elapsed / flat[p].duration * 10000) / 100) };
      }
    }
    return { current: null, next: flat[0] || null, slot: slots[0] || null, upcoming: flat.slice(0, 5), elapsed: 0, remaining: 0, progress: 0 };
  };
  MZ.reelClip = function (item, elapsed, sources) {
    const ids = item.reel || ['standby'], total = Math.max(1, item.reel_duration || 60);
    const cycle = Math.floor(Math.max(0, elapsed) / total);
    let pos = ((elapsed % total) + total) % total, acc = 0, chosen = null, localOffset = 0, index = 0;
    for (let i = 0; i < ids.length; i++) {
      const s = sources[ids[i]] || sources.standby;
      const d = Math.max(1, s.duration || 15);
      if (pos < acc + d) { chosen = s; localOffset = pos - acc; index = i; break; }
      acc += d;
    }
    if (!chosen) { chosen = sources[ids[0]] || sources.standby; index = 0; localOffset = 0; }
    return { src: chosen.src, kind: chosen.kind, title: chosen.title, duration: chosen.duration || 15,
             offset: 0, remaining: Math.max(1, (chosen.duration || 15) - localOffset),
             role: chosen.role || 'ident', seek: localOffset, reel: true,
             cycle: cycle, index: index };
  };
  MZ.resolveClip = function (item, elapsed) {
    if (!item) return { src: '', kind: 'image', title: 'MIZANORA — Please Stand By', duration: 15, seek: 0, remaining: 15, role: 'ident' };
    if (item.type === 'filler_reel') return MZ.reelClip(item, elapsed, MZ.reelSources(MZ.getConfig(MZ.state.activeId)));
    return { src: item.src, kind: item.kind, title: item.title, duration: item.duration,
             offset: item.offset || 0, seek: (item.offset || 0) + elapsed,
             remaining: Math.max(0, item.duration - elapsed), role: item.type, reel: false, cycle: 0, index: 0 };
  };

  /* ---------------------------- theme ---------------------------- */
  MZ.applyTheme = function (ch) {
    const t = ch.theme || {};
    const root = document.documentElement.style;
    root.setProperty('--primary', t.primary || '#12B981');
    root.setProperty('--accent', t.accent || '#F2C766');
    root.setProperty('--bg', t.bg || '#03130D');
    root.setProperty('--deep', t.bg || '#0B6B45');
    root.setProperty('--glow', String(t.glow === undefined ? 0.8 : t.glow));
    if (t.bg) document.body.style.background = t.bg;
  };
  MZ.logoUrl = function (ch) { return MZ.asset(ch.logo_url || ch.logo || 'assets/brand/logo-mizanora.svg'); };
  window.MZ_READY = true;
})();

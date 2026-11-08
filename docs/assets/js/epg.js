/* ==========================================================================
   MZ.EPG — XL 7-day electronic programme guide.
   Uses the generated epg.json; if the workflow has never run, rebuilds the
   whole guide locally from the deterministic engine.
   ========================================================================== */
(function () {
  'use strict';
  const MZ = window.MZ = window.MZ || {};
  let selectedDay = 0;

  function localTime(isoStr, tz) {
    const p = MZ.localParts(new Date(isoStr), tz);
    return p.hour + ':' + p.minute;
  }
  function dayKey(isoStr, tz) {
    const p = MZ.localParts(new Date(isoStr), tz);
    return p.year + '-' + p.month + '-' + p.day;
  }
  function programmesFor(cfg, id) {
    const e = MZ.state.epg[id];
    if (e && e.programmes && e.programmes.length) return e.programmes;
    // Local rebuild — full 7 days, day aligned.
    const tz = cfg.timezone || 'Asia/Karachi';
    const slotSec = (parseInt(cfg.slot_minutes || 60, 10)) * 60;
    const perDay = Math.max(1, Math.floor(86400 / slotSec));
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const first = Math.floor((dayStart.getTime() - MZ.anchorMs()) / (slotSec * 1000));
    const out = [];
    for (let k = first - perDay; k < first + perDay * 7; k++) {
      const s = MZ.buildSlot(cfg, k);
      out.push({ start: s.start, stop: s.end, title: s.program, genre: s.genre, desc: s.description,
                 rating: s.rating, prime: s.prime, prime_label: s.prime_label, poster: s.poster,
                 cast: s.cast, ad_count: s.ad_count, gap_filled: s.gap_filled, break_order: s.break_order,
                 audio_pitch: s.audio_pitch, slot: k });
    }
    return out;
  }
  function group(progs, tz) {
    const map = new Map();
    progs.forEach(function (p) { const k = dayKey(p.start, tz); if (!map.has(k)) map.set(k, []); map.get(k).push(p); });
    return Array.from(map.entries()).map(function (e) { return { key: e[0], list: e[1] }; });
  }

  MZ.EPG = {
    render: function (grid, toolbar, id, opts) {
      opts = opts || {};
      const cfg = MZ.getConfig(id);
      const tz = cfg.timezone || 'Asia/Karachi';
      const now = new Date();
      const progs = programmesFor(cfg, id);
      const days = group(progs, tz).slice(0, 8);
      if (selectedDay >= days.length) selectedDay = 0;
      const todayKey = dayKey(now.toISOString(), tz);

      // ---- toolbar ----
      if (toolbar) {
        toolbar.innerHTML = '';
        days.forEach(function (d, i) {
          const p = MZ.localParts(new Date(d.list[0].start), tz);
          const b = document.createElement('button');
          b.className = 'btn' + (i === selectedDay ? ' gold' : ' ghost');
          b.textContent = p.weekday.toUpperCase() + ' ' + p.day + ' ' + p.month.toUpperCase() + (d.key === todayKey ? ' •' : '');
          b.onclick = function () { selectedDay = i; MZ.EPG.render(grid, toolbar, id, opts); };
          toolbar.appendChild(b);
        });
        const jump = document.createElement('button');
        jump.className = 'btn ghost'; jump.textContent = '⊙ JUMP TO NOW';
        jump.onclick = function () {
          const i = days.findIndex(function (d) { return d.key === todayKey; });
          selectedDay = i < 0 ? 0 : i;
          MZ.EPG.render(grid, toolbar, id, opts);
          MZ.toast('EPG jumped to now');
        };
        toolbar.appendChild(jump);
        const xml = document.createElement('a');
        xml.className = 'btn ghost'; xml.textContent = '↓ XMLTV';
        xml.href = 'channels/' + id + '/epg.xml'; xml.target = '_blank'; xml.rel = 'noopener';
        toolbar.appendChild(xml);
        const label = document.createElement('span');
        label.className = 'epg-now';
        label.textContent = 'XL EPG · ' + progs.length + ' programmes · ' + tz + ' · PRIME SHADED';
        toolbar.appendChild(label);
      }
      if (!grid) return;
      grid.innerHTML = '';
      const view = days[selectedDay] || { list: [] };
      const list = view.list.slice();
      const nowMs = now.getTime();
      const row = document.createElement('div'); row.className = 'epg-day';
      const lab = document.createElement('div'); lab.className = 'epg-day-label';
      const p0 = MZ.localParts(new Date(list[0] ? list[0].start : now.toISOString()), tz);
      lab.innerHTML = p0.weekday.toUpperCase() + ' ' + p0.day + '<small>' + p0.month.toUpperCase() + ' ' + p0.year + '<br>' + list.length + ' SLOTS</small>';
      const track = document.createElement('div'); track.className = 'epg-progs';
      list.forEach(function (p) {
        const el = document.createElement('div');
        const a = Date.parse(p.start), b = Date.parse(p.stop);
        el.className = 'epg-prog' + (a <= nowMs && nowMs < b ? ' now' : '') + (p.prime ? ' prime' : '');
        el.innerHTML = '<time>' + localTime(p.start, tz) + ' – ' + localTime(p.stop, tz) + '</time>' +
          '<strong>' + esc(p.title) + '</strong>' +
          '<span>' + esc(p.genre || 'GENERAL') + ' · ' + esc(p.rating || 'U') +
          (p.ad_count ? ' · ' + p.ad_count + ' ADS' : '') + (p.gap_filled ? ' · +' + Math.round(p.gap_filled / 60) + 'm FILL' : '') + '</span>';
        el.title = (p.desc || p.title) + '\n' + (p.prime ? p.prime_label : '') + '\nBreak: ' + (p.break_order || []).join(' → ');
        el.onclick = function () { MZ.emit('epg:select', p); };
        track.appendChild(el);
      });
      row.appendChild(lab); row.appendChild(track); grid.appendChild(row);
      // auto-scroll to the current programme
      const active = track.querySelector('.epg-prog.now');
      if (active && track.scrollTo) setTimeout(function () { track.scrollTo({ left: Math.max(0, active.offsetLeft - track.offsetLeft - 40), behavior: 'smooth' }); }, 80);
    },
    programmes: programmesFor,
    reset: function () { selectedDay = 0; },
  };
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
})();

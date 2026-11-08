/* ==========================================================================
   MZ.Playout — 24/7 linear playout engine (browser side).
   Follows the deterministic schedule, plays MP4 / MKV / MOV / WebM / M3U8 /
   MPD / images, loops the trailer+ad reel, retries dead sources, applies audio
   gain/pitch/ducking, and NEVER leaves a black screen (3D ident fallback).
   ========================================================================== */
(function () {
  'use strict';
  const MZ = window.MZ = window.MZ || {};
  let video = null, hls = null, dash = null, tickTimer = null;
  let loadTimer = null, identTimer = null, suppressErrors = false;
  let slots = [], configStamp = '', lastSlot = null, mountedKey = '', lastItemId = '';
  let timeOffsetMs = 0, forceIdentUntil = 0, loopGuard = 0, autoplayBlocked = false;
  let loc = null, clip = null, ch = null;
  const audio = { gain: 1, pitch: 1, duck: 1, volume: 1, muted: false };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function now() { return new Date(Date.now() + timeOffsetMs); }
  function stamp(c) {
    return JSON.stringify([c.id, c.slot_minutes, c.break_order, c.segments, c.ads, c.trailers, c.prime_time, c.timezone, c.audio]);
  }
  function teardown() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (dash) { try { dash.reset(); } catch (e) {} dash = null; }
    clearTimeout(loadTimer); clearTimeout(identTimer);
    loadTimer = identTimer = null;
  }
  function showIdent(reason) {
    if (video) { video.pause(); video.classList.remove('live'); }
    MZ.state.fallback = true;
    MZ.state.mode = reason ? 'FALLBACK · ' + reason : 'STATION IDENT';
    MZ.emit('ident:show', { clip: clip, reason: reason || '' });
    MZ.emit('led', { key: 'fallback', state: 'warn' });
  }
  function hideIdent() {
    if (video) video.classList.add('live');
    MZ.state.fallback = false;
    MZ.emit('ident:hide');
    MZ.emit('led', { key: 'fallback', state: 'ok' });
  }
  function tryPlay() {
    if (!video || MZ.state.paused) return;
    const p = video.play();
    if (p && p.catch) p.catch(function (e) {
      if (e && e.name === 'NotAllowedError') {
        audio.muted = true; video.muted = true; autoplayBlocked = true;
        MZ.state.settings.ui.muted = true;
        MZ.log('warn', 'Autoplay blocked by browser — muted. Click anywhere to enable sound.');
        MZ.emit('audio:muted', true);
        video.play().catch(function () {});
      } else if (e && e.name !== 'AbortError') {
        MZ.log('warn', 'play() rejected: ' + (e.name || e));
      }
    });
  }
  function fail(reason) {
    if (suppressErrors) return;
    MZ.state.retries++;
    MZ.log('warn', 'Source failed (' + reason + ') → 3D ident fallback' + (clip ? ' · ' + clip.title : ''));
    MZ.emit('incident', { at: new Date(), level: 'warn', source: 'playout', message: reason + (clip ? ' · ' + clip.src : '') });
    teardown();
    suppressErrors = true;
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {}
    setTimeout(function () { suppressErrors = false; }, 800);
    showIdent(reason);
  }
  function seekOnMetadata() {
    if (!video || !clip) return;
    const d = isFinite(video.duration) ? video.duration : 0;
    if (clip.seek > 1 && d > 1) { try { video.currentTime = Math.min(clip.seek, Math.max(0, d - 1)); } catch (e) {} }
  }
  function armTimeout(ch) {
    const sec = parseInt((ch.errors && ch.errors.source_timeout) || 12, 10);
    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      if (video && !video.classList.contains('live')) fail('source timeout ' + sec + 's');
    }, sec * 1000);
  }
  function applyAudio() {
    if (!video || !ch) return;
    const a = ch.audio || {};
    audio.gain = parseFloat(a.gain || 1);
    audio.pitch = clamp(parseFloat(a.pitch || 1), 0.5, 2);
    const isAd = clip && /ad|filler_ad/.test(clip.role || '');
    audio.duck = isAd ? Math.pow(10, parseFloat(a.duck_ads_db || 0) / 20) : 1;
    const muteAds = isAd && !!a.mute_ads;
    video.muted = !!(audio.muted || muteAds);
    video.volume = clamp(audio.gain * audio.volume * audio.duck, 0, 1);
    try {
      video.playbackRate = audio.pitch;
      video.preservesPitch = false;   // pitch actually shifts with rate
      video.mozPreservesPitch = false; video.webkitPreservesPitch = false;
    } catch (e) {}
  }

  function mount(newLoc, newClip, cfg) {
    loc = newLoc; clip = newClip; ch = cfg;
    if (lastItemId !== loc.current.id) { forceIdentUntil = 0; MZ.state.forceIdent = false; lastItemId = loc.current.id; }
    teardown();
    loopGuard = 0;
    applyAudio();
    MZ.state.clip = clip;
    MZ.state.mode = clip.kind === 'image' ? '3D IDENT' : clip.kind.toUpperCase() + (clip.reel ? ' · REEL' : '');
    MZ.emit('led', { key: 'playlist', state: 'ok' });

    const forced = MZ.state.forceIdent && Date.now() < forceIdentUntil;
    if (forced || !clip.src || clip.kind === 'image' || clip.kind === 'reel') {
      if (clip.kind === 'image' && clip.src) MZ.emit('ident:background', clip.src);
      showIdent(clip.kind === 'image' ? '' : 'ident');
      clearTimeout(identTimer);
      identTimer = setTimeout(function () { mountedKey = ''; tick(true); }, Math.max(1000, clip.remaining * 1000));
      return;
    }

    const url = MZ.asset(clip.src);
    armTimeout(cfg);
    MZ.emit('ident:background', null);

    if (clip.kind === 'm3u8' || clip.kind === 'hls' || /\.m3u8(\?|$)/i.test(url)) {
      if (window.Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30,
                        manifestLoadingTimeOut: 9000, manifestLoadingMaxRetry: 1,
                        levelLoadingTimeOut: 9000, fragLoadingTimeOut: 12000 });
        hls.on(Hls.Events.MEDIA_ATTACHED, function () { hls.loadSource(url); });
        hls.on(Hls.Events.MANIFEST_PARSED, function () { tryPlay(); });
        hls.on(Hls.Events.ERROR, function (_e, data) {
          if (data && data.fatal) fail('HLS ' + (data.type || '') + ' ' + (data.details || ''));
        });
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url; tryPlay();
      } else fail('HLS not supported (hls.js CDN unavailable)');
    } else if (clip.kind === 'mpd') {
      if (window.dashjs && dashjs.MediaPlayer) {
        dash = dashjs.MediaPlayer().create();
        dash.initialize(video, url, false);
        dash.on('error', function () { fail('DASH error'); });
        tryPlay();
      } else fail('DASH not supported (dash.js CDN unavailable)');
    } else {
      // MP4 / M4V / WebM / MOV / MKV / TS / MP3 — progressive playback.
      video.src = url;
      try { video.load(); } catch (e) {}
      tryPlay();
    }
  }

  function ensureSlots(cfg, n) {
    const slotSec = (parseInt(cfg.slot_minutes || 60, 10)) * 60;
    const curSlot = Math.floor((n.getTime() - MZ.anchorMs()) / (slotSec * 1000));
    const st = stamp(cfg);
    if (!slots.length || curSlot !== lastSlot || st !== configStamp) {
      slots = MZ.buildWindow(cfg, n, 1, 4);
      lastSlot = curSlot; configStamp = st;
      MZ.emit('schedule:rebuilt', slots);
    }
  }
  function tick(force) {
    if (!video || !MZ.state.activeId) return;
    const cfg = MZ.getConfig();
    const n = now();
    ensureSlots(cfg, n);
    const found = MZ.locate(slots, n);
    if (!found.current) { showIdent('schedule gap'); return; }
    const c = MZ.resolveClip(found.current, found.elapsed);
    const key = found.current.id + '|' + c.cycle + '|' + c.index;
    if (force || key !== mountedKey) {
      mountedKey = key;
      MZ.state.retries = 0;
      mount(found, c, cfg);
    } else {
      loc = found; clip = c; ch = cfg;
      if (!MZ.state.fallback) applyAudio();
    }
    MZ.state.tickCount++;
    MZ.emit('playout:update', {
      loc: found, clip: c, ch: cfg, slots: slots, mode: MZ.state.mode,
      fallback: MZ.state.fallback, timeOffsetMs: timeOffsetMs,
      reelSources: MZ.reelSources(cfg),
    });
  }

  function attach(v) {
    video = v;
    v.addEventListener('loadedmetadata', function () {
      seekOnMetadata();
      clearTimeout(loadTimer);
      hideIdent();
    });
    v.addEventListener('playing', function () { clearTimeout(loadTimer); hideIdent(); });
    v.addEventListener('canplay', function () { clearTimeout(loadTimer); });
    v.addEventListener('error', function () { if (!suppressErrors && v.src) fail('media decode error (' + (clip ? clip.kind : '?') + ')'); });
    v.addEventListener('stalled', function () { MZ.log('warn', 'Buffer stalled — retrying'); });
    v.addEventListener('waiting', function () { /* normal buffering */ });
    v.addEventListener('ended', function () {
      if (!clip || MZ.state.fallback) return;
      if (clip.reel || /ad|trailer|ident/.test(clip.role || '')) {
        loopGuard++;
        if (loopGuard < 4) { try { v.currentTime = 0; tryPlay(); } catch (e) {} return; }
      }
      fail('source ended before slot end');
    });
  }

  MZ.Playout = {
    init: function (opts) {
      attach(opts.video);
      audio.volume = parseFloat((MZ.state.settings.ui || {}).volume || 1);
      audio.muted = !!(MZ.state.settings.ui || {}).muted;
      clearInterval(tickTimer);
      tick(true);
      tickTimer = setInterval(function () { tick(false); }, 500);
      MZ.on('config:changed', function () { configStamp = ''; mountedKey = ''; tick(true); });
      MZ.on('channel:changed', function () { mountedKey = ''; slots = []; configStamp = ''; timeOffsetMs = 0;
                                              lastItemId = ''; tick(true); });
      document.addEventListener('pointerdown', function resume() {
        if (autoplayBlocked) {
          autoplayBlocked = false; audio.muted = false;
          MZ.state.settings.ui.muted = false;
          applyAudio(); MZ.emit('audio:muted', false);
          MZ.toast('🔊 Sound enabled', 'good');
        }
      }, { once: true });
    },
    tick: tick,
    slots: function () { return slots; },
    now: now,
    sync: function () { timeOffsetMs = 0; MZ.state.timeOffsetMs = 0; mountedKey = ''; MZ.state.forceIdent = false; tick(true); MZ.toast('Schedule re-synced to server clock', 'good'); },
    skip: function () {
      timeOffsetMs += ((loc && loc.remaining ? loc.remaining : 15) + 1) * 1000;
      MZ.state.timeOffsetMs = timeOffsetMs;
      mountedKey = ''; tick(true); MZ.toast('Operator skip → next item');
    },
    forceFallback: function () {
      MZ.state.forceIdent = true;
      forceIdentUntil = Date.now() + ((loc && loc.remaining ? loc.remaining : 30) * 1000);
      mountedKey = ''; tick(true); MZ.toast('Station ident forced for current item');
    },
    reload: function () { mountedKey = ''; tick(true); MZ.toast('Playlist reloaded'); },
    setPaused: function (v) {
      MZ.state.paused = !!v;
      if (!video) return;
      if (v) video.pause(); else tryPlay();
      MZ.emit('transport:paused', v);
    },
    togglePlay: function () { MZ.Playout.setPaused(!MZ.state.paused); return MZ.state.paused; },
    setVolume: function (v) {
      audio.volume = clamp(v, 0, 2);
      MZ.state.settings.ui.volume = audio.volume; MZ.saveSettings();
      applyAudio();
    },
    setMuted: function (v) {
      audio.muted = !!v; MZ.state.settings.ui.muted = audio.muted; MZ.saveSettings();
      applyAudio(); MZ.emit('audio:muted', audio.muted);
    },
    isMuted: function () { return audio.muted; },
    setGain: function (v) {
      const id = MZ.state.activeId;
      MZ.setOverride(id, { audio: { gain: clamp(v, 0, 2) } });
    },
    setPitch: function (v) {
      const id = MZ.state.activeId;
      MZ.setOverride(id, { audio: { pitch: clamp(v, 0.5, 2) } });
    },
    pip: async function () {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else if (video && video.requestPictureInPicture) await video.requestPictureInPicture();
        else MZ.toast('Picture-in-Picture not supported', 'bad');
      } catch (e) { MZ.toast('PiP failed: ' + e.message, 'bad'); }
    },
    current: function () { return { loc: loc, clip: clip, ch: ch, slots: slots }; },
  };
})();

/* ==========================================================================
   MZ.visuals — procedural 3D line-art / hologram canvas.
   Always alive: it is the animated ident behind the video and the full-screen
   fallback when a source is unreachable. No libraries, no external assets.
   ========================================================================== */
(function () {
  'use strict';
  const MZ = window.MZ = window.MZ || {};
  let ctx = null, canvas = null, raf = 0, t = 0, W = 0, H = 0, dpr = 1;
  let primary = '#12B981', accent = '#F2C766', intensity = 1, reduced = false;
  let particles = [], sphere = [], rings = [];

  function hexToRgb(h) {
    h = (h || '#12B981').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function resize() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(320, r.width); H = Math.max(180, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function build() {
    sphere = [];
    const lat = 14, lon = 26;
    for (let i = 0; i <= lat; i++) {
      const row = [];
      const phi = Math.PI * (i / lat - 0.5);
      for (let j = 0; j <= lon; j++) {
        const th = 2 * Math.PI * j / lon;
        row.push({ x: Math.cos(phi) * Math.cos(th), y: Math.sin(phi), z: Math.cos(phi) * Math.sin(th) });
      }
      sphere.push(row);
    }
    rings = [0, 1, 2].map(function (k) { return { r: 0.72 + k * 0.19, tilt: 0.25 + k * 0.42, speed: 0.18 + k * 0.11 }; });
    particles = [];
    const n = Math.round(70 * intensity);
    for (let i = 0; i < n; i++) particles.push({ x: Math.random(), y: Math.random(), z: Math.random(), s: Math.random() * 1.6 + 0.4 });
  }
  function project(p, scale, ox, oy) {
    const fov = 3.4, d = fov / (fov + p.z);
    return [ox + p.x * scale * d, oy + p.y * scale * d, d, p.z];
  }
  function rot(p, ax, ay) {
    const ca = Math.cos(ay), sa = Math.sin(ay), cb = Math.cos(ax), sb = Math.sin(ax);
    const x1 = p.x * ca - p.z * sa, z1 = p.x * sa + p.z * ca;
    return { x: x1, y: p.y * cb - z1 * sb, z: p.y * sb + z1 * cb };
  }
  function line(a, b, color, alpha, width) {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function draw() {
    if (!ctx) return;
    const [pr, pg, pb] = hexToRgb(primary), [ar, ag, ab] = hexToRgb(accent);
    const cP = 'rgb(' + pr + ',' + pg + ',' + pb + ')', cA = 'rgb(' + ar + ',' + ag + ',' + ab + ')';
    ctx.clearRect(0, 0, W, H);
    // deep radial background
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.48, 10, W * 0.5, H * 0.5, W * 0.72);
    bg.addColorStop(0, 'rgba(' + pr + ',' + pg + ',' + pb + ',0.16)');
    bg.addColorStop(0.55, 'rgba(2,14,9,0.55)');
    bg.addColorStop(1, 'rgba(0,4,3,0.96)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // perspective floor grid
    ctx.save();
    const horizon = H * 0.66;
    for (let i = 0; i < 16; i++) {
      const p = (i / 15 + (t * 0.012 % (1 / 15)));
      const y = horizon + (H - horizon) * p * p;
      line([0, y], [W, y], cP, 0.035 + p * 0.10, 1);
    }
    for (let i = -12; i <= 12; i++) {
      line([W / 2 + i * 18, horizon], [W / 2 + i * W * 0.13, H], cP, 0.055, 1);
    }
    ctx.restore();

    // rotating 3D wireframe globe (line-art animation)
    const scale = Math.min(W, H) * 0.32, ox = W * 0.5, oy = H * 0.47;
    const ay = t * 0.22 * intensity, ax = Math.sin(t * 0.13) * 0.34;
    for (let i = 0; i < sphere.length; i++) {
      const row = sphere[i];
      for (let j = 0; j < row.length - 1; j++) {
        const a = project(rot(row[j], ax, ay), scale, ox, oy);
        const b = project(rot(row[j + 1], ax, ay), scale, ox, oy);
        const alpha = (0.05 + Math.max(0, -a[3]) * 0.13) * intensity;
        line(a, b, (i % 4 === 0 ? cA : cP), alpha, i % 4 === 0 ? 1.2 : 0.8);
      }
    }
    for (let j = 0; j < sphere[0].length; j += 2) {
      for (let i = 0; i < sphere.length - 1; i++) {
        const a = project(rot(sphere[i][j], ax, ay), scale, ox, oy);
        const b = project(rot(sphere[i + 1][j], ax, ay), scale, ox, oy);
        line(a, b, cP, (0.03 + Math.max(0, -a[3]) * 0.07) * intensity, 0.7);
      }
    }
    // orbiting rings
    rings.forEach(function (r, k) {
      ctx.beginPath();
      const tilt = r.tilt + Math.sin(t * 0.2 + k) * 0.12;
      for (let a = 0; a <= 64; a++) {
        const th = a / 64 * Math.PI * 2 + t * r.speed;
        const p = { x: Math.cos(th) * r.r, y: Math.sin(th) * r.r * Math.sin(tilt), z: Math.sin(th) * r.r * Math.cos(tilt) };
        const q = project(rot(p, ax * 0.4, ay * 0.5), scale, ox, oy);
        if (a === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
      }
      ctx.strokeStyle = k === 1 ? cA : cP; ctx.globalAlpha = 0.22 * intensity; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.globalAlpha = 1;
    });
    // pulsing core + scan ring
    const pulse = 0.5 + Math.sin(t * 1.6) * 0.5;
    const core = ctx.createRadialGradient(ox, oy, 2, ox, oy, scale * (0.32 + pulse * 0.2));
    core.addColorStop(0, 'rgba(' + ar + ',' + ag + ',' + ab + ',0.34)');
    core.addColorStop(1, 'rgba(' + ar + ',' + ag + ',' + ab + ',0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(ox, oy, scale * 0.55, 0, Math.PI * 2); ctx.fill();
    // floating particles
    particles.forEach(function (p) {
      const y = ((p.y - t * 0.012 * p.s) % 1 + 1) % 1;
      const x = (p.x + Math.sin(t * 0.3 + p.z * 9) * 0.01) * W;
      ctx.globalAlpha = 0.12 + p.z * 0.4;
      ctx.fillStyle = p.z > 0.6 ? cA : cP;
      ctx.fillRect(x, y * H, p.s * 1.7, p.s * 1.7);
    });
    ctx.globalAlpha = 1;
    // horizontal data sweep
    const sy = (t * 34) % H;
    const sweep = ctx.createLinearGradient(0, sy - 22, 0, sy + 4);
    sweep.addColorStop(0, 'rgba(' + ar + ',' + ag + ',' + ab + ',0)');
    sweep.addColorStop(1, 'rgba(' + ar + ',' + ag + ',' + ab + ',0.10)');
    ctx.fillStyle = sweep; ctx.fillRect(0, sy - 22, W, 26);
  }
  function loop(ts) {
    t = ts / 1000;
    draw();
    if (reduced) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
  }
  MZ.Visuals = {
    start: function (el, opts) {
      canvas = el; ctx = el.getContext('2d');
      opts = opts || {};
      primary = opts.primary || primary; accent = opts.accent || accent;
      intensity = opts.intensity || 1;
      reduced = !!(opts.reduced || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
      resize(); build();
      window.removeEventListener('resize', resize); window.addEventListener('resize', resize);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    },
    setTheme: function (p, a) { primary = p || primary; accent = a || accent; if (reduced) draw(); },
    setIntensity: function (v) { intensity = Math.max(0.2, Math.min(2, v)); build(); if (reduced) draw(); },
    setReduced: function (v) { reduced = !!v; cancelAnimationFrame(raf); raf = reduced ? 0 : requestAnimationFrame(loop); draw(); },
    stop: function () { cancelAnimationFrame(raf); raf = 0; },
  };
})();

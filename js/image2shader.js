'use strict';

// ---------------------------------------------------------------------------
// Image -> Shader
//   1. Analyse an image locally (palette, colour layout, brightness, texture
//      direction/scale, bright particles).
//   2a. Build an offline "starter" shader from those measurements, or
//   2b. ask Claude (through the local server, /api/claude) to write one,
//       auto-fixing compile errors and optionally refining against a render.
// ---------------------------------------------------------------------------

(function () {
  const app = window.shaderApp;
  if (!app) return;

  const $ = (id) => document.getElementById(id);
  const el = {
    openBtn: $('imgShaderBtn'), dialog: $('imgShaderDialog'), close: $('i2sClose'),
    drop: $('i2sDrop'), file: $('i2sFile'), preview: $('i2sPreview'), dropHint: $('i2sDropHint'),
    analysis: $('i2sAnalysis'), notes: $('i2sNotes'),
    starterBtn: $('i2sStarter'), animateBtn: $('i2sAnimate'), claudeBtn: $('i2sClaude'), refineBtn: $('i2sRefine'),
    matchBtn: $('i2sMatch'), matches: $('i2sMatches'), matchList: $('i2sMatchList'), recolor: $('i2sRecolor'),
    autoFix: $('i2sAutoFix'), status: $('i2sStatus'), claudeInfo: $('i2sClaudeInfo'),
  };

  const state = {
    image: null,        // HTMLImageElement
    imageName: '',
    jpegB64: null,      // resized copy sent to Claude
    analysis: null,
    busy: false,
    lastFromClaude: false,
    claudeStatus: null,
  };

  // ---------------------------------------------------------------------------
  // Dialog
  // ---------------------------------------------------------------------------
  function open() {
    el.dialog.hidden = false;
    refreshClaudeStatus();
    updateButtons();
  }
  function close() { if (!state.busy) el.dialog.hidden = true; }
  el.openBtn.addEventListener('click', open);
  el.close.addEventListener('click', close);
  el.dialog.addEventListener('click', (e) => { if (e.target === el.dialog) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.dialog.hidden) close(); });

  function setStatus(html, kind = '') {
    el.status.className = `i2s-status ${kind}`;
    el.status.innerHTML = html;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function updateButtons() {
    const ready = !!state.analysis && !state.busy;
    const st = state.claudeStatus;
    const claudeOk = !!(st && st.sdk);
    el.starterBtn.disabled = !ready;
    el.animateBtn.disabled = !ready;
    el.matchBtn.disabled = !ready || !window.STYLE_LIBRARY;
    el.animateBtn.classList.toggle('primary', !document.body.classList.contains('ai-available'));
    el.claudeBtn.disabled = !ready || !claudeOk;
    el.refineBtn.disabled = !ready || !claudeOk || !state.lastFromClaude;
    el.file.disabled = state.busy;
  }

  // Claude is only offered by the local launcher's server (serve.py). On a static host such as
  // GitHub Pages there is no server, so the Claude controls stay hidden and everything else
  // runs entirely in the browser.
  const LOCAL_HOST = ['127.0.0.1', 'localhost'].includes(location.hostname);

  async function refreshClaudeStatus() {
    state.claudeStatus = null;
    if (LOCAL_HOST) {
      try {
        const r = await fetch('api/claude/status', { cache: 'no-store' });
        if (r.ok && (r.headers.get('Content-Type') || '').includes('json')) state.claudeStatus = await r.json();
      } catch (_) { /* no local server */ }
    }
    const st = state.claudeStatus;
    document.body.classList.toggle('ai-available', !!st);
    if (!st) {
      el.claudeInfo.innerHTML = '';
    } else if (!st.sdk) {
      el.claudeInfo.innerHTML = 'To use Claude, install the Anthropic Python SDK: <code>python -m pip install anthropic</code>, set your API key (see the README), then restart the launcher.';
    } else if (st.credentials === 'none') {
      el.claudeInfo.innerHTML = `Uses <b>${escapeHtml(st.model)}</b>. No API key found yet: set the <code>ANTHROPIC_API_KEY</code> environment variable (see the README) and restart the launcher. Each generation is billed to your Anthropic account.`;
    } else {
      el.claudeInfo.innerHTML = `Uses <b>${escapeHtml(st.model)}</b> with your Anthropic account, billed per use: roughly 10–60 cents per generation (an estimate; it depends on how much Claude writes).`;
    }
    updateButtons();
  }

  // ---------------------------------------------------------------------------
  // Loading an image
  // ---------------------------------------------------------------------------
  el.drop.addEventListener('click', () => { if (!state.busy) el.file.click(); });
  el.drop.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !state.busy) { e.preventDefault(); el.file.click(); } });
  el.file.addEventListener('change', () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ''; });
  el.drop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.drop.classList.add('drag'); });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('drag'));
  el.drop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    el.drop.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f && !state.busy) loadFile(f);
  });
  // While the dialog is open, an image dropped anywhere on the page goes into it
  window.addEventListener('drop', (e) => {
    if (el.dialog.hidden || state.busy) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  // Paste a screenshot straight from the clipboard while the dialog is open
  window.addEventListener('paste', (e) => {
    if (el.dialog.hidden || state.busy) return;
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadFile(item.getAsFile(), 'pasted-image'); }
  });

  async function loadFile(file, fallbackName) {
    if (!file || !file.type.startsWith('image/')) { setStatus('That file isn’t an image.', 'err'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch (_) { URL.revokeObjectURL(url); setStatus('Couldn’t read that image.', 'err'); return; }
    state.image = img;
    state.imageName = (file.name || fallbackName || 'image').replace(/\.[^.]+$/, '');
    state.lastFromClaude = false;
    el.preview.src = url;
    el.preview.hidden = false;
    el.dropHint.hidden = true;
    state.jpegB64 = toJpegBase64(img, 1568, 0.9);
    state.analysis = analyse(img);
    renderAnalysis(state.analysis);
    setStatus(`Analysed <b>${escapeHtml(state.imageName)}</b> (${img.naturalWidth}×${img.naturalHeight}).`);
    updateButtons();
  }

  function toJpegBase64(source, maxEdge, quality) {
    const w0 = source.naturalWidth || source.width, h0 = source.naturalHeight || source.height;
    const s = Math.min(1, maxEdge / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * s));
    c.height = Math.max(1, Math.round(h0 * s));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality).split(',')[1];
  }

  // ---------------------------------------------------------------------------
  // Analysis (all values are 0-1 display RGB, i.e. what the shader should output)
  // ---------------------------------------------------------------------------
  const LAYOUT_COLS = 6, LAYOUT_ROWS = 4;

  function analyse(img) {
    const W = 160;
    const w = img.naturalWidth >= img.naturalHeight ? W : Math.max(8, Math.round(W * img.naturalWidth / img.naturalHeight));
    const h = img.naturalWidth >= img.naturalHeight ? Math.max(8, Math.round(W * img.naturalHeight / img.naturalWidth)) : W;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;

    const rgb = new Float32Array(n * 3);
    const lum = new Float32Array(n);
    let lumSum = 0, satSum = 0;
    for (let i = 0; i < n; i++) {
      const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = l; lumSum += l;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satSum += mx > 0 ? (mx - mn) / mx : 0;
    }
    const meanLum = lumSum / n;
    let varSum = 0, dark = 0, bright = 0;
    for (let i = 0; i < n; i++) {
      varSum += (lum[i] - meanLum) ** 2;
      if (lum[i] < 0.15) dark++;
      if (lum[i] > 0.75) bright++;
    }
    const contrast = Math.sqrt(varSum / n);

    const palette = kMeansPalette(rgb, n, 6);
    // True highlight and shadow colours: averages of the brightest 3% and darkest 10% of pixels
    // (palette entries are cluster averages, which dilute vivid highlights)
    const order = Array.from(lum.keys()).sort((i, j) => lum[i] - lum[j]);
    const avgOf = (idx) => [0, 1, 2].map((c) => +(idx.reduce((sum, i) => sum + rgb[i * 3 + c], 0) / Math.max(1, idx.length)).toFixed(3));
    const shadow = avgOf(order.slice(0, Math.max(1, Math.floor(n * 0.1))));
    const highlight = avgOf(order.slice(Math.floor(n * 0.97)));
    const particles = findParticles(lum, rgb, w, h, meanLum, contrast);
    // Background layout leaves out particle pixels, so glints don't turn the background grey
    const layout = layoutGrid(rgb, w, h, particles.present ? particles.mask : null);
    const texture = textureStats(lum, w, h);
    delete particles.mask;

    return {
      size: [img.naturalWidth, img.naturalHeight],
      aspect: +(img.naturalWidth / img.naturalHeight).toFixed(3),
      palette,
      shadow,
      highlight,
      layout,                       // rows from top, columns from left
      brightness: +meanLum.toFixed(3),
      contrast: +contrast.toFixed(3),
      saturation: +(satSum / n).toFixed(3),
      darkShare: +(dark / n).toFixed(3),
      brightShare: +(bright / n).toFixed(3),
      ...texture,
      particles,
    };
  }

  function kMeansPalette(rgb, n, k) {
    // Sample, initialise from luminance quantiles, then a few Lloyd iterations
    const step = Math.max(1, Math.floor(n / 6000));
    const pts = [];
    for (let i = 0; i < n; i += step) pts.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
    const byLum = pts.slice().sort((a, b) => (a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722) - (b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722));
    let centers = [];
    for (let j = 0; j < k; j++) centers.push(byLum[Math.min(byLum.length - 1, Math.floor((j + 0.5) / k * byLum.length))].slice());
    const assign = new Int32Array(pts.length);
    for (let it = 0; it < 10; it++) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (let p = 0; p < pts.length; p++) {
        let best = 0, bd = Infinity;
        for (let j = 0; j < centers.length; j++) {
          const d = (pts[p][0] - centers[j][0]) ** 2 + (pts[p][1] - centers[j][1]) ** 2 + (pts[p][2] - centers[j][2]) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
        assign[p] = best;
        const s = sums[best]; s[0] += pts[p][0]; s[1] += pts[p][1]; s[2] += pts[p][2]; s[3]++;
      }
      centers = centers.map((c, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : c));
    }
    const counts = new Array(centers.length).fill(0);
    for (let p = 0; p < pts.length; p++) counts[assign[p]]++;
    // Merge near-duplicates, sort by share
    let pal = centers.map((c, j) => ({ rgb: c, share: counts[j] / pts.length })).filter((p) => p.share > 0.004);
    pal.sort((a, b) => b.share - a.share);
    const merged = [];
    for (const p of pal) {
      const m = merged.find((q) => Math.hypot(q.rgb[0] - p.rgb[0], q.rgb[1] - p.rgb[1], q.rgb[2] - p.rgb[2]) < 0.06);
      if (m) m.share += p.share; else merged.push({ rgb: p.rgb.slice(), share: p.share });
    }
    return merged.map((p) => ({ rgb: p.rgb.map((v) => +v.toFixed(3)), share: +p.share.toFixed(3) }));
  }

  function layoutGrid(rgb, w, h, mask) {
    const rows = [];
    for (let gy = 0; gy < LAYOUT_ROWS; gy++) {
      const row = [];
      for (let gx = 0; gx < LAYOUT_COLS; gx++) {
        const x0 = Math.floor(gx * w / LAYOUT_COLS), x1 = Math.floor((gx + 1) * w / LAYOUT_COLS);
        const y0 = Math.floor(gy * h / LAYOUT_ROWS), y1 = Math.floor((gy + 1) * h / LAYOUT_ROWS);
        let r = 0, g = 0, b = 0, c = 0, ra = 0, ga = 0, ba = 0, ca = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const j = y * w + x, i = j * 3;
          ra += rgb[i]; ga += rgb[i + 1]; ba += rgb[i + 2]; ca++;
          if (mask && mask[j]) continue;
          r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; c++;
        }
        // Cells that are almost all particle fall back to their plain average, darkened
        if (c < ca * 0.15) { r = ra * 0.35; g = ga * 0.35; b = ba * 0.35; c = ca; }
        row.push([+(r / c).toFixed(3), +(g / c).toFixed(3), +(b / c).toFixed(3)]);
      }
      rows.push(row);
    }
    return rows;
  }

  function blur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); s += src[y * w + xx]; c++; }
      tmp[y * w + x] = s / c;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); s += tmp[yy * w + x]; c++; }
      out[y * w + x] = s / c;
    }
    return out;
  }

  function textureStats(lum, w, h) {
    // Gradient energy + structure tensor (dominant direction and how strongly it dominates)
    let gSum = 0, jxx = 0, jyy = 0, jxy = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (lum[i + 1 - w] + 2 * lum[i + 1] + lum[i + 1 + w]) - (lum[i - 1 - w] + 2 * lum[i - 1] + lum[i - 1 + w]);
      const gy = (lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - w] + lum[i - w + 1]);
      gSum += Math.hypot(gx, gy);
      jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
    }
    const count = (w - 2) * (h - 2);
    const angleGrad = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
    const coherence = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / (jxx + jyy + 1e-9);
    // Features run perpendicular to the gradient; convert to screen angle with y up
    let featureAngle = -(angleGrad + Math.PI / 2);
    featureAngle = Math.atan2(Math.sin(featureAngle), Math.cos(featureAngle));

    // Fine vs coarse detail (band energies of a small blur pyramid)
    const b1 = blur(lum, w, h, 1), b3 = blur(lum, w, h, 3), b9 = blur(lum, w, h, 9);
    let fine = 0, mid = 0, coarse = 0;
    for (let i = 0; i < w * h; i++) {
      fine += Math.abs(lum[i] - b1[i]);
      mid += Math.abs(b1[i] - b3[i]);
      coarse += Math.abs(b3[i] - b9[i]);
    }
    const total = fine + mid + coarse + 1e-9;
    return {
      edgeDensity: +(gSum / count).toFixed(3),
      direction: +featureAngle.toFixed(3),           // radians, 0 = horizontal features
      directionStrength: +Math.min(1, coherence).toFixed(3),
      detail: { fine: +(fine / total).toFixed(3), medium: +(mid / total).toFixed(3), coarse: +(coarse / total).toFixed(3) },
    };
  }

  function findParticles(lum, rgb, w, h, meanLum, contrast) {
    // Bright, roughly round blobs (glints, bokeh, stars, lights)
    const thr = Math.max(0.55, meanLum + 1.3 * contrast);
    // Mask of particle-ish pixels (a looser threshold, grown by one pixel to catch soft edges)
    const loose = Math.max(0.4, meanLum + 0.6 * contrast);
    const mask = new Uint8Array(w * h);
    let pr = 0, pg = 0, pb = 0, pc = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (lum[i] < loose) continue;
      pr += rgb[i * 3]; pg += rgb[i * 3 + 1]; pb += rgb[i * 3 + 2]; pc++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) mask[yy * w + xx] = 1;
      }
    }
    const coverage = pc / (w * h);
    // Where the particles are: share of particle pixels in an 8x6 grid (rows from the top), normalised to the busiest cell
    const DG_C = 8, DG_R = 6;
    const grid = [];
    let gmax = 1e-6;
    for (let gy = 0; gy < DG_R; gy++) for (let gx = 0; gx < DG_C; gx++) {
      let m = 0, c = 0;
      for (let y = Math.floor(gy * h / DG_R); y < Math.floor((gy + 1) * h / DG_R); y++)
        for (let x = Math.floor(gx * w / DG_C); x < Math.floor((gx + 1) * w / DG_C); x++) { m += mask[y * w + x]; c++; }
      const v = c ? m / c : 0;
      grid.push(v); gmax = Math.max(gmax, v);
    }
    const densityGrid = grid.map((v) => +(v / gmax).toFixed(3));
    const color = pc ? [pr / pc, pg / pc, pb / pc].map((v) => +v.toFixed(3)) : [1, 1, 1];
    const seen = new Uint8Array(w * h);
    const blobs = [];
    const stack = [];
    let allBlobs = 0;
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || lum[i] < thr) continue;
      let area = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        const x = j % w, y = (j - x) / w;
        area++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const k of [j - 1, j + 1, j - w, j + w]) {
          if (k < 0 || k >= w * h || seen[k]) continue;
          if (Math.abs((k % w) - x) > 1) continue;
          if (lum[k] >= thr) { seen[k] = 1; stack.push(k); }
        }
      }
      if (area < 2 || area >= w * h * 0.05) { if (area >= 2) allBlobs++; continue; }
      allBlobs++;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const elongation = Math.max(bw, bh) / Math.min(bw, bh);
      const fill = area / (bw * bh);
      // Particles are disc-like: not tiny, not stretched, filling most of their box
      if (area >= 4 && elongation <= 1.8 && fill >= 0.55) blobs.push({ area, x: sx / area / w, y: sy / area / h });
    }
    const count = blobs.length;
    const meanArea = count ? blobs.reduce((s, b) => s + b.area, 0) / count : 0;
    const radius = Math.sqrt(meanArea / Math.PI) / h;    // in image-height units
    let cx = 0.5, cy = 0.5, spread = 0.5;
    if (count) {
      cx = blobs.reduce((s, b) => s + b.x, 0) / count;
      cy = blobs.reduce((s, b) => s + b.y, 0) / count;
      spread = Math.sqrt(blobs.reduce((s, b) => s + (b.x - cx) ** 2 + (b.y - cy) ** 2, 0) / count);
    }
    return {
      count,
      present: count >= 8 && count >= allBlobs * 0.45,   // mostly round blobs, not streaks
      roundShare: +(allBlobs ? count / allBlobs : 0).toFixed(2),
      coverage: +coverage.toFixed(3),     // share of the image covered by bright particles
      densityGrid,                        // 8x6, rows from the top, 0-1
      color,                              // their average colour
      mask,
      radius: +radius.toFixed(4),
      center: [+cx.toFixed(3), +(1 - cy).toFixed(3)],   // 0-1, y up
      spread: +spread.toFixed(3),
    };
  }

  // ---------------------------------------------------------------------------
  // Analysis display
  // ---------------------------------------------------------------------------
  const toCss = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
  const pct = (v) => `${Math.round(v * 100)}%`;
  function directionName(a, s) {
    if (s < 0.12) return 'no strong direction';
    const deg = ((a * 180 / Math.PI) % 180 + 180) % 180;
    const name = deg < 22.5 || deg >= 157.5 ? 'horizontal' : deg < 67.5 ? 'diagonal ↗' : deg < 112.5 ? 'vertical' : 'diagonal ↖';
    return `${name} (${s < 0.3 ? 'weak' : 'strong'})`;
  }
  function renderAnalysis(a) {
    const sw = a.palette.map((p) => `<span class="sw" style="background:${toCss(p.rgb)}" title="${toCss(p.rgb)} · ${pct(p.share)}"><i>${pct(p.share)}</i></span>`).join('');
    const grid = a.layout.map((row) => row.map((c) => `<span style="background:${toCss(c)}"></span>`).join('')).join('');
    const d = a.detail;
    const detailWord = d.fine > 0.45 ? 'fine, busy detail' : d.coarse > 0.45 ? 'large soft shapes' : 'medium-scale texture';
    el.analysis.innerHTML = `
      <div class="i2s-row"><span class="k">Palette</span><span class="palette">${sw}</span></div>
      <div class="i2s-row"><span class="k">Layout</span><span class="layout" style="grid-template-columns:repeat(${LAYOUT_COLS},1fr)">${grid}</span></div>
      <div class="i2s-chips">
        <span>Brightness ${pct(a.brightness)}</span>
        <span>Contrast ${pct(Math.min(1, a.contrast * 2.5))}</span>
        <span>Saturation ${pct(a.saturation)}</span>
        <span>Texture: ${detailWord}</span>
        <span>Direction: ${directionName(a.direction, a.directionStrength)}</span>
        <span>${a.particles.present ? `${a.particles.count} bright particles` : 'No particle field'}</span>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Offline starter shader
  // ---------------------------------------------------------------------------
  const f3 = (v) => `vec3(${v.map((x) => x.toFixed(3)).join(', ')})`;
  const fnum = (v, d = 3) => Number(v).toFixed(d);

  function starterShader(a, name) {
    const pal = a.palette.slice(0, 5);
    while (pal.length < 3) pal.push({ rgb: pal[0] ? pal[0].rgb : [0.5, 0.5, 0.5], share: 0 });
    const byLum = pal.slice().sort((p, q) => (p.rgb[0] * 0.2126 + p.rgb[1] * 0.7152 + p.rgb[2] * 0.0722) - (q.rgb[0] * 0.2126 + q.rgb[1] * 0.7152 + q.rgb[2] * 0.0722));
    const darkC = byLum[0].rgb, midC = byLum[Math.floor(byLum.length / 2)].rgb, lightC = byLum[byLum.length - 1].rgb;

    const layoutConsts = a.layout.flat().map(f3).join(',\n    ');
    const d = a.detail;
    const scale = 1.5 + 9.0 * d.fine + 4.0 * d.medium;                  // noise frequency
    const stretch = 1.0 + 3.0 * Math.min(1, a.directionStrength * 1.6); // anisotropy along features
    const contrastAmt = Math.min(1, a.contrast * 2.2);
    const p = a.particles;
    const sparkleRadius = Math.min(0.08, Math.max(0.006, p.radius * 1.4));
    const particleCells = Math.max(6, Math.min(40, 0.42 / sparkleRadius));

    return `// ${name} - starter shader generated from an image by Shader Render.
// Colour layout, palette, texture direction/scale${p.present ? ' and bright particles' : ''} were measured
// from the image. Tweak the sliders, then build on this by hand.

uniform vec3  darkColor;    // color ${darkC.map((v) => fnum(v)).join(' ')}
uniform vec3  midColor;     // color ${midC.map((v) => fnum(v)).join(' ')}
uniform vec3  lightColor;   // color ${lightC.map((v) => fnum(v)).join(' ')}
uniform float textureAmount;// 0 1 0.5
uniform float speed;        // 0 2 0.4
uniform float detailScale;  // 0.5 16 ${fnum(scale, 2)}
uniform float stretch;      // 1 6 ${fnum(stretch, 2)}
uniform float direction;    // -3.1416 3.1416 ${fnum(a.direction)}
uniform float contrast;     // 0 1.5 ${fnum(contrastAmt)}
uniform float warp;         // 0 1 0.35
uniform float ridges;       // 0 1 ${fnum(Math.min(1, Math.max(0, (a.edgeDensity - 0.08) * 4)))}
${p.present ? `uniform vec3  sparkleColor; // color ${p.color.map((v) => fnum(v)).join(' ')}
uniform float sparkle;      // 0 2 1
uniform float sparkleSize;  // 0.3 2 1
uniform float density;      // 0 1 ${fnum(Math.min(0.95, Math.max(0.25, p.coverage * 5.0)))}
` : ''}uniform float grain;        // 0 0.08 ${fnum(Math.min(0.04, d.fine * 0.05))}

// Average colours of a ${LAYOUT_COLS}x${LAYOUT_ROWS} grid over the image (rows from the top)
const vec3 LAYOUT[${LAYOUT_COLS * LAYOUT_ROWS}] = vec3[${LAYOUT_COLS * LAYOUT_ROWS}](
    ${layoutConsts}
);

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v / 0.96875;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Bilinear lookup into the layout grid; s is 0-1 screen position, y up
vec3 layoutAt(vec2 s) {
    vec2 g = clamp(vec2(s.x, 1.0 - s.y) * vec2(${LAYOUT_COLS}.0, ${LAYOUT_ROWS}.0) - 0.5, vec2(0.0), vec2(${LAYOUT_COLS - 1}.0, ${LAYOUT_ROWS - 1}.0));
    ivec2 i = min(ivec2(floor(g)), ivec2(${LAYOUT_COLS - 2}, ${LAYOUT_ROWS - 2}));
    vec2 f = g - vec2(i);
    vec3 a = LAYOUT[i.y * ${LAYOUT_COLS} + i.x];
    vec3 b = LAYOUT[i.y * ${LAYOUT_COLS} + i.x + 1];
    vec3 c = LAYOUT[(i.y + 1) * ${LAYOUT_COLS} + i.x];
    vec3 d = LAYOUT[(i.y + 1) * ${LAYOUT_COLS} + i.x + 1];
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
${p.present ? `
// Where the image's bright particles were (8x6 grid, rows from the top)
const float PDENSITY[48] = float[48](
    ${p.densityGrid.map((v) => fnum(v)).join(', ')}
);

float densityAt(vec2 s) {
    vec2 g = clamp(vec2(s.x, 1.0 - s.y) * vec2(8.0, 6.0) - 0.5, vec2(0.0), vec2(7.0, 5.0));
    ivec2 i = min(ivec2(floor(g)), ivec2(6, 4));
    vec2 f = g - vec2(i);
    float a = PDENSITY[i.y * 8 + i.x], b = PDENSITY[i.y * 8 + i.x + 1];
    float c = PDENSITY[(i.y + 1) * 8 + i.x], d = PDENSITY[(i.y + 1) * 8 + i.x + 1];
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Soft bright discs where the image's particles were
vec3 sparkles(vec2 uv, float t) {
    vec3 acc = vec3(0.0);
    float scale = ${fnum(particleCells, 1)};
    vec2 g = uv * scale + vec2(0.0, t * 0.05) * scale;
    vec2 cell = floor(g);
    float soft = max(0.12, 1.5 * scale / iResolution.y);
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec2 id = cell + vec2(x, y);
        vec2 h = hash22(id);
        vec2 c = id + 0.5 + (h - 0.5) * 0.8;
        float r = min(0.42 * sparkleSize * (0.6 + 0.6 * h.y), 1.0);
        float d = length(g - c);
        if (d > r) continue;
        vec2 wp = (c - vec2(0.0, t * 0.05) * scale) / scale;
        vec2 sp = vec2(wp.x * iResolution.y / iResolution.x + 0.5, wp.y + 0.5);   // back to 0-1 screen
        float near = densityAt(sp);
        if (hash12(id * 1.7) > density * near * 1.3) continue;
        float tw = 0.55 + 0.45 * sin(t * (0.8 + 1.5 * h.x) + h.y * 6.283);
        float rim = smoothstep(r * 0.6, r - soft * 0.5, d) * 0.35;
        acc += smoothstep(r, r - soft, d) * (0.75 + rim) * tw * (0.6 + 0.6 * h.x) * (0.5 + 0.9 * near);
    }
    return acc * sparkleColor * 1.3;
}
` : ''}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    vec2 s = fragCoord / iResolution.xy;
    float t = iTime * speed;

    // Gently flowing lookup into the image's colour layout
    vec2 flow = vec2(fbm(uv * 1.3 + vec2(t * 0.11, 0.0)), fbm(uv * 1.3 + vec2(5.2, -t * 0.09))) - 0.5;
    vec3 base = layoutAt(s + flow * 0.12 * warp);

    // Texture at the measured scale, stretched along the measured direction
    vec2 q = rot(-direction) * uv;
    q.x /= stretch;
    float n = fbm(q * detailScale + flow * 2.0 * warp + vec2(t * 0.07, t * 0.03));
    vec3 tone = n < 0.5 ? mix(darkColor, midColor, n * 2.0) : mix(midColor, lightColor, n * 2.0 - 1.0);

    // The layout carries the image's colours; the texture modulates it and nudges it towards the palette
    vec3 col = base * (1.0 + (n - 0.5) * contrast * 1.2);
    col = mix(col, tone * (0.6 + 0.8 * dot(base, vec3(0.33))), textureAmount * 0.35);
    col = mix(base, col, textureAmount * 2.0 > 1.0 ? 1.0 : textureAmount * 2.0);

    // Thin bright lines along the texture's contours, for veiny or streaky images
    float n2 = fbm(q * detailScale * 0.9 + flow * 3.0 * warp - vec2(t * 0.05, 0.0) + 9.0);
    float ridge = pow(1.0 - abs(2.0 * n2 - 1.0), 6.0);
    col = mix(col * (1.0 - 0.35 * ridges), col + lightColor * ridge * 0.9, ridges);
${p.present ? '    col += sparkles(uv, t) * sparkle;\n' : ''}
    // Colours below 0.8 stay as measured; anything brighter rolls off softly towards white
    vec3 over = max(col - 0.8, 0.0);
    col = min(col, vec3(0.8)) + 0.2 * (1.0 - exp(-over * 5.0));
    col +=(hash12(fragCoord + fract(iTime * 7.31) * 913.0) - 0.5) * grain;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
  }

  // ---------------------------------------------------------------------------
  // Loading a generated shader into the editor
  // ---------------------------------------------------------------------------
  function slug(s) { return String(s || 'shader').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'shader'; }

  function applyShader(code, name) {
    if (app.state.modified && !confirm('Replace the current shader with the generated one? Unsaved edits will be lost.')) return null;
    app.loadProject({ code }, `${slug(name)}.glsl`);
    return app.compileErrors();
  }

  el.starterBtn.addEventListener('click', () => {
    if (!state.analysis) return;
    const name = `${state.imageName} procedural`;
    const errors = applyShader(starterShader(state.analysis, name), name);
    if (errors === null) return;
    state.lastFromClaude = false;
    setStatus(errors ? `Shader loaded, but it has errors:<br><code>${escapeHtml(errors)}</code>` : '✓ Procedural shader loaded. It recreates the image’s colours, layout and texture from scratch; adjust it with the sliders under Shader parameters.', errors ? 'err' : 'ok');
    updateButtons();
  });

  // ---------------------------------------------------------------------------
  // "Match a style": CLIP (a small image model, run in the browser) compares the
  // image with each style in js/style-library.js; the chosen example shader is
  // then recoloured with the image's palette. Free and private: nothing leaves
  // the browser. Model files come from the Hugging Face hub and are cached.
  // ---------------------------------------------------------------------------
  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
  let clipPromise = null;

  function loadClip(onProgress) {
    if (!clipPromise) {
      clipPromise = (async () => {
        const T = await import(TRANSFORMERS_URL);
        T.env.allowLocalModels = false;
        const files = {};
        const progress_callback = (p) => {
          if (p.status !== 'progress' || !p.total) return;
          files[p.file] = [p.loaded, p.total];
          const loaded = Object.values(files).reduce((s, f) => s + f[0], 0);
          const total = Object.values(files).reduce((s, f) => s + f[1], 0);
          onProgress(loaded, total);
        };
        const model = window.STYLE_LIBRARY.model;
        const processor = await T.AutoProcessor.from_pretrained(model, { progress_callback });
        const vision = await T.CLIPVisionModelWithProjection.from_pretrained(model, { dtype: 'q8', progress_callback });
        return { T, processor, vision };
      })().catch((e) => { clipPromise = null; throw e; });
    }
    return clipPromise;
  }

  async function imageEmbedding(clip, source) {
    const c = document.createElement('canvas');
    const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    const s = Math.min(1, 512 / Math.max(w, h));
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    const inputs = await clip.processor(clip.T.RawImage.fromCanvas(c));
    const { image_embeds } = await clip.vision(inputs);
    const v = Array.from(image_embeds.data);
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }

  function rankStyles(embedding) {
    const examples = window.SHADER_EXAMPLES;
    const styles = window.STYLE_LIBRARY.styles.filter((s) => examples.some((e) => e.file === s.file));
    const sims = styles.map((s) => s.embedding.reduce((a, x, i) => a + x * embedding[i], 0));
    const exps = sims.map((v) => Math.exp(100 * v));        // CLIP's usual logit scale
    const total = exps.reduce((a, b) => a + b, 0);
    return styles.map((s, i) => ({ file: s.file, p: exps[i] / total, example: examples.find((e) => e.file === s.file) }))
      .sort((a, b) => b.p - a.p);
  }

  el.matchBtn.addEventListener('click', async () => {
    if (!state.analysis || state.busy) return;
    state.busy = true;
    updateButtons();
    el.matches.hidden = true;
    setStatus('<span class="spinner"></span>Loading the style model…', 'busy');
    try {
      const clip = await loadClip((loaded, total) => {
        setStatus(`<span class="spinner"></span>Downloading the style model (first time only, cached afterwards)… ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`, 'busy');
      });
      setStatus('<span class="spinner"></span>Comparing the image with the style library…', 'busy');
      const ranked = rankStyles(await imageEmbedding(clip, state.image));
      showMatches(ranked.slice(0, 3));
      setStatus(`Closest match: <b>${escapeHtml(ranked[0].example.name)}</b> (${Math.round(ranked[0].p * 100)}%). Pick a style below to load it.`);
    } catch (e) {
      console.error(e);
      setStatus(`Couldn’t run the style model: ${escapeHtml(e.message || String(e))}`, 'err');
    } finally {
      state.busy = false;
      updateButtons();
    }
  });

  function showMatches(list) {
    el.matchList.innerHTML = '';
    for (const m of list) {
      const b = document.createElement('button');
      b.className = 'i2s-match';
      b.innerHTML = `<span class="name">${escapeHtml(m.example.name)}</span><span class="meter"><i style="width:${Math.max(2, Math.round(m.p * 100))}%"></i></span><span class="pct">${(m.p * 100).toFixed(1)}% match</span>`;
      b.addEventListener('click', () => loadStyle(m.example));
      el.matchList.appendChild(b);
    }
    el.matches.hidden = false;
  }

  // Colour uniforms annotated "// color r g b" in a shader's source
  function colorUniforms(src) {
    return [...src.matchAll(/^[ \t]*uniform\s+vec3\s+(\w+)\s*;\s*\/\/\s*colou?r\s+([-\d.\s]+)/gmi)].map((m) => {
      const def = m[2].trim().split(/\s+/).map(Number).slice(0, 3);
      return { name: m[1], def, lum: 0.2126 * def[0] + 0.7152 * def[1] + 0.0722 * def[2] };
    });
  }

  const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  // n image colours spread from darkest to brightest (from the main palette entries)
  // Boosts saturation while keeping the brightest channel (shaders brighten and wash out light colours)
  function vivid(c, amount = 1.8) {
    const mx = Math.max(...c);
    return c.map((v) => +Math.max(0, mx - (mx - v) * amount).toFixed(3));
  }

  // n colours from the image, darkest to brightest. The dark end is the image's real shadow colour.
  // forSliders: the bright end is the brightest palette colour, made more vivid (for colour
  // sliders that the shader brightens); otherwise it's the real highlight colour (for the grade).
  function paletteRamp(n, { forSliders = false } = {}) {
    const a = state.analysis;
    const byLum = a.palette.slice(0, Math.max(n, 5)).map((p) => p.rgb).sort((x, y) => lumOf(x) - lumOf(y));
    const top = forSliders ? vivid(byLum[byLum.length - 1]) : a.highlight;
    const mids = byLum.filter((c) => lumOf(c) > lumOf(a.shadow) + 0.02 && lumOf(c) < lumOf(top) - 0.02 && c !== byLum[byLum.length - 1]);
    const pal = [a.shadow, ...mids, top].sort((x, y) => lumOf(x) - lumOf(y));
    if (n === 1) return [pal[pal.length - 1]];
    return Array.from({ length: n }, (_, i) => pal[Math.round(i * (pal.length - 1) / (n - 1))]);
  }

  // For shaders without colour sliders: wrap the Image pass so its tones are mapped onto the image's palette
  function withPaletteGrade(code) {
    if (!/\bvoid\s+mainImage\s*\(/.test(code)) return null;
    const [dark, mid, light] = paletteRamp(3);
    const f = (c) => c.map((v) => fnum(v)).join(' ');
    return code.replace(/\bvoid\s+mainImage\s*\(/, 'void styleSourceImage(') + `

// ---- Added by Image -> Shader: maps this shader's tones onto the source image's palette
uniform float paletteMatch;  // 0 1 0.65
uniform vec3  paletteDark;   // color ${f(dark)}
uniform vec3  paletteMid;    // color ${f(mid)}
uniform vec3  paletteLight;  // color ${f(light)}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
    styleSourceImage(c, fragCoord);
    float l = clamp(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    vec3 g = l < 0.5 ? mix(paletteDark, paletteMid, l * 2.0) : mix(paletteMid, paletteLight, l * 2.0 - 1.0);
    fragColor = vec4(mix(c.rgb, g, paletteMatch), c.a);
}
`;
  }

  function loadStyle(example) {
    if (app.state.modified && !confirm(`Replace the current shader with “${example.name}”? Unsaved edits will be lost.`)) return;
    const recolor = el.recolor.checked;
    const spec = JSON.parse(JSON.stringify(example.code ? { code: example.code } : { common: example.common ?? null, passes: example.passes }));
    const allSrc = spec.code || [spec.common || '', ...Object.values(spec.passes).map((p) => p.code)].join('\n');
    const colors = colorUniforms(allSrc);
    let how = '';

    if (recolor && !colors.length) {
      const target = spec.code != null ? 'code' : 'image';
      const graded = withPaletteGrade(target === 'code' ? spec.code : spec.passes.image.code);
      if (graded) {
        if (target === 'code') spec.code = graded; else spec.passes.image.code = graded;
        how = ' A palette-match grade maps its colours onto the image’s (see the paletteMatch slider).';
      }
    }
    const isProject = !spec.code;
    app.loadProject(spec, `${slug(example.name)}-${slug(state.imageName)}.${isProject ? 'shader.json' : 'glsl'}`);

    if (recolor && colors.length) {
      // Darkest slider gets the darkest image colour, brightest gets the brightest
      const byLum = colors.slice().sort((a, b) => a.lum - b.lum);
      const ramp = paletteRamp(byLum.length, { forSliders: true });
      const values = {};
      byLum.forEach((c, i) => { values[c.name] = ramp[i].slice(); });
      app.setParamValues(values);
      how = ` Its colours (${byLum.map((c) => c.name).join(', ')}) now come from the image; use Reset in Shader parameters for the originals.`;
    }
    const errors = app.compileErrors();
    state.lastFromClaude = false;
    setStatus(errors ? `Loaded, but it has errors:<br><code>${escapeHtml(errors)}</code>` : `✓ Loaded <b>${escapeHtml(example.name)}</b>.${how}`, errors ? 'err' : 'ok');
    updateButtons();
  }

  // ---------------------------------------------------------------------------
  // "Animate this image": the image itself goes into iChannel0 and the shader
  // brings it to life. Closest match to the source, no AI needed.
  // ---------------------------------------------------------------------------
  function animatedShader(a, name) {
    const byLum = a.palette.slice().sort((p, q) => (q.rgb[0] * 0.2126 + q.rgb[1] * 0.7152 + q.rgb[2] * 0.0722) - (p.rgb[0] * 0.2126 + p.rgb[1] * 0.7152 + p.rgb[2] * 0.0722));
    const glowC = (a.particles.present ? a.particles.color : (byLum[0] || { rgb: [1, 1, 1] }).rgb);
    // Highlights: roughly the brightest ~15% of the image
    const highlight = Math.min(0.9, Math.max(0.35, a.brightness + 1.1 * a.contrast));
    return `// ${name} - the image itself, brought to life. Made by Shader Render's Image -> Shader (no AI).
// The image is loaded into iChannel0. Images aren't saved with the project, so after reopening,
// drop the image on the iChannel0 slot again (filter: Mipmap, wrap: Clamp).

uniform float speed;       // 0 2 0.5
uniform float flow;        // 0 1 0.35
uniform float flowScale;   // 0.5 8 2.5
uniform float shimmer;     // 0 2 ${a.particles.present ? '0.8' : '0.5'}
uniform float highlight;   // 0.2 1 ${fnum(highlight)}
uniform float glow;        // 0 1 ${a.particles.present ? '0.2' : '0.12'}
uniform vec3  glowColor;   // color ${glowC.map((v) => fnum(v)).join(' ')}
uniform float lightSweep;  // 0 1 0.2
uniform float breathe;     // 0 0.1 0.03
uniform float vignette;    // 0 1 0.15

const float IMAGE_ASPECT = ${fnum(a.aspect, 4)};

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v / 0.9375;
}

// Fill the frame with the image (like CSS object-fit: cover), zoomed in by 'zoom'
vec2 coverUV(vec2 fragCoord, float zoom) {
    vec2 s = fragCoord / iResolution.xy - 0.5;
    float screenAspect = iResolution.x / iResolution.y;
    if (screenAspect > IMAGE_ASPECT) s.y *= IMAGE_ASPECT / screenAspect;
    else s.x *= screenAspect / IMAGE_ASPECT;
    return s / zoom + 0.5;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * speed;

    // Slow push in and out; a little extra zoom keeps warped edges inside the image
    float zoom = 1.03 + breathe * (1.0 + sin(t * 0.3));
    vec2 uv = coverUV(fragCoord, zoom);

    // Gentle flowing distortion, like heat haze or moving water
    vec2 w = vec2(fbm(p * flowScale + vec2(t * 0.2, 0.0)), fbm(p * flowScale + vec2(3.1, -t * 0.17))) - 0.5;
    uv += w * 0.025 * flow;

    vec3 col = texture(iChannel0, uv).rgb;

    // Highlights twinkle
    float hl = smoothstep(highlight, highlight + 0.15, luma(col));
    float tw = noise(p * 45.0 + vec2(t * 1.6, -t * 1.1));
    col *= 1.0 + hl * shimmer * (tw - 0.5) * 0.8;    // brightens some highlights, dims others

    // Soft glow around bright areas (a blurrier mip level of the image), pulsing slowly
    vec3 blurred = texture(iChannel0, uv, 4.5).rgb;
    float bloom = smoothstep(highlight, 1.0, luma(blurred));
    col += glowColor * bloom * glow * (0.75 + 0.25 * sin(t * 0.8));

    // A soft band of light sweeping across now and then
    float band = dot(p, normalize(vec2(1.0, 0.35))) - (mod(t * 0.12, 3.0) - 1.5);
    col += col * exp(-band * band * 16.0) * lightSweep;

    col *= 1.0 - vignette * dot(p, p);
    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
  }

  el.animateBtn.addEventListener('click', () => {
    if (!state.analysis || !state.image) return;
    const name = `${state.imageName} animated`;
    if (app.state.modified && !confirm('Replace the current shader with the generated one? Unsaved edits will be lost.')) return;
    app.loadProject({ code: animatedShader(state.analysis, name) }, `${slug(name)}.glsl`);
    app.setImageChannel(0, state.image, state.imageName, el.preview.src);
    const errors = app.compileErrors();
    state.lastFromClaude = false;
    setStatus(errors
      ? `Shader loaded, but it has errors:<br><code>${escapeHtml(errors)}</code>`
      : '✓ Your image is in iChannel0 and the shader animates it. Try the flow, shimmer, glow and lightSweep sliders. <span class="muted">Note: images aren’t saved with projects, so re-add it to iChannel0 after reopening. For sharp 4K exports, use an image at least 3840 px wide.</span>', errors ? 'err' : 'ok');
    updateButtons();
  });

  // ---------------------------------------------------------------------------
  // Claude
  // ---------------------------------------------------------------------------
  let timer = null;
  function startBusy(label) {
    state.busy = true;
    updateButtons();
    const t0 = performance.now();
    const tick = () => {
      const s = Math.round((performance.now() - t0) / 1000);
      setStatus(`<span class="spinner"></span>${label} <span class="muted">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`, 'busy');
    };
    tick();
    timer = setInterval(tick, 1000);
  }
  function stopBusy() {
    clearInterval(timer);
    state.busy = false;
    updateButtons();
  }

  async function callClaude(body) {
    const r = await fetch('api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch (_) { /* non-JSON error page */ }
    if (!r.ok || !data || data.error) throw new Error((data && data.error) || `Server error ${r.status}`);
    return data;
  }

  function usageText(u, model) {
    if (!u) return '';
    return `${model ? `${escapeHtml(model)} · ` : ''}${(u.input_tokens || 0).toLocaleString()} in / ${(u.output_tokens || 0).toLocaleString()} out tokens`;
  }

  // Loads a Claude result; if it doesn't compile, sends the errors back (up to 2 times)
  async function loadWithAutoFix(result, notes, { replace }) {
    let current = result;
    let errors = replace ? applyShader(current.code, current.name) : (app.replaceImageCode(current.code), app.compileErrors());
    if (errors === null) return { cancelled: true };
    const usage = [usageText(current.usage, current.model)];
    for (let attempt = 1; errors && el.autoFix.checked && attempt <= 2; attempt++) {
      startBusy(`Fixing compile errors (attempt ${attempt} of 2)…`);
      try {
        const fixed = await callClaude({ mode: 'fix', code: current.code, errors, notes });
        current = { ...current, code: fixed.code };
        usage.push(usageText(fixed.usage, fixed.model));
      } finally {
        stopBusy();
      }
      app.replaceImageCode(current.code);
      errors = app.compileErrors();
    }
    return { current, errors, usage };
  }

  el.claudeBtn.addEventListener('click', async () => {
    if (!state.analysis || state.busy) return;
    const notes = el.notes.value.trim();
    startBusy('Claude is studying the image and writing a shader… (usually 1–3 minutes)');
    let result;
    try {
      result = await callClaude({ mode: 'generate', image: state.jpegB64, analysis: state.analysis, notes });
    } catch (e) {
      stopBusy();
      setStatus(escapeHtml(e.message), 'err');
      return;
    }
    stopBusy();
    try {
      const out = await loadWithAutoFix(result, notes, { replace: true });
      if (out.cancelled) { setStatus('Generated, but not loaded (kept your current shader).'); return; }
      state.lastFromClaude = !out.errors;
      setStatus(out.errors
        ? `“${escapeHtml(result.name)}” still has compile errors; it's in the editor so you can fix it by hand:<br><code>${escapeHtml(out.errors)}</code>`
        : `✓ <b>${escapeHtml(result.name)}</b> loaded. ${escapeHtml(result.summary)}<br><span class="muted">${out.usage.join(' · ')}</span>`, out.errors ? 'err' : 'ok');
    } catch (e) {
      setStatus(escapeHtml(e.message), 'err');
    }
    updateButtons();
  });

  el.refineBtn.addEventListener('click', async () => {
    if (!state.analysis || state.busy) return;
    const notes = el.notes.value.trim();
    const time = app.state.time;
    startBusy('Rendering the current shader and comparing it with the image…');
    let result;
    try {
      const aspect = state.analysis.aspect;
      const h = 720, w = Math.max(64, Math.round(h * Math.min(3, Math.max(0.33, aspect)) / 2) * 2);
      const blob = await ShaderExport.renderStill({
        project: app.exportProject(), custom: app.currentParamValues(), width: w, height: h,
        fps: 60, time, supersample: 1, mouse: app.state.mouse, dateBase: app.state.dateBase,
      });
      const img = await createImageBitmap(blob);
      const render = toJpegBase64(img, 1280, 0.9);
      result = await callClaude({ mode: 'refine', image: state.jpegB64, render, code: app.imageCode(), time, notes });
    } catch (e) {
      stopBusy();
      setStatus(escapeHtml(e.message), 'err');
      return;
    }
    stopBusy();
    try {
      const out = await loadWithAutoFix(result, notes, { replace: false });
      setStatus(out.errors
        ? `The refined version has compile errors; it's in the editor (use Ctrl+Z to go back):<br><code>${escapeHtml(out.errors)}</code>`
        : `✓ Refined. ${escapeHtml(result.summary)} <span class="muted">Ctrl+Z in the editor undoes it.</span><br><span class="muted">${out.usage.join(' · ')}</span>`, out.errors ? 'err' : 'ok');
    } catch (e) {
      setStatus(escapeHtml(e.message), 'err');
    }
    updateButtons();
  });

  // For testing from the console
  window.imageToShader = { analyse, starterShader, animatedShader, loadClip, imageEmbedding, rankStyles, loadStyle, state };
})();

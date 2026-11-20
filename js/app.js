'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const STORE_PROJECT = 'shader-render:project';
  const STORE_SRC = 'shader-render:source';          // legacy single-shader storage
  const STORE_NAME = 'shader-render:filename';
  const STORE_CHANNELS = 'shader-render:channels';    // legacy
  const STORE_SETTINGS = 'shader-render:settings';
  const STORE_PARAMS = 'shader-render:params';
  const STORE_SPLIT = 'shader-render:editor-width';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage unavailable */ } },
  };

  const el = {
    editor: $('editor'), log: $('log'), fileName: $('fileName'), modeBadge: $('modeBadge'),
    tabs: $('tabs'), addTab: $('addTab'),
    exampleSelect: $('exampleSelect'), openBtn: $('openBtn'), saveBtn: $('saveBtn'), fileInput: $('fileInput'),
    autoCompile: $('autoCompile'), compileBtn: $('compileBtn'), banner: $('banner'),
    previewBox: $('previewBox'), canvas: $('preview'), hud: $('hud'), exportOverlay: $('exportOverlay'),
    playBtn: $('playBtn'), iconPlay: $('iconPlay'), iconPause: $('iconPause'), restartBtn: $('restartBtn'),
    scrub: $('scrub'), timeLabel: $('timeLabel'), loopRange: $('loopRange'), previewScale: $('previewScale'),
    channels: $('channels'), channelsTitle: $('channelsTitle'), channelsNote: $('channelsNote'),
    resSelect: $('resSelect'), fpsSelect: $('fpsSelect'), startInput: $('startInput'), durationInput: $('durationInput'),
    codecSelect: $('codecSelect'), qualitySelect: $('qualitySelect'), bitrateInput: $('bitrateInput'), ssSelect: $('ssSelect'),
    toDiskRow: $('toDiskRow'), toDisk: $('toDisk'), exportSummary: $('exportSummary'),
    exportBtn: $('exportBtn'), pngBtn: $('pngBtn'), cancelBtn: $('cancelBtn'),
    progress: $('progress'), progressFill: $('progressFill'), progressText: $('progressText'), exportMsg: $('exportMsg'),
    dropHint: $('dropHint'),
  };

  const state = {
    playing: true,
    time: 0,
    frame: 0,
    lastTs: null,
    dirty: true,
    fps: 0,
    mouse: { x: 0, y: 0, cx: 0, cy: 0, down: false },
    exporting: false,
    control: null,
    modified: false,
    dateBase: new Date(),
    codecSupport: {},
  };

  // -------------------------------------------------------------------------
  // Banner for missing browser features
  // -------------------------------------------------------------------------
  const problems = [];
  if (!('VideoEncoder' in window)) problems.push('video export needs WebCodecs (use a current Chrome, Edge, Firefox or Safari)');
  if (!window.Mp4Muxer) problems.push('the MP4 muxer library failed to load (check your internet connection)');
  function showBanner(msg) { el.banner.textContent = msg; el.banner.hidden = false; }
  if (problems.length) showBanner(`Heads up: ${problems.join('; ')}.`);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // -------------------------------------------------------------------------
  // Passes / tabs model
  // -------------------------------------------------------------------------
  const TAB_ORDER = ['image', 'common', ...BUFFER_IDS];
  const TAB_LABEL = { image: 'Image', common: 'Common', A: 'Buffer A', B: 'Buffer B', C: 'Buffer C', D: 'Buffer D' };
  const DEFAULT_COMMON = `// Common: this code is added to the top of every Shadertoy-style pass.
// Put shared functions, constants and #defines here.

`;
  const defaultBufferCode = (id) => `// Buffer ${id}: renders into a texture every frame, before the Image pass.
// Read it from any pass by setting an input channel to "Buffer ${id}".
// When a buffer reads itself it gets its previous frame (feedback).
// Buffers keep alpha and use float precision, so they can store data.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 prev = texture(iChannel0, uv);          // iChannel0 = Buffer ${id} (itself)
    vec3 color = 0.5 + 0.5 * cos(iTime + uv.xyx * 4.0 + vec3(0.0, 2.0, 4.0));
    fragColor = mix(prev, vec4(color, 1.0), 0.03);
}
`;

  /** id -> { id, doc: CodeMirror.Doc, channels: [ch x4] | null, errors: [], marks: [], mode } */
  const tabs = new Map();
  let activeTab = 'image';
  const activePass = () => (activeTab === 'common' ? 'image' : activeTab);

  // -------------------------------------------------------------------------
  // Preview renderer
  // -------------------------------------------------------------------------
  let renderer;
  try {
    renderer = new ShaderRenderer(el.canvas);
  } catch (e) {
    showBanner(e.message);
    return;
  }

  el.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showBanner('The preview GPU context was lost. It will recover automatically.'); });
  el.canvas.addEventListener('webglcontextrestored', () => {
    renderer = new ShaderRenderer(el.canvas);
    for (const [id, t] of tabs) if (t.channels) t.channels.forEach((c, i) => renderer.setChannel(id, i, c));
    el.banner.hidden = true;
    compile();
  });

  // -------------------------------------------------------------------------
  // Channel sources
  // -------------------------------------------------------------------------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const noiseCache = {};
  function getNoise(kind, size = 256) {
    if (noiseCache[kind]) return noiseCache[kind];
    const gray = kind === 'gray';
    const rnd = mulberry32(gray ? 7 : 1337);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const v = (rnd() * 256) | 0;
      data[i * 4] = v;
      data[i * 4 + 1] = gray ? v : (rnd() * 256) | 0;
      data[i * 4 + 2] = gray ? v : (rnd() * 256) | 0;
      data[i * 4 + 3] = 255;
    }
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const s = (y * size + x) * 4, d = (y * 64 + x) * 4;
      img.data.set(data.subarray(s, s + 4), d);
    }
    ctx.putImageData(img, 0, 0);
    return (noiseCache[kind] = { data, width: size, height: size, thumb: c.toDataURL() });
  }

  function noiseChannel(kind, opts = {}) {
    const n = getNoise(kind);
    return {
      kind, name: kind === 'gray' ? 'Gray noise' : 'RGBA noise',
      data: n.data, width: n.width, height: n.height, thumb: n.thumb,
      filter: opts.filter || 'mipmap', wrap: opts.wrap || 'repeat', flip: false,
    };
  }
  function bufferChannel(id, opts = {}) {
    return {
      kind: 'buffer', buffer: id, name: `Buffer ${id}`,
      filter: opts.filter && opts.filter !== 'mipmap' ? opts.filter : 'linear',
      wrap: opts.wrap || 'clamp', flip: false,
    };
  }
  /** Builds a channel from a saved/example spec ({ kind, buffer?, filter?, wrap? } or legacy { preset }). */
  function channelFromSpec(spec) {
    if (!spec) return null;
    const kind = spec.kind || spec.preset;
    if (kind === 'noise' || kind === 'gray') return noiseChannel(kind, spec);
    if (kind === 'buffer' && BUFFER_IDS.includes(spec.buffer)) return bufferChannel(spec.buffer, spec);
    return null; // images can't be restored from storage
  }
  function channelToSpec(ch) {
    if (!ch || ch.kind === 'image') return null;
    return ch.kind === 'buffer' ? { kind: 'buffer', buffer: ch.buffer, filter: ch.filter, wrap: ch.wrap }
      : { kind: ch.kind, filter: ch.filter, wrap: ch.wrap };
  }

  // -------------------------------------------------------------------------
  // Editor
  // -------------------------------------------------------------------------
  const examples = window.SHADER_EXAMPLES;
  examples.forEach((ex, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = ex.name;
    el.exampleSelect.appendChild(o);
  });

  const cm = CodeMirror(el.editor, {
    value: '',
    mode: 'x-shader/x-fragment',
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    gutters: ['CodeMirror-linenumbers'],
    extraKeys: {
      'Ctrl-Enter': () => compile(),
      'Cmd-Enter': () => compile(),
      'Ctrl-S': () => saveProject(),
      'Cmd-S': () => saveProject(),
      Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
      'Shift-Tab': (c) => c.indentSelection('subtract'),
    },
  });

  let fileName = 'untitled.glsl';
  function setFileName(name) {
    fileName = name || 'untitled.glsl';
    el.fileName.textContent = fileName;
  }
  function setModified(v) {
    state.modified = v;
    el.fileName.classList.toggle('modified', v);
  }

  let compileTimer = null;
  let persistTimer = null;
  let ignoreChange = false;
  cm.on('change', () => {
    schedulePersist();
    if (ignoreChange) return;
    setModified(true);
    if (el.autoCompile.checked) {
      clearTimeout(compileTimer);
      compileTimer = setTimeout(compile, 450);
    }
  });

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------
  function createTab(id, code, channelSpecs) {
    const doc = CodeMirror.Doc(code, 'x-shader/x-fragment');
    const tab = { id, doc, channels: null, errors: [], marks: [], mode: '' };
    if (id !== 'common') {
      tab.channels = [0, 1, 2, 3].map((i) => channelFromSpec(channelSpecs && channelSpecs[i]));
      tab.channels.forEach((ch, i) => renderer.setChannel(id, i, ch));
    }
    tabs.set(id, tab);
    return tab;
  }

  function disposeTab(id) {
    const t = tabs.get(id);
    if (!t) return;
    if (t.channels) t.channels.forEach((ch) => ch && ch.objectUrl && URL.revokeObjectURL(ch.objectUrl));
    if (id !== 'common') renderer.removePass(id);
    tabs.delete(id);
  }

  function switchTab(id) {
    if (!tabs.has(id)) id = 'image';
    activeTab = id;
    cm.swapDoc(tabs.get(id).doc);
    renderTabs();
    syncSlots();
    updateModeBadge();
    buildBuiltins();
    schedulePersist();
    cm.focus();
  }

  function addTab(id) {
    if (tabs.has(id)) { switchTab(id); return; }
    if (id === 'common') createTab('common', DEFAULT_COMMON);
    else createTab(id, defaultBufferCode(id), [{ kind: 'buffer', buffer: id }]);
    setModified(true);
    compile();
    switchTab(id);
  }

  function removeTab(id) {
    if (id === 'image' || !tabs.has(id)) return;
    if (!confirm(`Remove the ${TAB_LABEL[id]} tab? Its code will be deleted.`)) return;
    disposeTab(id);
    // Channels that read a removed buffer now read nothing
    for (const [pid, t] of tabs) {
      if (!t.channels) continue;
      t.channels.forEach((ch, i) => { if (ch && ch.kind === 'buffer' && ch.buffer === id) setChannelFor(pid, i, null); });
    }
    setModified(true);
    if (activeTab === id) switchTab('image');
    compile();
  }

  function renderTabs() {
    el.tabs.innerHTML = '';
    for (const id of TAB_ORDER) {
      const t = tabs.get(id);
      if (!t) continue;
      const b = document.createElement('button');
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === activeTab));
      b.dataset.tab = id;
      const hasErr = t.errors.some((e) => e.type !== 'WARNING');
      b.title = hasErr ? `${TAB_LABEL[id]} has errors` : TAB_LABEL[id];
      b.innerHTML = `${hasErr ? '<span class="dot" aria-label="has errors"></span>' : ''}<span>${TAB_LABEL[id]}</span>` +
        (id !== 'image' ? `<span class="close" data-close="${id}" role="button" aria-label="Remove ${TAB_LABEL[id]}" title="Remove tab">✕</span>` : '');
      el.tabs.appendChild(b);
    }
    // "+ Add" menu lists the tabs that don't exist yet
    el.addTab.innerHTML = '<option value="">+ Add buffer / Common</option>';
    for (const id of TAB_ORDER) {
      if (id === 'image' || tabs.has(id)) continue;
      const o = document.createElement('option');
      o.value = id;
      o.textContent = id === 'common' ? 'Common (shared code)' : TAB_LABEL[id];
      el.addTab.appendChild(o);
    }
    el.addTab.hidden = el.addTab.options.length <= 1;
    el.addTab.value = '';
  }

  el.tabs.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); removeTab(close.dataset.close); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) switchTab(tab.dataset.tab);
  });
  el.addTab.addEventListener('change', () => { if (el.addTab.value) addTab(el.addTab.value); });

  function updateModeBadge() {
    const t = tabs.get(activeTab);
    el.modeBadge.textContent = activeTab === 'common' ? 'Shared code' : (t && t.mode) || '—';
  }

  // -------------------------------------------------------------------------
  // Compile
  // -------------------------------------------------------------------------
  function clearMarks(t) {
    t.marks.forEach((h) => {
      t.doc.removeLineClass(h, 'background', 'cm-error-line');
      t.doc.removeLineClass(h, 'gutter', 'cm-error-gutter');
    });
    t.marks = [];
  }

  function compile() {
    clearTimeout(compileTimer);
    renderer.setCommon(tabs.has('common') ? tabs.get('common').doc.getValue() : '');
    for (const t of tabs.values()) { clearMarks(t); t.errors = []; t.mode = ''; }

    let allOk = true;
    const seen = new Set();
    for (const id of [...BUFFER_IDS, 'image']) {
      const t = tabs.get(id);
      if (!t) continue;
      const res = renderer.compilePass(id, t.doc.getValue());
      t.mode = res.mode;
      if (res.ok) continue;
      allOk = false;
      for (const e of res.errors) {
        const target = tabs.get(e.tab) || t;
        const key = `${target.id}|${e.line}|${e.msg}`;
        if (seen.has(key)) continue; // Common errors are reported by every pass
        seen.add(key);
        target.errors.push(e);
      }
    }

    // Mark error lines and build the log
    const parts = [];
    for (const id of TAB_ORDER) {
      const t = tabs.get(id);
      if (!t || !t.errors.length) continue;
      const lineCount = t.doc.lineCount();
      for (const e of t.errors) {
        const ln = e.line && e.line <= lineCount ? e.line : null;
        if (ln) {
          const h = t.doc.getLineHandle(ln - 1);
          t.doc.addLineClass(h, 'background', 'cm-error-line');
          t.doc.addLineClass(h, 'gutter', 'cm-error-gutter');
          t.marks.push(h);
        }
        const cls = e.type === 'WARNING' ? 'err warn' : 'err';
        const tag = tabs.size > 1 ? `<span class="tabtag">${TAB_LABEL[id]}</span>` : '';
        parts.push(`<span class="${cls}" data-tab="${id}" data-line="${ln || ''}">${tag}${ln ? `<span class="ln">line ${ln}:</span> ` : ''}${escapeHtml(e.msg)}</span>`);
      }
    }
    if (allOk) {
      el.log.className = 'log';
      const passNames = [...BUFFER_IDS, 'image'].filter((id) => tabs.has(id)).map((id) => TAB_LABEL[id]);
      const img = tabs.get('image');
      el.log.textContent = tabs.size > 1
        ? `✓ Compiled ${passNames.join(', ')}${tabs.has('common') ? ' (with Common)' : ''} · buffers ${renderer.bufferFormat.name}`
        : `✓ Compiled (${img.mode})`;
      state.frame = 0;
      renderer.resetBuffers();
    } else {
      el.log.className = 'log has-errors';
      el.log.innerHTML = parts.join('');
    }
    buildParams();
    renderTabs();
    updateModeBadge();
    state.dirty = true;
    return allOk;
  }

  el.log.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    if (t.dataset.tab !== activeTab) switchTab(t.dataset.tab);
    if (!t.dataset.line) return;
    const line = Number(t.dataset.line) - 1;
    cm.focus();
    cm.setCursor({ line, ch: 0 });
    cm.scrollIntoView({ line, ch: 0 }, 80);
  });

  // -------------------------------------------------------------------------
  // Shader parameters
  //   Custom uniforms get live controls (shared by every pass). Optional annotations:
  //     uniform float speed;  // 0 5 1        -> min max default
  //     uniform int   count;  // 1 20 6
  //     uniform vec3  tint;   // color 1 .5 .2
  //     uniform vec2  offset; // -1 1 0 0     -> min max x y
  //     uniform bool  invert; // true
  // -------------------------------------------------------------------------
  const paramsEl = {
    custom: $('paramsCustom'), builtin: $('paramsBuiltin'), builtinWrap: $('paramsBuiltinWrap'),
    hint: $('paramsHint'), reset: $('paramsReset'), count: $('builtinCount'),
  };
  let paramValues = {};
  try { paramValues = JSON.parse(store.get(STORE_PARAMS) || '{}') || {}; } catch (_) { paramValues = {}; }
  let builtinCells = [];

  const COLOR_NAME = /(colou?r|tint|albedo|rgb|^col\d*$)/i;
  const AXES = ['x', 'y', 'z', 'w'];
  const BUILTIN_ORDER = [...BUILTIN_UNIFORMS];

  function saveParams() { store.set(STORE_PARAMS, JSON.stringify(paramValues)); }
  function fmtNum(v, digits = 3) { return String(+Number(v).toFixed(digits)); }
  function currentParamValues() { return JSON.parse(JSON.stringify(renderer.custom || {})); }

  function parseAnnotations(src) {
    const out = {};
    const re = /^[ \t]*uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*(?:\[\s*\d+\s*\])?\s*;[ \t]*(?:\/\/(.*))?$/gm;
    let m;
    while ((m = re.exec(src))) {
      if (out[m[2]]) continue;
      const comment = (m[3] || '').trim();
      out[m[2]] = {
        type: m[1],
        comment,
        nums: (comment.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number),
        color: /\bcolou?r\b/i.test(comment),
      };
    }
    return out;
  }

  function specFor(typeName, size, name, ann) {
    if (size > 1) return null; // arrays aren't editable
    const a = ann || { nums: [], comment: '', color: false };
    const n = a.nums;
    if (typeName === 'float' || typeName === 'int' || typeName === 'uint') {
      const isInt = typeName !== 'float';
      let min = 0, max = isInt ? 10 : 1, def = isInt ? 1 : 0.5;
      if (n.length >= 2) { [min, max] = n; def = n.length >= 3 ? n[2] : (isInt ? Math.round((min + max) / 2) : (min + max) / 2); }
      else if (n.length === 1) { def = n[0]; min = Math.min(0, def); max = Math.max(isInt ? 10 : 1, Math.abs(def) * 2); }
      if (typeName === 'uint') min = Math.max(0, min);
      if (max <= min) max = min + 1;
      return { kind: 'slider', comps: 1, min, max, step: isInt ? 1 : (max - min) / 1000, def: [def], isInt };
    }
    if (typeName === 'bool') return { kind: 'bool', def: [/\btrue\b|^1$/i.test(a.comment) ? 1 : 0] };
    const vm = typeName.match(/^vec([234])$/);
    if (vm) {
      const comps = Number(vm[1]);
      if (comps >= 3 && (a.color || (!n.length && COLOR_NAME.test(name)))) {
        const def = [1, 1, 1, 1].slice(0, comps);
        n.slice(0, comps).forEach((v, i) => { def[i] = Math.min(1, Math.max(0, v)); });
        return { kind: 'color', comps, def };
      }
      let min = 0, max = 1;
      let def = new Array(comps).fill(0.5);
      if (n.length >= 2) {
        [min, max] = n;
        if (max <= min) max = min + 1;
        const rest = n.slice(2);
        def = Array.from({ length: comps }, (_, i) => (rest.length ? rest[Math.min(i, rest.length - 1)] : (min + max) / 2));
      }
      return { kind: 'slider', comps, min, max, step: (max - min) / 1000, def };
    }
    return null;
  }

  const toHex = (v) => '#' + v.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
  const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);

  function buildControl(p, spec, value) {
    const row = document.createElement('div');
    row.className = 'param';
    const title = p.ann && p.ann.comment ? ` title="${escapeHtml(p.ann.comment)}"` : '';
    row.innerHTML = `<div class="param-name"${title}><b>${escapeHtml(p.name)}</b><span>${p.typeName}</span></div><div class="param-controls"></div>`;
    const box = row.querySelector('.param-controls');
    const commit = () => {
      renderer.custom[p.name] = value;
      paramValues[p.name] = { type: p.typeName, value: value.slice() };
      saveParams();
      state.dirty = true;
    };
    const line = () => { const d = document.createElement('div'); d.className = 'param-row'; box.appendChild(d); return d; };

    if (spec.kind === 'bool') {
      const r = line();
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!value[0];
      cb.setAttribute('aria-label', p.name);
      cb.addEventListener('change', () => { value[0] = cb.checked ? 1 : 0; commit(); });
      r.appendChild(cb);
      return row;
    }

    if (spec.kind === 'color') {
      const r = line();
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = toHex(value);
      picker.setAttribute('aria-label', p.name);
      const hex = document.createElement('span');
      hex.className = 'hex';
      const showHex = () => { hex.textContent = `${picker.value}  (${value.slice(0, 3).map((c) => c.toFixed(2)).join(', ')})`; };
      showHex();
      picker.addEventListener('input', () => {
        fromHex(picker.value).forEach((c, i) => { value[i] = c; });
        showHex();
        commit();
      });
      r.append(picker, hex);
      if (spec.comps === 4) addSlider(3, 'a', 0, 1, 0.001, false);
      return row;
    }

    for (let i = 0; i < spec.comps; i++) addSlider(i, spec.comps > 1 ? AXES[i] : '', spec.min, spec.max, spec.step, spec.isInt);
    return row;

    function addSlider(i, axis, min, max, step, isInt) {
      const r = line();
      if (axis) { const ax = document.createElement('span'); ax.className = 'axis'; ax.textContent = axis; r.appendChild(ax); }
      const range = document.createElement('input');
      range.type = 'range';
      Object.assign(range, { min, max, step });
      range.value = value[i];
      range.setAttribute('aria-label', `${p.name}${axis ? '.' + axis : ''}`);
      const num = document.createElement('input');
      num.type = 'number';
      num.step = isInt ? '1' : 'any';
      num.value = fmtNum(value[i], 4);
      range.addEventListener('input', () => {
        value[i] = isInt ? Math.round(Number(range.value)) : Number(range.value);
        num.value = fmtNum(value[i], 4);
        commit();
      });
      num.addEventListener('input', () => {
        if (num.value === '' || !isFinite(Number(num.value))) return;
        value[i] = isInt ? Math.round(Number(num.value)) : Number(num.value);
        range.value = value[i];
        commit();
      });
      r.append(range, num);
    }
  }

  function buildParams() {
    const allSource = [...tabs.values()].map((t) => t.doc.getValue()).join('\n');
    const ann = parseAnnotations(allSource);
    const custom = new Map();
    for (const id of renderer.passIds()) {
      for (const [name, u] of renderer.uniformsOf(id)) {
        if (BUILTIN_UNIFORMS.has(name) || custom.has(name)) continue;
        custom.set(name, { name, typeName: glslTypeName(u.type), size: u.size, ann: ann[name] });
      }
    }

    const newCustom = {};
    paramsEl.custom.innerHTML = '';
    for (const p of custom.values()) {
      const spec = specFor(p.typeName, p.size, p.name, p.ann);
      if (!spec) {
        const row = document.createElement('div');
        row.className = 'param';
        row.innerHTML = `<div class="param-name"><b>${escapeHtml(p.name)}</b><span>${p.typeName}${p.size > 1 ? `[${p.size}]` : ''}</span></div>` +
          '<div class="param-note">Not editable here (left at zero)</div>';
        paramsEl.custom.appendChild(row);
        continue;
      }
      const saved = paramValues[p.name];
      const value = saved && saved.type === p.typeName && Array.isArray(saved.value) && saved.value.length === spec.def.length
        ? saved.value.slice() : spec.def.slice();
      newCustom[p.name] = value;
      paramsEl.custom.appendChild(buildControl(p, spec, value));
    }
    renderer.custom = newCustom;

    const used = new Set();
    for (const id of renderer.passIds()) for (const name of renderer.uniformsOf(id).keys()) used.add(name);
    const unused = Object.keys(ann).filter((n) => !used.has(n) && !BUILTIN_UNIFORMS.has(n));
    if (!custom.size) {
      const d = document.createElement('div');
      d.className = 'params-empty';
      d.innerHTML = 'No custom uniforms in this shader. Declare one to get a control here, e.g. ' +
        '<code>uniform float speed; // 0 5 1</code> (min, max, default) or <code>uniform vec3 tint; // color 1 .5 .2</code>.';
      paramsEl.custom.appendChild(d);
    }
    if (unused.length) {
      const d = document.createElement('div');
      d.className = 'param-note';
      d.textContent = `Declared but not used, so the compiler removed: ${unused.join(', ')}`;
      paramsEl.custom.appendChild(d);
    }
    paramsEl.reset.hidden = !Object.keys(newCustom).length;
    buildBuiltins();
    paramsEl.hint.textContent = `${custom.size} custom · ${builtinCells.length} built-in`;
  }

  /** Built-in inputs of the selected pass, with live values. */
  function buildBuiltins() {
    const pid = activePass();
    const builtins = [];
    for (const [name, u] of renderer.uniformsOf(pid)) {
      if (BUILTIN_UNIFORMS.has(name)) builtins.push({ name, typeName: glslTypeName(u.type), size: u.size });
    }
    builtins.sort((a, b) => BUILTIN_ORDER.indexOf(a.name) - BUILTIN_ORDER.indexOf(b.name));
    paramsEl.builtin.innerHTML = '';
    builtinCells = [];
    if (!builtins.length) {
      paramsEl.builtin.innerHTML = `<span class="none">The ${TAB_LABEL[pid]} pass doesn’t use any built-in inputs.</span>`;
    }
    for (const b of builtins) {
      const t = document.createElement('span'); t.className = 't'; t.textContent = b.typeName + (b.size > 1 ? `[${b.size}]` : '');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = b.name;
      const v = document.createElement('span'); v.className = 'v';
      paramsEl.builtin.append(t, n, v);
      builtinCells.push({ ...b, cell: v });
    }
    paramsEl.count.textContent = tabs.size > 1 ? `· ${TAB_LABEL[pid]} pass (${builtins.length})` : (builtins.length ? `(${builtins.length})` : '');
    updateBuiltins();
  }

  function describeBuiltin(b, pid) {
    const ch = b.name.match(/^(?:iChannel|u_tex|u_texture)(\d)$/);
    if (ch) {
      const t = tabs.get(pid);
      const c = t && t.channels && t.channels[Number(ch[1])];
      if (!c) return 'empty (black)';
      return c.kind === 'buffer' ? `${c.name} (${renderer.bufferFormat.name})` : `${c.name} · ${c.width}×${c.height}`;
    }
    const v = renderer.lastValuesOf(pid).get(b.name);
    if (!v) return '–';
    switch (b.name) {
      case 'iResolution': case 'u_resolution': case 'resolution':
        return `${v[0]} × ${v[1]}`;
      case 'iChannelResolution': {
        const parts = [];
        for (let i = 0; i < 4; i++) parts.push(v[i * 3] ? `${v[i * 3]}×${v[i * 3 + 1]}` : '–');
        return parts.join('  ');
      }
      case 'iDate': {
        const s = v[3];
        const hh = String(Math.floor(s / 3600)).padStart(2, '0');
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const ss = (s % 60).toFixed(1).padStart(4, '0');
        return `${v[0]}-${String(v[1] + 1).padStart(2, '0')}-${String(v[2]).padStart(2, '0')} ${hh}:${mm}:${ss}`;
      }
      case 'iChannelTime':
        return `${fmtNum(v[0], 2)} (×4)`;
      default: {
        const isInt = /^(int|uint|bool)/.test(b.typeName);
        const comps = { float: 1, vec2: 2, vec3: 3, vec4: 4 }[b.typeName] || v.length;
        return v.slice(0, comps).map((x) => (isInt ? String(Math.round(x)) : Number(x).toFixed(b.name.includes('ime') ? 3 : 2))).join(', ');
      }
    }
  }

  function updateBuiltins() {
    if (!builtinCells.length || !paramsEl.builtinWrap.open) return;
    const pid = activePass();
    for (const b of builtinCells) {
      const text = describeBuiltin(b, pid);
      if (b.cell.textContent !== text) b.cell.textContent = text;
    }
  }

  paramsEl.reset.addEventListener('click', () => {
    Object.keys(renderer.custom).forEach((n) => { delete paramValues[n]; });
    saveParams();
    buildParams();
    state.dirty = true;
  });

  // -------------------------------------------------------------------------
  // Channel slots (show the selected pass's iChannel0–3)
  // -------------------------------------------------------------------------
  const slotEls = [];
  for (let i = 0; i < 4; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'channel';
    wrap.innerHTML = `
      <div class="thumb" tabindex="0" role="button" aria-label="Load image into iChannel${i}">
        <span class="empty">+ image</span>
        <span class="buf" hidden></span>
        <span class="label">iChannel${i}</span>
        <button class="clear" title="Clear channel" hidden>✕</button>
      </div>
      <select class="ch-source" aria-label="iChannel${i} source"></select>
      <div class="ch-opts">
        <select class="ch-filter" title="Filtering"><option value="mipmap">Mipmap</option><option value="linear">Linear</option><option value="nearest">Nearest</option></select>
        <select class="ch-wrap" title="Wrap"><option value="repeat">Repeat</option><option value="clamp">Clamp</option></select>
        <label class="check"><input type="checkbox" class="ch-flip" checked> Flip Y</label>
      </div>
      <input type="file" accept="image/*" hidden>`;
    el.channels.appendChild(wrap);
    const s = {
      root: wrap,
      thumb: wrap.querySelector('.thumb'),
      empty: wrap.querySelector('.empty'),
      buf: wrap.querySelector('.buf'),
      clear: wrap.querySelector('.clear'),
      source: wrap.querySelector('.ch-source'),
      filter: wrap.querySelector('.ch-filter'),
      wrapSel: wrap.querySelector('.ch-wrap'),
      flip: wrap.querySelector('.ch-flip'),
      flipLabel: wrap.querySelector('.ch-opts .check'),
      file: wrap.querySelector('input[type=file]'),
    };
    slotEls.push(s);

    s.thumb.addEventListener('click', (e) => { if (e.target !== s.clear) s.file.click(); });
    s.thumb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.file.click(); } });
    s.clear.addEventListener('click', (e) => { e.stopPropagation(); setChannelFor(activePass(), i, null); });
    s.file.addEventListener('change', () => { if (s.file.files[0]) loadChannelImage(activePass(), i, s.file.files[0]); s.file.value = ''; });
    s.source.addEventListener('change', () => {
      const v = s.source.value;
      const pid = activePass();
      if (v === 'none') setChannelFor(pid, i, null);
      else if (v === 'image') { s.file.click(); syncSlot(i); }
      else if (v.startsWith('buffer:')) setChannelFor(pid, i, bufferChannel(v.slice(7)));
      else setChannelFor(pid, i, noiseChannel(v));
    });
    const applyOpts = () => {
      const pid = activePass();
      const ch = tabs.get(pid).channels[i];
      if (!ch) return;
      ch.filter = s.filter.value; ch.wrap = s.wrapSel.value; ch.flip = s.flip.checked;
      setChannelFor(pid, i, ch);
    };
    s.filter.addEventListener('change', applyOpts);
    s.wrapSel.addEventListener('change', applyOpts);
    s.flip.addEventListener('change', applyOpts);

    s.thumb.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); s.thumb.classList.add('drag'); });
    s.thumb.addEventListener('dragleave', () => s.thumb.classList.remove('drag'));
    s.thumb.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      s.thumb.classList.remove('drag');
      el.dropHint.hidden = true;
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) loadChannelImage(activePass(), i, f);
    });
  }

  function syncSlot(i) {
    const s = slotEls[i];
    const t = tabs.get(activePass());
    const ch = t && t.channels ? t.channels[i] : null;

    // Source options: built-ins plus whichever buffers exist
    const opts = [['none', 'None'], ['noise', 'Noise RGBA'], ['gray', 'Noise gray'], ['image', 'Image…']];
    for (const id of BUFFER_IDS) if (tabs.has(id)) opts.push([`buffer:${id}`, `Buffer ${id}${id === activePass() ? ' (itself)' : ''}`]);
    s.source.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    s.source.value = !ch ? 'none' : ch.kind === 'buffer' ? `buffer:${ch.buffer}` : ch.kind;

    const isBuf = !!ch && ch.kind === 'buffer';
    s.thumb.classList.toggle('filled', !!ch);
    s.thumb.style.backgroundImage = ch && !isBuf ? `url("${ch.thumb}")` : '';
    s.thumb.style.imageRendering = ch && ch.kind !== 'image' ? 'pixelated' : '';
    s.empty.hidden = !!ch;
    s.buf.hidden = !isBuf;
    if (isBuf) s.buf.innerHTML = `${ch.buffer}<small>buffer</small>`;
    s.clear.hidden = !ch;
    if (ch) { s.filter.value = ch.filter; s.wrapSel.value = ch.wrap; s.flip.checked = ch.flip; }
    s.filter.querySelector('option[value="mipmap"]').disabled = isBuf;
    s.flipLabel.hidden = isBuf;
    s.thumb.title = !ch ? `Load an image into iChannel${i}` : isBuf ? `${ch.name} (live)` : `${ch.name} (${ch.width}×${ch.height})`;
  }

  function syncSlots() {
    const isCommon = activeTab === 'common';
    el.channels.hidden = isCommon;
    el.channelsNote.hidden = !isCommon;
    el.channelsTitle.textContent = isCommon ? 'Input channels' : `Input channels · ${TAB_LABEL[activePass()]}`;
    if (!isCommon) for (let i = 0; i < 4; i++) syncSlot(i);
  }

  function setChannelFor(pid, i, ch) {
    const t = tabs.get(pid);
    if (!t || !t.channels) return;
    const old = t.channels[i];
    if (old && old.objectUrl && (!ch || ch.objectUrl !== old.objectUrl)) URL.revokeObjectURL(old.objectUrl);
    t.channels[i] = ch;
    renderer.setChannel(pid, i, ch);
    if (pid === activePass() && activeTab !== 'common') syncSlot(i);
    state.dirty = true;
    schedulePersist();
  }

  async function loadChannelImage(pid, i, file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (_) {
      URL.revokeObjectURL(url);
      el.exportMsg.className = 'msg err';
      el.exportMsg.textContent = `Couldn't read ${file.name} as an image.`;
      return;
    }
    setChannelFor(pid, i, {
      kind: 'image', name: file.name, source: img, width: img.naturalWidth, height: img.naturalHeight,
      thumb: url, objectUrl: url, filter: 'mipmap', wrap: 'repeat', flip: true,
    });
  }

  // -------------------------------------------------------------------------
  // Project: load, persist, export snapshot
  // -------------------------------------------------------------------------
  /** Normalises an example / saved project / file into { common, passes: { id: { code, channels } } }. */
  function normalizeProject(spec) {
    if (!spec) return null;
    if (typeof spec.code === 'string') return { common: null, passes: { image: { code: spec.code, channels: spec.channels || [] } } };
    if (!spec.passes || !spec.passes.image || typeof spec.passes.image.code !== 'string') return null;
    const passes = {};
    for (const id of ['image', ...BUFFER_IDS]) {
      const p = spec.passes[id];
      if (p && typeof p.code === 'string') passes[id] = { code: p.code, channels: Array.isArray(p.channels) ? p.channels : [] };
    }
    return { common: typeof spec.common === 'string' ? spec.common : null, passes };
  }

  function loadProject(spec, name, { active } = {}) {
    const proj = normalizeProject(spec);
    if (!proj) throw new Error('Not a valid shader project.');
    for (const id of [...tabs.keys()]) disposeTab(id);
    createTab('image', proj.passes.image.code, proj.passes.image.channels);
    if (proj.common != null) createTab('common', proj.common);
    for (const id of BUFFER_IDS) if (proj.passes[id]) createTab(id, proj.passes[id].code, proj.passes[id].channels);
    activeTab = tabs.has(active) ? active : 'image';
    cm.swapDoc(tabs.get(activeTab).doc);
    setFileName(name);
    setModified(false);
    state.frame = 0;
    renderTabs();
    syncSlots();
    compile();
    schedulePersist();
  }

  function projectData() {
    const data = { format: 'shader-render-project', version: 2, name: fileName, active: activeTab, common: null, passes: {} };
    if (tabs.has('common')) data.common = tabs.get('common').doc.getValue();
    for (const id of ['image', ...BUFFER_IDS]) {
      const t = tabs.get(id);
      if (t) data.passes[id] = { code: t.doc.getValue(), channels: t.channels.map(channelToSpec) };
    }
    return data;
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => store.set(STORE_PROJECT, JSON.stringify(projectData())), 300);
  }

  /** Snapshot used by the exporter (live channel objects, including images). */
  function exportProject() {
    return {
      common: tabs.has('common') ? tabs.get('common').doc.getValue() : '',
      passes: [...BUFFER_IDS, 'image'].filter((id) => tabs.has(id)).map((id) => ({
        id, code: tabs.get(id).doc.getValue(), channels: tabs.get(id).channels.slice(),
      })),
    };
  }
  const isMultiPass = () => tabs.size > 1;

  // -------------------------------------------------------------------------
  // Export settings
  // -------------------------------------------------------------------------
  const CODEC_EFFICIENCY = { avc: 1, hevc: 0.6, vp9: 0.65, av1: 0.5 };

  function readSettings() {
    const [width, height] = el.resSelect.value.split('x').map(Number);
    const fps = Number(el.fpsSelect.value);
    const start = Math.max(0, Number(el.startInput.value) || 0);
    const duration = Math.max(0.1, Number(el.durationInput.value) || 1);
    return {
      width, height, fps, start, duration,
      codec: el.codecSelect.value,
      bitrate: Math.round(Math.max(1, Number(el.bitrateInput.value) || 1) * 1e6),
      supersample: Number(el.ssSelect.value),
      toDisk: el.toDisk.checked && !el.toDiskRow.hidden,
    };
  }

  function autoBitrate() {
    const s = readSettings();
    const bpp = Number(el.qualitySelect.value) * CODEC_EFFICIENCY[s.codec];
    const mbps = Math.min(400, Math.max(2, Math.round((s.width * s.height * s.fps * bpp) / 1e6)));
    el.bitrateInput.value = mbps;
  }

  function persistSettings() {
    store.set(STORE_SETTINGS, JSON.stringify({
      res: el.resSelect.value, fps: el.fpsSelect.value, start: el.startInput.value, duration: el.durationInput.value,
      codec: el.codecSelect.value, quality: el.qualitySelect.value, bitrate: el.bitrateInput.value,
      ss: el.ssSelect.value, toDisk: el.toDisk.checked, scale: el.previewScale.value, loop: el.loopRange.checked,
    }));
  }

  function restoreSettings() {
    let s;
    try { s = JSON.parse(store.get(STORE_SETTINGS) || 'null'); } catch (_) { s = null; }
    if (!s) { autoBitrate(); return; }
    const setIf = (sel, v) => { if (v != null && [...sel.options].some((o) => o.value === String(v))) sel.value = String(v); };
    setIf(el.resSelect, s.res); setIf(el.fpsSelect, s.fps); setIf(el.codecSelect, s.codec);
    setIf(el.qualitySelect, s.quality); setIf(el.ssSelect, s.ss); setIf(el.previewScale, s.scale);
    if (s.start != null) el.startInput.value = s.start;
    if (s.duration != null) el.durationInput.value = s.duration;
    if (s.bitrate != null) el.bitrateInput.value = s.bitrate;
    if (s.toDisk != null) el.toDisk.checked = s.toDisk;
    if (s.loop != null) el.loopRange.checked = s.loop;
  }

  function fmtBytes(b) {
    if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
    if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(b / 1e3))} KB`;
  }
  function fmtTime(sec) {
    if (!isFinite(sec)) return '–';
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  // Above this estimated size, exports are written straight to a user-chosen file
  const LARGE_EXPORT_BYTES = 1.5e9;
  function mustStreamToDisk(s) {
    return !s.toDisk && !!window.showSaveFilePicker && (s.bitrate * s.duration) / 8 > LARGE_EXPORT_BYTES;
  }

  function updateSummary() {
    const s = readSettings();
    const frames = Math.max(1, Math.round(s.duration * s.fps));
    const size = (s.bitrate * s.duration) / 8;
    const support = state.codecSupport[`${s.codec}|${s.width}x${s.height}@${s.fps}`];
    let html = `<b>${s.width}×${s.height}</b> · ${s.fps} fps · ${frames.toLocaleString()} frames · ` +
      `${s.start.toFixed(2)}s → ${(s.start + s.duration).toFixed(2)}s · ≈ <b>${fmtBytes(size)}</b>`;
    if (s.supersample > 1) html += ` · rendering at ${s.width * 2}×${s.height * 2}`;
    if (renderer.hasBuffers() && s.start > 0) html += `<br>Buffers are simulated from 0 s first (${Math.round(s.start * s.fps).toLocaleString()} extra frames, not encoded).`;
    if (support === false) html += `<br><span class="warn">${ShaderExport.CODEC_LABELS[s.codec]} at this size/frame rate isn't supported by this browser — pick another codec.</span>`;
    if (mustStreamToDisk(s)) html += '<br>This export is large, so you’ll be asked where to save it and it will be written straight to disk.';
    else if (!s.toDisk && size > LARGE_EXPORT_BYTES) html += '<br><span class="warn">Large file — this browser can’t stream to disk, so the export may fail. Try Chrome or Edge, or lower the duration/bitrate.</span>';
    el.exportSummary.innerHTML = html;
    el.exportBtn.disabled = state.exporting || support === false || !('VideoEncoder' in window) || !window.Mp4Muxer;

    // Preview matches output aspect ratio
    el.previewBox.style.setProperty('--ar', (s.width / s.height).toFixed(5));
    el.scrub.min = '0';
    el.scrub.max = String(s.start + s.duration);
    state.dirty = true;
  }

  let probeToken = 0;
  async function probeCodecs() {
    if (!('VideoEncoder' in window)) return;
    const token = ++probeToken;
    const s = readSettings();
    const key = (c) => `${c}|${s.width}x${s.height}@${s.fps}`;
    await Promise.all([...el.codecSelect.options].map(async (opt) => {
      const k = key(opt.value);
      if (!(k in state.codecSupport)) {
        const cfg = await ShaderExport.findEncoderConfig({ codec: opt.value, width: s.width, height: s.height, fps: s.fps, bitrate: s.bitrate });
        state.codecSupport[k] = !!cfg;
      }
      if (token !== probeToken) return;
      const base = opt.textContent.replace(/ — unsupported$/, '');
      opt.textContent = state.codecSupport[k] ? base : `${base} — unsupported`;
    }));
    if (token === probeToken) updateSummary();
  }

  restoreSettings();
  if (window.showSaveFilePicker) el.toDiskRow.hidden = false;

  [el.resSelect, el.fpsSelect, el.codecSelect, el.qualitySelect].forEach((s) => s.addEventListener('change', () => {
    autoBitrate(); updateSummary(); persistSettings(); probeCodecs();
  }));
  [el.startInput, el.durationInput, el.bitrateInput].forEach((s) => s.addEventListener('input', () => { updateSummary(); persistSettings(); }));
  [el.ssSelect, el.toDisk, el.loopRange].forEach((s) => s.addEventListener('change', () => { updateSummary(); persistSettings(); }));
  el.previewScale.addEventListener('change', () => { persistSettings(); state.dirty = true; });

  // -------------------------------------------------------------------------
  // Export actions
  // -------------------------------------------------------------------------
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function baseName() {
    return (fileName || 'shader').replace(/\.[^.]+$/, '').replace(/\.shader$/, '').replace(/[^\w.-]+/g, '_') || 'shader';
  }

  function setExporting(on) {
    state.exporting = on;
    el.exportBtn.hidden = on;
    el.pngBtn.disabled = on;
    el.cancelBtn.hidden = !on;
    el.progress.hidden = !on;
    el.exportOverlay.hidden = !on;
    [el.resSelect, el.fpsSelect, el.startInput, el.durationInput, el.codecSelect, el.qualitySelect,
      el.bitrateInput, el.ssSelect, el.toDisk].forEach((c) => { c.disabled = on; });
    updateSummary();
  }

  async function startExport() {
    if (state.exporting) return;
    const s = readSettings();
    const resTag = s.height >= 2160 || s.width >= 2160 ? '4k' : '1080p';
    const outName = `${baseName()}_${resTag}_${s.fps}fps.mp4`;
    el.exportMsg.className = 'msg';
    el.exportMsg.textContent = '';

    // The file picker must open directly from the click. Large exports always go
    // straight to a file: browsers can't reliably hold multi-GB videos in memory.
    let fileHandle = null;
    if (s.toDisk || mustStreamToDisk(s)) {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: outName,
          types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
        });
      } catch (e) {
        if (e.name === 'AbortError') return;
        el.exportMsg.className = 'msg err';
        el.exportMsg.textContent = `Couldn't open a file for writing: ${e.message}`;
        return;
      }
    }

    state.control = { cancelled: false };
    setExporting(true);
    el.progressFill.style.width = '0%';
    el.progressText.textContent = 'Preparing encoder…';
    const t0 = performance.now();

    try {
      const result = await ShaderExport.exportVideo({
        project: exportProject(),
        custom: currentParamValues(),
        ...s,
        mouse: state.mouse,
        dateBase: state.dateBase,
        fileHandle,
        control: state.control,
        onProgress: (p) => {
          const pct = (p.frame / p.totalFrames) * 100;
          el.progressFill.style.width = `${pct.toFixed(1)}%`;
          if (p.phase === 'warmup') {
            el.progressText.textContent = `Simulating buffers up to the start time… ${p.frame.toLocaleString()} / ${p.totalFrames.toLocaleString()} frames`;
            return;
          }
          if (p.phase === 'finalize') {
            el.progressText.textContent = `Finalizing… ${p.totalFrames.toLocaleString()} frames · ${fmtBytes(p.bytes)}`;
            return;
          }
          const rate = p.frame / Math.max(p.elapsed, 1e-3);
          const eta = (p.totalFrames - p.frame) / rate;
          el.progressText.textContent =
            `Frame ${p.frame.toLocaleString()} / ${p.totalFrames.toLocaleString()} · ${rate.toFixed(1)} fps · ` +
            `${fmtBytes(p.bytes)} · elapsed ${fmtTime(p.elapsed)} · ETA ${fmtTime(eta)}`;
        },
      });
      const took = (performance.now() - t0) / 1000;
      if (result.blob) download(result.blob, outName);
      el.exportMsg.className = 'msg ok';
      el.exportMsg.textContent = result.toDisk
        ? `✓ Saved ${fileHandle.name} — ${result.frames.toLocaleString()} frames, ${fmtBytes(result.bytes)}, in ${fmtTime(took)}.`
        : `✓ Downloaded ${outName} — ${result.frames.toLocaleString()} frames, ${fmtBytes(result.bytes)}, in ${fmtTime(took)}.`;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        el.exportMsg.className = 'msg';
        el.exportMsg.textContent = 'Export cancelled.';
      } else {
        console.error(e);
        el.exportMsg.className = 'msg err';
        el.exportMsg.textContent = `Export failed: ${e && e.message ? e.message : e}`;
      }
    } finally {
      setExporting(false);
      state.lastTs = null;
    }
  }

  el.exportBtn.addEventListener('click', startExport);
  el.cancelBtn.addEventListener('click', () => { if (state.control) state.control.cancelled = true; });

  el.pngBtn.addEventListener('click', async () => {
    const s = readSettings();
    el.exportMsg.className = 'msg';
    el.exportMsg.textContent = 'Rendering frame…';
    el.pngBtn.disabled = true;
    try {
      const blob = await ShaderExport.renderStill({
        project: exportProject(), custom: currentParamValues(), width: s.width, height: s.height,
        fps: s.fps, time: state.time, supersample: s.supersample, mouse: state.mouse, dateBase: state.dateBase,
        onProgress: (p) => { el.exportMsg.textContent = `Simulating buffers… ${p.frame} / ${p.totalFrames} frames`; },
      });
      const name = `${baseName()}_${s.width}x${s.height}_t${state.time.toFixed(2)}.png`;
      download(blob, name);
      el.exportMsg.className = 'msg ok';
      el.exportMsg.textContent = `✓ Downloaded ${name}`;
    } catch (e) {
      el.exportMsg.className = 'msg err';
      el.exportMsg.textContent = `PNG failed: ${e.message}`;
    } finally {
      el.pngBtn.disabled = state.exporting;
    }
  });

  // -------------------------------------------------------------------------
  // Transport + mouse
  // -------------------------------------------------------------------------
  function restartSim() {
    state.frame = 0;
    renderer.resetBuffers();
    state.dirty = true;
  }
  function setPlaying(p) {
    state.playing = p;
    el.iconPlay.hidden = p;
    el.iconPause.hidden = !p;
    state.lastTs = null;
  }
  el.playBtn.addEventListener('click', () => setPlaying(!state.playing));
  el.restartBtn.addEventListener('click', () => {
    state.time = readSettings().start;
    restartSim();
  });
  el.scrub.addEventListener('input', () => {
    state.time = Number(el.scrub.value);
    if (renderer.hasBuffers()) restartSim();
    state.dirty = true;
  });

  function pointerPos(e) {
    const r = el.canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    };
  }
  el.canvas.addEventListener('pointerdown', (e) => {
    const p = pointerPos(e);
    Object.assign(state.mouse, { x: p.x, y: p.y, cx: p.x, cy: p.y, down: true });
    el.canvas.setPointerCapture(e.pointerId);
    state.dirty = true;
  });
  el.canvas.addEventListener('pointermove', (e) => {
    if (!state.mouse.down) return;
    const p = pointerPos(e);
    state.mouse.x = p.x; state.mouse.y = p.y;
    state.dirty = true;
  });
  const up = () => { state.mouse.down = false; state.dirty = true; };
  el.canvas.addEventListener('pointerup', up);
  el.canvas.addEventListener('pointercancel', up);

  // -------------------------------------------------------------------------
  // Files: open, save, drag & drop
  // -------------------------------------------------------------------------
  /** Single-pass shaders save as .glsl; multi-pass projects save as a .json bundle. */
  function saveProject() {
    if (!isMultiPass()) {
      const name = /\.\w+$/.test(fileName) && !/\.json$/i.test(fileName) ? fileName : `${baseName()}.glsl`;
      download(new Blob([tabs.get('image').doc.getValue()], { type: 'text/plain' }), name);
    } else {
      download(new Blob([JSON.stringify(projectData(), null, 2)], { type: 'application/json' }), `${baseName()}.shader.json`);
    }
    setModified(false);
  }
  el.saveBtn.addEventListener('click', saveProject);
  el.openBtn.addEventListener('click', () => el.fileInput.click());

  async function openShaderFile(file) {
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      let spec;
      try { spec = JSON.parse(text); } catch (_) { spec = null; }
      if (!normalizeProject(spec)) { alert(`${file.name} isn't a Shader Render project file.`); return; }
      if (state.modified && !confirm(`Replace the current project with ${file.name}? Unsaved edits will be lost.`)) return;
      loadProject(spec, file.name, { active: spec.active });
      return;
    }
    // A plain shader file goes into the selected tab
    const target = tabs.get(activeTab);
    const what = isMultiPass() ? `the ${TAB_LABEL[activeTab]} tab` : 'the current shader';
    if (state.modified && !confirm(`Replace ${what} with ${file.name}? Unsaved edits will be lost.`)) return;
    ignoreChange = true;
    target.doc.setValue(text);
    target.doc.clearHistory();
    ignoreChange = false;
    if (!isMultiPass() || activeTab === 'image') setFileName(file.name);
    setModified(isMultiPass());
    state.frame = 0;
    compile();
    schedulePersist();
  }
  el.fileInput.addEventListener('change', () => {
    if (el.fileInput.files[0]) openShaderFile(el.fileInput.files[0]);
    el.fileInput.value = '';
  });

  el.exampleSelect.addEventListener('change', () => {
    const ex = examples[Number(el.exampleSelect.value)];
    el.exampleSelect.value = '';
    if (!ex) return;
    if (state.modified && !confirm(`Replace the current project with “${ex.name}”? Unsaved edits will be lost.`)) return;
    loadProject(ex, ex.file);
  });

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const modalOpen = () => !!document.querySelector('.modal:not([hidden])');
  const hideDropHint = () => { dragDepth = 0; el.dropHint.hidden = true; };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || modalOpen()) return;   // dialogs handle their own drops
    dragDepth++;
    el.dropHint.hidden = false;
  });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.dropHint.hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  // Capture phase: runs for every drop, even ones a drop zone stops from bubbling,
  // so the overlay can never get stuck on screen
  window.addEventListener('drop', hideDropHint, true);
  window.addEventListener('dragend', hideDropHint, true);
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (modalOpen()) return;                    // e.g. Image -> Shader takes the file itself
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) {
      const pid = activePass();
      const free = tabs.get(pid).channels.findIndex((c) => !c);
      loadChannelImage(pid, free === -1 ? 0 : free, f);
    } else {
      openShaderFile(f);
    }
  });

  // Keyboard: space toggles play when not typing
  window.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('.CodeMirror, input, select, textarea');
    if (e.code === 'Space' && !typing) { e.preventDefault(); setPlaying(!state.playing); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !typing) { e.preventDefault(); saveProject(); }
  });

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  let fpsAccum = 0, fpsFrames = 0;
  let lastBuiltinUpdate = 0;

  function tick(ts) {
    requestAnimationFrame(tick);
    if (state.exporting) return;

    const dt = state.lastTs == null ? 0 : Math.min(0.25, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    if (state.playing) {
      state.time += dt;
      state.dirty = true;
    }
    if (el.loopRange.checked) {
      const s = readSettings();
      const end = s.start + s.duration;
      if (state.time >= end || state.time < s.start) {
        state.time = s.start + (((state.time - s.start) % s.duration) + s.duration) % s.duration;
        if (state.playing) restartSim();
      }
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Number(el.previewScale.value);
    const w = Math.max(1, Math.round(el.previewBox.clientWidth * dpr * scale));
    const h = Math.max(1, Math.round(el.previewBox.clientHeight * dpr * scale));
    if (w !== el.canvas.width || h !== el.canvas.height) state.dirty = true;

    // Buffers advance one step per rendered frame, so keep rendering while they exist
    if (!state.dirty) return;
    state.dirty = false;

    renderer.render({
      width: w, height: h,
      time: state.time,
      timeDelta: dt || 1 / 60,
      frame: state.frame,
      frameRate: state.fps || 60,
      mouse: state.mouse,
      date: new Date(state.dateBase.getTime() + state.time * 1000),
      supersample: 1,
    });
    if (state.playing) state.frame++;

    if (dt > 0) {
      fpsAccum += dt; fpsFrames++;
      if (fpsAccum >= 0.5) { state.fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }
    }
    el.hud.textContent = `${w}×${h}${state.playing ? ` · ${Math.round(state.fps)} fps` : ' · paused'}`;
    el.timeLabel.textContent = `${state.time.toFixed(2)}s · f${state.frame}`;
    if (document.activeElement !== el.scrub) el.scrub.value = String(state.time);
    if (ts - lastBuiltinUpdate > 120) { lastBuiltinUpdate = ts; updateBuiltins(); }
  }

  // -------------------------------------------------------------------------
  // Resizable editor pane
  // -------------------------------------------------------------------------
  const layoutEl = document.querySelector('.layout');
  const editorPane = document.querySelector('.editor-pane');
  const splitter = $('splitter');
  const MIN_EDITOR = 260, MIN_SIDE = 360;
  let splitRaf = 0;

  function applyEditorWidth(px, save) {
    if (px == null) {
      layoutEl.style.removeProperty('--editor-w');
      if (save) store.set(STORE_SPLIT, '');
    } else {
      const total = layoutEl.clientWidth - splitter.offsetWidth;
      const w = Math.round(Math.min(Math.max(px, MIN_EDITOR), Math.max(MIN_EDITOR, total - MIN_SIDE)));
      layoutEl.style.setProperty('--editor-w', `${w}px`);
      splitter.setAttribute('aria-valuenow', String(w));
      if (save) store.set(STORE_SPLIT, String(w));
    }
    cancelAnimationFrame(splitRaf);
    splitRaf = requestAnimationFrame(() => cm.refresh());
    state.dirty = true;
  }

  let drag = null;
  splitter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: editorPane.getBoundingClientRect().width };
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
  });
  splitter.addEventListener('pointermove', (e) => {
    if (drag) applyEditorWidth(drag.w + e.clientX - drag.x, false);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing');
    applyEditorWidth(editorPane.getBoundingClientRect().width, true);
  };
  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);
  splitter.addEventListener('dblclick', () => applyEditorWidth(null, true));
  splitter.addEventListener('keydown', (e) => {
    const w = editorPane.getBoundingClientRect().width;
    const stepPx = e.shiftKey ? 96 : 24;
    if (e.key === 'ArrowLeft') applyEditorWidth(w - stepPx, true);
    else if (e.key === 'ArrowRight') applyEditorWidth(w + stepPx, true);
    else if (e.key === 'Home') applyEditorWidth(MIN_EDITOR, true);
    else if (e.key === 'End') applyEditorWidth(Infinity, true);
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => {
    if (layoutEl.style.getPropertyValue('--editor-w')) applyEditorWidth(editorPane.getBoundingClientRect().width, false);
  });
  const savedSplit = Number(store.get(STORE_SPLIT));
  if (savedSplit > 0) applyEditorWidth(savedSplit, false);

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  function initialProject() {
    try {
      const saved = JSON.parse(store.get(STORE_PROJECT) || 'null');
      if (normalizeProject(saved)) return { spec: saved, name: saved.name, active: saved.active };
    } catch (_) { /* fall through */ }
    const legacy = store.get(STORE_SRC);
    if (legacy) {
      let channels = [];
      try { channels = JSON.parse(store.get(STORE_CHANNELS) || '[]') || []; } catch (_) { channels = []; }
      return { spec: { code: legacy, channels }, name: store.get(STORE_NAME) || 'untitled.glsl' };
    }
    return { spec: examples[0], name: examples[0].file };
  }

  const init = initialProject();
  loadProject(init.spec, init.name, { active: init.active });
  updateSummary();
  probeCodecs();
  state.time = readSettings().start;
  requestAnimationFrame(tick);

  // Used by js/image2shader.js, and handy for debugging in the console
  window.shaderApp = {
    state, cm, compile, tabs, addTab, switchTab, loadProject, projectData,
    exportProject, currentParamValues,
    get renderer() { return renderer; },
    imageCode: () => tabs.get('image').doc.getValue(),
    /** Puts an image into one of the Image pass's channels (mipmapped, clamped, upright). */
    setImageChannel(i, source, name, thumbUrl) {
      setChannelFor('image', i, {
        kind: 'image', name: name || 'image', source,
        width: source.naturalWidth || source.width, height: source.naturalHeight || source.height,
        thumb: thumbUrl || '', filter: 'mipmap', wrap: 'clamp', flip: true,
      });
    },
    /** Replaces the Image tab's code as one undoable edit, then compiles. */
    replaceImageCode(code) {
      if (activeTab !== 'image') switchTab('image');
      const doc = tabs.get('image').doc;
      doc.replaceRange(code, { line: 0, ch: 0 }, { line: doc.lastLine(), ch: doc.getLine(doc.lastLine()).length });
      compile();
    },
    /** Compile errors across all tabs as plain text ('' if it compiled). */
    compileErrors() {
      const lines = [];
      for (const [id, t] of tabs) {
        for (const e of t.errors) {
          if (e.type === 'WARNING') continue;
          lines.push(`${tabs.size > 1 ? `[${TAB_LABEL[id]}] ` : ''}${e.line ? `line ${e.line}: ` : ''}${e.msg}`);
        }
      }
      return lines.join('\n');
    },
  };
})();

'use strict';

// ---------------------------------------------------------------------------
// Importers: Shadertoy JSON and ISF (Interactive Shader Format) -> Shader Render.
//
//   ShaderImporters.parseShadertoy(text | object)
//     -> { name, project: { common, passes }, textures: [...], warnings: [...] }
//   ShaderImporters.convertISF(text, fileName)
//     -> { name, code, warnings }
//   ShaderImporters.detect(text) -> 'shadertoy' | 'isf' | 'project' | null
//
// Also wires up the Import dialog (toolbar "Import…").
// ---------------------------------------------------------------------------

(function () {
  const BUFFER_LETTERS = ['A', 'B', 'C', 'D'];

  function tryJSON(text) {
    if (typeof text !== 'string') return text;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function detect(text) {
    const trimmed = String(text || '').trim();
    if (/^\/\*\s*\{/.test(trimmed) && /"(ISFVSN|INPUTS|CATEGORIES|DESCRIPTION)"/.test(trimmed)) return 'isf';
    const j = tryJSON(trimmed);
    if (j && typeof j === 'object') {
      const s = Array.isArray(j) ? j[0] : j;
      if (s && (s.Shader || s.renderpass)) return 'shadertoy';
      if (s && s.passes) return 'project';
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Shadertoy
  // -------------------------------------------------------------------------
  const SHADERTOY_LICENSE_NOTE =
    '// Unless the author states otherwise in the code or description, Shadertoy shaders are\n' +
    '// licensed CC BY-NC-SA 3.0: credit the author, non-commercial use only, share alike.\n';

  function samplerOf(input) {
    const s = input.sampler || {};
    const filter = s.filter === 'nearest' ? 'nearest' : s.filter === 'linear' ? 'linear' : 'mipmap';
    const wrap = s.wrap === 'clamp' ? 'clamp' : 'repeat';
    const flip = String(s.vflip) === 'true';
    return { filter, wrap, flip };
  }

  function parseShadertoy(input) {
    let data = tryJSON(input);
    if (!data) throw new Error('That isn’t valid JSON.');
    if (Array.isArray(data)) data = data[0];
    if (data && data.Shader) data = data.Shader;
    if (!data || !Array.isArray(data.renderpass)) throw new Error('No Shadertoy render passes found in that JSON.');

    const info = data.info || {};
    const warnings = [];
    const passes = data.renderpass;

    // Which buffer letter each pass writes to, keyed by its output id
    const outputToBuffer = {};
    const bufferPasses = passes.filter((p) => p.type === 'buffer');
    bufferPasses.forEach((p, i) => {
      const fromName = /buf(?:fer)?\s*([a-d])/i.exec(p.name || '');
      const letter = fromName ? fromName[1].toUpperCase() : BUFFER_LETTERS[i];
      p._letter = letter;
      for (const o of p.outputs || []) outputToBuffer[String(o.id)] = letter;
    });

    const project = { common: null, passes: {} };
    const textures = [];
    for (const p of passes) {
      const type = p.type;
      if (type === 'common') { project.common = p.code || ''; continue; }
      if (type === 'sound') { warnings.push('The Sound pass was skipped (audio isn’t supported).'); continue; }
      if (type === 'cubemap') { warnings.push('The Cube A pass was skipped (cubemap passes aren’t supported).'); continue; }
      if (type !== 'image' && type !== 'buffer') { warnings.push(`A “${type}” pass was skipped.`); continue; }
      const id = type === 'image' ? 'image' : p._letter;
      if (!BUFFER_LETTERS.includes(id) && id !== 'image') continue;

      const channels = [null, null, null, null];
      for (const inp of p.inputs || []) {
        const ch = Number(inp.channel);
        if (!(ch >= 0 && ch <= 3)) continue;
        const kind = inp.ctype || inp.type;
        const smp = samplerOf(inp);
        if (kind === 'buffer') {
          const letter = outputToBuffer[String(inp.id)] ||
            (/buffer0?([0-3])/.exec(inp.src || inp.filepath || '') ? BUFFER_LETTERS[Number(/buffer0?([0-3])/.exec(inp.src || inp.filepath)[1])] : null);
          if (letter) channels[ch] = { kind: 'buffer', buffer: letter, filter: smp.filter === 'mipmap' ? 'linear' : smp.filter, wrap: smp.wrap };
          else warnings.push(`${passLabel(id)} iChannel${ch}: couldn’t tell which buffer it reads.`);
        } else if (kind === 'texture') {
          const path = inp.src || inp.filepath || '';
          if (path) textures.push({ pass: id, channel: ch, url: /^https?:/.test(path) ? path : `https://www.shadertoy.com${path.startsWith('/') ? '' : '/'}${path}`, ...smp });
        } else {
          const what = { keyboard: 'keyboard', music: 'music', musicstream: 'SoundCloud audio', mic: 'microphone', webcam: 'webcam', video: 'video', cubemap: 'cubemap', volume: '3D texture' }[kind] || kind;
          warnings.push(`${passLabel(id)} iChannel${ch} uses ${what} input, which isn’t supported, so it reads black.`);
        }
      }
      project.passes[id] = { code: p.code || '', channels };
    }
    if (!project.passes.image) throw new Error('This shader has no Image pass.');

    const name = info.name || 'Shadertoy import';
    const url = info.id ? `https://www.shadertoy.com/view/${info.id}` : 'https://www.shadertoy.com';
    const header = `// "${name}"${info.username ? ` by ${info.username}` : ''}\n// ${url}\n// Imported from Shadertoy into Shader Render.\n${SHADERTOY_LICENSE_NOTE}\n`;
    project.passes.image.code = header + project.passes.image.code;
    return { name, author: info.username || '', url, project, textures, warnings };
  }

  function passLabel(id) { return id === 'image' ? 'Image' : `Buffer ${id}`; }

  // -------------------------------------------------------------------------
  // ISF
  // -------------------------------------------------------------------------
  const num = (v, d = 4) => String(+Number(v).toFixed(d));

  /**
   * glsl: 300 converts to GLSL ES 3.00 (WebGL2's newer dialect: unsigned ints, array
   * constructors, dynamic indexing), 100 to GLSL ES 1.00. ISF targets desktop GLSL, so
   * neither is guaranteed; importText tries 300 first and falls back to 100.
   */
  function convertISF(text, fileName = 'shader.fs', { glsl = 300 } = {}) {
    const src = String(text || '');
    const m = /^\s*\/\*\s*(\{[\s\S]*?\})\s*\*\//.exec(src);
    if (!m) throw new Error('No ISF JSON header (/*{ ... }*/) found.');
    let meta;
    try { meta = JSON.parse(m[1]); } catch (e) { throw new Error(`The ISF header isn’t valid JSON: ${e.message}`); }
    let body = src.slice(m.index + m[0].length);
    const warnings = [];
    const baseName = fileName.replace(/\.[^.]+$/, '');

    if (/^\s*varying\s/m.test(body)) {
      warnings.push('This shader uses a custom ISF vertex shader (.vs), which isn’t supported, so it may not compile.');
    }
    if (glsl === 300) {
      // GLSL ES 3.00 spellings of the GLSL 1.x built-ins ISF code uses
      body = body.replace(/\bgl_FragColor\b/g, 'isfFragColor').replace(/\btexture2D\s*\(/g, 'texture(').replace(/\bvarying\s/g, 'in ');
    }

    if (Array.isArray(meta.PASSES) && meta.PASSES.length > 1) {
      warnings.push('This ISF shader has several passes; only single-pass ISF is supported, so it may not look right.');
    }
    if (meta.IMPORTED && Object.keys(meta.IMPORTED).length) {
      warnings.push('Imported images in the ISF header aren’t loaded; load them into channels by hand.');
    }

    const lines = [];
    const defines = [];
    let imageIndex = 0;
    for (const inp of meta.INPUTS || []) {
      const name = inp.NAME;
      if (!name || !/^[A-Za-z_]\w*$/.test(name)) continue;
      const label = inp.LABEL ? `  ${inp.LABEL}` : '';
      switch (inp.TYPE) {
        case 'float': {
          const min = inp.MIN ?? 0, max = inp.MAX ?? 1, def = inp.DEFAULT ?? (min + max) / 2;
          lines.push(`uniform float ${name}; // ${num(min)} ${num(max)} ${num(def)}`);
          break;
        }
        case 'long': {
          const values = Array.isArray(inp.VALUES) && inp.VALUES.length ? inp.VALUES : [0, 1];
          const def = inp.DEFAULT ?? values[0];
          if (Array.isArray(inp.LABELS)) lines.push(`// ${name}: ${values.map((v, i) => `${v} = ${inp.LABELS[i] ?? v}`).join(', ')}`);
          lines.push(`uniform int ${name}; // ${Math.min(...values)} ${Math.max(...values)} ${def}`);
          break;
        }
        case 'bool':
        case 'event':
          lines.push(`uniform bool ${name}; // ${inp.DEFAULT ? 'true' : 'false'}`);
          break;
        case 'color': {
          const def = Array.isArray(inp.DEFAULT) ? inp.DEFAULT : [1, 1, 1, 1];
          lines.push(`uniform vec4 ${name}; // color ${def.slice(0, 4).map((v) => num(v, 3)).join(' ')}`);
          break;
        }
        case 'point2D': {
          const def = Array.isArray(inp.DEFAULT) ? inp.DEFAULT : [0.5, 0.5];
          let lo = 0, hi = Math.max(1, ...def.map((v) => Math.abs(v) * 2));
          if (Array.isArray(inp.MIN) && Array.isArray(inp.MAX)) { lo = Math.min(...inp.MIN); hi = Math.max(...inp.MAX); }
          lines.push(`uniform vec2 ${name}; // ${num(lo)} ${num(hi)} ${num(def[0])} ${num(def[1])}`);
          break;
        }
        case 'image':
          if (imageIndex < 4) {
            defines.push(`#define ${name} iChannel${imageIndex}`);
            warnings.push(`Image input “${name}” reads iChannel${imageIndex}: load an image or a buffer into it.`);
            imageIndex++;
          } else {
            warnings.push(`Image input “${name}” has no free channel.`);
          }
          break;
        case 'audio':
        case 'audioFFT':
          lines.push(`uniform sampler2D ${name}; // audio isn't supported (reads black)`);
          warnings.push(`Audio input “${name}” isn’t supported, so it reads black.`);
          break;
        default:
          warnings.push(`Input “${name}” of type ${inp.TYPE} isn’t supported.`);
      }
    }

    const title = meta.DESCRIPTION && meta.DESCRIPTION.length < 80 ? meta.DESCRIPTION : baseName;
    const credit = meta.CREDIT ? `// Credit: ${String(meta.CREDIT).replace(/\n/g, ' ')}\n` : '';

    const tex = glsl === 300 ? 'texture' : 'texture2D';
    const versionLines = glsl === 300
      ? '#version 300 es\nprecision highp float;\nprecision highp int;\nout vec4 isfFragColor;\n'
      : 'precision highp float;\n';
    // (#version must be the very first line, so the credit comments go after it)
    const code =
`${versionLines}// ${baseName}: converted from ISF (Interactive Shader Format) by Shader Render.
${credit}${meta.CATEGORIES ? `// Categories: ${meta.CATEGORIES.join(', ')}\n` : ''}
// ISF built-ins, mapped onto Shader Render's inputs
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iDate;
${imageIndex ? Array.from({ length: imageIndex }, (_, i) => `uniform sampler2D iChannel${i};`).join('\n') + '\n' : ''}#define TIME iTime
#define TIMEDELTA iTimeDelta
#define RENDERSIZE iResolution.xy
#define FRAMEINDEX iFrame
#define DATE iDate
#define PASSINDEX 0
#define isf_FragNormCoord (gl_FragCoord.xy / iResolution.xy)
#define IMG_NORM_PIXEL(img, uv) ${tex}(img, uv)
#define IMG_PIXEL(img, px) ${tex}(img, (px) / iResolution.xy)
#define IMG_THIS_NORM_PIXEL(img) ${tex}(img, isf_FragNormCoord)
#define IMG_THIS_PIXEL(img) ${tex}(img, isf_FragNormCoord)
#define IMG_SIZE(img) iResolution.xy
${defines.join('\n')}${defines.length ? '\n' : ''}
// Inputs (sliders)
${lines.join('\n')}
${body.replace(/^\s*\n/, '\n')}`;
    return { name: title, code, warnings, meta };
  }

  window.ShaderImporters = { detect, parseShadertoy, convertISF };

  // -------------------------------------------------------------------------
  // Import dialog
  // -------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const dlg = $('importDialog');
  if (!dlg || !window.shaderApp) return;
  const els = {
    open: $('importBtn'), close: $('impClose'), text: $('impText'), file: $('impFile'), choose: $('impChoose'),
    go: $('impGo'), status: $('impStatus'),
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  els.open.addEventListener('click', () => { dlg.hidden = false; els.text.focus(); });
  els.close.addEventListener('click', () => { dlg.hidden = true; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.hidden = true; });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.hidden) dlg.hidden = true; });
  els.choose.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', async () => {
    const f = els.file.files[0];
    els.file.value = '';
    if (!f) return;
    els.text.value = await f.text();
    els.text.dataset.fileName = f.name;
    runImport();
  });
  els.go.addEventListener('click', runImport);

  async function runImport() {
    const text = els.text.value;
    if (!text.trim()) { els.status.className = 'i2s-status err'; els.status.textContent = 'Paste Shadertoy JSON or an ISF shader first.'; return; }
    els.status.className = 'i2s-status busy';
    els.status.innerHTML = '<span class="spinner"></span>Importing…';
    try {
      const res = await window.shaderApp.importText(text, els.text.dataset.fileName || '');
      if (!res) { els.status.className = 'i2s-status'; els.status.textContent = 'Import cancelled.'; return; }
      els.status.className = 'i2s-status ok';
      els.status.innerHTML = `✓ Imported <b>${esc(res.name)}</b>.` +
        (res.warnings.length ? `<br><span class="muted">${res.warnings.map(esc).join('<br>')}</span>` : '');
      delete els.text.dataset.fileName;
    } catch (e) {
      els.status.className = 'i2s-status err';
      els.status.textContent = e.message;
    }
  }
})();

'use strict';

// ---------------------------------------------------------------------------
// Shader source handling
// ---------------------------------------------------------------------------

const BUFFER_IDS = ['A', 'B', 'C', 'D']; // render order; the Image pass is drawn last

const SHADERTOY_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iSampleRate;
uniform float iChannelTime[4];
uniform vec3 iChannelResolution[4];
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
out vec4 shaderRenderFragColor;
`;

// The Image pass is opaque; buffer passes keep their alpha channel (often used for data).
const FOOTER_IMAGE = `
void main() {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, gl_FragCoord.xy);
  shaderRenderFragColor = vec4(color.rgb, 1.0);
}
`;
const FOOTER_BUFFER = `
void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  shaderRenderFragColor = color;
}
`;

const VS_300 = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const VS_100 = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Uniforms the app drives automatically; everything else is a user parameter.
const BUILTIN_UNIFORMS = new Set([
  'iResolution', 'iTime', 'iTimeDelta', 'iFrameRate', 'iFrame', 'iMouse', 'iDate', 'iSampleRate',
  'iChannelTime', 'iChannelResolution', 'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3',
  'u_resolution', 'u_time', 'u_delta', 'u_frame', 'u_mouse', 'resolution', 'time', 'mouse',
  'u_tex0', 'u_tex1', 'u_tex2', 'u_tex3', 'u_texture0', 'u_texture1', 'u_texture2', 'u_texture3',
]);

/** GLSL type name for a WebGL uniform type enum. */
function glslTypeName(type) {
  const T = WebGL2RenderingContext;
  const names = {
    [T.FLOAT]: 'float', [T.FLOAT_VEC2]: 'vec2', [T.FLOAT_VEC3]: 'vec3', [T.FLOAT_VEC4]: 'vec4',
    [T.INT]: 'int', [T.INT_VEC2]: 'ivec2', [T.INT_VEC3]: 'ivec3', [T.INT_VEC4]: 'ivec4',
    [T.UNSIGNED_INT]: 'uint', [T.BOOL]: 'bool', [T.BOOL_VEC2]: 'bvec2', [T.BOOL_VEC3]: 'bvec3', [T.BOOL_VEC4]: 'bvec4',
    [T.FLOAT_MAT2]: 'mat2', [T.FLOAT_MAT3]: 'mat3', [T.FLOAT_MAT4]: 'mat4',
    [T.SAMPLER_2D]: 'sampler2D', [T.SAMPLER_CUBE]: 'samplerCube', [T.SAMPLER_3D]: 'sampler3D',
  };
  return names[type] || `type 0x${type.toString(16)}`;
}

function countLines(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Detects the dialect of a fragment shader and wraps it so WebGL2 can compile it.
 *  - "#version 300 es" at the top  -> used verbatim
 *  - defines mainImage()           -> Shadertoy wrapper (GLSL ES 3.00), Common code prepended
 *  - otherwise                     -> GLSL ES 1.00 (gl_FragColor), precision added if missing
 * Returns { mode, version, code, mapLine(n) -> { tab: 'pass'|'common'|null, line } }.
 */
function buildFragmentSource(src, { common = '', isBuffer = false } = {}) {
  if (/^\s*#version\s+300\s+es/.test(src)) {
    return { mode: 'GLSL ES 3.00', version: 300, code: src, mapLine: (n) => ({ tab: 'pass', line: n }) };
  }
  if (/\bvoid\s+mainImage\s*\(/.test(src)) {
    const commonPart = common && common.trim() ? common + '\n' : '';
    const headerLines = countLines(SHADERTOY_HEADER);
    const commonLines = countLines(commonPart);
    return {
      mode: 'Shadertoy',
      version: 300,
      code: SHADERTOY_HEADER + commonPart + src + '\n' + (isBuffer ? FOOTER_BUFFER : FOOTER_IMAGE),
      mapLine: (n) => {
        if (n <= headerLines) return { tab: null, line: null };
        if (n <= headerLines + commonLines) return { tab: 'common', line: n - headerLines };
        return { tab: 'pass', line: n - headerLines - commonLines };
      },
    };
  }
  const hasPrecision = /\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(src);
  const hasDirectivesFirst = /^\s*#(extension|version)/m.test(src);
  if (!hasPrecision && !hasDirectivesFirst) {
    const prefix = 'precision highp float;\n';
    const off = countLines(prefix);
    return { mode: 'GLSL ES 1.00', version: 100, code: prefix + src, mapLine: (n) => ({ tab: 'pass', line: Math.max(1, n - off) }) };
  }
  return { mode: 'GLSL ES 1.00', version: 100, code: src, mapLine: (n) => ({ tab: 'pass', line: n }) };
}

function parseShaderLog(log, mapLine, passId) {
  const out = [];
  for (const raw of String(log).split('\n')) {
    const line = raw.replace(/\0/g, '').trim();
    if (!line) continue;
    const m = line.match(/^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/);
    if (m) {
      const loc = mapLine(Number(m[2]));
      out.push({ type: m[1], tab: loc.tab === 'common' ? 'common' : passId, line: loc.line, msg: m[3] });
    } else {
      out.push({ type: 'ERROR', tab: passId, line: null, msg: line });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderer: one WebGL2 context, an Image pass plus optional Buffer A–D passes.
// Buffers are double-buffered float textures, so a pass can read its own
// previous frame (feedback) and any other buffer's latest result.
// ---------------------------------------------------------------------------

class ShaderRenderer {
  constructor(canvas, { preserveDrawingBuffer = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.common = '';
    this.passes = new Map();   // passId -> { program, uniforms: Map, lastValues: Map, mode }
    this.channels = {};        // passId -> [channel x4]
    this.textures = {};        // passId -> [{ tex, w, h } | null x4]  (images / noise)
    this.buffers = {};         // bufferId -> { tex: [t0, t1], fbo: [f0, f1], cur, w, h }
    this.samplers = new Map();
    this.custom = {};          // user parameter values shared by all passes: name -> number[]

    // 1x1 black texture bound to empty channels
    this.blackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blackTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.ssFbo = null;
    this.ssTex = null;
    this.ssSize = [0, 0];

    this.bufferFormat = this._pickBufferFormat();

    // Component counts per uniform type (negative = integer types)
    this.components = new Map([
      [gl.FLOAT, 1], [gl.FLOAT_VEC2, 2], [gl.FLOAT_VEC3, 3], [gl.FLOAT_VEC4, 4],
      [gl.INT, -1], [gl.BOOL, -1], [gl.UNSIGNED_INT, -2],
    ]);
  }

  /** Best render-target format for buffers: 32-bit float, then 16-bit float, then 8-bit. */
  _pickBufferFormat() {
    const gl = this.gl;
    const cbf = gl.getExtension('EXT_color_buffer_float');
    const half = cbf || gl.getExtension('EXT_color_buffer_half_float');
    const linear32 = gl.getExtension('OES_texture_float_linear');
    const candidates = [];
    if (cbf && linear32) candidates.push({ internal: gl.RGBA32F, name: 'RGBA32F' });
    if (half) candidates.push({ internal: gl.RGBA16F, name: 'RGBA16F' });
    candidates.push({ internal: gl.RGBA8, name: 'RGBA8' });
    for (const c of candidates) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, c.internal, 4, 4);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      if (ok) return c;
    }
    return candidates[candidates.length - 1];
  }

  setCommon(code) { this.common = code || ''; }
  hasPass(id) { return this.passes.has(id) && !!this.passes.get(id).program; }
  passIds() { return [...this.passes.keys()]; }
  uniformsOf(id) { const p = this.passes.get(id); return p ? p.uniforms : new Map(); }
  lastValuesOf(id) { const p = this.passes.get(id); return p ? p.lastValues : new Map(); }

  _compileShader(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }

  /**
   * Compiles one pass ('image' or 'A'–'D'). On failure the pass keeps its previous program.
   * Errors are tagged with the tab they belong to (the pass, or 'common').
   */
  compilePass(id, source) {
    const gl = this.gl;
    const built = buildFragmentSource(source, { common: this.common, isBuffer: id !== 'image' });
    const fs = this._compileShader(gl.FRAGMENT_SHADER, built.code);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs) || 'Unknown shader compile error.';
      gl.deleteShader(fs);
      return { ok: false, mode: built.mode, errors: parseShaderLog(log, built.mapLine, id) };
    }
    const vs = this._compileShader(gl.VERTEX_SHADER, built.version === 300 ? VS_300 : VS_100);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'Unknown program link error.';
      gl.deleteProgram(prog);
      return { ok: false, mode: built.mode, errors: parseShaderLog(log, built.mapLine, id) };
    }

    const old = this.passes.get(id);
    if (old && old.program) gl.deleteProgram(old.program);
    const uniforms = new Map();
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      uniforms.set(name, { loc: gl.getUniformLocation(prog, info.name), type: info.type, size: info.size });
    }
    this.passes.set(id, { program: prog, uniforms, lastValues: new Map(), mode: built.mode });
    return { ok: true, mode: built.mode, errors: [] };
  }

  /** Removes a pass, its channel textures and (for buffers) its render targets. */
  removePass(id) {
    const gl = this.gl;
    const p = this.passes.get(id);
    if (p && p.program) gl.deleteProgram(p.program);
    this.passes.delete(id);
    for (let i = 0; i < 4; i++) this.setChannel(id, i, null);
    delete this.channels[id];
    delete this.textures[id];
    this._freeBuffer(id);
  }

  /** Sets a uniform by name if the pass uses it, adapting to the declared type. */
  _set(pass, name, values) {
    const u = pass.uniforms.get(name);
    if (!u) return;
    pass.lastValues.set(name, values);
    const gl = this.gl;
    const comps = this.components.get(u.type);
    if (comps === undefined) return; // samplers and matrices handled elsewhere
    if (comps < 0) {
      const arr = new Int32Array(u.size);
      for (let i = 0; i < u.size; i++) arr[i] = Math.round(values[i] ?? 0);
      if (comps === -2) gl.uniform1uiv(u.loc, new Uint32Array(arr.map((v) => Math.max(0, v))));
      else gl.uniform1iv(u.loc, arr);
      return;
    }
    const len = comps * u.size;
    const arr = new Float32Array(len);
    for (let i = 0; i < len; i++) arr[i] = values[i] ?? 0;
    if (comps === 1) gl.uniform1fv(u.loc, arr);
    else if (comps === 2) gl.uniform2fv(u.loc, arr);
    else if (comps === 3) gl.uniform3fv(u.loc, arr);
    else gl.uniform4fv(u.loc, arr);
  }

  /**
   * channel: null
   *   | { kind: 'buffer', buffer: 'A'..'D', filter, wrap }
   *   | { data: Uint8Array, width, height, filter, wrap, flip }        (noise)
   *   | { source: HTMLImageElement|HTMLCanvasElement, filter, wrap, flip }  (images)
   * filter: 'mipmap' | 'linear' | 'nearest'; wrap: 'repeat' | 'clamp'
   */
  setChannel(passId, i, channel) {
    const gl = this.gl;
    if (!this.channels[passId]) this.channels[passId] = [null, null, null, null];
    if (!this.textures[passId]) this.textures[passId] = [null, null, null, null];
    const old = this.textures[passId][i];
    if (old) gl.deleteTexture(old.tex);
    this.textures[passId][i] = null;
    this.channels[passId][i] = channel || null;
    if (!channel || channel.kind === 'buffer') return;

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!channel.flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let w, h;
    if (channel.data) {
      w = channel.width; h = channel.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, channel.data);
    } else {
      w = channel.source.naturalWidth || channel.source.width;
      h = channel.source.naturalHeight || channel.source.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, channel.source);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.textures[passId][i] = { tex, w, h };
  }

  /** Sampler objects let each channel choose filtering/wrapping independently of the texture. */
  _sampler(filter, wrap, isBuffer) {
    if (isBuffer && filter === 'mipmap') filter = 'linear'; // buffers have no mip chain
    const key = `${filter}|${wrap}`;
    let s = this.samplers.get(key);
    if (s) return s;
    const gl = this.gl;
    s = gl.createSampler();
    const w = wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, w);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, w);
    const min = filter === 'nearest' ? gl.NEAREST : filter === 'linear' ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR;
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter === 'nearest' ? gl.NEAREST : gl.LINEAR);
    this.samplers.set(key, s);
    return s;
  }

  _makeBuffer(w, h) {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    if (w > max || h > max) throw new Error(`Buffer size ${w}×${h} exceeds this GPU's limit (${max}px).`);
    const b = { tex: [], fbo: [], cur: 0, w, h };
    for (let k = 0; k < 2; k++) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, this.bufferFormat.internal, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      b.tex.push(tex);
      b.fbo.push(fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return b;
  }

  _freeBuffer(id) {
    const b = this.buffers[id];
    if (!b) return;
    const gl = this.gl;
    b.fbo.forEach((f) => gl.deleteFramebuffer(f));
    b.tex.forEach((t) => gl.deleteTexture(t));
    delete this.buffers[id];
  }

  /** Allocates buffers for existing buffer passes (cleared whenever the size changes). */
  _ensureBuffers(w, h) {
    for (const id of BUFFER_IDS) {
      if (this.passes.has(id)) {
        const b = this.buffers[id];
        if (!b || b.w !== w || b.h !== h) {
          this._freeBuffer(id);
          this.buffers[id] = this._makeBuffer(w, h);
        }
      } else {
        this._freeBuffer(id);
      }
    }
  }

  /** Clears every buffer to transparent black (restart a simulation). */
  resetBuffers() {
    const gl = this.gl;
    for (const id in this.buffers) {
      const b = this.buffers[id];
      for (const f of b.fbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      b.cur = 0;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  hasBuffers() { return BUFFER_IDS.some((id) => this.hasPass(id)); }

  _ensureSsFbo(w, h) {
    const gl = this.gl;
    if (this.ssFbo && this.ssSize[0] === w && this.ssSize[1] === h) return;
    if (this.ssFbo) { gl.deleteFramebuffer(this.ssFbo); gl.deleteTexture(this.ssTex); }
    const max = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    if (w > max || h > max) throw new Error(`Supersampled size ${w}×${h} exceeds this GPU's limit (${max}px).`);
    this.ssTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.ssTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.ssFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ssTex, 0);
    this.ssSize = [w, h];
  }

  _drawPass(passId, pass, rw, rh, p) {
    const gl = this.gl;
    gl.useProgram(pass.program);
    gl.bindVertexArray(this.vao);

    const m = p.mouse || { x: 0, y: 0, cx: 0, cy: 0, down: false };
    const mx = m.x * rw, my = m.y * rh;
    const sign = m.down ? 1 : -1;
    const d = p.date || new Date();
    const secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    const t = p.time;

    // Channels
    const chans = this.channels[passId] || [];
    const texs = this.textures[passId] || [];
    const chRes = [];
    for (let i = 0; i < 4; i++) {
      const ch = chans[i];
      let tex = null, w = 0, h = 0;
      if (ch && ch.kind === 'buffer') {
        const b = this.buffers[ch.buffer];
        if (b) { tex = b.tex[b.cur]; w = b.w; h = b.h; }
      } else if (texs[i]) {
        tex = texs[i].tex; w = texs[i].w; h = texs[i].h;
      }
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex || this.blackTex);
      gl.bindSampler(i, tex ? this._sampler(ch.filter, ch.wrap, ch.kind === 'buffer') : null);
      chRes.push(w, h, 1);
      for (const name of [`iChannel${i}`, `u_tex${i}`, `u_texture${i}`]) {
        const u = pass.uniforms.get(name);
        if (u) gl.uniform1i(u.loc, i);
      }
    }

    // Shadertoy
    this._set(pass, 'iResolution', [rw, rh, 1]);
    this._set(pass, 'iTime', [t]);
    this._set(pass, 'iTimeDelta', [p.timeDelta]);
    this._set(pass, 'iFrameRate', [p.frameRate]);
    this._set(pass, 'iFrame', [p.frame]);
    this._set(pass, 'iMouse', [mx, my, sign * m.cx * rw, sign * m.cy * rh]);
    this._set(pass, 'iDate', [d.getFullYear(), d.getMonth(), d.getDate(), secs]);
    this._set(pass, 'iSampleRate', [44100]);
    this._set(pass, 'iChannelTime', [t, t, t, t]);
    this._set(pass, 'iChannelResolution', chRes);
    // Book of Shaders / glslViewer
    this._set(pass, 'u_resolution', [rw, rh]);
    this._set(pass, 'u_time', [t]);
    this._set(pass, 'u_delta', [p.timeDelta]);
    this._set(pass, 'u_frame', [p.frame]);
    this._set(pass, 'u_mouse', [mx, my]);
    // glslsandbox
    this._set(pass, 'resolution', [rw, rh]);
    this._set(pass, 'time', [t]);
    this._set(pass, 'mouse', [m.x, m.y]);
    // User parameters
    for (const name in this.custom) {
      if (!BUILTIN_UNIFORMS.has(name)) this._set(pass, name, this.custom[name]);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Renders one frame: Buffer A–D (those that exist), then Image.
   * p: { width, height, time, timeDelta, frame, frameRate, mouse:{x,y,cx,cy,down} (0..1), date, supersample }
   */
  render(p) {
    const gl = this.gl;
    const ss = Math.max(1, (p.supersample | 0) || 1);
    const w = p.width, h = p.height;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const rw = w * ss, rh = h * ss;

    this._ensureBuffers(rw, rh);
    for (const id of BUFFER_IDS) {
      const pass = this.passes.get(id);
      const b = this.buffers[id];
      if (!pass || !pass.program || !b) continue;
      const write = 1 - b.cur; // read the previous frame from b.cur, write the other texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo[write]);
      gl.viewport(0, 0, rw, rh);
      this._drawPass(id, pass, rw, rh, p);
      b.cur = write;
    }

    const image = this.passes.get('image');
    if (!image || !image.program) return;
    if (ss > 1) {
      this._ensureSsFbo(rw, rh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssFbo);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, rw, rh);
    this._drawPass('image', image, rw, rh, p);

    if (ss > 1) {
      // Exact 2:1 linear blit == 2x2 box filter
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ssFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, rw, rh, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  dispose() {
    const gl = this.gl;
    try {
      for (const id of [...this.passes.keys(), ...Object.keys(this.textures)]) this.removePass(id);
      BUFFER_IDS.forEach((id) => this._freeBuffer(id));
      if (this.ssFbo) { gl.deleteFramebuffer(this.ssFbo); gl.deleteTexture(this.ssTex); }
      this.samplers.forEach((s) => gl.deleteSampler(s));
      gl.deleteTexture(this.blackTex);
      gl.deleteBuffer(this.vbo);
      gl.deleteVertexArray(this.vao);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (_) { /* context may already be lost */ }
    this.passes.clear();
  }
}

window.ShaderRenderer = ShaderRenderer;
window.buildFragmentSource = buildFragmentSource;
window.BUILTIN_UNIFORMS = BUILTIN_UNIFORMS;
window.BUFFER_IDS = BUFFER_IDS;
window.glslTypeName = glslTypeName;

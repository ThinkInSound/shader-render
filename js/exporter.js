'use strict';

// ---------------------------------------------------------------------------
// Video export: render each frame offline at a fixed timestep, encode with
// WebCodecs, mux into MP4 with mp4-muxer. Output is frame-exact regardless of
// how fast the shader actually renders.
// ---------------------------------------------------------------------------

const CODEC_LABELS = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' };

/** Codec strings to try, lowest sufficient level first. */
function codecCandidates(family, w, h, fps) {
  const pixels = w * h;
  const rate = pixels * fps;
  if (family === 'avc') {
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
    const mbps = mbs * fps;
    // [level_idc, MaxMBPS, MaxFS]
    const levels = [
      [0x28, 245760, 8192], [0x2a, 522240, 8704], [0x32, 589824, 22080],
      [0x33, 983040, 36864], [0x34, 2073600, 36864], [0x3c, 4177920, 139264],
    ];
    const ok = levels.filter(([, maxMbps, maxFs]) => mbps <= maxMbps && mbs <= maxFs)
      .map(([lv]) => lv.toString(16).toUpperCase().padStart(2, '0'));
    const out = [];
    for (const profile of ['6400', '4D00', '42E0']) for (const lv of ok) out.push(`avc1.${profile}${lv}`);
    return out;
  }
  if (family === 'hevc') {
    // general_level_idc = level * 30
    const lv = pixels > 2228224 ? (rate > 2228224 * 30 ? [156, 153, 183] : [153, 150, 156])
      : (fps > 30 ? [123, 150, 153] : [120, 123, 150]);
    return lv.flatMap((l) => [`hvc1.1.6.L${l}.B0`, `hev1.1.6.L${l}.B0`]);
  }
  if (family === 'vp9') {
    const lv = pixels > 2228224 ? (fps > 30 ? ['51', '52', '60'] : ['50', '51', '52']) : (fps > 30 ? ['41', '50', '51'] : ['40', '41', '50']);
    return lv.map((l) => `vp09.00.${l}.08`);
  }
  if (family === 'av1') {
    // seq_level_idx: 4.0=8, 4.1=9, 5.0=12, 5.1=13, 5.2=14
    const lv = pixels > 2228224 ? (fps > 30 ? ['13', '14', '16'] : ['12', '13', '14']) : (fps > 30 ? ['09', '12', '13'] : ['08', '09', '12']);
    return lv.map((l) => `av01.0.${l}M.08`);
  }
  return [];
}

/** Finds an encoder config this browser can actually do. Prefers hardware encoders. */
async function findEncoderConfig({ codec, width, height, fps, bitrate }) {
  if (!('VideoEncoder' in window)) return null;
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
    for (const codecString of codecCandidates(codec, width, height, fps)) {
      const cfg = {
        codec: codecString,
        width,
        height,
        bitrate,
        framerate: fps,
        hardwareAcceleration,
        latencyMode: 'quality',
        bitrateMode: 'variable',
      };
      if (codec === 'avc') cfg.avc = { format: 'avc' };
      if (codec === 'hevc') cfg.hevc = { format: 'hevc' };
      try {
        const res = await VideoEncoder.isConfigSupported(cfg);
        if (res.supported) return cfg;
      } catch (_) { /* invalid string for this browser; keep trying */ }
    }
  }
  return null;
}

/** Yields to the event loop without timer throttling (keeps working in background tabs). */
const yieldChannel = new MessageChannel();
const yieldQueue = [];
yieldChannel.port1.onmessage = () => { const r = yieldQueue.shift(); if (r) r(); };
function yieldToEventLoop() {
  return new Promise((resolve) => { yieldQueue.push(resolve); yieldChannel.port2.postMessage(0); });
}

/** Highest whole-Mbps bitrate (below `aboveMbps`) the encoder accepts, or 0 if even 2 Mbps fails. */
async function maxSupportedMbps(settings, aboveMbps) {
  const ok = async (mbps) => !!(await findEncoderConfig({ ...settings, bitrate: mbps * 1e6 }));
  if (!(await ok(2))) return 0;
  let lo = 2, hi = Math.max(3, Math.floor(aboveMbps));
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Collects muxer output in memory as a list of chunks rather than one ArrayBuffer.
 * A single buffer (or Blob part) can't exceed ~2 GB, but a Blob built from many
 * chunks can, so long/4K videos no longer fail at the end.
 * The muxer writes sequentially, then seeks back once at the end to patch the
 * mdat header; those writes overwrite bytes in chunks we already hold.
 */
function createChunkSink() {
  const parts = []; // { pos, data: Uint8Array }, contiguous and in order
  let end = 0;
  return {
    get size() { return end; },
    onData(data, position) {
      const dataEnd = position + data.byteLength;
      // Overwrite any part of the range we already have
      if (position < end) {
        for (const p of parts) {
          const pEnd = p.pos + p.data.byteLength;
          if (pEnd <= position || p.pos >= dataEnd) continue;
          const from = Math.max(position, p.pos);
          const to = Math.min(dataEnd, pEnd);
          p.data.set(data.subarray(from - position, to - position), from - p.pos);
        }
      }
      // Append anything past the current end (zero-fill a gap, which shouldn't happen)
      if (dataEnd > end) {
        if (position > end) parts.push({ pos: end, data: new Uint8Array(position - end) });
        const start = Math.max(position, end);
        parts.push({ pos: start, data: data.slice(start - position) });
        end = dataEnd;
      }
    },
    toBlob(type) { return new Blob(parts.map((p) => p.data), { type }); },
  };
}

function waitForDequeue(encoder) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      encoder.removeEventListener('dequeue', finish);
      resolve();
    };
    encoder.addEventListener('dequeue', finish);
    setTimeout(finish, 30); // fallback for browsers without the dequeue event
  });
}

const PASS_LABELS = { image: 'Image', common: 'Common', A: 'Buffer A', B: 'Buffer B', C: 'Buffer C', D: 'Buffer D' };

/**
 * project: { common: string, passes: [{ id: 'image'|'A'..'D', code, channels: [channel x4] }] }
 */
function makeRenderer(width, height, project, custom) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new ShaderRenderer(canvas, { preserveDrawingBuffer: true });
  try {
    renderer.setCommon(project.common || '');
    for (const pass of project.passes) {
      const res = renderer.compilePass(pass.id, pass.code);
      if (!res.ok) {
        const first = res.errors[0] || {};
        const where = PASS_LABELS[first.tab] || PASS_LABELS[pass.id];
        throw new Error(`${where} failed to compile${first.line ? ` (line ${first.line})` : ''}: ${first.msg || 'unknown error'}`);
      }
      (pass.channels || []).forEach((ch, i) => renderer.setChannel(pass.id, i, ch));
    }
    if (!renderer.hasPass('image')) throw new Error('The Image pass is missing.');
  } catch (e) {
    renderer.dispose();
    throw e;
  }
  renderer.custom = JSON.parse(JSON.stringify(custom || {}));
  return { canvas, renderer };
}

function dateAt(base, seconds) {
  return new Date(base.getTime() + seconds * 1000);
}

function frameParams(opts, i, mouse) {
  const time = i / opts.fps;
  return {
    width: opts.width, height: opts.height, time,
    timeDelta: 1 / opts.fps, frame: i, frameRate: opts.fps,
    mouse, date: dateAt(opts.dateBase, time), supersample: opts.supersample,
  };
}

/**
 * Buffers carry state from frame to frame, so a render that starts later than t=0
 * first simulates the earlier frames (without encoding them).
 */
async function warmUp(renderer, opts, frames, mouse, control, onProgress) {
  if (!renderer.hasBuffers() || frames <= 0) return;
  const t0 = performance.now();
  let lastUi = 0;
  for (let i = 0; i < frames; i++) {
    if (control && control.cancelled) throw new DOMException('Export cancelled', 'AbortError');
    renderer.render(frameParams(opts, i, mouse));
    const now = performance.now();
    if (now - lastUi > 100) {
      lastUi = now;
      renderer.gl.finish();
      if (onProgress) onProgress({ phase: 'warmup', frame: i + 1, totalFrames: frames, elapsed: (now - t0) / 1000, bytes: 0 });
      await yieldToEventLoop();
    }
  }
}

/**
 * opts: { project, custom, width, height, fps, start, duration, codec, bitrate, supersample,
 *         mouse, dateBase, fileHandle?, control:{cancelled}, onProgress(info) }
 * Returns { blob?, bytes, frames, toDisk }
 */
async function exportVideo(opts) {
  const { width, height, fps, start, duration, codec, bitrate, control, onProgress } = opts;
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const firstFrame = Math.round(start * fps);

  const config = await findEncoderConfig({ codec, width, height, fps, bitrate });
  if (!config) {
    // Tell "bitrate too high" apart from "codec/size not supported"
    const maxMbps = await maxSupportedMbps({ codec, width, height, fps }, bitrate / 1e6);
    if (maxMbps) {
      throw new Error(`${CODEC_LABELS[codec]} at ${width}×${height} @ ${fps} fps doesn't accept ${Math.round(bitrate / 1e6)} Mbps in this browser. Lower the bitrate to ${maxMbps} Mbps or less.`);
    }
    throw new Error(`This browser can't encode ${CODEC_LABELS[codec]} at ${width}×${height} @ ${fps} fps. Try H.264, a lower frame rate, or Chrome/Edge.`);
  }

  const { canvas, renderer } = makeRenderer(width, height, opts.project, opts.custom);
  const mouse = { ...opts.mouse, down: false };
  let fileStream = null;
  let temp = null;       // private-storage file used when not streaming to a user-chosen file
  let finished = false;
  let encoder = null;
  let encodeError = null;
  let bytes = 0;

  try {
    // Without buffers, frames are independent: number them from the export start.
    const stateful = renderer.hasBuffers();
    if (stateful) await warmUp(renderer, opts, firstFrame, mouse, control, onProgress);

    let target;
    let sink = null;
    let writer = null;
    if (!opts.fileHandle && opts.useTempFile !== false) {
      temp = await createTempFile(Math.round((bitrate * duration) / 8));
    }
    if (opts.fileHandle || temp) {
      fileStream = opts.fileHandle ? await opts.fileHandle.createWritable() : temp.stream;
      writer = createFileWriter(fileStream);
      target = new Mp4Muxer.StreamTarget({
        onData: (data, position) => writer.onData(data, position),
        chunked: true,
        chunkSize: 16 * 1024 * 1024,
      });
    } else {
      sink = createChunkSink();
      target = new Mp4Muxer.StreamTarget({
        onData: (data, position) => sink.onData(data, position),
        chunked: true,
        chunkSize: opts.chunkSize || 16 * 1024 * 1024,
      });
    }
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec, width, height, frameRate: fps },
      // Media first, index at the end: no second in-memory copy of the video,
      // and 64-bit sizes/offsets so files over 4 GB work.
      fastStart: false,
      firstTimestampBehavior: 'offset',
    });

    encoder = new VideoEncoder({
      output: (chunk, meta) => { bytes += chunk.byteLength; muxer.addVideoChunk(chunk, meta); },
      error: (e) => { encodeError = e; },
    });
    encoder.configure(config);

    const gop = Math.max(1, Math.round(fps * 2)); // keyframe every 2 s
    const frameDur = 1e6 / fps;
    const t0 = performance.now();
    let lastUi = 0;

    for (let i = 0; i < totalFrames; i++) {
      if (control.cancelled) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      if (renderer.gl.isContextLost()) {
        throw new Error('The GPU context was lost — the shader may be too heavy at this resolution. Try 1080p or turn off supersampling.');
      }

      const fp = frameParams(opts, firstFrame + i, mouse);
      if (!stateful) fp.frame = i;
      renderer.render(fp);

      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
      encoder.encode(frame, { keyFrame: i % gop === 0 });
      frame.close();

      while (encoder.encodeQueueSize > 4 && !encodeError) await waitForDequeue(encoder);
      if (writer) {
        if (writer.error) throw writer.error;   // e.g. disk/storage full: stop now, not after the render
        await writer.drain(4);                   // don't let unwritten data pile up in memory
      }

      const now = performance.now();
      if (now - lastUi > 100 || i === totalFrames - 1) {
        lastUi = now;
        onProgress({ phase: 'render', frame: i + 1, totalFrames, elapsed: (now - t0) / 1000, bytes });
        await yieldToEventLoop();
      }
    }

    onProgress({ phase: 'finalize', frame: totalFrames, totalFrames, elapsed: (performance.now() - t0) / 1000, bytes });
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();

    if (fileStream) {
      await writer.close();
      fileStream = null;
      finished = true;
      if (temp) {
        // A disk-backed File: can be downloaded at any size, unlike an in-memory Blob
        const file = await temp.handle.getFile();
        return { blob: file, bytes: file.size, frames: totalFrames, toDisk: false };
      }
      return { bytes, frames: totalFrames, toDisk: true };
    }
    finished = true;
    return { blob: sink.toBlob('video/mp4'), bytes: sink.size, frames: totalFrames, toDisk: false };
  } catch (e) {
    throw friendlyWriteError(e);
  } finally {
    if (fileStream) { try { await fileStream.abort(); } catch (_) { /* ignore */ } }
    if (temp && !finished) { try { await temp.dir.removeEntry(temp.name); } catch (_) { /* ignore */ } }
    if (encoder && encoder.state !== 'closed') { try { encoder.close(); } catch (_) { /* ignore */ } }
    renderer.dispose();
  }
}

/**
 * Writes muxer output to a FileSystemWritableFileStream in order, remembering the
 * first failure (the muxer itself doesn't wait for writes) and allowing the
 * render loop to wait when too many writes are still pending.
 */
function createFileWriter(stream) {
  let error = null;
  let inflight = 0;
  let waiters = [];
  const settled = () => {
    inflight--;
    const w = waiters;
    waiters = [];
    w.forEach((r) => r());
  };
  return {
    get error() { return error; },
    onData(data, position) {
      inflight++;
      stream.write({ type: 'write', data, position }).then(settled, (e) => { if (!error) error = e; settled(); });
    },
    async drain(max) {
      while (inflight > max && !error) await new Promise((r) => waiters.push(r));
    },
    async close() {
      await this.drain(0);
      if (error) throw error;
      await stream.close();
    },
  };
}

function friendlyWriteError(e) {
  if (e && e.name === 'QuotaExceededError') {
    return new Error('Ran out of storage while writing the video. Turn on “Stream straight to a file” to write it directly to disk (or free up disk space), or lower the bitrate/duration.');
  }
  return e;
}

/**
 * Creates a file in the browser's private storage (OPFS) to write the export into.
 * It lives on disk, so memory use stays small and the result can be any size.
 * Earlier exports left there are removed once they're over 10 minutes old
 * (their downloads have long finished). Returns null if unavailable.
 */
async function createTempFile(estimatedBytes) {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('exports', { create: true });
    for await (const [name, handle] of dir.entries()) {
      try {
        const f = await handle.getFile();
        if (Date.now() - f.lastModified > 10 * 60 * 1000) await dir.removeEntry(name);
      } catch (_) { /* in use or already gone */ }
    }
    if (navigator.storage.estimate && estimatedBytes) {
      const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
      // Writable streams need room for a temporary copy too, so only half the free space is usable
      if ((quota - usage) / 2 < estimatedBytes * 1.25) return null;
    }
    const name = `export-${Date.now()}.mp4`;
    const handle = await dir.getFileHandle(name, { create: true });
    if (typeof handle.createWritable !== 'function') return null;
    const stream = await handle.createWritable();
    return { dir, name, handle, stream };
  } catch (_) {
    return null;
  }
}

/**
 * Renders a single frame at export resolution and returns a PNG blob.
 * opts: { project, custom, width, height, fps, time, supersample, mouse, dateBase, onProgress? }
 */
async function renderStill(opts) {
  const { canvas, renderer } = makeRenderer(opts.width, opts.height, opts.project, opts.custom);
  try {
    const mouse = { ...opts.mouse, down: false };
    const frameIndex = Math.round(opts.time * opts.fps);
    await warmUp(renderer, opts, frameIndex, mouse, null, opts.onProgress);
    const fp = frameParams(opts, frameIndex, mouse);
    fp.time = opts.time;
    fp.date = dateAt(opts.dateBase, opts.time);
    renderer.render(fp);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG.'))), 'image/png');
    });
  } finally {
    renderer.dispose();
  }
}

window.ShaderExport = { exportVideo, renderStill, findEncoderConfig, CODEC_LABELS };

'use strict';

// Built-in example shaders. Shadertoy-style shaders define mainImage();
// "classic" shaders define main() and declare their own uniforms.
// Single-pass examples use { code, channels }; multi-pass ones use
// { common, passes: { image, A..D: { code, channels } } }.

const RD_COMMON = `// Common: added to the top of every pass.
// Gray-Scott reaction-diffusion. Each of Buffers A-D runs one simulation
// step (A reads D, B reads A, C reads B, D reads C), so the pattern advances
// four steps per frame. Drag on the preview to paint.

uniform float feed;   // 0.01 0.08 0.0545
uniform float kill;   // 0.045 0.07 0.062

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// State: x = chemical U, y = chemical V.
vec4 grayScottStep(sampler2D state, vec2 fragCoord, vec3 res, vec4 mouse) {
    vec2 px = 1.0 / res.xy;
    vec2 uv = fragCoord * px;
    vec2 c = texture(state, uv).xy;

    // Seed when the buffers are empty (first frame, restart, resize)
    if (c.x == 0.0 && c.y == 0.0) {
        float v = step(0.9985, hash12(floor(fragCoord / 6.0)));
        vec2 d = fragCoord - 0.5 * res.xy;
        v = max(v, step(abs(length(d) - res.y * 0.12), 4.0));
        return vec4(1.0, v, 0.0, 1.0);
    }

    // 3x3 Laplacian
    vec2 lap = -c;
    lap += 0.2 * (texture(state, uv + vec2(px.x, 0.0)).xy + texture(state, uv - vec2(px.x, 0.0)).xy
                + texture(state, uv + vec2(0.0, px.y)).xy + texture(state, uv - vec2(0.0, px.y)).xy);
    lap += 0.05 * (texture(state, uv + px).xy + texture(state, uv - px).xy
                 + texture(state, uv + vec2(px.x, -px.y)).xy + texture(state, uv + vec2(-px.x, px.y)).xy);

    float reaction = c.x * c.y * c.y;
    vec2 n = c + vec2(1.0 * lap.x - reaction + feed * (1.0 - c.x),
                      0.5 * lap.y + reaction - (kill + feed) * c.y);

    // Paint V with the mouse
    if (mouse.z > 0.0 && length(fragCoord - mouse.xy) < res.y * 0.02) n.y = 0.9;

    return vec4(clamp(n, 0.0, 1.0), 0.0, 1.0);
}
`;

const rdBuffer = (id, from) => `// Buffer ${id}: one reaction-diffusion step. iChannel0 = Buffer ${from}.
// The step itself lives in the Common tab.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = grayScottStep(iChannel0, fragCoord, iResolution, iMouse);
}
`;

const RD_IMAGE = `// Image: shades the simulation from Buffer D (iChannel0).

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 px = 1.0 / iResolution.xy;
    vec2 uv = fragCoord * px;
    float v = texture(iChannel0, uv).y;

    // Light the surface using the gradient of V
    float dx = texture(iChannel0, uv + vec2(px.x, 0.0)).y - texture(iChannel0, uv - vec2(px.x, 0.0)).y;
    float dy = texture(iChannel0, uv + vec2(0.0, px.y)).y - texture(iChannel0, uv - vec2(0.0, px.y)).y;
    vec3 n = normalize(vec3(-dx, -dy, 0.08));
    float light = clamp(dot(n, normalize(vec3(-0.5, 0.6, 0.6))), 0.0, 1.0);

    vec3 col = mix(vec3(0.02, 0.03, 0.06), vec3(0.95, 0.55, 0.25), smoothstep(0.1, 0.45, v));
    col = mix(col, vec3(1.0, 0.95, 0.85), smoothstep(0.4, 0.7, v));
    col *= 0.55 + 0.6 * light;

    fragColor = vec4(col, 1.0);
}
`;

const bufCh = (id) => [{ kind: 'buffer', buffer: id }];

window.SHADER_EXAMPLES = [
  {
    name: 'Aurora — domain-warped noise',
    file: 'aurora.glsl',
    code: `// Aurora — domain-warped fractal noise (Shadertoy-style)
// Uniforms available: iResolution, iTime, iTimeDelta, iFrame, iFrameRate,
// iMouse, iDate, iChannel0..3, iChannelResolution[4]

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
    }
    return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.15;

    vec2 q = vec2(fbm(uv * 2.0 + t), fbm(uv * 2.0 - t + 3.1));
    vec2 r = vec2(fbm(uv * 2.0 + 4.0 * q + vec2(1.7, 9.2) + t * 1.3),
                  fbm(uv * 2.0 + 4.0 * q + vec2(8.3, 2.8) - t));
    float f = fbm(uv * 2.0 + 4.0 * r);

    vec3 col = mix(vec3(0.02, 0.03, 0.10), vec3(0.05, 0.55, 0.55), clamp(f * f * 2.0, 0.0, 1.0));
    col = mix(col, vec3(0.75, 0.25, 0.65), clamp(length(q) * 0.6, 0.0, 1.0) * 0.6);
    col = mix(col, vec3(1.0, 0.85, 0.55), clamp(r.x * r.x * 1.2, 0.0, 1.0) * 0.5);
    col *= 0.6 + 0.9 * f;
    col *= 1.0 - 0.35 * dot(uv, uv);

    fragColor = vec4(pow(col, vec3(0.9)), 1.0);
}
`,
  },
  {
    name: 'Raymarched forms — shadows & AO',
    file: 'raymarch.glsl',
    code: `// Raymarched forms — soft shadows and ambient occlusion
// Drag on the preview to orbit the camera.

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
    float ground = p.y + 1.0;
    vec3 q = p;
    q.xz *= rot(iTime * 0.4);
    q.xy *= rot(iTime * 0.3);
    float tor = sdTorus(q, vec2(0.9, 0.28));
    float s = length(p - vec3(sin(iTime) * 1.1, 0.2 + 0.3 * sin(iTime * 1.7), cos(iTime) * 1.1)) - 0.45;
    return min(ground, smin(tor, s, 0.35));
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(1e-3, 0.0);
    return normalize(vec3(map(p + e.xyy) - map(p - e.xyy),
                          map(p + e.yxy) - map(p - e.yxy),
                          map(p + e.yyx) - map(p - e.yyx)));
}

float softShadow(vec3 ro, vec3 rd) {
    float res = 1.0, t = 0.02;
    for (int i = 0; i < 48; i++) {
        float h = map(ro + rd * t);
        res = min(res, 8.0 * h / t);
        t += clamp(h, 0.02, 0.25);
        if (res < 0.001 || t > 8.0) break;
    }
    return clamp(res, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
    float o = 0.0, s = 1.0;
    for (int i = 1; i <= 5; i++) {
        float h = 0.06 * float(i);
        o += (h - map(p + n * h)) * s;
        s *= 0.7;
    }
    return clamp(1.0 - 2.5 * o, 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float a = 0.3 + (iMouse.z > 0.0 ? (iMouse.x / iResolution.x - 0.5) * 6.0 : iTime * 0.1);
    vec3 ro = vec3(3.2 * sin(a), 1.1, 3.2 * cos(a));
    vec3 ta = vec3(0.0, -0.1, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0, 1, 0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 128; i++) {
        float h = map(ro + rd * t);
        if (h < 1e-3) { hit = true; break; }
        t += h;
        if (t > 20.0) break;
    }

    vec3 sky = mix(vec3(0.55, 0.65, 0.85), vec3(0.12, 0.16, 0.3), clamp(rd.y * 1.5 + 0.3, 0.0, 1.0));
    vec3 col = sky;
    if (hit) {
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p);
        vec3 l = normalize(vec3(0.6, 0.8, 0.4));
        vec3 alb = p.y < -0.99
            ? vec3(0.35) + 0.15 * mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0)
            : 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + p.y * 2.0 + iTime * 0.5);
        float dif = clamp(dot(n, l), 0.0, 1.0) * softShadow(p + n * 0.01, l);
        float occ = ambientOcclusion(p, n);
        float spe = pow(clamp(dot(reflect(rd, n), l), 0.0, 1.0), 32.0);
        col = alb * (0.15 * occ * vec3(0.6, 0.7, 1.0) + 1.1 * dif * vec3(1.0, 0.92, 0.8)) + 0.4 * spe * dif;
        col = mix(col, sky, 1.0 - exp(-0.004 * t * t * t));
    }

    fragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}
`,
  },
  {
    name: 'Truchet weave',
    file: 'truchet.glsl',
    code: `// Truchet weave — randomly flipped quarter-circle tiles

float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float scale = 6.0;
    uv = uv * scale + vec2(iTime * 0.3, iTime * 0.15);

    vec2 id = floor(uv);
    vec2 gv = fract(uv) - 0.5;
    if (hash21(id) < 0.5) gv.x = -gv.x;

    // Resolution-independent edge width: one pixel in tile units
    float px = scale / iResolution.y;

    vec2 c = gv - sign(gv.x + gv.y + 1e-4) * 0.5;
    float d = abs(length(c) - 0.5);
    float w = 0.11;
    float mask = smoothstep(w + px, w - px, d);

    float ang = atan(c.x, c.y);
    float dir = mod(id.x + id.y, 2.0) * 2.0 - 1.0;
    float flow = sin(ang * 4.0 + iTime * 3.0 * dir) * 0.5 + 0.5;

    vec3 base = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + (id.x + id.y) * 0.04 + iTime * 0.05));
    vec3 col = vec3(0.03, 0.03, 0.05);
    col = mix(col, base * (0.4 + 0.8 * flow), mask);
    col += base * 0.25 * smoothstep(0.35, 0.0, d);
    col *= 1.0 - 0.25 * length(fragCoord / iResolution.xy - 0.5);

    fragColor = vec4(col, 1.0);
}
`,
  },
  {
    name: 'Noise texture (uses iChannel0)',
    file: 'channel-demo.glsl',
    channels: [{ kind: 'noise' }],
    code: `// Uses iChannel0 — set it to "Noise RGBA" (done automatically for this example)
// or drop any image on the iChannel0 slot.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    // Two layers of texture-driven flow
    vec2 warp = texture(iChannel0, p * 0.15 + iTime * 0.01).rg - 0.5;
    vec3 a = texture(iChannel0, p * 0.4 + warp * 0.6 + vec2(iTime * 0.02, 0.0)).rgb;
    vec3 b = texture(iChannel0, p * 1.3 - warp + vec2(0.0, iTime * 0.03)).rgb;

    float v = smoothstep(0.35, 0.75, a.r * 0.7 + b.g * 0.3);
    vec3 col = mix(vec3(0.05, 0.02, 0.08), vec3(1.0, 0.45, 0.2), v);
    col = mix(col, vec3(1.0, 0.9, 0.6), pow(v, 6.0));
    col *= 0.75 + 0.25 * cos(uv.x * 3.1416 - 1.5708);

    fragColor = vec4(col, 1.0);
}
`,
  },
  {
    name: 'Reaction-diffusion (multi-pass: Common + Buffers A–D)',
    file: 'reaction-diffusion.shader.json',
    common: RD_COMMON,
    passes: {
      image: { code: RD_IMAGE, channels: bufCh('D') },
      A: { code: rdBuffer('A', 'D'), channels: bufCh('D') },
      B: { code: rdBuffer('B', 'A'), channels: bufCh('A') },
      C: { code: rdBuffer('C', 'B'), channels: bufCh('B') },
      D: { code: rdBuffer('D', 'C'), channels: bufCh('C') },
    },
  },
  {
    name: 'Tweakable rings (custom parameters)',
    file: 'rings-params.glsl',
    code: `// Custom uniforms appear as live controls under "Shader parameters".
// Annotate them with a trailing comment:
//   float/int:  // min max default
//   vec2/vec4:  // min max x y ...
//   color:      // color r g b
//   bool:       // true | false
// The values are used for exports too.

uniform float speed;    // 0 4 1
uniform float rings;    // 2 40 14
uniform int   arms;     // 1 12 5
uniform float twist;    // 0 3 1.5
uniform vec3  colorA;   // color 0.08 0.55 1.0
uniform vec3  colorB;   // color 1.0 0.32 0.5
uniform vec2  center;   // -0.5 0.5 0 0
uniform bool  invert;   // false

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y - center;
    float r = length(p);
    float a = atan(p.y, p.x);
    float t = iTime * speed;

    float wave = sin(r * rings - t * 3.0 + sin(a * float(arms) + t) * twist);
    float edge = fwidth(wave) * 1.5;
    float m = smoothstep(-edge, edge, wave);

    vec3 col = mix(colorA, colorB, m);
    col *= 1.0 - 0.55 * r;
    if (invert) col = 1.0 - col;

    fragColor = vec4(col, 1.0);
}
`,
  },
  {
    name: 'Classic GLSL ES 1.0 (u_time / u_resolution)',
    file: 'classic.frag',
    code: `// Classic fragment shader (GLSL ES 1.00 / Book of Shaders / glslsandbox style).
// Declare the uniforms you use; supported names include:
//   u_time, u_resolution, u_mouse, u_frame, time, resolution, mouse,
//   plus every Shadertoy uniform (iTime, iResolution, ...).
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution) / u_resolution.y;
    float r = length(p);
    float a = atan(p.y, p.x);

    float rings = sin(10.0 * r - u_time * 2.0 + 2.0 * sin(a * 3.0 + u_time));
    vec3 col = 0.5 + 0.5 * cos(u_time * 0.5 + vec3(0.0, 2.0, 4.0) + r * 3.0 + rings);
    col *= 0.4 + 0.6 * smoothstep(0.0, 0.08, abs(rings));

    gl_FragColor = vec4(col * (1.2 - r * 0.5), 1.0);
}
`,
  },
];

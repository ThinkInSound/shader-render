// Fire & Ice — abstract, glitchy. Shadertoy-compatible (iTime, iResolution, iMouse).
// A chaotic, domain-warped border between turbulent fire and fractured ice,
// broken up by digital glitches: slice tears, block shifts, RGB splits,
// frame stutter and the occasional fire/ice colour swap.

#define CHAOS        1.0    // how wildly the fire/ice border writhes
#define BALANCE      0.25   // + more ice, - more fire
#define SPEED        1.0    // overall animation speed
#define FIRE_HEAT    1.0    // flame brightness
#define ICE_SPARKLE  1.0    // glints in the ice
#define GLITCH       1.0    // 0 = clean, 1 = default, 2+ = heavy
#define GRAIN        1.0    // film grain + scanlines

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// ---------------------------------------------------------------- noise ----
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i),                  hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
const mat2 OCT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = OCT * p; a *= 0.5; }
    return s / 0.96875;   // ~0..1
}
// Ridged multifractal: sharp creases, each octave weighted by the last,
// so cracks branch off cracks.
float ridged(vec2 p) {
    float s = 0.0, a = 0.5, prev = 1.0;
    for (int i = 0; i < 5; i++) {
        float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
        n *= n;
        s += n * a * prev;
        prev = n;
        p = OCT * p;
        a *= 0.5;
    }
    return s;
}

// --------------------------------------------------------------- border ----
// Signed field: > 0 fire, < 0 ice. Two layers of domain warping make it
// curl and tear apart; w returns the warp so the textures can follow it.
float border(vec2 p, float t, out vec2 w) {
    vec2 s = p * 1.1;
    vec2 q = vec2(fbm(s + vec2(0.0, t * 0.07)),
                  fbm(s + vec2(5.2, 1.3) - vec2(t * 0.05, 0.0)));
    w = vec2(fbm(s + 3.0 * q + vec2(1.7, 9.2) + t * 0.12),
             fbm(s + 3.0 * q + vec2(8.3, 2.8) - t * 0.10));
    float n = fbm(s + 3.0 * w * CHAOS);
    vec2 drift = vec2(cos(t * 0.05), sin(t * 0.05) * 0.4);   // slow tug-of-war
    return (n - 0.5) * 3.0 + dot(p, drift) * 0.5 - BALANCE;
}

// ----------------------------------------------------------------- fire ----
vec3 fireRamp(float x) {
    return vec3(1.0, 0.10, 0.02) * smoothstep(0.0, 0.40, x) * 1.2
         + vec3(1.0, 0.40, 0.05) * smoothstep(0.3, 0.75, x) * 2.0
         + vec3(1.0, 0.85, 0.45) * smoothstep(0.7, 1.10, x) * 3.5;
}

vec3 fire(vec2 p, float t, vec2 w, float depth) {
    vec2 q = p * vec2(2.2, 1.3) + w * 1.5;     // follows the border's warp
    q.y -= t * 0.9;                             // rising
    float f = fbm(q + vec2(fbm(q * 1.7 - vec2(0.0, t * 0.8)) * 1.8, 0.0));
    float turb = ridged(q * 2.3 - vec2(0.0, t * 1.4));
    float heat = smoothstep(0.35, 0.85, f) * 0.75 + turb * 0.3;
    heat *= 0.55 + 0.45 * smoothstep(0.0, 0.7, depth);
    return fireRamp(heat * FIRE_HEAT);
}

// ------------------------------------------------------------------ ice ----
vec3 ice(vec2 p, float t, vec2 w, float depth) {
    vec3 deep  = vec3(0.002, 0.008, 0.035);
    vec3 mid   = vec3(0.02, 0.14, 0.36);
    vec3 light = vec3(0.6, 0.9, 1.0);

    // Frost streaks: noise stretched along an axis that changes from region
    // to region, like crystals that grew in different directions.
    vec2 a = rot(0.6 + w.x * 3.0) * p;
    float streak = fbm(a * vec2(10.0, 1.4) + vec2(0.0, t * 0.03));
    // Branching fracture lines.
    float cracks = ridged(p * 2.6 + w * 2.0 + t * 0.015);
    // Fine rime grain.
    float grain = vnoise(p * 70.0);

    vec3 col = mix(deep, mid, smoothstep(0.25, 0.8, streak) * (0.6 + 0.4 * grain));
    col += light * smoothstep(0.5, 0.75, cracks) * 0.7;             // crisp fracture lines
    col += light * smoothstep(0.75, 0.95, cracks) * 1.2;            // brightest crossings
    col += light * smoothstep(0.72, 0.9, streak) * 0.2;
    col *= 0.7 + 0.3 * smoothstep(0.0, 0.6, depth);   // thinner, darker ice near the heat

    // Twinkling glints.
    vec2 g = p * 22.0;
    vec2 id = floor(g), f = fract(g);
    vec2 r = hash22(id);
    float d = length(f - (0.2 + 0.6 * r));
    float blink = pow(max(sin(t * (1.5 + r.x * 3.0) + r.y * 6.2832), 0.0), 12.0);
    col += vec3(0.85, 0.95, 1.0) * (1.0 - smoothstep(0.0, 0.08, d)) * blink * 3.0 * ICE_SPARKLE;
    return col;
}

// ------------------------------------------------------------ particles ----
float particles(vec2 p, float t, float dir, float speed, float seed) {
    float acc = 0.0;
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float sc = 6.0 + fk * 4.0;
        vec2 g = p * sc;
        g.y -= t * dir * speed * (0.8 + 0.3 * fk) * sc;
        g.x += sin(g.y * 0.6 + fk * 2.0 + seed) * 0.35;
        vec2 id = floor(g), f = fract(g);
        vec2 r = hash22(id + seed + fk * 31.0);
        if (r.x < 0.65) continue;
        float d = length(f - (0.2 + 0.6 * hash22(id + 7.0 + seed)));
        float flick = 0.6 + 0.4 * sin(t * 9.0 + r.y * 40.0);
        acc += (1.0 - smoothstep(0.0, 0.06, d)) * flick * (1.0 - fk * 0.25);
    }
    return acc;
}

// ---------------------------------------------------------------- scene ----
vec3 scene(vec2 p, float t) {
    vec2 w;
    float b = border(p, t, w);
    float iceAmt = 1.0 - smoothstep(-0.03, 0.03, b);

    vec3 col = vec3(0.0);
    if (iceAmt < 0.999) col += fire(p, t, w, b) * (1.0 - iceAmt);
    if (iceAmt > 0.001) col += ice(p, t, w, -b) * iceAmt;

    // Seam: a flickering, broken white-hot line with coloured halos.
    float flick = 0.5 + vnoise(p * 18.0 + vec2(t * 6.0, -t * 4.0));
    float seam = exp(-abs(b) * 28.0) * flick;
    float halo = exp(-abs(b) * 7.0);
    col += vec3(1.0, 0.9, 0.8) * seam * 1.6;
    col += mix(vec3(1.0, 0.35, 0.08), vec3(0.2, 0.6, 1.0), iceAmt) * halo * mix(0.3, 0.12, iceAmt);

    // Steam boiling off the seam.
    vec2 sq = p * vec2(3.0, 1.6) - vec2(0.0, t * 0.5);
    float steam = smoothstep(0.5, 0.85, fbm(sq + fbm(sq * 1.3) * 1.5)) * halo;
    col = mix(col, vec3(0.5, 0.52, 0.56), steam * 0.35);

    // Embers rise in the fire, snow falls in the ice.
    col += vec3(1.0, 0.55, 0.15) * particles(p, t,  1.0, 0.35,  0.0) * smoothstep(0.05, 0.3,  b) * 2.5;
    col += vec3(0.8, 0.9, 1.0)   * particles(p, t, -1.0, 0.12, 50.0) * smoothstep(0.05, 0.3, -b) * 1.2;
    return col;
}

vec3 tonemap(vec3 c) {
    c = c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14);
    return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

// ------------------------------------------------------------------ main ----
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float t = iTime * SPEED;

    // Glitch clock: random ticks plus a slow envelope so glitches cluster.
    float gt = floor(iTime * 12.0);
    float env = smoothstep(0.6, 0.9, vnoise(vec2(iTime * 0.7, 3.0)));
    float tick = step(0.85, hash12(vec2(gt, 1.0)));
    float gA = GLITCH * clamp(env + tick * 0.5, 0.0, 1.0);

    // Frame stutter: time snaps to coarse steps during bursts.
    t = mix(t, floor(t * 6.0) / 6.0, step(0.5, gA));

    // Horizontal slice tears.
    float rows = mix(18.0, 70.0, hash12(vec2(gt, 2.0)));
    float row = floor(uv.y * rows);
    float tear = step(1.0 - 0.35 * gA, hash12(vec2(row, gt)));
    float shift = tear * (hash12(vec2(row, gt + 7.0)) - 0.5) * 0.3 * gA;

    // Displaced blocks.
    vec2 blk = floor(uv * vec2(10.0, 16.0));
    float bh = hash12(blk + gt * 1.37);
    float isBlock = step(1.0 - 0.1 * gA, bh);
    vec2 boff = isBlock * (hash22(blk + gt) - 0.5) * 0.4;

    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y * 2.0;
    p += vec2(shift * 2.0, 0.0) + boff;

    vec3 col = scene(p, t);

    // RGB split only on torn rows / blocks (keeps the cost down).
    if (tear + isBlock > 0.0) {
        float s = 0.025 + 0.05 * gA * hash12(vec2(row, gt + 3.0));
        col.r = scene(p + vec2(s, 0.0), t).r;
        col.b = scene(p - vec2(s, 0.0), t).b;
    }

    col = tonemap(col);

    // Corrupted blocks: posterize, and sometimes swap fire ↔ ice colours.
    if (isBlock > 0.0) {
        col = floor(col * 5.0) / 5.0;
        if (bh > 1.0 - 0.03 * gA) col = col.bgr;
    }

    // Scanlines, grain, vignette.
    col *= 1.0 - 0.06 * GRAIN * (0.5 + 0.5 * sin(fragCoord.y * 3.14159));
    col += (hash12(fragCoord + fract(iTime * 13.0) * 500.0) - 0.5) * 0.05 * GRAIN;
    col *= 0.7 + 0.3 * pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.2);

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

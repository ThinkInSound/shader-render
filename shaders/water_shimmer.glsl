// Light shimmering on water — Shadertoy-compatible (iTime, iResolution, iMouse)
#define WAVE_ITERS_NEAR 28     // wave octaves close to the camera
#define WAVE_ITERS_FAR  10     // octaves near the horizon (less aliasing)
#define WAVE_DEPTH      0.30   // world-space wave amplitude
#define WAVE_SPEED      0.8
#define RIPPLE_DEPTH    0.035  // small wind ripples → the sparkle
#define SPARKLE_AMOUNT  1.0    // extra twinkling point glints (0 = off)
#define SPARKLE_DENSITY 6.0    // sparkle cells per world unit
#define SPARKLE_SPREAD  60.0  // lower = sparkles spread wider around the sun path
#define CAM_HEIGHT      2.2

vec3 sunDir() { return normalize(vec3(0.12, 0.08, 1.0)); }

// One sharp-crested wave: returns (height, derivative along dir).
vec2 wave(vec2 p, vec2 dir, float freq, float phase) {
    float x = dot(dir, p) * freq + phase;
    float w = exp(sin(x) - 1.0);
    return vec2(w, -w * cos(x));
}

// Sum of many rotated waves; each one slightly drags the domain of the
// next, which bunches the crests together like real wind-blown water.
float waterHeight(vec2 p, int iters) {
    float seed = 0.0, freq = 1.0, speed = 2.0, weight = 1.0;
    float sumH = 0.0, sumW = 0.0;
    float t = iTime * WAVE_SPEED;
    for (int i = 0; i < WAVE_ITERS_NEAR; i++) {
        if (i >= iters) break;
        vec2 d = vec2(sin(seed), cos(seed));
        vec2 r = wave(p, d, freq, t * speed);
        p += d * r.y * weight * 0.4;
        sumH += r.x * weight;
        sumW += weight;
        weight *= 0.82;
        freq   *= 1.18;
        speed  *= 1.07;
        seed   += 1232.399963;
    }
    return sumH / sumW;   // 0..1
}

// Gradient noise for the small wind ripples that make the glitter.
vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float gnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(dot(hash2(i),                 f),
                   dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
               mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
                   dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
float ripples(vec2 p) {
    float t = iTime;
    return gnoise(p * 3.0  + vec2( t * 0.7,  t * 0.4)) * 0.5
         + gnoise(p * 6.5  + vec2(-t * 0.9,  t * 0.6)) * 0.25
         + gnoise(p * 13.0 + vec2( t * 1.3, -t * 1.1)) * 0.125;
}

// Twinkling point sparkles: one random point per grid cell on the water,
// each blinking at its own rate. pix = pixel size in world units, used to
// keep distant sparkles from aliasing into noise.
float sparkleLayer(vec2 p, float density, float pix, float seed) {
    vec2 g  = p * density + seed;
    vec2 id = floor(g), f = fract(g);
    vec2 r  = hash2(id + seed) * 0.5 + 0.5;          // two randoms in 0..1
    float d = length(f - (0.15 + 0.7 * r));
    float rad  = 0.07 + pix * density * 1.5;
    float spot = (1.0 - smoothstep(0.0, rad, d)) * pow(0.07 / rad, 2.0);
    float rate  = 1.5 + r.x * 3.0;
    float blink = pow(max(sin(iTime * rate + r.y * 6.2832), 0.0), 8.0);
    return spot * blink;
}

// Full surface height in world units; ripples fade out with distance.
float surface(vec2 p, int iters, float rippleAmt) {
    return waterHeight(p, iters) * WAVE_DEPTH + ripples(p) * RIPPLE_DEPTH * rippleAmt;
}

vec3 sky(vec3 rd, bool withSun) {
    vec3 sd = sunDir();
    float y = max(rd.y, 0.0);
    vec3 zenith  = vec3(0.006, 0.018, 0.06);
    vec3 horizon = vec3(0.17, 0.08, 0.045);
    vec3 col = mix(horizon, zenith, pow(y, 0.35));
    float s = max(dot(rd, sd), 0.0);
    col += vec3(1.0, 0.40, 0.12) * pow(s, 10.0)  * 0.12;  // wide warm haze
    col += vec3(1.0, 0.60, 0.30) * pow(s, 150.0) * 0.6;   // halo
    if (withSun)
        col += vec3(1.0, 0.9, 0.7) * smoothstep(0.99988, 0.99993, s) * 30.0;
    return col;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    // Camera: slow drift forward; drag the mouse horizontally to turn.
    float yaw = sin(iTime * 0.07) * 0.04;
    if (iMouse.x > 0.0) yaw += (iMouse.x / iResolution.x - 0.5) * 2.5;
    vec3 ro = vec3(0.0, CAM_HEIGHT, iTime * 0.6);
    vec3 fw = normalize(vec3(sin(yaw), -0.10, cos(yaw)));
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(fw * 1.6 + rt * uv.x + up * uv.y);

    vec3 col;
    if (rd.y >= 0.0) {
        col = sky(rd, true);
    } else {
        // Intersect the mean water plane; waves only perturb the normal.
        float t = -ro.y / rd.y;
        vec3 p = ro + rd * t;

        // Fewer octaves + wider normal footprint with distance → no sparkle noise.
        float fade = clamp(t / 80.0, 0.0, 1.0);
        int iters = int(mix(float(WAVE_ITERS_NEAR), float(WAVE_ITERS_FAR), sqrt(fade)));
        float e = 0.01 + t * 0.0025;
        float rip = 1.0 - smoothstep(10.0, 60.0, t);
        float h  = surface(p.xz, iters, rip);
        float hx = surface(p.xz + vec2(e, 0.0), iters, rip);
        float hz = surface(p.xz + vec2(0.0, e), iters, rip);
        vec3 n = normalize(vec3(h - hx, e, h - hz));
        float crest = clamp(h / WAVE_DEPTH, 0.0, 1.0);
        n = normalize(mix(n, vec3(0.0, 1.0, 0.0), fade * 0.5));

        float ndv  = max(dot(n, -rd), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

        vec3 refl = reflect(rd, n);
        refl.y = abs(refl.y);
        vec3 reflCol = sky(refl, false);

        // Sun glints: a razor-sharp lobe gives the twinkling sparkles,
        // a softer lobe gives the glowing path that leads to the sun.
        float sd = max(dot(refl, sunDir()), 0.0);
        vec3 sunCol = vec3(1.0, 0.85, 0.6);
        vec3 glint = sunCol * (pow(sd, 5000.0) * 220.0 + pow(sd, 400.0) * 1.5 + pow(sd, 40.0) * 0.12);

        // Extra twinkles, gated to facets that nearly reflect the sun so they
        // cluster in the glitter path. Two layers at different scales.
        float pix = t / (iResolution.y * 1.6);
        float spk = sparkleLayer(p.xz, SPARKLE_DENSITY,       pix, 0.0)
                  + sparkleLayer(p.xz, SPARKLE_DENSITY * 2.3, pix, 17.0) * 0.7;
        spk *= 1.0 - smoothstep(20.0, 70.0, t);
        glint += sunCol * spk * pow(sd, SPARKLE_SPREAD) * 200.0 * SPARKLE_AMOUNT;

        // Water body: dark teal, a little lighter on crests (fake scattering).
        vec3 deep    = vec3(0.003, 0.02, 0.035);
        vec3 shallow = vec3(0.02, 0.10, 0.11);
        vec3 body = mix(deep, shallow, crest * crest);

        col = mix(body, reflCol, fres) + glint * mix(0.25, 1.0, fres);

        // Haze into the horizon.
        vec3 hzCol = sky(normalize(vec3(rd.x, 0.0, rd.z)), false);
        col = mix(col, hzCol, 1.0 - exp(-t * 0.006));
    }

    // Tone map (ACES approximation) + gamma + soft vignette.
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    vec2 q = fragCoord / iResolution.xy;
    col *= 0.8 + 0.2 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.15);

    fragColor = vec4(col, 1.0);
}

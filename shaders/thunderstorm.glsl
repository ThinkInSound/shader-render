// Thunderstorm — single pass, Shadertoy-compatible (iTime, iResolution).
// Looking into the eye of a churning storm, full frame. The cloud boils in
// many directions at once (each scale of eddy drifts its own way) while the
// bands curve gently around a calm, ragged eye and the whole storm turns
// slowly, a slight swirl rather than a drawn spiral. Lightning forms
// anywhere: branching bolts crawl through the cloud in random directions,
// dimmed and blurred where the cloud is thick, and light the cloud around
// them; silent sheet flashes glow from deep inside. A thunder rumble shakes
// the view a beat after the biggest discharges.

#define CHURN         1.0   // speed of the boiling cloud motion
#define TURBULENCE    1.0   // how torn and warped the cloud is
#define CLOUD_SCALE   2.6   // size of the cloud features (bigger = smaller, busier clouds)
#define STRIKE_RATE   1.0   // how often lightning fires
#define BOLT_GLOW     1.0   // brightness of visible bolts
#define CLOUD_FLASH   1.0   // brightness of the light inside the cloud
#define THUNDER_SHAKE 1.0   // 0 = off
#define SWIRL         1.0   // how much the bands curve around the eye (0 = none)
#define SWIRL_SPEED   1.0   // how fast the storm turns
#define EYE_SIZE      0.11  // radius of the calm eye (0 = no eye)

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// ---------------------------------------------------------------- noise ----
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float noise1(float x) {
    float i = floor(x), f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i),                  hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// fbm whose octaves each drift in their own slowly turning direction, so big
// and small eddies slide past and through each other: churning, not one swirl.
float churnFbm(vec2 p, float t, int oct) {
    float s = 0.0, a = 0.5, n = 0.0;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        float fi = float(i);
        float ang = fi * 2.1 + t * (0.06 + 0.04 * fi) * (mod(fi, 2.0) * 2.0 - 1.0);
        s += a * vnoise(p + vec2(cos(ang), sin(ang)) * t * (0.1 + 0.12 * fi));
        n += a;
        p = m * p;
        a *= 0.5;
    }
    return s / n;
}

// ---------------------------------------------------------------- clouds ---
// Screen point → cloud coordinates. Around the eye at the centre the bands
// get a gentle fixed twist (strongest near the middle), and the whole storm
// turns slowly as one piece, so it swirls without winding itself up.
vec2 toCloud(vec2 s, float t) {
    float r = length(s);
    float twist = SWIRL * 1.5 * exp(-r * 2.2);
    float spin = -t * 0.045 * SWIRL_SPEED;
    return rot(twist + spin) * s * CLOUD_SCALE + vec2(0.03, 0.02) * t * CHURN;
}

// Cloud density; warp is returned so lighting can reuse it.
float stormDensity(vec2 P, float t, out vec2 warp) {
    float tc = t * CHURN;
    vec2 p = P * 0.45;
    vec2 q = vec2(churnFbm(p + vec2(0.0, 1.3), tc, 3), churnFbm(p + vec2(5.2, 7.1), tc * 1.1, 3));
    vec2 r = vec2(churnFbm(p + 2.2 * q + vec2(1.7, 9.2), tc * 0.9, 3),
                  churnFbm(p + 2.2 * q + vec2(8.3, 2.8), tc * 1.2, 3));
    warp = (r - 0.5) * 1.3 * TURBULENCE;
    // Lumpy masses rather than streaks: a broad shape plus puffy detail.
    float base = churnFbm(P + warp, tc, 6);
    float puff = churnFbm(P * 2.3 + warp * 1.5 + 17.0, tc * 1.4, 3);
    return base * 0.8 + puff * 0.2;
}

// ------------------------------------------------------------- lightning ---
float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0));
}
vec2 closestOnSeg(vec2 p, vec2 a, vec2 b) {
    vec2 ba = b - a;
    return a + ba * clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
}

// Point at fraction s along a jagged bolt from a to b (ends pinned).
vec2 boltPoint(vec2 a, vec2 b, float s, float seed, float amp) {
    vec2 d = b - a;
    vec2 n = normalize(vec2(-d.y, d.x));
    float disp = (noise1(s * 5.0 + seed) - 0.5)
               + (noise1(s * 17.0 + seed * 1.7) - 0.5) * 0.4
               + (noise1(s * 55.0 + seed * 2.3) - 0.5) * 0.15;
    return mix(a, b, s) + n * disp * amp * length(d) * sqrt(sin(3.14159 * s));
}

// Distance to the part of a bolt revealed so far (reveal 0..1 from a to b).
float boltDist(vec2 p, vec2 a, vec2 b, float seed, float amp, float reveal, int n) {
    vec2 lo = min(a, b), hi = max(a, b);
    float pad = amp * length(b - a) * 0.8 + 0.08;
    if (any(lessThan(p, lo - pad)) || any(greaterThan(p, hi + pad))) return 1e3;   // quick reject
    float d = 1e3;
    vec2 prev = a;
    float fn = float(n);
    for (int i = 1; i <= 40; i++) {
        if (i > n) break;
        float s = float(i) / fn;
        if (s - 1.0 / fn > reveal) break;
        vec2 cur = boltPoint(a, b, s, seed, amp);
        d = min(d, segDist(p, prev, cur));
        prev = cur;
    }
    return d;
}

// Brightness dt seconds after a discharge: a main stroke, a few re-strokes,
// and the ragged flicker of current crawling through the cloud.
float strokes(float dt, vec4 h, float seed) {
    if (dt < 0.0) return 0.0;
    float t2 = 0.05 + 0.04 * h.y, t3 = 0.13 + 0.06 * h.z, t4 = 0.27 + 0.1 * h.w;
    float f = exp(-dt * 20.0);
    f += (0.4 + 0.6 * h.z) * exp(-max(dt - t2, 0.0) * 24.0) * step(t2, dt);
    f += (0.2 + 0.7 * h.w) * step(0.3, h.y) * exp(-max(dt - t3, 0.0) * 24.0) * step(t3, dt);
    f += 0.6 * h.x * step(0.5, h.z) * exp(-max(dt - t4, 0.0) * 14.0) * step(t4, dt);
    f *= 0.7 + 0.3 * noise1(dt * 60.0 + seed);
    return f;
}

#define CHANNELS 6
// Each channel fires once per period at a random moment. Returns false when
// the channel is idle around time t; otherwise the event's timing and seeds.
bool lightningEvent(int c, float t, out float dt, out vec4 h, out float seed) {
    float fc = float(c);
    float period = (1.9 + fc * 0.9) / STRIKE_RATE;
    float tt = t + fc * 0.77;
    float slot = floor(tt / period);
    float ts = slot * period + hash11(slot * 7.13 + fc * 31.7) * period * 0.65 + 0.1;
    dt = tt - ts;
    seed = slot * 13.7 + fc * 101.3;
    h = vec4(hash11(seed + 1.1), hash11(seed + 2.3), hash11(seed + 3.7), hash11(seed + 4.9));
    return dt > -0.1 && dt < 2.5;
}

// Where an event's bolt runs: starts anywhere in frame and heads in a random
// direction, loosely across the frame so most of it stays in view.
void boltEnds(vec4 h, float seed, out vec2 a, out vec2 b) {
    a = vec2((h.y - 0.5) * 1.5, (hash11(seed + 6.1) - 0.5) * 0.8);
    float toCentre = atan(-a.y + 0.001, -a.x);
    float ang = toCentre + (hash11(seed + 7.3) - 0.5) * 2.6;
    float len = 0.3 + 0.5 * h.w;
    b = a + vec2(cos(ang), sin(ang)) * len;
}

// ------------------------------------------------------------------ main ----
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float t = iTime;
    vec2 s = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    // Thunder: a rumble that shakes the view a beat after big discharges.
    float shake = 0.0;
    for (int c = 0; c < CHANNELS; c++) {
        float dt, seed; vec4 h;
        if (!lightningEvent(c, t, dt, h, seed) || h.x < 0.3) continue;
        float big = h.z;
        float delay = 0.25 + (1.0 - big) * 0.9;
        shake += big * big * exp(-max(dt - delay, 0.0) * 2.5) * step(delay, dt);
    }
    s += shake * THUNDER_SHAKE * 0.006 * vec2(noise1(t * 37.0) - 0.5, noise1(t * 29.0 + 5.0) - 0.5);

    // ---- Cloud ----
    vec2 P = toCloud(s, t);
    vec2 warp;
    float d = stormDensity(P, t, warp);

    // The eye: a calm, thin opening with a ragged edge, ringed by a denser
    // eyewall. Its edge wobbles with angle and time so it never looks drawn.
    float r = length(s);
    vec2 dir = s / max(r, 1e-4);                                // noise on a circle: no seam
    float eyeR = EYE_SIZE * (1.0 + 0.35 * (vnoise(dir * 1.5 + vec2(t * 0.15, 3.0)) - 0.5)
                                 + 0.2 * (d - 0.5));            // edge follows the cloud itself
    float eyewall = exp(-pow((r - eyeR * 1.6) / (eyeR * 1.4 + 1e-3), 2.0));
    d += 0.1 * eyewall * step(0.001, EYE_SIZE);
    float dens = smoothstep(0.34, 0.66, d);
    float eye = 1.0 - smoothstep(eyeR * 0.3, eyeR * 1.7, r);   // 1 in the middle of the eye
    dens *= 1.0 - 0.55 * eye;                                   // thin wisps still drift through
    // Faux relief: compare with the density a little up and to the left, so
    // billows get a lit edge and a shaded underside.
    float dUp = churnFbm(P + vec2(-0.2, 0.3) + warp, t * CHURN, 5);
    float relief = clamp((d - dUp) * 4.0, -1.0, 1.0);
    vec3 col = mix(vec3(0.075, 0.08, 0.098), vec3(0.01, 0.012, 0.018), dens);
    col *= 1.0 + 0.6 * relief * (1.0 - 0.5 * eye);
    col = mix(col, col * vec3(0.85, 0.9, 1.05), eye);           // a touch cooler and calmer in the eye

    // ---- Lightning ----
    vec3 lit = vec3(0.0);
    float boltGlow = 0.0, skyFlash = 0.0;
    for (int c = 0; c < CHANNELS; c++) {
        float dt, seed; vec4 h;
        if (!lightningEvent(c, t, dt, h, seed) || dt > 1.2) continue;
        bool bolt = h.x > 0.3;
        float big = h.z;
        vec2 a, b;
        boltEnds(h, seed, a, b);

        vec2 lightAt;               // nearest point of the discharge, in view space
        float amount;
        if (bolt) {
            float leader = clamp((dt + 0.08) / 0.08, 0.0, 1.0);        // bolt races out from a
            float bright = dt < 0.0 ? 0.15 : strokes(dt, h, seed) + 0.06 * exp(-dt * 4.0);
            float w = mix(0.0009, 0.0024, big);
            float dm = boltDist(s, a, b, seed, 0.25, leader, 34);
            float glow = exp(-dm / w) * 2.5 + exp(-dm / (w * mix(14.0, 30.0, dens))) * 0.5;
            // Branches fork off the main channel and fade sooner.
            for (int k = 0; k < 5; k++) {
                float fk = float(k);
                float hb = hash11(seed + fk * 7.7);
                float sb = 0.08 + 0.75 * hb;
                if (leader < sb) continue;
                vec2 start = boltPoint(a, b, sb, seed, 0.25);
                float side = hash11(seed + fk * 3.3) > 0.5 ? 1.0 : -1.0;
                vec2 dir = rot(side * (0.35 + 0.65 * hb)) * normalize(b - a);
                vec2 end = start + dir * length(b - a) * (0.15 + 0.3 * hash11(seed + fk * 5.1));
                float reveal = clamp((leader - sb) / (1.0 - sb + 1e-3), 0.0, 1.0);
                float db = boltDist(s, start, end, seed + fk * 13.0, 0.35, reveal, 14);
                glow += (exp(-db / (w * 0.7)) * 1.2 + exp(-db / (w * 10.0)) * 0.2) * exp(-max(dt, 0.0) * 5.0);
            }
            // Thick cloud swallows the sharp core and leaves a blurry glow.
            boltGlow += glow * bright * (0.6 + 0.8 * big) * mix(1.0, 0.3, dens);
            lightAt = closestOnSeg(s, a, mix(a, b, leader));
            amount = bright * (1.5 + 2.0 * big);
        } else {
            // Sheet lightning: no visible channel, a pocket glows from deep inside.
            if (dt < 0.0) continue;
            float flick = (0.4 + 0.6 * noise1(dt * 45.0 + seed)) * (0.5 + 0.5 * noise1(dt * 12.0 + seed * 2.0));
            amount = flick * exp(-dt * 3.5) * smoothstep(0.0, 0.03, dt) * (1.5 + 1.5 * big);
            lightAt = a;
        }
        skyFlash += amount * 0.15;
        if (amount < 0.01) continue;

        // Light the cloud, blocked by the cloud between this point and the discharge,
        // so pockets light up with dark lumps of cloud in front of them.
        vec2 L = toCloud(lightAt, t);
        vec2 toL = L - P;
        float dist = length(toL);
        float od = 0.0;
        for (int k = 1; k <= 6; k++) {
            vec2 sp = P + toL * (float(k) / 7.0);
            od += smoothstep(0.3, 0.7, churnFbm(sp + warp, t * CHURN, 3));
        }
        float T = exp(-1.0 * od / 6.0 * dist);
        lit += vec3(0.72, 0.78, 1.0) * amount * T / (1.0 + dist * dist * 1.2)
             * (0.25 + 0.75 * dens) * (1.0 + 0.5 * relief);
    }
    col += lit * 0.35 * CLOUD_FLASH + vec3(0.6, 0.65, 0.8) * skyFlash * 0.02;
    col += vec3(0.82, 0.86, 1.0) * boltGlow * BOLT_GLOW;

    // Tone map (ACES approximation), vignette, grain.
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    vec2 uv = fragCoord / iResolution.xy;
    col *= 0.6 + 0.4 * pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.25);
    col += (hash12(fragCoord + fract(t) * 300.0) - 0.5) * 0.02;

    fragColor = vec4(col, 1.0);
}

// Crowd Shadows — single pass, Shadertoy-compatible (iTime, iResolution, iMouse).
// Paste into the Image tab; no buffers or build step needed.
//
// Low golden sun behind a dancing crowd throws their shadows onto an old,
// peeling yellow-plaster wall: heads and shoulders merge into a dark band,
// arms wave above it, slivers of sunlight slip through the gaps.
// Drag to move the sun (changes shadow angle and height).

#define PEOPLE      22      // crowd size (two loose rows)
#define WILDNESS    1.0     // how much they bounce, sway and wave
#define TEMPO       1.0
#define ARMS_UP     0.45    // how often arms are raised (0..1)
#define SUN_SOFT    0.05    // shadow blur per metre between person and wall
#define SUN_WARMTH  1.0
#define LIGHT_SHIMMER 0.15  // gentle variation in the sunlight (0 = steady)

// ---------------------------------------------------------------- noise ----
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i),                  hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
    return s / 0.96875;
}

// ----------------------------------------------------------------- wall ----
// Old wall: stone blocks, partly covered by white base plaster and a yellow
// paint coat that has flaked away in patches. Returns albedo; h = relief.
vec3 wallMaterial(vec2 w, out float h) {
    // Stone plinth along the bottom.
    if (w.y < 0.3) {
        float g = 0.75 + 0.25 * fbm(w * 7.0);
        float lip = smoothstep(0.24, 0.3, w.y);                 // top edge catches light
        h = 0.03 + 0.02 * lip + (fbm(w * 12.0) - 0.5) * 0.01;
        if (w.y < 0.0) {                                        // pavement
            h = -0.05 + (fbm(w * 9.0) - 0.5) * 0.01;
            return vec3(0.28, 0.27, 0.26) * g;
        }
        return vec3(0.40, 0.40, 0.39) * g;
    }

    // Exposed rubble stone / grey render: rough, pitted, faint irregular joints.
    float rough = fbm(w * 4.0 + 5.0);
    float pits  = smoothstep(0.62, 0.75, fbm(w * 11.0 + 2.0));
    vec3 stone = vec3(0.44, 0.44, 0.43) * (0.55 + 0.5 * rough);
    stone *= 1.0 - 0.4 * pits;

    // Where the plaster survives, and where the paint on top of it survives.
    float n = fbm(w * 0.8 + 3.0) + 0.15 * fbm(w * 6.0);
    float plaster = smoothstep(0.385, 0.395, n);
    float paint   = smoothstep(0.398, 0.41, n + 0.04 * (vnoise(w * 30.0) - 0.5));

    vec3 basePlaster = vec3(0.80, 0.78, 0.72) * (0.85 + 0.15 * fbm(w * 5.0));
    // Ochre paint: saturated yellow with orange and faded-cream patches.
    float pv = fbm(w * 1.6 + 1.0);
    vec3 ochre = mix(vec3(0.92, 0.48, 0.07), vec3(0.97, 0.68, 0.12), smoothstep(0.3, 0.6, pv));
    ochre = mix(ochre, vec3(0.95, 0.80, 0.48), smoothstep(0.62, 0.8, fbm(w * 2.5 + 8.0)) * 0.7);
    ochre *= 0.88 + 0.12 * vnoise(w * 40.0);

    vec3 col = mix(stone, mix(basePlaster, ochre, paint), plaster);

    // Grime and water stains running down.
    col *= 0.8 + 0.2 * fbm(vec2(w.x * 3.0, w.y * 0.6) + 11.0);
    col *= mix(0.8, 1.0, smoothstep(0.3, 1.0, w.y));           // dirtier near the ground

    h = plaster * 0.012 + paint * 0.003 - pits * 0.003;
    return col;
}

// Cheaper relief-only version of the wall, used for the bump normal.
float wallHeight(vec2 w) {
    if (w.y < 0.3) return w.y < 0.0 ? -0.05 : 0.03 + 0.02 * smoothstep(0.24, 0.3, w.y);
    float n = fbm(w * 0.8 + 3.0) + 0.15 * vnoise(w * 6.0);
    return smoothstep(0.385, 0.395, n) * 0.012 + smoothstep(0.398, 0.41, n) * 0.003
         + (vnoise(w * 11.0 + 2.0) - 0.5) * 0.003;
}

// --------------------------------------------------------------- people ----
#define PELVIS 0
#define CHEST  1
#define HEAD   2
#define SH_L   3
#define EL_L   4
#define HD_L   5
#define SH_R   6
#define EL_R   7
#define HD_R   8
#define KN_L   9
#define FT_L   10
#define KN_R   11
#define FT_R   12
#define HAIR   13
#define NJ     14

// Where person i stands (x along the wall, z out from it) and their height.
vec3 personBase(int i, out float height) {
    float fi = float(i);
    float r1 = hash12(vec2(fi, 1.3)), r2 = hash12(vec2(fi, 7.9));
    height = 1.6 + 0.28 * r2;
    // Two loose rows: front row nearer the wall, back row offset between them.
    float row = mod(fi, 2.0);
    float x = -3.6 + floor(fi * 0.5) * 0.62 + row * 0.31 + (r1 - 0.5) * 0.25;
    float z = mix(0.8, 1.7, row) + 0.4 * hash12(vec2(fi, 4.1));
    return vec3(x, 0.0, z);
}

void person(int i, float t, out vec3 J[NJ]) {
    float fi = float(i);
    float seed = hash12(vec2(fi, 9.4));
    float W = WILDNESS;
    float height;
    vec3 base = personBase(i, height);
    float k = height / 1.75;

    float ph = t * (4.0 + 1.5 * seed) * TEMPO + seed * 30.0;
    base.x += sin(t * 0.4 + seed * 6.0) * 0.12 * W;                  // shuffling
    float bob  = abs(sin(ph)) * 0.07 * W;
    float sway = sin(ph * 0.5 + seed * 3.0) * 0.18 * W;

    vec3 up = normalize(vec3(sway, 1.0, 0.0));
    J[PELVIS] = vec3(0.0, 0.95 * k + bob, 0.0);
    J[CHEST]  = J[PELVIS] + up * 0.5 * k;
    J[HEAD]   = J[CHEST] + up * 0.3 * k + vec3(sin(ph * 0.5 + 1.0) * 0.04 * W, 0.0, 0.0);
    J[HAIR]   = J[HEAD] + vec3(sin(ph * 0.5) * 0.08 * W - 0.05, -0.1, 0.0);
    vec3 side = vec3(up.y, -up.x, 0.0);

    // Arms go up and come down over time; raised arms wave overhead.
    for (int a = 0; a < 2; a++) {
        float s = a == 0 ? -1.0 : 1.0;
        float raise = smoothstep(0.35, 0.65, vnoise(vec2(t * 0.35 + fi * 3.1 + float(a) * 1.7, seed * 9.0)) + ARMS_UP - 0.5);
        float wave = sin(ph * 0.75 + float(a) * 1.3 + seed * 4.0);
        float ang  = mix(0.25 + 0.1 * wave, 2.7 + 0.35 * wave * W, raise);   // 0 = down, pi = straight up
        float bend = mix(0.2, 0.45 + 0.45 * sin(ph * 0.75 + 2.0), raise);   // elbows flex as they wave
        vec3 sh = J[CHEST] + side * s * 0.19 * k;
        vec3 d1 = vec3(s * sin(ang), -cos(ang), 0.0);
        vec3 d2 = vec3(s * sin(ang + bend), -cos(ang + bend), 0.0);
        vec3 el = sh + d1 * 0.3 * k;
        vec3 hd = el + d2 * 0.28 * k;
        if (a == 0) { J[SH_L] = sh; J[EL_L] = el; J[HD_L] = hd; }
        else        { J[SH_R] = sh; J[EL_R] = el; J[HD_R] = hd; }
    }
    // Legs: bouncing on the spot.
    for (int a = 0; a < 2; a++) {
        float s = a == 0 ? -1.0 : 1.0;
        vec3 hip = J[PELVIS] + vec3(0.1 * s, 0.0, 0.0);
        vec3 kn = hip + vec3(0.03 * s, -0.46 * k + bob * 0.5, 0.0);
        vec3 ft = vec3(hip.x + 0.04 * s, 0.0, 0.0);
        if (a == 0) { J[KN_L] = kn; J[FT_L] = ft; } else { J[KN_R] = kn; J[FT_R] = ft; }
    }
    for (int j = 0; j < NJ; j++) J[j] += base;
}

float capsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a, ba = b - a;
    float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * hh) - mix(ra, rb, hh);
}

// Sunlight reaching wall point w past person i (0..1). The sun is far away,
// so every joint is shifted along the light direction onto the wall.
float personVis(vec2 w, vec3 J[NJ], vec3 L) {
    vec2 P[NJ];
    for (int j = 0; j < NJ; j++) P[j] = J[j].xy - L.xy / L.z * J[j].z;
    // Heads, shoulders and raised arms read clearly; everything below the
    // chest is a solid mass (clothes, legs, the people beside them).
    float d = length(w - P[HEAD]) - 0.125;
    d = min(d, length(w - P[HAIR]) - 0.085);
    d = min(d, capsule(w, P[CHEST],  P[HEAD],  0.08, 0.07));
    d = min(d, capsule(w, P[SH_L],   P[SH_R],  0.11, 0.11));
    d = min(d, capsule(w, P[PELVIS], P[CHEST], 0.22, 0.22));
    d = min(d, capsule(w, (P[FT_L] + P[FT_R]) * 0.5, P[PELVIS], 0.2, 0.22));
    d = min(d, capsule(w, P[SH_L],   P[EL_L],  0.065, 0.055));
    d = min(d, capsule(w, P[EL_L],   P[HD_L],  0.055, 0.05));
    d = min(d, capsule(w, P[SH_R],   P[EL_R],  0.065, 0.055));
    d = min(d, capsule(w, P[EL_R],   P[HD_R],  0.055, 0.05));
    d = min(d, length(w - P[HD_L]) - 0.055);                    // hands
    d = min(d, length(w - P[HD_R]) - 0.055);
    float pen = J[CHEST].z * SUN_SOFT + 0.012;
    return smoothstep(-pen, pen, d);
}

// ------------------------------------------------------------------ main ----
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    // Wall coordinates in metres: pavement at the bottom, ~2.7 m of wall.
    vec2 w = vec2(p.x * 2.7, (p.y + 0.5) * 2.7 - 0.12);

    // Low sun, slightly to the left, behind the crowd.
    vec3 L = normalize(vec3(0.25, 0.33, 1.0));
    if (iMouse.x > 0.0) {
        vec2 m = iMouse.xy / iResolution.xy;
        L = normalize(vec3((m.x - 0.5) * 1.2, 0.1 + 0.6 * m.y, 1.0));
    }

    // Crowd shadows.
    float vis = 1.0;
    vec3 J[NJ];
    for (int i = 0; i < PEOPLE; i++) {
        float hgt;
        vec3 b = personBase(i, hgt);
        float sx = b.x - L.x / L.z * b.z;
        if (abs(w.x - sx) > 1.05 || w.y > hgt * 1.4) continue;   // can't reach this pixel
        person(i, t, J);
        vis *= personVis(w, J, L);
    }

    // Wall relief, lit by the low sun: peeled edges catch light or cast tiny shadows.
    float h;
    vec3 albedo = wallMaterial(w, h);
    float e = 0.004;
    float h0 = wallHeight(w);
    float hx = wallHeight(w + vec2(e, 0.0));
    float hy = wallHeight(w + vec2(0.0, e));
    vec3 n = normalize(vec3(-(hx - h0) / e, -(hy - h0) / e, 1.0));
    float relief = clamp(dot(n, L) / L.z, 0.0, 1.6);

    float shimmer = 1.0 + LIGHT_SHIMMER * (vnoise(vec2(t * 2.0, 3.0)) - 0.5);
    vec3 sunCol = mix(vec3(1.0, 0.8, 0.55), vec3(1.0, 0.66, 0.32), SUN_WARMTH) * 1.75 * shimmer;
    vec3 skyCol = vec3(0.42, 0.48, 0.60) * 0.28;                // cool shade
    float ao = 0.75 + 0.25 * smoothstep(-0.01, 0.012, h);       // recesses a bit darker

    // Under blue skylight the yellow paint goes greyish, so shade the
    // desaturated colour and light the full colour.
    vec3 shadeAlbedo = mix(albedo, vec3(dot(albedo, vec3(0.3, 0.5, 0.2))), 0.65);
    vec3 col = albedo * sunCol * vis * relief + shadeAlbedo * skyCol * ao * (0.85 + 0.15 * relief);

    // Grade: tone map (ACES approx), gamma, warm vignette, grain.
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    vec2 uv = fragCoord / iResolution.xy;
    col *= 0.7 + 0.3 * pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.25);
    col += (hash12(fragCoord + fract(t) * 300.0) - 0.5) * 0.025;

    fragColor = vec4(col, 1.0);
}

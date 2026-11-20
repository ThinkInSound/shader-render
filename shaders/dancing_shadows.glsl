// Dancing Shadows — Shadertoy-compatible (iTime, iResolution, iMouse)
// People dance wildly around a campfire; the low, flickering fire throws
// their shadows huge and stretched onto the wall behind them.
//
// Each dancer is a 3D stick figure. Every joint is projected from the fire
// onto the wall, so a dancer near the flames casts a giant, blurry shadow
// and one near the wall casts a smaller, sharper one, exactly like the real
// thing. Two flame "tongues" act as two lights, which doubles and jitters
// the shadow edges. Drag horizontally to move the fire.

#define DANCERS     18      // split across three rings
#define WILDNESS    1.0     // how big the moves are
#define TEMPO       1.0     // dance + circling speed
#define FIRE_DIST   3.0     // fire's distance from the wall (m)
#define FIRE_HEIGHT 0.35    // low fire → long, tall shadows
#define FLICKER     1.0
#define SOFTNESS    1.0     // shadow blur multiplier
#define HEAT_HAZE   1.0     // shimmer above the fire
#define STROBE      0.35    // 0 = off; strength of the occasional strobe bursts
#define STROBE_RATE 9.0     // flashes per second during a burst

#define LIGHT_R     0.13    // size of a flame tongue (drives penumbra)

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

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
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
    return s / 0.9375;
}

// --------------------------------------------------------------- dancer ----
// Joint indices
#define PELVIS 0
#define CHEST  1
#define NECK   2
#define HEAD   3
#define SH_L   4
#define EL_L   5
#define HD_L   6
#define SH_R   7
#define EL_R   8
#define HD_R   9
#define HIP_L  10
#define KN_L   11
#define FT_L   12
#define HIP_R  13
#define KN_R   14
#define FT_R   15
#define HAIR   16
#define HEM    17      // bottom of the skirt (dancers that wear one)
#define NJ     18

// Where dancer i stands: three rings around the fire, the middle one
// circling the opposite way.
vec3 dancerBase(int i, float t, float fireX, out float th, out float dir) {
    int ring = i % 3;
    float R = 0.7 + 0.25 * float(ring);     // close to the fire, far from the wall
    dir = ring == 1 ? -1.0 : 1.0;
    float seed = hash12(vec2(float(i) * 7.31, 3.7));
    th = dir * t * (0.3 + 0.12 * seed) * TEMPO + float(i) * 2.39996;
    return vec3(fireX + R * sin(th), 0.0, FIRE_DIST - R * cos(th));
}

// Builds one dancer's skeleton in world space for time t.
void dancer(int i, float t, float fireX, out vec3 J[NJ]) {
    float fi = float(i);
    float seed = hash12(vec2(fi * 7.31, 3.7));
    float W = WILDNESS;

    float th, dir;
    vec3 base = dancerBase(i, t, fireX, th, dir);

    float ph = t * (5.0 + 2.5 * seed) * TEMPO + seed * 20.0;    // dance phase
    float jump  = pow(abs(sin(ph * 0.5)), 0.6) * 0.3 * W;
    float yaw   = th * dir + 1.5708 + sin(ph * 0.23 + seed * 6.0) * 2.2 * W;  // twirls
    float leanS = sin(ph * 0.5 + seed * 3.0) * 0.4 * W;
    float leanF = 0.15 + sin(ph * 0.5 + 1.0) * 0.3 * W;

    vec3 up   = normalize(vec3(sin(leanS), 1.0, sin(leanF)));
    vec3 side = normalize(vec3(up.y, -up.x, 0.0));
    J[PELVIS] = vec3(0.0, 0.95 + jump, 0.0);
    J[CHEST]  = J[PELVIS] + up * 0.5;
    J[NECK]   = J[CHEST] + up * 0.1;
    J[HEAD]   = J[NECK] + up * 0.15 + vec3(sin(ph) * 0.04 * W, 0.0, 0.0);
    J[HAIR]   = J[HEAD] + vec3(sin(ph * 0.5 + 1.0) * 0.4 * W, -0.2 + 0.15 * sin(ph), -0.3);
    // Skirt flares out and swings with the hips.
    J[HEM]    = J[PELVIS] + vec3(sin(ph * 0.5 + 2.0) * 0.15 * W, -0.38 + 0.06 * sin(ph * 2.0), 0.0);

    // Arms: a = raise angle (0 down, pi straight up), b = elbow bend,
    // beta = swing forward/back.
    for (int k = 0; k < 2; k++) {
        float s = k == 0 ? -1.0 : 1.0;
        float off = k == 0 ? 0.0 : 3.14159;
        float a    = 2.0 + 1.1 * sin(ph + off + seed * 2.0) * W;
        float b    = 0.2 + 1.0 * (0.5 + 0.5 * sin(ph * 2.0 + s)) * W;
        float beta = sin(ph * 0.7 + s * 1.3) * 0.9 * W;
        vec3 sh = J[CHEST] + side * 0.2 * s;
        vec3 d1 = vec3(s * sin(a) * cos(beta), -cos(a), sin(a) * sin(beta));
        vec3 d2 = vec3(s * sin(a + b) * cos(beta), -cos(a + b), sin(a + b) * sin(beta));
        vec3 el = sh + d1 * 0.3;
        vec3 hd = el + d2 * 0.28;
        if (k == 0) { J[SH_L] = sh; J[EL_L] = el; J[HD_L] = hd; }
        else        { J[SH_R] = sh; J[EL_R] = el; J[HD_R] = hd; }
    }

    // Legs: alternating steps, a high kick on one side, knees bending.
    for (int k = 0; k < 2; k++) {
        float s = k == 0 ? -1.0 : 1.0;
        float off = k == 0 ? 0.0 : 3.14159;
        float alpha  = sin(ph + off) * 0.6 * W
                     + (k == 1 ? max(0.0, sin(ph * 0.5 + seed * 5.0)) * 1.1 * W : 0.0);
        float spread = 0.12 + 0.3 * max(0.0, sin(ph * 0.5 + 2.0)) * W;
        float kb     = 0.2 + 1.0 * max(0.0, sin(ph + 3.14159 - off)) * W;
        vec3 hip = J[PELVIS] + vec3(0.1 * s, 0.0, 0.0);
        vec3 d1 = normalize(vec3(s * spread, -cos(alpha), sin(alpha)));
        vec3 d2 = normalize(vec3(s * spread * 0.5, -cos(alpha - kb), sin(alpha - kb)));
        vec3 kn = hip + d1 * 0.46;
        vec3 ft = kn + d2 * 0.46;
        if (k == 0) { J[HIP_L] = hip; J[KN_L] = kn; J[FT_L] = ft; }
        else        { J[HIP_R] = hip; J[KN_R] = kn; J[FT_R] = ft; }
    }

    // Turn and place in the world.
    float c = cos(yaw), sn = sin(yaw);
    for (int j = 0; j < NJ; j++) {
        vec3 v = J[j];
        J[j] = vec3(c * v.x + sn * v.z, v.y, -sn * v.x + c * v.z) + base;
    }
}

// ------------------------------------------------------------ projection ----
// Project a 3D point from light L onto the wall (z = 0). s = magnification.
vec2 proj(vec3 P, vec3 L, out float s) {
    s = L.z / max(L.z - P.z, 0.3);   // limbs reaching past the fire don't explode
    return L.xy + (P.xy - L.xy) * s;
}

// Tapered capsule between projected joints a, b with radii ra, rb.
float capsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
}

// How much of light L reaches wall point w past one dancer (0..1).
float dancerVis(vec2 w, vec3 J[NJ], vec3 L, bool skirt) {
    float den = L.z - J[PELVIS].z;
    if (den < 0.3) return 1.0;                 // behind or inside the fire: no shadow on the wall
    // Penumbra grows with the dancer's distance from the wall vs. the fire.
    float pen = (LIGHT_R * J[PELVIS].z / den + 0.04) * SOFTNESS;
    float s0;
    vec2 c = proj(J[PELVIS], L, s0);
    if (length(w - c) > s0 * 1.7 + pen * 2.0 + 0.3) return 1.0;   // far from this shadow: skip

    vec2 P[NJ];
    float S[NJ];
    for (int j = 0; j < NJ; j++) P[j] = proj(J[j], L, S[j]);

    float d = length(w - P[HEAD]) - 0.12 * S[HEAD];
    d = min(d, capsule(w, P[PELVIS], P[CHEST], 0.15 * S[PELVIS], 0.17 * S[CHEST]));
    d = min(d, capsule(w, P[CHEST],  P[NECK],  0.08 * S[CHEST],  0.055 * S[NECK]));
    d = min(d, capsule(w, P[NECK],   P[HEAD],  0.055 * S[NECK],  0.06 * S[HEAD]));
    d = min(d, capsule(w, P[HEAD],   P[HAIR],  0.1 * S[HEAD],    0.03 * S[HAIR]));
    d = min(d, capsule(w, P[SH_L],   P[SH_R],  0.075 * S[SH_L],  0.075 * S[SH_R]));
    d = min(d, capsule(w, P[SH_L],   P[EL_L],  0.065 * S[SH_L],  0.055 * S[EL_L]));
    d = min(d, capsule(w, P[EL_L],   P[HD_L],  0.055 * S[EL_L],  0.045 * S[HD_L]));
    d = min(d, capsule(w, P[SH_R],   P[EL_R],  0.065 * S[SH_R],  0.055 * S[EL_R]));
    d = min(d, capsule(w, P[EL_R],   P[HD_R],  0.055 * S[EL_R],  0.045 * S[HD_R]));
    d = min(d, capsule(w, P[HIP_L],  P[HIP_R], 0.13 * S[HIP_L],  0.13 * S[HIP_R]));
    d = min(d, capsule(w, P[HIP_L],  P[KN_L],  0.09 * S[HIP_L],  0.065 * S[KN_L]));
    d = min(d, capsule(w, P[KN_L],   P[FT_L],  0.065 * S[KN_L],  0.05 * S[FT_L]));
    d = min(d, capsule(w, P[HIP_R],  P[KN_R],  0.09 * S[HIP_R],  0.065 * S[KN_R]));
    d = min(d, capsule(w, P[KN_R],   P[FT_R],  0.065 * S[KN_R],  0.05 * S[FT_R]));
    if (skirt) d = min(d, capsule(w, P[PELVIS], P[HEM], 0.12 * S[PELVIS], 0.2 * S[HEM]));

    return smoothstep(-pen, pen, d);
}

// ------------------------------------------------------------------ main ----
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    // Wall coordinates in metres: base just below the frame, ~7 m tall.
    vec2 w = vec2(p.x * 7.0, (p.y + 0.5) * 7.0 + 0.05);

    // Strobe: rare, short bursts of flashing on top of the firelight.
    float env   = smoothstep(0.62, 0.85, vnoise(vec2(t * 0.3, 11.0))) * STROBE;
    float flash = step(fract(t * STROBE_RATE), 0.4);
    float strobeGain = mix(1.0, mix(0.12, 1.6, flash), env);
    float td = t;
    float fireX = iMouse.x > 0.0 ? (iMouse.x / iResolution.x - 0.5) * 3.0 : 0.0;

    // Heat shimmer rising from the fire bends everything a little.
    vec2 hz = vec2(vnoise(w * 3.0 + vec2(0.0, -t * 2.5)), vnoise(w * 3.0 + vec2(4.0, -t * 2.2))) - 0.5;
    w += hz * 0.05 * HEAT_HAZE * exp(-abs(w.x - fireX) * 0.6) * exp(-w.y * 0.35);

    // Two flame tongues that flicker independently: fast crackle, slower
    // breathing, plus flare-ups where the fire surges and the shadows jump.
    float flare = smoothstep(0.55, 0.9, vnoise(vec2(t * 1.3, 4.0)));
    float fl1 = 0.75 + FLICKER * (0.16 * sin(t * 13.0) + 0.1 * sin(t * 29.0 + 1.0)
              + 0.55 * (vnoise(vec2(t * 9.0, 1.0)) - 0.5) + 0.3 * (vnoise(vec2(t * 27.0, 3.0)) - 0.5)
              + 0.45 * flare);
    float fl2 = 0.75 + FLICKER * (0.16 * sin(t * 17.0 + 2.0) + 0.1 * sin(t * 31.0)
              + 0.55 * (vnoise(vec2(t * 11.0, 5.0)) - 0.5) + 0.3 * (vnoise(vec2(t * 23.0, 8.0)) - 0.5)
              + 0.35 * flare);
    fl1 = max(fl1, 0.15);
    fl2 = max(fl2, 0.15);
    // Flames lick up and sway, moving the light, so every shadow lurches.
    vec3 F  = vec3(fireX, FIRE_HEIGHT, FIRE_DIST);
    vec3 L1 = F + FLICKER * vec3((vnoise(vec2(t * 5.0, 2.5)) - 0.5) * 0.25 + sin(t * 7.3) * 0.04,
                                 (vnoise(vec2(t * 8.0, 2.0)) - 0.5) * 0.4 + flare * 0.2, 0.0);
    vec3 L2 = F + vec3(0.12, 0.1, 0.05)
                + FLICKER * vec3((vnoise(vec2(t * 6.0, 7.5)) - 0.5) * 0.25 + sin(t * 9.1) * 0.04,
                                 (vnoise(vec2(t * 10.0, 9.0)) - 0.5) * 0.45 + flare * 0.25, 0.0);

    // Shadows from every dancer, for each flame.
    float vis1 = 1.0, vis2 = 1.0;
    vec3 J[NJ];
    for (int i = 0; i < DANCERS; i++) {
        // Cheap test first: skip dancers whose shadow can't reach this pixel.
        float th, dr;
        vec3 b = dancerBase(i, td, fireX, th, dr) + vec3(0.0, 1.0, 0.0);
        float den = L1.z - b.z;
        if (den < 0.3) continue;
        float s;
        vec2 c = proj(b, L1, s);
        if (length(w - c) > s * 1.8 + LIGHT_R * b.z / den * SOFTNESS * 2.0 + 0.5) continue;

        dancer(i, td, fireX, J);
        bool skirt = (i % 3) == 0;
        vis1 *= dancerVis(w, J, L1, skirt);
        vis2 *= dancerVis(w, J, L2, skirt);
    }

    // Firelight on the wall: inverse-square falloff times the incidence angle.
    vec3 W3 = vec3(w, 0.0);
    float d1 = length(L1 - W3), d2 = length(L2 - W3);
    float E1 = 18.0 * fl1 * L1.z / (d1 * d1 * d1);
    float E2 = 10.0 * fl2 * L2.z / (d2 * d2 * d2);
    vec3 fireCol = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.7, 0.45), flash * env);   // flashes run whiter
    vec3 light = fireCol * (E1 * vis1 + E2 * vis2) * mix(0.9, 1.15, vis1 * vis2) * strobeGain;
    light += vec3(1.0, 0.35, 0.08) * 0.04 * fl1;              // light bounced off the ground
    light += vec3(0.02, 0.025, 0.045);                        // night sky

    // Rough stone / plaster wall.
    vec3 albedo = vec3(0.6, 0.52, 0.45) * (0.7 + 0.3 * fbm(w * 2.5)) * (0.88 + 0.12 * vnoise(w * 35.0));
    vec3 col = albedo * light;

    // Glow from the fire just below the frame.
    col += vec3(1.0, 0.35, 0.08) * exp(-(pow(w.x - fireX, 2.0) * 0.7 + w.y * w.y * 1.8)) * 0.35 * fl1 * strobeGain;

    // Tone map (ACES approximation) + gamma + vignette + grain.
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    vec2 uv = fragCoord / iResolution.xy;
    col *= 0.55 + 0.45 * pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.3);
    col += (hash12(fragCoord + fract(t) * 300.0) - 0.5) * 0.02;

    fragColor = vec4(col, 1.0);
}

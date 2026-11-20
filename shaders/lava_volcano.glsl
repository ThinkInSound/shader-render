// Lava flowing from a volcano — Shadertoy-compatible (iTime, iResolution, iMouse)
// Drag horizontally to orbit the camera.

#define VOLCANO_HEIGHT 3.0
#define VOLCANO_RADIUS 6.0
#define CRATER_RADIUS  0.8
#define LAVA_STREAMS   5.0    // whole number: count of main lava channels
#define LAVA_SPEED     1.0    // flow speed multiplier
#define LAVA_GLOW      1.0    // how strongly the lava lights the rock around it
#define SMOKE_AMOUNT   1.0
#define EMBER_AMOUNT   1.0

#define RIM_H (VOLCANO_HEIGHT * (1.0 - CRATER_RADIUS / VOLCANO_RADIUS) * (1.0 - CRATER_RADIUS / VOLCANO_RADIUS))
#define HAZE  vec3(0.07, 0.028, 0.022)

// ---------------------------------------------------------------- noise ----
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i),                  hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p, int octaves) {
    float s = 0.0, a = 0.5, norm = 0.0;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        s += a * vnoise(p);
        norm += a;
        p = m * p;
        a *= 0.5;
    }
    return s / norm;   // ~0..1
}

// ----------------------------------------------------------------- lava ----
// x = lava coverage (0..1), y = soft falloff around it (for glow on rock).
vec2 lavaMask(vec2 p) {
    float r = length(p);
    float theta = atan(p.y, p.x);
    // Streams are bands in angle, warped by noise so they wind down the slope.
    float warp = (fbm(p * 0.35, 3) - 0.5) * 5.0 + r * 0.25;
    float c = cos(theta * LAVA_STREAMS + warp) * 0.5 + 0.5;          // 1 at a stream's centre
    float w = mix(0.03, 0.10, smoothstep(CRATER_RADIUS, VOLCANO_RADIUS, r)); // widen downhill
    float reach = VOLCANO_RADIUS * (0.6 + 0.4 * fbm(p * 0.25 + 7.0, 3));    // ragged stream ends
    float stream = smoothstep(1.0 - w, 1.0 - w * 0.3, c) * (1.0 - smoothstep(reach - 0.8, reach, r));
    float glow   = smoothstep(1.0 - w * 6.0, 1.0, c) * (1.0 - smoothstep(reach - 0.5, reach + 1.0, r));
    float crater = 1.0 - smoothstep(CRATER_RADIUS * 0.55, CRATER_RADIUS * 0.85, r);
    return vec2(max(stream, crater), max(glow, crater));
}

// Two noise values carried down the slope with the flow. Flow-map trick:
// two phases half a cycle apart, cross-faded so neither ever visibly resets.
vec2 lavaFlow(vec2 p, float r) {
    vec2 dir = p / max(r, 1e-3);
    float downhill = smoothstep(CRATER_RADIUS, VOLCANO_RADIUS, r);
    float travel = 2.2 * LAVA_SPEED * mix(1.4, 0.5, downhill);   // slows as it cools
    float cyc = iTime * 0.12;
    float ph0 = fract(cyc), ph1 = fract(cyc + 0.5);
    vec2 a = p - dir * ph0 * travel;
    vec2 b = p - dir * ph1 * travel + 3.7;
    vec2 na = vec2(fbm(a * 2.0, 5), fbm(a * 5.0 + 11.0, 4));
    vec2 nb = vec2(fbm(b * 2.0, 5), fbm(b * 5.0 + 11.0, 4));
    return mix(na, nb, abs(2.0 * ph0 - 1.0));
}

// Blackbody-ish emission ramp: dark red → orange → yellow-white (HDR).
vec3 lavaRamp(float x) {
    return vec3(1.0, 0.16, 0.02) * smoothstep(0.05, 0.45, x) * 1.5
         + vec3(1.0, 0.42, 0.06) * smoothstep(0.35, 0.80, x) * 3.0
         + vec3(1.0, 0.85, 0.50) * smoothstep(0.75, 1.20, x) * 6.0;
}

// -------------------------------------------------------------- terrain ----
float volcanoShape(vec2 p, float r) {
    float x = r / VOLCANO_RADIUS;
    float h = min(VOLCANO_HEIGHT * pow(max(1.0 - x, 0.0), 2.0), RIM_H);  // concave cone, flat top
    h += 0.14 * exp(-pow((r - CRATER_RADIUS) / 0.25, 2.0));              // crater lip
    h -= 0.40 * (1.0 - smoothstep(CRATER_RADIUS * 0.4, CRATER_RADIUS, r)); // crater bowl
    return h;
}

// Cheap version for ray marching (fewer octaves far away).
float terrainLow(vec2 p, float t) {
    float r = length(p);
    return volcanoShape(p, r) + (fbm(p * 0.9, t < 25.0 ? 4 : 2) - 0.5) * 0.5;
}

// Detailed version for normals: adds gullies, grit and the lava channels.
float terrainHigh(vec2 p) {
    float r = length(p);
    float x = r / VOLCANO_RADIUS;
    float h = volcanoShape(p, r) + (fbm(p * 0.9, 5) - 0.5) * 0.5;
    float theta = atan(p.y, p.x);
    float slope = smoothstep(0.1, 0.3, x) * (1.0 - smoothstep(0.8, 1.1, x));
    h += sin(theta * 23.0 + fbm(p * 0.6, 3) * 6.0) * 0.07 * slope;
    h += (fbm(p * 4.0, 3) - 0.5) * 0.06;
    h -= lavaMask(p).x * 0.06;
    return h;
}

float march(vec3 ro, vec3 rd) {
    const float TOP = VOLCANO_HEIGHT + 0.5;   // nothing is taller than this
    float t = 0.5;
    if (ro.y > TOP) {                          // jump straight down to the terrain's slab
        if (rd.y >= 0.0) return -1.0;
        t = max(t, (ro.y - TOP) / -rd.y);
    }
    for (int i = 0; i < 140; i++) {
        vec3 pos = ro + rd * t;
        if (pos.y > TOP && rd.y > 0.0) break;  // heading up and clear of everything
        float d = pos.y - terrainLow(pos.xz, t);
        if (d < 0.002 * t) return t;
        // Careful steps on the steep cone, long strides over the flat plain.
        float plain = smoothstep(0.0, 3.0, length(pos.xz) - VOLCANO_RADIUS);
        t += d * mix(0.45, 0.85, plain);
        if (t > 70.0) break;
    }
    return -1.0;
}

vec3 calcNormal(vec2 p, float e) {
    float h  = terrainHigh(p);
    float hx = terrainHigh(p + vec2(e, 0.0));
    float hz = terrainHigh(p + vec2(0.0, e));
    return normalize(vec3(h - hx, e, h - hz));
}

vec3 shadeTerrain(vec3 pos, vec3 n) {
    float r = length(pos.xz);
    vec2 lm = lavaMask(pos.xz);
    vec3 glowCol = vec3(1.0, 0.32, 0.07);

    // Basalt, lit by a faint moon, the night sky and the lava itself.
    vec3 rock = mix(vec3(0.03, 0.026, 0.024), vec3(0.07, 0.055, 0.045), fbm(pos.xz * 3.0, 3));
    vec3 moonDir = normalize(vec3(-0.5, 0.6, -0.3));
    float dif = max(dot(n, moonDir), 0.0);
    vec3 col = rock * (vec3(0.22, 0.27, 0.42) * dif * 0.7 + vec3(0.06, 0.04, 0.05));
    col += rock * glowCol * lm.y * lm.y * 5.0 * LAVA_GLOW;                 // stream glow
    col += rock * glowCol * exp(-max(r - CRATER_RADIUS, 0.0) * 2.5) * 3.0 * LAVA_GLOW; // crater glow

    if (lm.x > 0.001) {
        vec2 fl = lavaFlow(pos.xz, r);
        float cool = smoothstep(CRATER_RADIUS, VOLCANO_RADIUS * 0.9, r);  // 0 hot top → 1 cooler base
        // Molten lava: bright streaks carried by the flow.
        float molten = (0.6 + 0.8 * fl.x) * (1.0 - 0.3 * cool);
        // Crust plates cover more of the stream as it cools and along its banks.
        float crust = smoothstep(0.60 - 0.22 * cool, 0.66 - 0.22 * cool, fl.y);
        crust = max(crust, 1.0 - smoothstep(0.25, 0.8, lm.x));
        // Glowing cracks run through the crust.
        float crack = 1.0 - smoothstep(0.0, 0.035, abs(fl.x - 0.5));
        float heat = mix(molten, crack * (0.75 - 0.25 * cool), crust);
        vec3 lava = lavaRamp(heat) + rock * crust * 0.5;
        col = mix(col, lava, smoothstep(0.0, 0.3, lm.x));
    }
    return col;
}

// ----------------------------------------------------- sky, smoke, embers ----
vec3 sky(vec3 rd) {
    vec3 col = mix(HAZE, vec3(0.008, 0.006, 0.018), smoothstep(-0.02, 0.45, rd.y));
    float s = hash13(floor(rd * 260.0));
    col += step(0.9975, s) * 0.5 * smoothstep(0.08, 0.35, rd.y);   // stars
    return col;
}

// Wind bends the plume (and the embers) to one side as it rises.
float plumeDrift(float y) { return y * 0.15 + y * y * 0.04; }

// Smoke and embers are drawn on a camera-facing plane through the volcano.
vec2 plumeCoords(vec3 ro, vec3 rd, vec3 fwFlat, vec3 rtFlat, out float tp) {
    tp = -dot(ro, fwFlat) / dot(rd, fwFlat);
    vec3 q = ro + rd * tp;
    return vec2(dot(q, rtFlat), q.y - RIM_H);
}

vec4 plume(vec2 e) {
    float y = e.y;
    if (y < -0.3) return vec4(0.0);
    float x = e.x - plumeDrift(max(y, 0.0));
    float w = 0.35 + max(y, 0.0) * 0.45;
    float shape = (1.0 - smoothstep(w * 0.4, w, abs(x)))
                * smoothstep(-0.3, 0.4, y) * (1.0 - smoothstep(6.0, 11.0, y));
    vec2 uv = vec2(x, y - iTime * 0.35);
    float d = fbm(uv * 0.8, 4) * 0.65 + fbm(uv * 2.1 + 4.0, 3) * 0.35;
    float dens = clamp((d - 0.38) * 2.8, 0.0, 1.0) * shape * SMOKE_AMOUNT;
    vec3 smoke = vec3(0.035, 0.03, 0.03)
               + vec3(1.0, 0.3, 0.06) * exp(-max(y, 0.0) * 0.9) * 1.6;   // underlit by the crater
    return vec4(smoke, clamp(dens, 0.0, 0.92));
}

vec3 embers(vec2 e) {
    if (e.y < 0.0 || e.y > 5.0) return vec3(0.0);
    float x = e.x - plumeDrift(e.y) * 0.7;
    float cone = 1.0 - smoothstep(0.15 + e.y * 0.45, 0.35 + e.y * 0.8, abs(x));
    float acc = 0.0;
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float sc = 4.0 + fk * 3.0;
        vec2 g = vec2(x * sc, (e.y - iTime * (1.0 + fk * 0.5)) * sc * 0.6);
        vec2 id = floor(g), f = fract(g);
        float h1 = hash12(id + fk * 17.0), h2 = hash12(id + fk * 17.0 + 4.3);
        if (h1 < 0.55) continue;                     // most cells are empty
        vec2 c = vec2(0.2 + 0.6 * h2, 0.2 + 0.6 * fract(h1 * 7.0));
        float d = length((f - c) * vec2(1.0, 1.6));
        float flick = 0.6 + 0.4 * sin(iTime * 12.0 + h2 * 40.0);
        acc += (1.0 - smoothstep(0.0, 0.07, d)) * flick;
    }
    float fade = 1.0 - smoothstep(1.0, 5.0, e.y);
    return vec3(1.0, 0.45, 0.1) * acc * cone * fade * 3.0 * EMBER_AMOUNT;
}

// ------------------------------------------------------------------ main ----
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float ang = 0.5 + iTime * 0.02;
    if (iMouse.x > 0.0) ang += (iMouse.x / iResolution.x - 0.5) * 6.2832;
    vec3 ro = vec3(sin(ang) * 13.0, 3.0, cos(ang) * 13.0);
    vec3 ta = vec3(0.0, 1.5, 0.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(fw * 1.7 + rt * uv.x + up * uv.y);

    float t = march(ro, rd);
    float tHit = t > 0.0 ? t : 1e5;
    vec3 col;
    if (t > 0.0) {
        vec3 pos = ro + rd * t;
        col = shadeTerrain(pos, calcNormal(pos.xz, 0.004 + t * 0.001));
        col = mix(col, HAZE, 1.0 - exp(-t * 0.025));
    } else {
        col = sky(rd);
    }

    // Smoke plume + embers, hidden where the terrain is in front of them.
    vec3 fwFlat = normalize(vec3(fw.x, 0.0, fw.z));
    float tp;
    vec2 e = plumeCoords(ro, rd, fwFlat, rt, tp);
    if (tp > 0.0 && tp < tHit) {
        vec4 sm = plume(e);
        col = mix(col, sm.rgb, sm.a);
        col += embers(e);
    }

    // Heat bloom around the crater.
    float b = max(dot(rd, normalize(vec3(0.0, RIM_H, 0.0) - ro)), 0.0);
    col += vec3(1.0, 0.3, 0.06) * (pow(b, 300.0) * 0.5 + pow(b, 30.0) * 0.03);

    // Tone map (ACES approximation) + gamma + vignette.
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    vec2 q = fragCoord / iResolution.xy;
    col *= 0.75 + 0.25 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.15);

    fragColor = vec4(col, 1.0);
}

// Ancient green: carved malachite tiles engraved with glyph motifs that glow
// neon and pulse on the beat. Set bpm to the track's tempo so the flashes land
// on the kick (every 4th beat hits harder). Resolution-independent, so 1080p
// and 4K exports match.

uniform float bpm;           // 60 160 90
uniform float beatPunch;     // 0 1 0.6
uniform float glyphGlow;     // 0 2 1
uniform float patternScale;  // 3 12 6
uniform float flowSpeed;     // 0 2 0.6
uniform float stoneBands;    // 0 1 0.75
uniform float grain;         // 0 0.1 0.03
uniform vec3  darkGreen;     // color 0.0 0.08 0.035
uniform vec3  midGreen;      // color 0.02 0.4 0.17
uniform vec3  neonGreen;     // color 0.5 1.0 0.12

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v / 0.9375;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Banded, swirling green stone (malachite-like) with fine grit
vec3 stone(vec2 p, float t) {
    vec2 q = p + 0.45 * vec2(fbm(p * 1.6 + t * 0.03), fbm(p * 1.6 + 4.1 - t * 0.025));
    float f = fbm(q * 2.4);
    float bands = 0.5 + 0.5 * sin(f * 60.0 + length(q) * 10.0);
    bands = mix(0.5, bands, stoneBands);
    float grit = 0.5 * noise(p * 90.0) + 0.5 * noise(p * 35.0);
    vec3 c = mix(darkGreen * 1.6, midGreen, smoothstep(0.1, 0.95, bands));
    c = mix(c, midGreen * 1.5, smoothstep(0.85, 1.0, bands) * 0.5);
    return c * (0.78 + 0.4 * grit);
}

// Distance to the nearest engraved line of motif k, in tile units (p in [-0.5, 0.5]).
float motif(vec2 p, float k, float t) {
    float r = length(p), a = atan(p.y, p.x);
    if (k < 1.0) return abs(fract(r * 8.0 - t * 0.4) - 0.5) / 8.0 + max(0.0, r - 0.42);       // rings
    if (k < 2.0) {                                                                              // spiral
        float v = r * 5.0 - a / 6.2832 + t * 0.2;
        return abs(fract(v) - 0.5) / 5.0 + max(0.0, r - 0.42);
    }
    if (k < 3.0) {                                                                              // zigzag
        float y = p.y + abs(fract(p.x * 3.0) - 0.5) * 0.45;
        return abs(fract(y * 5.0 + t * 0.3) - 0.5) / 5.0;
    }
    if (k < 4.0) {                                                                              // stepped squares
        float m = max(abs(p.x), abs(p.y));
        return abs(fract(m * 9.0 - t * 0.3) - 0.5) / 9.0;
    }
    if (k < 5.0) {                                                                              // dot circles
        vec2 q = fract(p * 4.0) - 0.5;
        return abs(length(q) - 0.18) / 4.0;
    }
    if (k < 6.0) {                                                                              // diamonds
        float m = abs(p.x) + abs(p.y);
        return abs(fract(m * 7.0 + t * 0.3) - 0.5) / 7.0;
    }
    float rays = abs(fract(a / 6.2832 * 12.0 + t * 0.05) - 0.5) * r * 6.2832 / 12.0;           // sun
    rays = max(rays, max(0.14 - r, r - 0.42));
    return min(rays, abs(r - 0.08));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    // Beat clock
    float beats = t * bpm / 60.0;
    float beatN = floor(beats);
    float accent = mod(beatN, 4.0) < 0.5 ? 1.0 : 0.6;          // bar downbeat hits harder
    float pulse = exp(-fract(beats) * 5.0) * accent;

    // Zoom punch on the beat
    uv *= 1.0 - 0.03 * pulse * beatPunch;

    // Tile grid, slightly rotated and drifting
    vec2 p = rot(0.12) * uv * patternScale + vec2(0.15, 0.05) * t * flowSpeed;
    vec2 id = floor(p);
    vec2 f0 = fract(p) - 0.5;
    vec2 f = f0;
    vec2 h = hash22(id);
    float k = floor(h.x * 7.0);
    f = rot(floor(h.y * 4.0) * 1.5708) * f;                      // each tile turned 0/90/180/270
    float d = motif(f, k, t * flowSpeed * (0.5 + h.y));

    float aa = 1.5 * patternScale / iResolution.y;
    float border = 0.5 - max(abs(f.x), abs(f.y));                 // distance to the tile's edge
    float inside = smoothstep(0.0, 0.07, border);
    float w = 0.014 + 0.01 * h.y;
    float line = smoothstep(w + aa, w - aa, d) * inside;          // engraved line
    float wear = noise(p * 9.0 + h * 17.0) * 0.65 + noise(p * 31.0) * 0.35;
    line *= smoothstep(0.2, 0.42, wear);                          // chipped, eroded in places
    float joint = smoothstep(0.022 + aa, 0.022 - aa, border);     // gap between tiles

    // Which tiles are lit: a wave sweeping across the grid, plus random tiles on each beat
    float wave = pow(0.5 + 0.5 * sin(dot(id, vec2(0.55, 0.35)) - t * 1.4 * flowSpeed), 3.0);
    float beatTile = step(hash12(id + beatN * 7.13), 0.22) * pulse * beatPunch * 1.6;
    float act = 0.12 + 0.88 * max(wave, beatTile);

    // Glow colour wanders between lime, emerald and mint
    float hue = 0.5 + 0.5 * sin(t * 0.35 + h.x * 6.2832);
    float hue2 = 0.5 + 0.5 * sin(t * 0.21 + h.y * 6.2832 + 2.0);
    vec3 glowCol = mix(neonGreen, vec3(0.15, 1.0, 0.55), hue * 0.7);
    glowCol = mix(glowCol, vec3(0.78, 1.0, 0.2), hue2 * 0.35);

    // Stone, carved
    vec3 col = stone(uv * 1.2 + vec2(0.02, 0.01) * t, t);
    col *= 1.0 - 0.55 * line;
    col *= 1.0 - 0.65 * joint;
    float bevel = smoothstep(0.075, 0.025, border) * (1.0 - joint);
    float facing = abs(f0.y) > abs(f0.x) ? sign(f0.y) : -sign(f0.x);   // +1 top/left, -1 bottom/right
    col *= 1.0 + bevel * (facing > 0.0 ? 0.35 : -0.35);
    col *= 0.85 + 0.3 * smoothstep(0.15, 0.6, noise(p * 2.3 + 40.0));  // some tiles more weathered

    // Light in the grooves, with a soft halo
    float halo = exp(-d * 45.0) * inside;
    col += glowCol * act * glyphGlow * (1.7 * line + 0.3 * halo);

    // Whole frame lifts a little on the beat
    col *= 1.0 + 0.22 * pulse * beatPunch;

    // Roll-off, vignette, grain
    col = 1.0 - exp(-col * 1.4);
    col *= 1.0 - 0.4 * dot(uv * 0.8, uv * 0.8);
    col += (hash12(fragCoord + fract(t * 7.31) * 913.0) - 0.5) * grain;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

// Ancient green, abstract: a slowly warping carved-stone texture.
// Malachite banding, engraved contour lines and a network of veins that glow
// bright green wherever a drifting "energy" field passes. Brightness swells
// come and go irregularly. Resolution-independent, so 1080p and 4K match.

uniform float flowSpeed;     // 0 2 0.5
uniform float scale;         // 0.5 3 1
uniform float contourLines;  // 0 1 0.7
uniform float veins;         // 0 1 0.8
uniform float glow;          // 0 2 1.1
uniform float swells;        // 0 1 0.5
uniform float stoneBands;    // 0 1 0.65
uniform float grain;         // 0 0.1 0.025
uniform vec3  darkGreen;     // color 0.0 0.045 0.02
uniform vec3  midGreen;      // color 0.02 0.3 0.13
uniform vec3  neonGreen;     // color 0.45 1.0 0.1

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
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p + 7.3; a *= 0.5; }
    return v / 0.96875;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Distances to the nearest and second-nearest drifting cell points.
vec2 voronoi(vec2 p, float t) {
    vec2 n = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(i, j);
        vec2 o = 0.5 + 0.4 * sin(t + 6.2831 * hash22(n + g));
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return vec2(f1, f2);
}

// Irregular brightness swells (incommensurate frequencies: never repeats exactly)
float swell(float t) {
    float s = sin(t * 0.37) * sin(t * 0.23 + 1.3) + 0.5 * sin(t * 0.71 + 2.1) * sin(t * 0.13);
    return clamp(0.5 + 0.6 * s, 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * flowSpeed;

    // Flowing, two-level domain warp
    vec2 p = rot(0.04 * t) * uv * 2.2 * scale;
    vec2 w1 = vec2(fbm(p * 0.9 + vec2(0.0, t * 0.12)), fbm(p * 0.9 + vec2(5.2, -t * 0.1)));
    vec2 w2 = vec2(fbm(p * 1.7 + 3.0 * w1 + vec2(t * 0.08, 1.7)), fbm(p * 1.7 + 3.0 * w1 + vec2(8.3, t * 0.09)));
    vec2 q = p + 1.4 * w2;
    float h = fbm(q * 1.2);

    // Stone: malachite-like bands plus fine grit
    float bands = 0.5 + 0.5 * sin(h * 64.0 + length(w2) * 8.0);
    bands = mix(0.5, bands, stoneBands);
    vec3 col = mix(darkGreen * 1.4, midGreen, smoothstep(0.1, 0.95, bands));
    float grit = 0.5 * noise(uv * 160.0) + 0.5 * noise(uv * 55.0 + 3.0);
    col *= 0.78 + 0.4 * grit;

    // Engraved contour lines of the height field (faded where they'd crowd below a pixel)
    float N = 18.0;
    float hc = h * N + t * 0.06;
    float contour = smoothstep(0.1, 0.0, abs(fract(hc) - 0.5)) * smoothstep(0.6, 0.15, fwidth(hc));

    // Vein network: edges between warped cells
    vec2 v = voronoi(q * 3.0 + 4.0, t * 0.5);
    float edge = v.y - v.x;
    float veinCore = smoothstep(0.05, 0.0, edge);
    float vein = exp(-edge * 24.0) + 0.25 * exp(-edge * 6.0);

    // Drifting energy: where it's high, lines and veins light up
    float e = fbm(q * 0.5 + vec2(-t * 0.18, t * 0.13) + 20.0);
    float energy = smoothstep(0.32, 0.75, e) * mix(1.0, 0.4 + 1.1 * swell(iTime), swells);

    // Glow colour wanders between lime, mint and yellow-green
    vec3 mint = vec3(0.18, 1.0, 0.6);
    vec3 lime = vec3(0.75, 1.0, 0.18);
    vec3 glowCol = mix(neonGreen, mint, 0.5 + 0.5 * sin(h * 5.0 + iTime * 0.3));
    glowCol = mix(glowCol, lime, 0.3 * (0.5 + 0.5 * sin(e * 7.0 - iTime * 0.21)));

    // Carve the grooves, then fill them with light
    col *= 1.0 - 0.45 * contour * contourLines;
    col *= 1.0 - 0.5 * veinCore * veins;
    col += glowCol * glow * energy * (1.3 * contour * contourLines + 1.8 * vein * veins);
    col += glowCol * 0.14 * glow * energy * energy;   // soft bloom

    // Roll-off, vignette, grain
    col = 1.0 - exp(-col * 1.5);
    col *= 1.0 - 0.38 * dot(uv * 0.8, uv * 0.8);
    col += (hash12(fragCoord + fract(iTime * 7.31) * 913.0) - 0.5) * grain;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

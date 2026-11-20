// Fireflies at dusk: glowing specks drifting and blinking over a dark meadow and treeline.
// Original shader written for Shader Render.
uniform vec3  skyTop;       // color 0.04 0.06 0.16
uniform vec3  skyGlow;      // color 0.42 0.28 0.38
uniform vec3  treeColor;    // color 0.01 0.015 0.02
uniform vec3  fireflyColor; // color 0.85 1.0 0.35
uniform float count;        // 0 1 0.55
uniform float pulseSpeed;   // 0 3 1
uniform float driftSpeed;   // 0 2 0.5
uniform float glowSize;     // 0.3 3 1

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

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;
    vec3 col = mix(skyGlow, skyTop, smoothstep(-0.15, 0.5, uv.y));

    // Treeline and meadow silhouettes
    float trees = -0.12 + 0.12 * fbm(vec2(uv.x * 3.0, 1.0)) + 0.08 * pow(noise(vec2(uv.x * 18.0, 4.0)), 3.0);
    float px = 1.0 / iResolution.y;
    col = mix(col, treeColor, smoothstep(trees + px, trees - px, uv.y));
    col = mix(col, treeColor * 1.6, smoothstep(-0.28, -0.32, uv.y + 0.03 * noise(vec2(uv.x * 8.0, 2.0))));

    // Fireflies, each in its own cell, glowing softly
    float scale = 7.0;
    vec2 g = uv * scale;
    vec2 cell = floor(g);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 id = cell + vec2(i, j);
        vec2 h = hash22(id);
        if (h.x > count) continue;
        vec2 c = id + 0.5 + 0.35 * vec2(sin(t * driftSpeed * (0.4 + h.y) + h.x * 20.0), cos(t * driftSpeed * (0.3 + h.x) + h.y * 13.0));
        float d = length(g - c) / scale;
        float blink = pow(max(0.0, sin(t * pulseSpeed * (0.6 + h.y) + h.x * 31.0)), 3.0);
        float r = 0.004 * glowSize;
        col += fireflyColor * (smoothstep(r + px, 0.0, d) + 0.6 * exp(-d / (r * 4.0))) * blink;
    }
    fragColor = vec4(1.0 - exp(-col * 1.4), 1.0);
}

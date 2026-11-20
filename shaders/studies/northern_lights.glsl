// Northern lights: green and violet curtains rippling over snowy mountains under the stars.
// Original shader written for Shader Render.
uniform vec3  auroraLow;     // color 0.1 0.95 0.5
uniform vec3  auroraHigh;    // color 0.55 0.25 0.9
uniform vec3  skyColor;      // color 0.01 0.02 0.06
uniform vec3  mountainColor; // color 0.03 0.04 0.07
uniform float intensity;     // 0 2 1
uniform float speed;         // 0 2 0.4
uniform float height;        // 0 1 0.5
uniform float stars;         // 0 1 0.7

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
    float t = iTime * speed;
    vec3 col = skyColor * (1.0 + 2.0 * smoothstep(0.5, -0.3, uv.y));

    // Stars
    vec2 g = uv * 70.0, id = floor(g);
    float s = hash12(id);
    if (s > 0.975) col += vec3(0.85, 0.9, 1.0) * smoothstep(0.1, 0.0, length(fract(g) - 0.5)) * (0.5 + 0.5 * sin(iTime * 3.0 + s * 50.0)) * stars;

    // Curtains: each layer is a wavy base line with light rising above it in vertical rays
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float x = uv.x + fi * 0.37;
        float base = -0.05 + height * 0.3 + 0.12 * sin(x * 1.8 + t * (0.6 + fi * 0.15)) + 0.08 * fbm(vec2(x * 1.5 - t * 0.2, fi));
        float above = uv.y - base;
        float rays = 0.4 + 0.6 * noise(vec2(x * 40.0 + t * 2.0, fi * 3.0)) * noise(vec2(x * 9.0 - t, fi));
        float band = smoothstep(-0.02, 0.0, above) * exp(-above * (5.0 + fi * 1.5)) * rays;
        vec3 c = mix(auroraLow, auroraHigh, smoothstep(0.0, 0.35, above));
        col += c * band * intensity * (0.55 - fi * 0.1);
    }

    // Mountains, faintly lit by the aurora near the ridge
    float ridge = -0.22 + 0.16 * fbm(vec2(uv.x * 1.6, 3.0)) + 0.05 * fbm(vec2(uv.x * 6.0, 8.0));
    float px = 1.0 / iResolution.y;
    float m = smoothstep(ridge + px, ridge - px, uv.y);
    vec3 mountain = mountainColor + auroraLow * 0.04 * intensity * smoothstep(ridge - 0.08, ridge, uv.y);
    col = mix(col, mountain, m);
    fragColor = vec4(1.0 - exp(-col * 1.3), 1.0);
}

// Nebula: glowing gas clouds, dark dust lanes and twinkling stars in deep space.
// Original shader written for Shader Render.
uniform vec3  gasA;       // color 0.6 0.14 0.65
uniform vec3  gasB;       // color 0.1 0.45 0.8
uniform vec3  coreColor;  // color 1.0 0.72 0.5
uniform vec3  spaceColor; // color 0.005 0.008 0.025
uniform float density;    // 0 2 1
uniform float stars;      // 0 2 1
uniform float drift;      // 0 1 0.15
uniform float twinkle;    // 0 3 1

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
    float t = iTime * drift;
    vec2 p = uv * 1.6 + vec2(t * 0.3, t * 0.12);
    vec2 q = vec2(fbm(p + t * 0.2), fbm(p + 5.2 - t * 0.15));
    float n = fbm(p * 1.4 + 2.0 * q);
    float n2 = fbm(p * 2.6 - q * 1.5 + 9.1);

    vec3 col = spaceColor;
    col += gasA * smoothstep(0.35, 0.9, n) * density;
    col += gasB * smoothstep(0.4, 0.95, n2) * density * 0.8;
    col += coreColor * pow(smoothstep(0.5, 1.0, n * n2 * 1.9), 2.0) * density * 1.5;
    col *= 0.55 + 0.45 * smoothstep(0.25, 0.65, fbm(p * 3.0 + 20.0));   // dust lanes

    float px = 1.0 / iResolution.y;
    for (int i = 0; i < 3; i++) {
        float s = 30.0 + float(i) * 28.0;
        vec2 g = uv * s + float(i) * 13.1 + vec2(t * (0.5 + float(i)), 0.0);
        vec2 id = floor(g), f = fract(g) - 0.5;
        vec2 h = hash22(id + float(i) * 7.0);
        if (h.x > 0.14) continue;
        vec2 off = (hash22(id + 3.1) - 0.5) * 0.6;
        float d = length(f - off) / s;                       // in screen units
        float size = (0.0007 + 0.0016 * h.y) * (1.0 + float(2 - i) * 0.5);
        float tw = 0.55 + 0.45 * sin(iTime * twinkle * (1.0 + 3.0 * h.y) + h.x * 60.0);
        col += vec3(0.9, 0.95, 1.0) * smoothstep(size + px, 0.0, d) * tw * stars;
        col += vec3(0.6, 0.7, 1.0) * exp(-d / (size * 3.0)) * 0.15 * tw * stars;
    }
    fragColor = vec4(1.0 - exp(-col * 1.4), 1.0);
}

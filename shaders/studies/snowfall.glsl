// Snowfall at night: layers of flakes drifting down through soft blue light.
// Original shader written for Shader Render.
uniform vec3  skyTop;     // color 0.02 0.04 0.1
uniform vec3  skyBottom;  // color 0.14 0.2 0.34
uniform vec3  snowColor;  // color 0.95 0.97 1.0
uniform vec3  lampColor;  // color 1.0 0.78 0.5
uniform float amount;     // 0 1 0.6
uniform float fallSpeed;  // 0 3 1
uniform float wind;       // -1 1 0.2
uniform float flakeSize;  // 0.3 3 1
uniform float lampGlow;   // 0 1 0.4

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
    float t = iTime * fallSpeed;
    vec3 col = mix(skyBottom, skyTop, smoothstep(-0.5, 0.5, uv.y));
    vec2 lamp = vec2(0.45, 0.25);
    col += lampColor * lampGlow * 0.5 * exp(-length(uv - lamp) * 3.0);

    float px = 1.0 / iResolution.y;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float scale = 26.0 - fi * 4.5;                       // far layers: small, many, slow
        float depth = 0.4 + 0.15 * fi;
        vec2 g = uv * scale;
        g += vec2(wind * t * depth * 2.0, t * depth * 3.0);
        vec2 id = floor(g), f = fract(g) - 0.5;
        vec2 h = hash22(id + fi * 17.0);
        if (h.x > amount) continue;
        vec2 off = (hash22(id + 5.3 + fi) - 0.5) * 0.6 + vec2(0.15 * sin(iTime * (0.5 + h.y) + h.x * 9.0), 0.0);
        float d = length(f - off) / scale;
        float r = (0.0012 + 0.0016 * h.y) * flakeSize * (0.6 + fi * 0.35);
        float soft = px + r * (0.6 - fi * 0.1);
        float lit = 1.0 + 2.0 * lampGlow * exp(-length(uv - lamp) * 4.0);
        col += snowColor * smoothstep(r + soft, r - soft * 0.3, d) * (0.35 + 0.15 * fi) * lit;
    }
    fragColor = vec4(1.0 - exp(-col * 1.3), 1.0);
}

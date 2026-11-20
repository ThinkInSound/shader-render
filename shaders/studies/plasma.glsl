// Retro plasma: classic layered sine-wave plasma flowing through a three-colour palette.
// Original shader written for Shader Render.
uniform vec3  colorA;     // color 0.95 0.2 0.6
uniform vec3  colorB;     // color 0.1 0.8 0.95
uniform vec3  colorC;     // color 1.0 0.85 0.2
uniform float speed;      // 0 3 1
uniform float scale;      // 0.5 8 3
uniform float complexity; // 0 1 0.6
uniform float bands;      // 0 1 0

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

vec3 palette3(float f) {
    f = fract(f) * 3.0;
    if (f < 1.0) return mix(colorA, colorB, smoothstep(0.0, 1.0, f));
    if (f < 2.0) return mix(colorB, colorC, smoothstep(0.0, 1.0, f - 1.0));
    return mix(colorC, colorA, smoothstep(0.0, 1.0, f - 2.0));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y * scale;
    float t = iTime * speed;
    float v = sin(uv.x + t);
    v += sin((uv.y + t) * 0.5);
    v += sin((uv.x + uv.y + t) * 0.5);
    vec2 c = uv + vec2(sin(t * 0.33), cos(t * 0.5)) * 1.5;
    v += sin(sqrt(dot(c, c) + 1.0) + t);
    v += complexity * sin(length(uv * 1.7 - vec2(cos(t * 0.21), sin(t * 0.3))) * 3.0 - t);
    v = v * 0.25 + t * 0.05;
    if (bands > 0.0) { float steps = mix(48.0, 5.0, bands); v = floor(v * steps) / steps; }
    fragColor = vec4(palette3(v), 1.0);
}

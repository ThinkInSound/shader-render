// Op art: stripes warped into rippling moire waves.
// Original shader written for Shader Render.
uniform vec3  colorA;   // color 0.02 0.02 0.02
uniform vec3  colorB;   // color 0.96 0.96 0.94
uniform float stripes;  // 5 80 30
uniform float warp;     // 0 2 1
uniform float twist;    // 0 2 0.7
uniform float speed;    // 0 2 0.5

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
    float r = length(uv);
    float v = uv.y * stripes;
    v += warp * 2.5 * sin(uv.x * 4.0 + t) * cos(uv.y * 3.0 - t * 0.7);
    v += twist * stripes * 0.06 * sin(r * 9.0 - t * 2.0) / (0.3 + r);
    float s = sin(v * 3.14159);
    float aa = fwidth(v) * 3.14159;
    float m = smoothstep(-aa, aa, s);
    fragColor = vec4(mix(colorA, colorB, m), 1.0);
}

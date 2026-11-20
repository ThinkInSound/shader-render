// Kaleidoscope: mirrored wedges of flowing colour, rings and dots, slowly turning.
// Original shader written for Shader Render.
uniform float segments;   // 3 16 8
uniform float speed;      // 0 2 0.4
uniform float zoom;       // 0.5 4 1.5
uniform float detail;     // 0 1 0.6
uniform vec3  colorA;     // color 0.95 0.35 0.2
uniform vec3  colorB;     // color 0.15 0.55 0.92
uniform vec3  colorC;     // color 0.98 0.86 0.4
uniform vec3  background; // color 0.02 0.02 0.05

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
    float a = atan(uv.y, uv.x) + t * 0.2;
    float seg = 6.28318 / floor(segments);
    a = abs(mod(a, seg) - seg * 0.5);                       // fold into one mirrored wedge
    vec2 p = vec2(cos(a), sin(a)) * r * zoom + vec2(t * 0.3, 0.0);

    float n = fbm(p * 2.0 + vec2(0.0, t * 0.2));
    float rings = 0.5 + 0.5 * sin(r * 18.0 * zoom - t * 2.0);
    vec2 cell = fract(p * 3.0) - 0.5;
    float aa = 3.0 * zoom * 3.0 / iResolution.y;
    float dots = smoothstep(0.24 + aa, 0.24 - aa, length(cell));

    vec3 col = mix(background, colorA, smoothstep(0.3, 0.6, n));
    col = mix(col, colorB, smoothstep(0.55, 0.8, n) * 0.9);
    col += colorC * dots * rings * detail;
    col += colorC * 0.3 * exp(-r * 7.0);
    col *= smoothstep(1.2, 0.3, r);
    fragColor = vec4(col, 1.0);
}

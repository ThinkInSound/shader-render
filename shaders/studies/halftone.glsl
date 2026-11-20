// Halftone: comic-book dot screen over drifting shapes, with a second accent-colour screen.
// Original shader written for Shader Render.
uniform vec3  inkColor;      // color 0.1 0.1 0.16
uniform vec3  paperColor;    // color 0.97 0.94 0.86
uniform vec3  accentColor;   // color 0.92 0.22 0.3
uniform float dotsPerScreen; // 10 120 46
uniform float angle;         // -1.57 1.57 0.4
uniform float contrast;      // 0 2 1
uniform float speed;         // 0 2 0.5
uniform float accent;        // 0 1 0.6

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

float tone(vec2 p, float t) {
    float v = 0.5 + 0.5 * sin(p.x * 2.0 + t) * cos(p.y * 1.7 - t * 0.7);
    v = mix(v, smoothstep(0.55, 0.25, length(p - 0.35 * vec2(sin(t * 0.6), cos(t * 0.45)))), 0.6);
    return clamp((v - 0.5) * contrast + 0.5, 0.0, 1.0);
}

float dotScreen(vec2 uv, float ang, float density, float t, float shift) {
    vec2 q = rot(ang) * uv * density;
    vec2 id = floor(q), f = fract(q) - 0.5;
    vec2 centre = rot(-ang) * ((id + 0.5) / density);
    float v = tone(centre * 1.6 + shift, t);
    float r = 0.5 * sqrt(v) * 0.98;
    float aa = 1.5 * density / iResolution.y;
    return smoothstep(r + aa, r - aa, length(f));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * speed;
    float k = dotScreen(uv, angle, dotsPerScreen, t, 0.0);
    float a = dotScreen(uv, angle + 0.6, dotsPerScreen * 0.8, t * 1.1, 0.9) * accent;
    vec3 col = paperColor;
    col = mix(col, col * accentColor, a);
    col = mix(col, inkColor, k);
    col *= 0.96 + 0.04 * noise(uv * 900.0);                       // paper texture
    fragColor = vec4(col, 1.0);
}

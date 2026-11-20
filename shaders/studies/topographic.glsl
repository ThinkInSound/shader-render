// Topographic map: contour lines over shaded terrain that slowly morphs.
// Original shader written for Shader Render.
uniform vec3  lowColor;   // color 0.2 0.35 0.24
uniform vec3  highColor;  // color 0.86 0.78 0.6
uniform vec3  lineColor;  // color 0.28 0.16 0.08
uniform float contours;   // 4 40 16
uniform float lineWidth;  // 0.5 4 1.2
uniform float relief;     // 0 2 1
uniform float morph;      // 0 1 0.1
uniform float scale;      // 0.3 4 1.2

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

float height(vec2 p, float tm) {
    return fbm(p + vec2(fbm(p * 0.7 + tm), fbm(p * 0.7 - tm + 4.0)) * 0.6);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    vec2 p = uv * scale + vec2(iTime * morph * 0.1, 0.0);
    float tm = iTime * morph * 0.2;
    float h = height(p, tm);

    // Hill shading from the height gradient
    float e = 0.004;
    float hx = height(p + vec2(e, 0.0), tm);
    float hy = height(p + vec2(0.0, e), tm);
    vec3 n = normalize(vec3((h - hx) / e, (h - hy) / e, 1.0 / (0.6 * relief + 0.01)));
    float shade = clamp(dot(n, normalize(vec3(-0.6, 0.7, 0.5))), 0.0, 1.0);

    vec3 col = mix(lowColor, highColor, smoothstep(0.2, 0.85, h));
    col *= 0.55 + 0.6 * shade;

    // Contour lines, every fifth one bolder; width in pixels at 1080p, scaled for other sizes
    float v = h * contours;
    float fw = fwidth(v);
    float dist = abs(fract(v - 0.5) - 0.5);
    float k = lineWidth * iResolution.y / 1080.0;
    float major = mod(floor(v + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
    float w = k * (1.0 + major);
    float line = 1.0 - smoothstep(fw * w * 0.5, fw * (w * 0.5 + 1.0), dist);
    col = mix(col, lineColor, line * (0.6 + 0.3 * major));
    fragColor = vec4(col, 1.0);
}

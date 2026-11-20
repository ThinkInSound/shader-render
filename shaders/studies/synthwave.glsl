// Synthwave sunset: a striped sun over a neon grid racing towards the horizon.
// Original shader written for Shader Render.
uniform vec3  skyTop;     // color 0.07 0.02 0.18
uniform vec3  skyHorizon; // color 0.85 0.22 0.55
uniform vec3  sunTop;     // color 1.0 0.86 0.3
uniform vec3  sunBottom;  // color 1.0 0.22 0.55
uniform vec3  gridColor;  // color 0.2 0.85 1.0
uniform float speed;      // 0 3 1
uniform float horizon;    // -0.3 0.3 -0.05
uniform float glow;       // 0 2 1

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
    float px = 1.0 / iResolution.y;
    vec3 col;
    if (uv.y > horizon) {
        float h = uv.y - horizon;
        col = mix(skyHorizon, skyTop, smoothstep(0.0, 0.55, h));
        // Stars
        vec2 g = uv * 60.0, id = floor(g);
        float s = hash12(id);
        if (s > 0.96) col += vec3(1.0) * smoothstep(0.08, 0.0, length(fract(g) - 0.5)) * (0.4 + 0.6 * sin(iTime * 2.0 + s * 40.0)) * smoothstep(0.1, 0.5, h);
        // Sun with stripes cut through its lower half
        vec2 sp = uv - vec2(0.0, horizon + 0.17);
        float d = length(sp);
        float sun = smoothstep(0.23 + px, 0.23 - px, d);
        float gap = sp.y < 0.04 ? step(0.5 + 2.5 * (0.04 - sp.y), fract(sp.y * 22.0 - t * 0.4) + 0.5) : 1.0;
        col = mix(col, mix(sunBottom, sunTop, smoothstep(-0.2, 0.2, sp.y)), sun * gap);
        col += sunBottom * 0.35 * exp(-d * 4.5) * glow;
    } else {
        // Ground plane in perspective
        float depth = horizon - uv.y;
        float z = 0.18 / (depth + 0.002);
        vec2 g = vec2(uv.x * z * 1.6, z + t * 1.2);
        vec2 fw = fwidth(g);
        vec2 dist = 0.5 - abs(fract(g) - 0.5);           // distance to the nearest grid line
        float k = max(1.0, 0.0015 * iResolution.y);       // line width scales with resolution
        float lx = 1.0 - smoothstep(fw.x * k * 0.5, fw.x * (k * 0.5 + 1.0), dist.x);
        float ly = 1.0 - smoothstep(fw.y * k * 0.5, fw.y * (k * 0.5 + 1.0), dist.y);
        float line = max(lx, ly) * smoothstep(0.0, 0.03, depth);
        col = mix(skyTop * 0.4, vec3(0.01, 0.0, 0.03), smoothstep(0.0, 0.4, depth));
        col += gridColor * line * glow * (1.2 - depth);
        col += skyHorizon * 0.35 * exp(-depth * 10.0) * glow;
    }
    fragColor = vec4(1.0 - exp(-col * 1.3), 1.0);
}

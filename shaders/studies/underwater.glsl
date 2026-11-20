// Underwater: sun rays slanting through blue water over rippling caustics and drifting particles.
// Original shader written for Shader Render.
uniform vec3  deepColor;    // color 0.0 0.07 0.17
uniform vec3  shallowColor; // color 0.08 0.5 0.66
uniform vec3  lightColor;   // color 0.75 0.95 1.0
uniform float rays;         // 0 2 1
uniform float caustics;     // 0 2 1
uniform float particles;    // 0 1 0.5
uniform float speed;        // 0 2 0.5

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

vec2 voronoi(vec2 p, float t) {
    vec2 n = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(i, j);
        vec2 o = 0.5 + 0.4 * sin(t + 6.2831 * hash22(n + g));
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return vec2(f1, f2);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * speed;
    vec3 col = mix(deepColor, shallowColor, smoothstep(-0.6, 0.6, uv.y));

    // Light rays from the surface, slanting and swaying
    float x = uv.x + uv.y * 0.35;
    float r = 0.5 + 0.5 * sin(x * 9.0 + t * 0.7);
    r *= 0.5 + 0.5 * sin(x * 23.0 - t * 1.1 + sin(x * 3.0));
    r += 0.4 * noise(vec2(x * 12.0, t * 0.3));
    col += lightColor * pow(r * 0.6, 3.0) * rays * 0.6 * smoothstep(-0.6, 0.5, uv.y);

    // Caustic light on the sea floor (lower part of the frame, in perspective)
    float floorY = -0.15 - uv.y;
    if (floorY > 0.0) {
        vec2 fp = vec2(uv.x / (floorY + 0.25), 1.0 / (floorY + 0.25)) * 1.4;
        vec2 v = voronoi(fp * 2.0, t * 1.5);
        float c = exp(-(v.y - v.x) * 10.0);
        col += lightColor * c * caustics * 0.35 * smoothstep(0.0, 0.25, floorY);
    }

    // Drifting particles
    vec2 g = uv * 20.0 + vec2(t * 0.2, t * 0.35);
    vec2 id = floor(g), f = fract(g) - 0.5;
    vec2 h = hash22(id);
    if (h.x < particles) {
        float d = length(f - (h - 0.5) * 0.6) / 20.0;
        col += lightColor * smoothstep(0.0025, 0.0, d) * 0.5 * (0.5 + 0.5 * sin(iTime + h.y * 20.0));
    }
    col *= 1.0 - 0.25 * dot(uv, uv);
    fragColor = vec4(1.0 - exp(-col * 1.2), 1.0);
}

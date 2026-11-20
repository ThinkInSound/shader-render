// Stained glass: Voronoi cells of coloured glass with dark lead lines and light moving behind.
// Original shader written for Shader Render.
// A study of cellular (Voronoi) noise.
uniform vec3  glassA;     // color 0.85 0.12 0.18
uniform vec3  glassB;     // color 0.12 0.32 0.85
uniform vec3  glassC;     // color 0.98 0.75 0.18
uniform vec3  glassD;     // color 0.15 0.65 0.38
uniform vec3  leadColor;  // color 0.03 0.03 0.04
uniform float cells;      // 2 20 7
uniform float leadWidth;  // 0.01 0.15 0.05
uniform float glow;       // 0 2 1
uniform float speed;      // 0 2 0.3

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
    vec2 p = uv * cells;
    vec2 n = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(i, j);
        vec2 o = 0.5 + 0.35 * sin(iTime * speed * 0.4 + 6.2831 * hash22(n + g));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = n + g; } else if (d < d2) { d2 = d; }
    }
    float edge = sqrt(d2) - sqrt(d1);   // roughly the distance to the nearest border

    float h = hash12(id);
    vec3 glass = h < 0.25 ? glassA : h < 0.5 ? glassB : h < 0.75 ? glassC : glassD;
    glass *= 0.7 + 0.5 * hash12(id + 7.0);

    // Light behind the glass drifts across; the glass itself is a little uneven
    float light = 0.6 + 0.5 * sin(iTime * speed + uv.x * 2.2 + uv.y * 1.4);
    light += 0.3 * smoothstep(0.7, 0.0, length(uv - 0.5 * vec2(sin(iTime * speed * 0.5), cos(iTime * speed * 0.37))));
    float grain = 0.8 + 0.4 * noise(p * 5.0 + id * 3.0);
    vec3 col = glass * light * grain * glow;

    float aa = 1.5 * cells / iResolution.y;
    float lead = smoothstep(leadWidth + aa, leadWidth, edge);
    col += 0.18 * glass * smoothstep(leadWidth + 0.06, leadWidth, edge) * (1.0 - lead);    // bright glass edge
    col = mix(col, leadColor, lead);
    fragColor = vec4(1.0 - exp(-col * 1.2), 1.0);
}

// Drifting clouds: layered fractal-noise clouds over a sky gradient, lit from the upper left.
// Original shader written for Shader Render.
// A study of fbm (fractal Brownian motion) and domain warping.
uniform vec3  skyTop;      // color 0.16 0.4 0.85
uniform vec3  skyHorizon;  // color 0.72 0.85 0.98
uniform vec3  cloudLight;  // color 1.0 0.98 0.95
uniform vec3  cloudShade;  // color 0.52 0.58 0.7
uniform float coverage;    // 0 1 0.35
uniform float softness;    // 0.02 0.5 0.16
uniform float windSpeed;   // 0 2 0.4
uniform float scale;       // 0.5 4 1.6

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
    float t = iTime * windSpeed;
    vec3 sky = mix(skyHorizon, skyTop, smoothstep(-0.5, 0.55, uv.y));

    vec3 col = sky;
    // Two layers: big slow clouds behind, smaller faster ones in front
    for (int i = 0; i < 2; i++) {
        float fi = float(i);
        float s = scale * (2.4 + fi * 1.6);
        vec2 p = uv * s + vec2(t * (0.25 + fi * 0.2) + fi * 7.0, fi * 3.0);
        vec2 w = 0.5 * vec2(fbm(p * 0.5 - t * 0.05), fbm(p * 0.5 + 3.3 + t * 0.04));
        float n = fbm(p + w);
        // Fewer clouds near the top of the sky, more towards the horizon
        float cov = coverage + 0.15 * smoothstep(0.4, -0.4, uv.y) - fi * 0.08;
        float th = 0.7 - cov * 0.36;                        // fbm values sit around 0.3-0.7
        float c = smoothstep(th - softness * 0.25, th + softness * 0.25, n);

        // Thicker cloud towards the light means a shaded underside
        float n2 = fbm(p + w + vec2(-0.08, 0.06));
        float lit = clamp((n2 - n) * 6.0 + 0.6, 0.0, 1.0);
        vec3 cloud = mix(cloudShade, cloudLight, lit);
        col = mix(col, cloud, c * (0.85 + fi * 0.15));
    }
    col += cloudLight * 0.08 * smoothstep(0.6, -0.4, length(uv - vec2(-0.6, 0.45)));   // sun haze
    fragColor = vec4(col, 1.0);
}

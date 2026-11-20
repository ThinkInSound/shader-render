// Celestial sparkles on water: out-of-focus sun glitter (bokeh).
// Several depth layers of soft discs with bright rims. A drifting "light" cloud
// decides where glints appear, and a moving wave field makes them shimmer in
// patches. Everything is in resolution-independent units, so 1080p and 4K
// exports look the same.

uniform float density;       // 0 1 0.8
uniform float sparkleSize;   // 0.4 1.6 1
uniform float twinkleSpeed;  // 0 3 1
uniform float driftSpeed;    // 0 2 0.6
uniform float exposure;      // 0.2 3 1.5
uniform float rimStrength;   // 0 1 0.6
uniform float fringe;        // 0 1 0.4
uniform float grain;         // 0 0.08 0.012
uniform vec3  sparkleColor;  // color 1.0 0.72 0.46
uniform vec3  waterColor;    // color 0.02 0.045 0.12
uniform vec3  glowColor;     // color 0.08 0.2 0.24

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
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + 17.1; a *= 0.5; }
    return v / 0.875;
}

// Where the light hits the water: a lumpy cloud around the centre that slowly drifts.
float glitterField(vec2 p, float t) {
    vec2 q = p - vec2(0.02 + 0.04 * sin(t * 0.07), -0.12 + 0.04 * cos(t * 0.05));
    q *= vec2(1.25, 0.78);                     // a little taller than wide, like a glitter path
    float blob = exp(-dot(q, q) * 3.0);
    float lumps = fbm(p * 2.6 + vec2(t * 0.03, -t * 0.02));
    return smoothstep(0.08, 0.75, blob * (0.15 + 1.7 * lumps));
}

// Out-of-focus disc: soft edge plus a brighter rim, like real lens bokeh.
float bokeh(float d, float r, float soft) {
    float disc = smoothstep(r, r - soft, d);
    float ring = smoothstep(r - soft - 0.2 * r, r - 0.6 * soft, d) * smoothstep(r + 0.2 * soft, r - 0.7 * soft, d);
    return disc * (1.0 - 0.3 * rimStrength) + ring * 0.7 * rimStrength;
}

// One depth layer of sparkles.
//   scale: cells per unit (bigger = smaller, more numerous discs)
//   radius/soft: disc radius and edge softness in cell units
//   everywhere: 0 = only where the light hits, 1 = scattered across the frame
vec3 sparkleLayer(vec2 uv, float t, float scale, float radius, float soft,
                  float bright, float everywhere, float seed, vec3 tint) {
    vec3 acc = vec3(0.0);
    vec2 drift = vec2(0.3, 0.1) * t * driftSpeed * (6.0 / scale);  // nearer layers move faster
    vec2 g = uv * scale + drift + seed * 13.7;
    vec2 cell = floor(g);
    float px = scale / iResolution.y;                              // one pixel in cell units
    soft = max(soft, 1.5 * px);

    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec2 id = cell + vec2(x, y);
        vec2 h = hash22(id + seed);
        float h2 = hash12(id * 1.37 + seed * 7.1);

        // Spark position, with a gentle bob as the water moves
        vec2 c = id + 0.5 + (h - 0.5) * 0.8
               + 0.07 * vec2(sin(t * 0.6 + h.x * 6.283), cos(t * 0.5 + h.y * 6.283));

        // Cheap test first: skip sparks whose disc doesn't cover this pixel
        float r = min(radius * sparkleSize * (0.75 + 0.5 * h.y), 1.05);
        float d = length(g - c);
        if (d > r * 1.05) continue;

        vec2 wp = (c - drift - seed * 13.7) / scale;                // back to screen space

        // Is this spot catching the light? Fades in and out as the cloud drifts.
        float field = glitterField(wp, t);
        float prob = density * mix(field, 1.0, everywhere);
        float present = smoothstep(h2 - 0.06, h2 + 0.06, prob);
        if (present <= 0.0) continue;

        // Shimmer: a travelling wave field plus each glint's own flicker
        float wave = noise(wp * 7.0 + vec2(t * 0.8, -t * 0.55) * twinkleSpeed);
        float flick = sin(t * twinkleSpeed * (1.2 + 2.5 * h.x) + h.y * 6.283);
        float glint = smoothstep(0.28, 0.62, wave + 0.22 * flick);
        if (glint <= 0.0) continue;

        // Slight colour fringing at the edges (lens chromatic aberration)
        float ca = 0.035 * fringe;
        vec3 m = vec3(bokeh(d, r * (1.0 + ca), soft),
                      bokeh(d, r, soft),
                      bokeh(d, r * (1.0 - ca), soft));

        vec3 col = mix(sparkleColor, vec3(1.0, 0.9, 0.75), h.x * 0.5) * tint;
        float hot = 0.45 + 1.1 * field;              // glints near the light's centre are brighter
        acc += m * col * glint * present * bright * hot * (0.55 + 0.9 * h2);
    }
    return acc;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    // Deep water, a cool glow from the upper right, and haze where the light is
    vec3 bg = waterColor * (0.75 + 0.5 * smoothstep(1.1, 0.0, length(uv * vec2(0.7, 1.0))));
    bg += glowColor * 0.55 * smoothstep(1.1, 0.0, length(uv - vec2(0.85, 0.55)));
    float haze = glitterField(uv, t);
    bg += sparkleColor * (0.04 * haze + 0.1 * haze * haze);

    vec3 light = vec3(0.0);
    light += sparkleLayer(uv, t, 7.0, 0.30, 0.16, 0.07, 1.0, 1.0, mix(glowColor * 3.0, sparkleColor, 0.35)); // far, faint, everywhere
    light += sparkleLayer(uv, t, 17.0, 0.44, 0.16, 0.5, 0.012, 2.0, vec3(1.0));   // small, dense
    light += sparkleLayer(uv, t, 13.0, 0.44, 0.15, 0.62, 0.012, 3.0, vec3(1.0));  // medium
    light += sparkleLayer(uv, t, 9.5, 0.42, 0.14, 0.55, 0.01, 4.0, vec3(1.0));    // nearer, larger

    vec3 col = bg + light * exposure;

    // Soft highlight roll-off: overlapping glints bloom to warm white
    col = 1.0 - exp(-col * 1.5);

    // Grade: teal shadows, warm highlights, vignette, a little film grain
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.18);                                   // richer colour after roll-off
    col = mix(col * vec3(0.88, 1.0, 1.08), col, smoothstep(0.0, 0.6, lum));
    col *= 1.0 - 0.3 * dot(uv * 0.75, uv * 0.75);
    col += (hash12(fragCoord + fract(t * 7.31) * 913.0) - 0.5) * grain;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

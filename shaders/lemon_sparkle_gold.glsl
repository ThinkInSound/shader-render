// Lemon juice sparkle gold: backlit lemon juice with rippling caustic light,
// rising fizz and drifting gold flakes that flash into star glints as they turn.
// Sizes are in resolution-independent units, so 1080p and 4K exports match.

uniform vec3  juiceColor;    // color 1.0 0.76 0.1
uniform vec3  deepColor;     // color 0.55 0.21 0.01
uniform vec3  goldColor;     // color 1.0 0.72 0.28
uniform float caustics;      // 0 2 1
uniform float bubbleAmount;  // 0 1 0.4
uniform float riseSpeed;     // 0 3 1
uniform float glitter;       // 0 1 0.7
uniform float twinkleSpeed;  // 0 3 1
uniform float starSize;      // 0 2 1
uniform float exposure;      // 0.2 3 1.3

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

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Distances to the nearest and second-nearest moving cell points.
vec2 voronoi(vec2 p, float t) {
    vec2 n = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(i, j);
        vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * hash22(n + g));
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
    return vec2(f1, f2);
}

// Caustics: bright lines where neighbouring cells meet, on a gently warped surface.
float causticLight(vec2 p, float t) {
    vec2 w = p + 0.3 * vec2(noise(p * 1.7 + t * 0.25), noise(p * 1.7 - t * 0.22 + 5.0));
    vec2 a = voronoi(w * 3.5, t * 0.8);
    vec2 b = voronoi(w * 6.5 + 3.1, t * 1.1 + 2.0);
    float la = exp(-(a.y - a.x) * 14.0);
    float lb = exp(-(b.y - b.x) * 16.0);
    float patches = 0.35 + 0.9 * noise(p * 1.4 + vec2(t * 0.05, -t * 0.04));
    return (la * 0.5 + lb * 0.3 + la * lb * 1.5) * patches;
}

// Rising bubbles: columns of bubbles moving up at their own speeds, wobbling a little.
vec3 bubbleLayer(vec2 uv, float t, float scale, float radius, float blur, float bright, float seed) {
    vec3 acc = vec3(0.0);
    float px = scale / iResolution.y;
    float aa = max(blur, 1.5 * px);
    vec2 g = uv * scale;
    float cx = floor(g.x);
    for (int x = -1; x <= 1; x++) {
        float col = cx + float(x);
        float speed = (0.5 + 0.9 * hash12(vec2(col, seed))) * riseSpeed;
        float gy = g.y - t * speed;
        float cy = floor(gy);
        for (int y = -1; y <= 1; y++) {
            vec2 id = vec2(col, cy + float(y));
            vec2 h = hash22(id + seed * 3.7);
            if (h.x > bubbleAmount * 0.7) continue;

            float r = radius * (0.45 + 0.9 * h.y);
            vec2 c = vec2(col + 0.5 + (h.y - 0.5) * 0.4 + 0.1 * sin(t * 3.0 * (0.6 + h.x) + id.y * 1.7),
                          id.y + 0.5);
            vec2 v = vec2(g.x, gy) - c;
            float d = length(v);
            if (d > r + aa) continue;

            float body = smoothstep(r + 0.5 * aa, r - 0.5 * aa, d);
            float rimW = max(0.14 * r, aa);
            float rim = smoothstep(r - rimW - aa, r - 0.3 * rimW, d) * body;
            float spec = smoothstep(0.32 * r, 0.0, length(v - vec2(-0.35, 0.38) * r));
            float spec2 = 0.45 * smoothstep(0.16 * r, 0.0, length(v - vec2(0.32, -0.36) * r));
            vec3 tint = mix(juiceColor, vec3(1.0), 0.55);
            acc += (tint * (0.12 * body + 0.8 * rim) + vec3(1.0, 0.98, 0.9) * (spec + spec2) * 1.4) * bright;
        }
    }
    return acc;
}

// Gold flakes: mostly a faint golden speck, flashing into a star glint as they turn.
vec3 glitterLayer(vec2 uv, float t, float scale, float flare, float bright, float seed) {
    vec3 acc = vec3(0.0);
    vec2 g = uv * scale + vec2(0.4 * sin(t * 0.05 + seed), -0.03 * t) * scale * 0.1;
    vec2 cell = floor(g);
    float R = 1.0 / scale;                       // one cell, in screen units
    float w = max(0.0009, 0.8 / iResolution.y);  // spike width
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 id = cell + vec2(i, j);
        vec2 h = hash22(id + seed);
        float h2 = hash12(id * 1.31 + seed * 5.3);
        if (h2 > glitter) continue;

        vec2 c = id + 0.5 + (h - 0.5) * 0.8 + 0.15 * vec2(sin(t * 0.3 + h.x * 6.283), cos(t * 0.23 + h.y * 6.283));
        vec2 v = (g - c) / scale;
        float dist = length(v);
        if (dist > R) continue;

        float flash = pow(max(0.0, sin(t * twinkleSpeed * (0.5 + 1.5 * h.y) + h.x * 6.283)), 16.0);
        float window = smoothstep(R, 0.4 * R, dist);   // fade to zero before the cell edge
        float sz = max(0.0022, 1.2 / iResolution.y);
        float core = exp(-dist * dist / (sz * sz));
        float L = max(1e-4, flare * starSize * (0.3 + 0.7 * flash) * R * 0.8);

        vec2 rv = rot(h.x * 0.6 - 0.3) * v;
        float spikes = exp(-abs(rv.y) / w - abs(rv.x) / L) + exp(-abs(rv.x) / w - abs(rv.y) / L);
        vec2 dv = rot(0.785) * rv;
        float diag = exp(-abs(dv.y) / w - abs(dv.x) / (0.45 * L)) + exp(-abs(dv.x) / w - abs(dv.y) / (0.45 * L));
        float halo = 0.25 * exp(-dist / (0.35 * L));

        float base = 0.15 + 0.15 * h.y;
        float I = (core * (base + 2.5 * flash) + (spikes + 0.4 * diag + halo) * flash * 1.2) * window;
        acc += I * mix(goldColor, vec3(1.0, 0.97, 0.88), 0.6 * flash) * bright;
    }
    return acc;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    // Juice, backlit from the upper middle: luminous lemon fading to amber
    float lightDist = length((uv - vec2(0.12, 0.38)) * vec2(0.8, 1.0));
    vec3 col = mix(juiceColor * 0.95, deepColor * 0.35, smoothstep(0.0, 1.2, lightDist));

    // Faint streaky pulp texture
    float pulp = noise(rot(0.3) * uv * vec2(18.0, 5.0) + vec2(0.0, t * 0.02));
    col *= 0.94 + 0.12 * pulp;

    // Rippling caustic light, strongest near the light
    float nearLight = 0.1 + 0.9 * smoothstep(1.3, 0.0, lightDist);
    col += mix(juiceColor, vec3(1.0, 0.93, 0.6), 0.4) * caustics * 0.4 * causticLight(uv, t) * nearLight;

    // Fizz: blurred bubbles behind, sharper ones in front
    col += bubbleLayer(uv, t * 0.6, 13.0, 0.30, 0.07, 0.3, 1.0);
    col += bubbleLayer(uv, t, 8.0, 0.24, 0.0, 0.65, 2.0);

    // Gold flakes: many small ones, fewer big glints
    col += glitterLayer(uv, t * 1.1, 42.0, 0.6, 0.55, 5.0);  // fine gold dust
    col += glitterLayer(uv, t, 22.0, 1.0, 0.9, 3.0);
    col += glitterLayer(uv, t * 0.9, 11.0, 1.0, 1.3, 4.0);   // big star glints

    // Glow from the light source
    col += mix(juiceColor, vec3(1.0, 0.95, 0.7), 0.3) * 0.35 * exp(-lightDist * 2.6);

    // Highlight roll-off that keeps the hue golden (a per-channel curve would
    // squash red more than green and turn the yellow olive), then let the
    // brightest glints bloom towards white.
    col *= exposure;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 hueKept = col * (1.0 - exp(-lum * 1.8)) / max(lum, 1e-4);
    vec3 perChannel = 1.0 - exp(-col * 1.8);
    col = mix(hueKept, perChannel, smoothstep(0.6, 1.4, lum));

    // Edges sink into deep amber rather than darkening to khaki
    float vig = smoothstep(0.35, 1.25, length(uv * vec2(0.85, 1.0)));
    col = mix(col, deepColor * 0.5, vig * 0.65);

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

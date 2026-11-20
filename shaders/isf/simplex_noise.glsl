#version 300 es
precision highp float;
precision highp int;
out vec4 isfFragColor;
// Simplex Noise: converted from ISF (Interactive Shader Format) by Shader Render.
// From Vidvox ISF-Files, https://github.com/Vidvox/ISF-Files (MIT License, see THIRD_PARTY_NOTICES.md)
// Credit: by VIDVOX (simplex by Ashima Arts / Stefan Gustavson)
// Categories: Generator, Noise

// ISF built-ins, mapped onto Shader Render's inputs
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iDate;
#define TIME iTime
#define TIMEDELTA iTimeDelta
#define RENDERSIZE iResolution.xy
#define FRAMEINDEX iFrame
#define DATE iDate
#define PASSINDEX 0
#define isf_FragNormCoord (gl_FragCoord.xy / iResolution.xy)
#define IMG_NORM_PIXEL(img, uv) texture(img, uv)
#define IMG_PIXEL(img, px) texture(img, (px) / iResolution.xy)
#define IMG_THIS_NORM_PIXEL(img) texture(img, isf_FragNormCoord)
#define IMG_THIS_PIXEL(img) texture(img, isf_FragNormCoord)
#define IMG_SIZE(img) iResolution.xy

// Inputs (sliders)
uniform float scale; // 1 50 8
// octaves: 1 = 1, 2 = 2, 3 = 3, 4 = 4, 5 = 5, 6 = 6
uniform int octaves; // 1 6 4
uniform float persistence; // 0 1 0.5
uniform float lacunarity; // 1 4 2
uniform float speed; // 0 2 0
uniform float contrast; // 0 3 1
uniform float seed; // 0 100 0
uniform vec4 colorLow; // color 0 0 0 1
uniform vec4 colorHigh; // color 1 1 1 1

//	2D simplex noise. Output range approximately [-1, 1].
//	Standard Ashima Arts / Stefan Gustavson implementation:
//	  https://github.com/ashima/webgl-noise (MIT)
vec3 permute(vec3 x)	{
    return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v)	{
    const vec4 C = vec4( 0.211324865405187,
                         0.366025403784439,
                        -0.577350269189626,
                         0.024390243902439);

    //	Skew the input space to find which simplex cell we're in.
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);

    //	Determine which of the two triangles within the cell.
    vec2 i1  = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy  -= i1;

    //	Hash the three simplex vertices.
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                   + i.x + vec3(0.0, i1.x, 1.0));

    //	Per-vertex falloff (smooth bumps that vanish at the simplex boundary).
    vec3 m = max(0.5 - vec3(dot(x0,    x0),
                            dot(x12.xy, x12.xy),
                            dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;

    //	Pick a pseudo-random gradient from the hash and dot it with the
    //	distance vector at each vertex.
    vec3 x  = 2.0 * fract(p * C.www) - 1.0;
    vec3 h  = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}


//	Direction vector for a given octave — each octave scrolls along its own
//	heading so summed octaves "boil" rather than scrolling as a single block.
vec2 octaveDir(int oct)	{
    float a = float(oct) * 1.61803398875 + seed * 0.1;
    return vec2(cos(a), sin(a));
}


void main()	{
    vec2 uv = isf_FragNormCoord;

    //	Aspect-correct so noise features are visually round, not stretched.
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2  pos    = vec2(uv.x * aspect, uv.y);

    //	Stable per-shader offset from the seed so different seeds give
    //	completely different patterns rather than just translated ones.
    vec2 seedOffset = vec2(seed * 3.14159, seed * 2.71828);

    //	fBM octave summation.
    float total      = 0.0;
    float amplitude  = 1.0;
    float frequency  = scale;
    float maxAmp     = 0.0;          //	for normalization at the end

    //	GLSL/SPIR-V wants a constant loop bound; iterate the max and break.
    for (int i = 0; i < 6; ++i)	{
        if (i >= octaves) break;

        vec2 samplePos = pos * frequency
                       + seedOffset
                       + octaveDir(i) * TIME * speed;

        total     += snoise(samplePos) * amplitude;
        maxAmp    += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }

    //	Normalize to roughly [-1, 1] regardless of octave count / persistence.
    total /= max(maxAmp, 0.000001);

    //	Remap [-1, 1] -> [0, 1].
    float t = total * 0.5 + 0.5;

    //	Apply contrast around the mid value.
    t = (t - 0.5) * contrast + 0.5;
    t = clamp(t, 0.0, 1.0);

    vec3 rgb = mix(colorLow.rgb, colorHigh.rgb, t);
    float a  = mix(colorLow.a,   colorHigh.a,   t);

    isfFragColor = vec4(rgb, a);
}

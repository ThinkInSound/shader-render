#version 300 es
precision highp float;
precision highp int;
out vec4 isfFragColor;
// Heart: converted from ISF (Interactive Shader Format) by Shader Render.
// From Vidvox ISF-Files, https://github.com/Vidvox/ISF-Files (MIT License, see THIRD_PARTY_NOTICES.md)
// Credit: by VIDVOX
// Categories: Geometry

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
uniform float size; // 0 1 0.25
uniform vec4 color; // color 1 0 0 1

//	Adapted from https://glsl.io/transition/d71472a550601b96d69d

 
bool inHeart (vec2 p, vec2 center, float size) {
	if (size == 0.0) return false;
	vec2 o = (p-center)/(1.6*size);
	return pow(o.x*o.x+o.y*o.y-0.3, 3.0) < o.x*o.x*pow(o.y, 3.0);
}
 
void main() {
	vec2 p = isf_FragNormCoord;
	float m = inHeart(p, vec2(0.5, 0.4), size) ? 1.0 : 0.0;
	isfFragColor = mix(vec4(0.0), color, m);
}
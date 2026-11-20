#version 300 es
precision highp float;
precision highp int;
out vec4 isfFragColor;
// Random Checkerboard: converted from ISF (Interactive Shader Format) by Shader Render.
// From Vidvox ISF-Files, https://github.com/Vidvox/ISF-Files (MIT License, see THIRD_PARTY_NOTICES.md)
// Credit: VIDVOX
// Categories: Pattern, Color

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
uniform float width; // 0 1 0.25
uniform vec2 offset; // 0 1 0 0
uniform float hue; // 0 1 0
uniform float saturation; // 0 1 0.5
uniform float brightness; // 0 1 0.95
uniform bool randHue; // true
uniform bool randSaturation; // false
uniform bool randBright; // false
uniform bool randAlpha; // false
uniform float rSeed; // 0 1 0.71

float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

vec4 rand4(vec4 co)	{
	vec4	returnMe = vec4(0.0);
	returnMe.r = rand(co.rg);
	returnMe.g = rand(co.gb);
	returnMe.b = rand(co.ba);
	returnMe.a = rand(co.rb);
	return returnMe;
}

vec3 hsv2rgb(vec3 c)	{
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {

	vec4 out_color = vec4(0.0);
	vec2 coord = isf_FragNormCoord;
	vec4 hsv = vec4(hue, saturation, brightness, 1.0);
	float minW = max(width,1.0/RENDERSIZE.y);
	vec2 indexes = floor((coord+offset) / minW);
	float index = indexes.x + indexes.y/minW;
	
	hsv.r = (randHue) ? mod(hsv.r + rand(vec2(index, rSeed + 0.34219)),1.0) : hsv.r;
	hsv.g = (randSaturation) ? mod(hsv.g + rand(vec2(index, rSeed + 0.57731)),1.0) : hsv.g;
	hsv.b = (randBright) ? mod(hsv.b + rand(vec2(index, rSeed + 0.79436)),1.0) : hsv.b;
	hsv.a = (randAlpha) ? rand(vec2(hsv.a + index, rSeed + 1.37665)) : hsv.a;
	
	out_color.rgb = hsv2rgb(hsv.rgb);
	out_color.a = hsv.a;
	
	isfFragColor = out_color;
}
#version 300 es
precision highp float;
precision highp int;
out vec4 isfFragColor;
// Checkerboard: converted from ISF (Interactive Shader Format) by Shader Render.
// From Vidvox ISF-Files, https://github.com/Vidvox/ISF-Files (MIT License, see THIRD_PARTY_NOTICES.md)
// Credit: by VIDVOX
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
uniform vec4 color1; // color 1 1 1 1
uniform vec4 color2; // color 0 0 0 1
uniform vec2 splitPos; // 0 1 0.5 0.5

void main() {
	//	determine if we are on an even or odd line
	//	math goes like..
	//	mod(((coord+offset) / width),2)
	
	
	vec4		out_color = color2;
	float		size = width * RENDERSIZE.x;

	if (size == 0.0)	{
		out_color = color1;
	}
	else if ((mod(((gl_FragCoord.x+(offset.x*RENDERSIZE.x)) / size),2.0) < 2.0 * splitPos.x)&&(mod(((gl_FragCoord.y+(offset.y*RENDERSIZE.y)) / size),2.0) > 2.0 * splitPos.y))	{
		out_color = color1;
	}
	else if ((mod(((gl_FragCoord.x+(offset.x*RENDERSIZE.x)) / size),2.0) > 2.0 * splitPos.x)&&(mod(((gl_FragCoord.y+(offset.y*RENDERSIZE.y)) / size),2.0) < 2.0 * splitPos.y))	{
		out_color = color1;
	}
	
	isfFragColor = out_color;
}
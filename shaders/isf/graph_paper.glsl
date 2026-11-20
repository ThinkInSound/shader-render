#version 300 es
precision highp float;
precision highp int;
out vec4 isfFragColor;
// Graph Paper: converted from ISF (Interactive Shader Format) by Shader Render.
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
uniform vec4 bgColor; // color 0.94 0.94 0.97 1
uniform vec4 lineColor; // color 0.64 0.77 0.96 1
// majorDivisions: 0 = 0, 1 = 1, 2 = 2, 3 = 3, 4 = 4, 5 = 5, 6 = 6, 7 = 7, 8 = 8, 9 = 9, 10 = 10, 11 = 11, 12 = 12, 13 = 13, 14 = 14, 15 = 15, 16 = 16
uniform int majorDivisions; // 0 16 3
// minorHDivisions: 0 = 0, 1 = 1, 2 = 2, 3 = 3, 4 = 4, 5 = 5, 6 = 6, 7 = 7, 8 = 8
uniform int minorHDivisions; // 0 8 2
// minorVDivisions: 0 = 0, 1 = 1, 2 = 2, 3 = 3, 4 = 4, 5 = 5, 6 = 6, 7 = 7, 8 = 8
uniform int minorVDivisions; // 0 8 2
uniform float majorDivisionLineWidth; // 1 5 3
uniform bool square; // true

const float minorDivisionLineWidth = 1.0;


void main()	{
	vec4		inputPixelColor = bgColor;
	vec2		loc = gl_FragCoord.xy;
	vec2		divisionSize = (square) ? vec2(max(RENDERSIZE.x,RENDERSIZE.y)) : RENDERSIZE;
	divisionSize = (divisionSize - majorDivisionLineWidth) / (1.0 + float(majorDivisions));
	vec2		modLoc = mod(loc,divisionSize);
	if ((modLoc.x < majorDivisionLineWidth)||(modLoc.y < majorDivisionLineWidth))	{
		inputPixelColor = lineColor;
	}
	if (minorHDivisions > 0)	{
		vec2	locDivisionSize = (divisionSize) / (1.0+float(minorHDivisions));
		modLoc = mod(loc,locDivisionSize);
		if (modLoc.x < minorDivisionLineWidth)	{
			inputPixelColor = lineColor;
		}
	}
	if (minorVDivisions > 0)	{
		vec2	locDivisionSize = (divisionSize) / (1.0+float(minorVDivisions));
		modLoc = mod(loc,locDivisionSize);
		if (modLoc.y < minorDivisionLineWidth)	{
			inputPixelColor = lineColor;
		}
	}

	isfFragColor = inputPixelColor;
}

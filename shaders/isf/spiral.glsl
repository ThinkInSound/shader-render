#version 300 es
precision highp float;
precision highp int;
out vec4 isfFragColor;
// Spiral: converted from ISF (Interactive Shader Format) by Shader Render.
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
uniform float rotation; // 0 1 0
uniform float count; // 0.1 50 2
uniform float width; // 0 0.25 0.125
uniform float softness; // 0 1 0.25
uniform vec4 color1; // color 0 0 0 0
uniform vec4 color2; // color 1 1 1 1

const float pi = 3.14159265359;


void main() {
	//	determine if we are on an even or odd line
	//	math goes like..
	//	r = a + b*theta
	//	Changing the parameter 'a' will turn the spiral, while 'b' controls the distance between successive turnings.
	
	
	vec4 out_color = color1;
	
	//	convert to polar coordinates
	vec2 loc = vec2(isf_FragNormCoord[0],isf_FragNormCoord[1]);
	loc.y = (loc.y - 0.5) * RENDERSIZE.y / RENDERSIZE.x + 0.5;
	float r = 2.0 * count * distance(vec2(0.5,0.5), loc) + width;
	float theta = atan ((loc.y-0.5),(loc.x-0.5));

	loc.y = r * sin(theta + 2.0 * pi * rotation) + 0.5;

	if (loc.y < 0.5)	{
		theta = theta + 2.0 * pi;
		theta = mod(theta + rotation * 2.0 * pi, 2.0 * pi);
		theta = (theta + 2.0 * pi * floor(r - width));
	}
	else	{
		theta = mod(theta + rotation * 2.0 * pi, 2.0 * pi);
		theta = (theta + 2.0 * pi * floor(r + width));
	}
	
	if (width == 0.0)	{
		out_color = color1;
	}
	else 	{
		float dist = abs(r - theta/(2.0*pi));
		if (dist < width)	{
			if (dist > width * (1.0-softness))	{
				out_color = mix(color2, color1, (dist - width * (1.0-softness))/(width - width * (1.0-softness)));
			}
			else	{
				out_color = color2;
			}
		}
	}
	
	isfFragColor = out_color;
}
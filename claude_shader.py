"""Image -> shader with Claude, used by serve.py's /api/claude endpoint.

Credentials are resolved by the Anthropic SDK the usual way: ANTHROPIC_API_KEY,
ANTHROPIC_AUTH_TOKEN, or a profile created with `ant auth login`. They stay in
this local server process and are never sent to the browser.

Three modes:
  generate - image (+ local analysis + notes) -> new shader
  fix      - shader + compile errors          -> corrected shader
  refine   - target image + current render + shader -> closer shader
"""

import base64
import json
import os

MODEL = "claude-opus-5-5"
MAX_IMAGE_BYTES = 8 * 1024 * 1024

SYSTEM_PROMPT = """You write fragment shaders for Shader Render, a browser app that previews GLSL shaders and exports them as 1080p or 4K video.

## Environment
- Write Shadertoy-style code: define `void mainImage(out vec4 fragColor, in vec2 fragCoord)`. The app wraps it in GLSL ES 3.00 (WebGL2) and already declares: `uniform vec3 iResolution; uniform float iTime, iTimeDelta, iFrameRate; uniform int iFrame; uniform vec4 iMouse, iDate; uniform sampler2D iChannel0..iChannel3;`. Do not redeclare these, and do not write `#version`, `precision` or `main()`.
- The iChannel textures are empty (black); don't use them. Everything must be procedural.
- GLSL ES 3.00 rules: use `texture()`, never `texture2D()`; no implicit int/float conversion (write `1.0`, not `1`; use `float(i)`); loops need constant bounds; no recursion. Don't use reserved words as names (`sample`, `input`, `output`, `filter`, `common`, `active`, `partition`, `resource`, `smooth`, `flat`); defining your own `hash`, `noise` and `fbm` functions is fine.

## Parameters
Expose 5 to 12 custom uniforms the user can tweak. The app turns a trailing comment on the declaration line into a slider or colour picker:
    uniform float speed;   // 0 4 1            (min max default)
    uniform int   count;   // 1 20 6
    uniform vec2  center;  // -0.5 0.5 0 0     (min max x y)
    uniform vec3  tint;    // color 1 0.5 0.2  (colour picker, components 0-1)
    uniform bool  invert;  // false
One declaration per line, each one actually used (unused uniforms are compiled away). Expose the image's key colours as `color` uniforms with values sampled from it, plus the parameters that matter most for the look and motion (speed, density, scale, glow, contrast...).

## Look and motion
- Recreate the image as a procedural, animated piece: match its palette, composition (where light, dark and each colour sit), texture scale and character, lighting and mood. Not a pixel copy: a living version of it that someone would recognise.
- Motion should be smooth and calm enough to read at 24-60 fps; nothing that strobes or flickers per frame. It should never visibly loop or reset.
- Resolution independence: use `vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;` and size everything in those units. One pixel is `1.0 / iResolution.y`; use it only for antialiasing widths. 1080p and 4K must look the same apart from sharpness.
- Roll off highlights softly (e.g. `1.0 - exp(-c)`) and keep hues true in bright areas instead of hard clipping. Add grain or vignette only if the image has them.

## Performance
It must render at 20+ fps at 3840x2160 on a laptop GPU. Keep per-pixel work modest (roughly under 150 noise evaluations, raymarching under 80 steps), skip expensive per-cell work early with cheap distance tests, and avoid large nested loops.

## Output
Return JSON matching the schema: `name` (a short title), `summary` (one or two plain sentences: what it shows and which parameters matter most) and `code` (the complete shader source, starting with a short comment header)."""

SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "summary": {"type": "string"},
        "code": {"type": "string"},
    },
    "required": ["name", "summary", "code"],
    "additionalProperties": False,
}


class UserFacingError(Exception):
    """An error whose message is safe and useful to show in the app."""


def status():
    """Whether the SDK is installed and credentials look configured (no API call)."""
    try:
        import anthropic  # noqa: F401
        version = getattr(anthropic, "__version__", "unknown")
        sdk = True
    except ImportError:
        version = None
        sdk = False
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        creds = "environment"
    elif os.path.isdir(os.path.join(os.path.expanduser("~"), ".config", "anthropic")):
        creds = "profile"
    else:
        creds = "none"
    return {"sdk": sdk, "version": version, "credentials": creds, "model": MODEL}


def _image_block(b64, label):
    if not isinstance(b64, str) or not b64:
        raise UserFacingError(f"The {label} image is missing.")
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise UserFacingError(f"The {label} image isn't valid base64.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise UserFacingError(f"The {label} image is too large (max 8 MB after resizing).")
    if raw[:3] == b"\xff\xd8\xff":
        media = "image/jpeg"
    elif raw[:8] == b"\x89PNG\r\n\x1a\n":
        media = "image/png"
    else:
        raise UserFacingError(f"The {label} image must be a JPEG or PNG.")
    return {"type": "image", "source": {"type": "base64", "media_type": media, "data": b64}}


def _text(value, limit):
    return str(value or "")[:limit]


def _build_content(payload):
    mode = payload.get("mode")
    notes = _text(payload.get("notes"), 2000).strip()
    notes_part = f"\n\nNotes from the user: {notes}" if notes else ""

    if mode == "generate":
        analysis = _text(json.dumps(payload.get("analysis") or {}, indent=1), 6000)
        return [
            _image_block(payload.get("image"), "source"),
            {"type": "text", "text": (
                "Recreate this image as an animated shader for Shader Render.\n\n"
                "Measurements the app took from the image, to help you match it. Colours are 0-1 RGB as displayed "
                "(shader output is shown directly, so you can use these values as-is): the palette with each "
                "colour's share of the image, a coarse colour layout grid (rows from the top, columns from the "
                f"left), and brightness and texture statistics:\n{analysis}{notes_part}"
            )},
        ]

    if mode == "fix":
        code = _text(payload.get("code"), 60000)
        errors = _text(payload.get("errors"), 6000)
        if not code.strip():
            raise UserFacingError("There's no shader code to fix.")
        return [{"type": "text", "text": (
            "This shader fails to compile in WebGL2 (GLSL ES 3.00, Shadertoy-style wrapper as described). "
            "Fix every error and return the complete corrected shader, keeping its look, motion and parameters.\n\n"
            f"Compiler errors (line numbers refer to the code below):\n{errors}\n\n"
            f"Shader:\n```glsl\n{code}\n```{notes_part}"
        )}]

    if mode == "refine":
        code = _text(payload.get("code"), 60000)
        t = payload.get("time", 0)
        if not code.strip():
            raise UserFacingError("There's no shader code to refine.")
        return [
            _image_block(payload.get("image"), "target"),
            _image_block(payload.get("render"), "rendered"),
            {"type": "text", "text": (
                "Image 1 is the target. Image 2 is the current shader below, rendered at "
                f"t = {float(t):.2f} s. Compare them closely (palette, brightness and contrast, composition, "
                "texture scale and character, shapes, lighting) and revise the shader so it looks closer to the "
                "target, fixing the biggest differences first. Keep existing parameter names where they still "
                "make sense, and keep it animated and fast.\n\n"
                f"Current shader:\n```glsl\n{code}\n```{notes_part}"
            )},
        ]

    raise UserFacingError("Unknown mode.")


def run(payload):
    """Calls Claude and returns {name, summary, code, model, usage}. Raises UserFacingError."""
    try:
        import anthropic
    except ImportError:
        raise UserFacingError(
            "The Anthropic Python SDK isn't installed. Run `python -m pip install anthropic`, "
            "then restart Shader Render."
        )

    content = _build_content(payload)
    request = dict(
        model=MODEL,
        max_tokens=64000,
        system=SYSTEM_PROMPT,
        thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": content}],
        # If the request is declined by a safety classifier, the API retries it on a
        # suitable fallback model within the same call.
        betas=["server-side-fallback-2026-07-01"],
    )

    try:
        client = anthropic.Anthropic()
        try:
            stream_ctx = client.beta.messages.stream(**request, fallbacks="default")
        except TypeError:
            # Older SDK releases without the `fallbacks` parameter
            stream_ctx = client.beta.messages.stream(**request, extra_body={"fallbacks": "default"})
        with stream_ctx as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        raise UserFacingError(
            "Claude rejected the credentials. Set the ANTHROPIC_API_KEY environment variable "
            "(or run `ant auth login`), then restart Shader Render."
        )
    except anthropic.PermissionDeniedError as e:
        raise UserFacingError(f"Your Anthropic account doesn't have access to this: {e.message}")
    except anthropic.RateLimitError:
        raise UserFacingError("Rate limited by the Claude API. Wait a minute and try again.")
    except anthropic.BadRequestError as e:
        raise UserFacingError(f"The Claude API rejected the request: {e.message}")
    except anthropic.APIStatusError as e:
        raise UserFacingError(f"Claude API error ({e.status_code}). Try again shortly.")
    except anthropic.APIConnectionError:
        raise UserFacingError("Couldn't reach the Claude API. Check your internet connection.")
    except Exception as e:
        # e.g. no credentials found at all when the client is created
        if "api_key" in str(e).lower() or "auth" in str(e).lower():
            raise UserFacingError(
                "No Anthropic credentials found. Set the ANTHROPIC_API_KEY environment variable "
                "(or run `ant auth login`), then restart Shader Render."
            )
        raise

    if message.stop_reason == "refusal":
        raise UserFacingError("Claude declined to generate a shader for this image.")
    if message.stop_reason == "max_tokens":
        raise UserFacingError("The response was cut off before the shader was complete. Try again.")

    text = "".join(block.text for block in message.content if block.type == "text")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise UserFacingError("Claude's reply wasn't in the expected format. Try again.")
    if not isinstance(data.get("code"), str) or "main" not in data["code"]:
        raise UserFacingError("Claude's reply didn't contain a shader. Try again.")

    usage = message.usage
    return {
        "name": _text(data.get("name"), 120) or "Generated shader",
        "summary": _text(data.get("summary"), 1000),
        "code": data["code"],
        "model": message.model,
        "usage": {
            "input_tokens": getattr(usage, "input_tokens", 0) or 0,
            "output_tokens": getattr(usage, "output_tokens", 0) or 0,
        },
    }

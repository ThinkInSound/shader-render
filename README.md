# Shader Render

Load a GLSL fragment shader, preview it live, and export it as a frame-accurate
1080p or 4K MP4 (H.264, HEVC, VP9 or AV1), entirely in the browser.

**Try it: https://thinkinsound.github.io/shader-render/**

## Use it online (GitHub Pages)

The app is a static site: plain HTML, CSS and JavaScript with no build step and no server code,
so it runs as-is on GitHub Pages or any static host. Everything (previews, exports and
Image → Shader) happens in the visitor's browser. The optional Claude features need the local
launcher, so they're hidden online.

To publish your own copy, push this folder to a GitHub repository, then go to
**Settings → Pages → Build and deployment**, choose **Deploy from a branch**, pick `main` and
`/ (root)`, and save. The site appears at `https://<user>.github.io/<repo>/` after a minute or two.
The empty `.nojekyll` file tells Pages to serve the files as they are.

Video export needs WebCodecs (current Chrome or Edge recommended), and Pages serves over HTTPS,
which WebCodecs requires.

## Run locally

Double-click **`Start Shader Render.bat`**. It starts a local server and opens
http://127.0.0.1:8765 in your browser. Close the console window to stop it. It needs Python.

Or start the server yourself:

```bash
python serve.py 8765
```

`serve.py` only accepts connections from this computer. It listens on 127.0.0.1, rejects
requests whose Host header isn't `127.0.0.1` or `localhost` (this blocks DNS-rebinding
tricks from websites), serves only files inside this folder, and turns off directory listings.

CodeMirror and mp4-muxer load from a CDN, so you need an internet connection.

Use a current Chrome or Edge for the widest codec support. Video export needs WebCodecs.

## Shader dialects

| Detected when…                 | Treated as                                               |
|--------------------------------|----------------------------------------------------------|
| defines `mainImage(...)`       | Shadertoy (`iTime`, `iResolution`, `iMouse`, `iChannel0-3`, …) |
| starts with `#version 300 es`  | Raw GLSL ES 3.00, used as-is                              |
| anything else                  | GLSL ES 1.00 (`gl_FragColor`); `precision highp float` added if missing |

Raw shaders can declare any of these uniforms: `u_time`, `u_resolution`, `u_mouse`, `u_frame`,
`u_delta`, `time`, `resolution`, `mouse`, `u_tex0-3`, plus all the Shadertoy names.

## Examples

The Examples menu has 45 shaders:

- Hand-made pieces (bokeh sparkles, lemon gold, ancient green, water, lava, storms, shadows…)
- **Study:** 13 originals, each focused on one technique: fbm clouds, Voronoi stained glass,
  nebula, plasma, kaleidoscope, synthwave grid, snowfall, fireflies, topographic contours,
  halftone, op art, northern lights, underwater light
- **ISF:** 14 generators from [Vidvox ISF-Files](https://github.com/Vidvox/ISF-Files) (MIT),
  converted with the ISF importer

Credits and licences are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). To add your own,
see `shaders/build_examples.py`.

## Importing shaders

**Import…** (or Open, or drag and drop) accepts:

- **Shadertoy JSON:** keeps the Common, Buffer A–D and Image passes, buffer and texture channels
  (textures load from shadertoy.com), and adds the author, link and licence to the code.
  Keyboard, sound, video, webcam and cubemap inputs aren't supported and read black. To get a
  shader's JSON, create a free app key at shadertoy.com/myapps, then open
  `https://www.shadertoy.com/api/v1/shaders/SHADER_ID?key=YOUR_KEY` in your browser; this works
  for shaders their authors published as "Public + API". Shadertoy shaders are CC BY-NC-SA 3.0
  (non-commercial) unless their author says otherwise.
- **ISF (`.fs`):** converts the JSON header's inputs into sliders (float, int, bool, colour,
  point) and maps ISF's built-ins (`TIME`, `RENDERSIZE`, `isf_FragNormCoord`, `IMG_PIXEL`…) onto
  Shader Render's. Image inputs read `iChannel0`–`3`, so ISF filters work on an image you load
  there. ISF is written for desktop GLSL, so a few shaders need small fixes for WebGL; the
  importer reports compile errors. Multi-pass ISF and custom vertex shaders aren't supported.
- **Shader Render projects** (`.shader.json`).

## Image → Shader

Click **Image → Shader**, then drop in an image, choose one, or paste a screenshot (Ctrl+V).
The app measures it straight away (palette, colour layout, brightness, contrast, texture scale
and direction, bright particles), and then you can choose any of these options. All of them
are free, and the image never leaves your browser:

- **Match a style:** a small image model (CLIP ViT-B/32, run in the browser with
  [transformers.js](https://huggingface.co/docs/transformers.js)) compares the image with every
  style in the style library and lists the three closest example shaders. Click one to load it,
  recoloured with the image's palette: its colour sliders are set from the image, or, if it has
  none, a `paletteMatch` grade maps its colours onto the image's. The first use downloads the
  model (about 90 MB) from Hugging Face; the browser caches it after that.
- **Animate this image:** puts the image itself into `iChannel0` and generates a shader that
  brings it to life: gentle flowing distortion, twinkling highlights, a soft glow around bright
  areas, a slow push-in, and an occasional sweep of light. This gives the closest match, because
  it uses the real pixels. Images aren't saved with projects, so after reopening, drop the image
  on the iChannel0 slot again. For sharp 4K exports, use an image at least 3840 px wide.
- **Procedural shader:** recreates the image from scratch in code, using its colour layout,
  palette, texture direction and scale, vein-like ridges for busy textures, and particle discs
  where the image had round highlights. It's fully resolution-independent, but a loose
  interpretation rather than a close copy. Use it as a starting point and tweak the sliders.

### Adding styles to Match a style

The style library lives in `shaders/build_style_library.mjs`: each entry names an example shader
and gives a few short descriptions of the kind of image it suits. After adding an example
(see `shaders/build_examples.py`) and a style entry for it, rebuild `js/style-library.js`:

```bash
npm install --no-save @huggingface/transformers@4.3.2
```

```bash
node shaders/build_style_library.mjs --test path/to/an-image.jpg
```

`--test` is optional; it prints the top matches for an image so you can check the descriptions.
Shaders with `// color r g b` sliders are recoloured most faithfully.

### Optional: Claude (local launcher only)

When the app runs through `Start Shader Render.bat` and Claude is set up, two more buttons appear.
They never appear on the GitHub Pages version.

- **Generate with Claude:** Claude (Opus 5.5) looks at the image and writes a complete animated
  shader with sliders for its colours and main settings. If it doesn't compile, the errors are
  sent back to Claude automatically (up to 2 times). This usually takes 1–3 minutes.
- **Refine with Claude:** renders the current shader at the preview's time and shows Claude the
  render next to the original image, so it can close the gap. Ctrl+Z in the editor undoes a refine.

Use the notes box to steer Claude ("slow drift", "make the glow pulse"...).

#### Setting up Claude (one time)

1. Install the Anthropic Python SDK:
   ```bash
   python -m pip install anthropic
   ```
2. Get an API key at https://platform.claude.com/ and save it as an environment variable. On
   Windows, run this in a terminal (replacing the placeholder), then open a new terminal:
   ```bash
   setx ANTHROPIC_API_KEY "your-key-here"
   ```
   If you use the `ant` CLI, `ant auth login` works instead.
3. Restart **Start Shader Render.bat**. The launcher window and the panel both say whether
   Claude is ready.

Each Claude request is billed to your Anthropic account (roughly 10–60 cents per generation,
an estimate). The key stays in the local server process (`serve.py`). It is never sent to the
browser, and the server only accepts Claude requests from the app's own page.

## Shader parameters

Any custom `uniform` your shader uses gets a live control in the **Shader parameters**
panel. The current values are also used for video and PNG exports. To set ranges and
defaults, add a comment at the end of the declaration:

```glsl
uniform float speed;   // 0 4 1          min max default
uniform int   arms;    // 1 12 5
uniform vec2  center;  // -0.5 0.5 0 0   min max x y
uniform vec3  tint;    // color 1 .5 .2  colour picker (names like color/tint also get one)
uniform bool  invert;  // true
```

Without a comment, floats use 0–1 and ints use 0–10. Values are remembered per uniform
name. The panel also lists the built-in inputs the shader uses (`iTime`, `iResolution`, …)
with their live values.

Drag the bar between the editor and the preview to resize the editor. Double-click it to reset.

## Multi-pass (Buffers A–D and Common)

Use **+ Add** above the editor to add Shadertoy-style tabs:

- **Buffer A–D**: each renders into its own texture every frame, in the order A, B, C, D,
  then Image. To read a buffer from any pass, set one of that pass's input channels to
  "Buffer X". A buffer that reads itself gets its own previous frame, which makes feedback
  effects and simulations possible. Buffers keep alpha and use 32-bit float precision where
  the GPU supports it.
- **Common**: code added to the top of every Shadertoy-style pass, for shared functions,
  constants and custom uniforms.

The **Input channels** panel always shows the channels of the selected tab. Restart (⏮) or
scrubbing clears the buffers. Buffers start empty on frame 0 and are sized to match the
render, so feedback shaders change when the resolution changes.

When exporting a multi-pass shader from a start time later than 0, the app first runs the
buffers from 0 s (without encoding) so the video picks up exactly where the simulation would
be. PNG frames work the same way.

**Save** writes a `.glsl` file for single-pass shaders and a `.shader.json` project for
multi-pass ones. **Open** accepts both. A plain shader file opens into the selected tab.

See the "Reaction-diffusion" example.

## Extra examples (`shaders/`)

The `shaders/` folder holds more example shaders (water, lava, fire & ice, dancing and crowd
shadows). They show up at the end of the Examples menu through `js/examples-extra.js`, which
is generated from that folder. After editing or adding a shader there, list it in
`shaders/build_examples.py` if it's new, then run:

```bash
python shaders/build_examples.py
```

and reload the app. Each file also opens directly with **Open**.

## Export notes

- Rendering runs offline at a fixed timestep, so heavy shaders still give smooth video.
  They just take longer to export.
- **2×2 supersampling** renders at twice the size in each direction and box-filters down,
  which removes aliasing.
- **Stream straight to a file** (Chrome/Edge) writes to a file you choose as it encodes, with
  no size limit. Exports estimated over 1.5 GB always use it, so you'll be asked where to save.
- Otherwise the video is written to the browser's private storage on disk, then downloaded.
  If there isn't enough room there, it's built in memory instead, which only works for files
  under about 2 GB. Old temporary exports are cleared at the start of later exports.
- If the disk or storage fills up, the export stops straight away with a message, instead of
  failing after the render.
- No keyboard, audio, video or cubemap inputs.

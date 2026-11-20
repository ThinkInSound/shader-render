# Third-party notices

Shader Render itself is licensed under GPL-3.0-or-later (see [LICENSE](LICENSE)). This file lists
the third-party code and assets it includes or loads, and their licences.

## Example shaders

### Vidvox ISF-Files (MIT License)

The examples named "ISF: … (Vidvox)", in `shaders/isf/`, were converted with Shader Render's
ISF importer from generators in [Vidvox/ISF-Files](https://github.com/Vidvox/ISF-Files).
Only generators credited to VIDVOX or its staff were included. The conversion maps ISF's
built-ins and inputs onto Shader Render's; the shader code itself is unchanged.

```
MIT License

Copyright (c) 2018

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ridgelines and Simplex Noise include simplex noise by Ian McEwan and Ashima Arts and by
Stefan Gustavson, distributed under the MIT License (credited in their shader headers).

### Studies

The examples named "Study: …", in `shaders/studies/`, are original shaders written for
Shader Render and licensed under GPL-3.0-or-later with the rest of the app. They cover techniques also taught in *The Book of Shaders*, but they don't
contain its code. The Book of Shaders and its examples are "all rights reserved" by
Patricio Gonzalez Vivo, so none of them are bundled here.

## Libraries loaded at runtime

These are loaded from CDNs when the app runs; none are copied into this repository.

- [CodeMirror 5](https://codemirror.net/5/), MIT License
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), MIT License
- [transformers.js](https://github.com/huggingface/transformers.js) (Hugging Face), Apache License 2.0
- [CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32) (OpenAI, converted to
  ONNX by Xenova), MIT License; used by Image → Shader's "Match a style"

## Shaders you import

Shaders imported from Shadertoy keep their author, link and a licence note in their header.
Shadertoy shaders are CC BY-NC-SA 3.0 (non-commercial) unless their author says otherwise,
so check the licence before using an imported shader in commercial work. ISF files carry
whatever licence their authors gave them.

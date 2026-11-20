// Builds js/style-library.js: the styles Image -> Shader's "Match a style" can pick from.
//
// Each style is an example shader plus a few descriptions of what it looks like. This
// script turns the descriptions into CLIP text embeddings once, offline, so the web app
// only has to download CLIP's image half and compare embeddings in the browser.
//
// After adding or changing a style below (the shader must be an example in the app):
//   npm install --no-save @huggingface/transformers@4.3.2
//   node shaders/build_style_library.mjs
// Optional check: node shaders/build_style_library.mjs --test path/to/image.jpg

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AutoTokenizer, CLIPTextModelWithProjection,
  AutoProcessor, CLIPVisionModelWithProjection, RawImage,
} from '@huggingface/transformers';

const MODEL = 'Xenova/clip-vit-base-patch32';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'js', 'style-library.js');

// file: the example's `file` value. prompts: short descriptions of images it suits.
const STYLES = [
  { file: 'celestial_sparkles.glsl', prompts: [
    'out of focus bokeh lights on dark water', 'blurry sparkles of sunlight reflecting on water at night',
    'soft round glowing bokeh circles on a dark blue background', 'glittering defocused lights'] },
  { file: 'lemon_sparkle_gold.glsl', prompts: [
    'golden fizzy drink with bubbles and sparkles', 'champagne bubbles in yellow liquid',
    'sparkling gold glitter on a yellow background', 'lemonade with rising bubbles'] },
  { file: 'ancient_green.glsl', prompts: [
    'green marble stone texture with glowing veins', 'abstract swirling green malachite',
    'neon green organic veins texture', 'green liquid swirls abstract background'] },
  { file: 'ancient_green_glyphs.glsl', prompts: [
    'grid of carved stone tiles with glowing symbols', 'ancient engraved geometric patterns on stone',
    'glowing tribal glyphs pattern', 'square tiles with spirals and concentric circles'] },
  { file: 'water_shimmer.glsl', prompts: [
    'sunlight shimmering on the ocean surface', 'sea at sunset with glittering reflections',
    'ripples on a lake reflecting the sky', 'calm water waves to the horizon'] },
  { file: 'lava_volcano.glsl', prompts: [
    'erupting volcano with flowing lava', 'molten glowing magma', 'red hot lava landscape at night'] },
  { file: 'fire_and_ice.glsl', prompts: [
    'fire and ice abstract glitch art', 'flames meeting frost, orange and blue', 'hot and cold colours colliding'] },
  { file: 'dancing_shadows.glsl', prompts: [
    'silhouettes of people dancing around a campfire at night', 'campfire glowing in the dark with shadows',
    'warm firelight flickering on figures'] },
  { file: 'dancing_shadows_feedback.shader.json', prompts: [
    'motion blur trails of dancing silhouettes', 'ghostly echo trails of moving figures in warm light'] },
  { file: 'crowd_shadows.glsl', prompts: [
    'shadows of a crowd on a wall at sunset', 'silhouettes of people against an orange wall',
    'long shadows of people in golden hour light'] },
  { file: 'thunderstorm.glsl', prompts: [
    'thunderstorm with lightning strikes', 'dark storm clouds at night', 'lightning bolt in a stormy sky'] },
  { file: 'aurora.glsl', prompts: [
    'abstract swirling fluid colours', 'marbled ink in water, teal and purple', 'colourful smoke flowing abstract'] },
  { file: 'raymarch.glsl', prompts: [
    '3D render of a torus and sphere with soft shadows', 'smooth glossy 3D shapes on a checkered floor'] },
  { file: 'truchet.glsl', prompts: [
    'colourful truchet tile pattern', 'woven pattern of curved neon lines', 'maze of glowing arcs on black'] },
  { file: 'reaction-diffusion.shader.json', prompts: [
    'organic coral like reaction diffusion pattern', 'brain coral maze pattern', 'leopard spots and stripes pattern'] },
  { file: 'rings-params.glsl', prompts: [
    'hypnotic concentric wavy rings', 'psychedelic pink and blue ripples', 'flower shaped wavy circles pattern'] },
  // Studies (originals)
  { file: 'studies/clouds.glsl', prompts: [
    'white fluffy clouds in a blue sky', 'cloudy sky with patches of blue', 'cumulus clouds drifting in daylight'] },
  { file: 'studies/stained_glass.glsl', prompts: [
    'colourful stained glass window', 'mosaic of coloured glass pieces with dark lead lines', 'church window of red blue and yellow glass'] },
  { file: 'studies/nebula.glsl', prompts: [
    'colourful nebula in deep space with stars', 'purple and blue galaxy gas clouds', 'starfield with glowing cosmic dust'] },
  { file: 'studies/plasma.glsl', prompts: [
    'retro psychedelic plasma colours', 'smooth rainbow gradient waves', 'trippy pastel colour swirls'] },
  { file: 'studies/kaleidoscope.glsl', prompts: [
    'kaleidoscope mandala pattern', 'symmetrical radial ornament with glowing dots', 'mirrored colourful kaleidoscope'] },
  { file: 'studies/synthwave.glsl', prompts: [
    'retro synthwave sunset with a neon grid', '80s outrun striped sun over a grid', 'vaporwave neon landscape'] },
  { file: 'studies/snowfall.glsl', prompts: [
    'snow falling at night', 'snowflakes in a dark winter sky', 'snowfall lit by a street lamp'] },
  { file: 'studies/fireflies.glsl', prompts: [
    'fireflies glowing over a dark forest at dusk', 'treeline silhouette at twilight with glowing specks', 'summer night meadow with fireflies'] },
  { file: 'studies/topographic.glsl', prompts: [
    'topographic map with contour lines', 'terrain elevation map', 'contour lines on a shaded relief map'] },
  { file: 'studies/halftone.glsl', prompts: [
    'halftone dot pattern in comic style', 'pop art print dots', 'newspaper print dot screen'] },
  { file: 'studies/op_art.glsl', prompts: [
    'black and white op art stripes', 'optical illusion wavy lines', 'moire pattern of warped stripes'] },
  { file: 'studies/northern_lights.glsl', prompts: [
    'aurora borealis over mountains', 'green northern lights in the night sky', 'polar lights above snowy peaks'] },
  { file: 'studies/underwater.glsl', prompts: [
    'underwater sun rays in blue water', 'ocean floor with light rays and caustics', 'deep blue sea seen from below the surface'] },
  // Vidvox ISF generators
  { file: 'isf/worley_cells.glsl', prompts: [
    'cellular pattern of irregular cells', 'voronoi cell texture like cracked tiles', 'mosaic of irregular blue and yellow cells'] },
  { file: 'isf/ridgelines.glsl', prompts: [
    'white noise ridges on black', 'electric veins texture', 'wrinkled white lines on black'] },
  { file: 'isf/simplex_noise.glsl', prompts: [
    'grey cloudy noise texture', 'smooth monochrome noise', 'grainy grey smoke texture'] },
  { file: 'isf/random_lines.glsl', prompts: [
    'random green lines crossing', 'abstract scattered straight lines', 'tangle of glowing straight lines'] },
  { file: 'isf/noise.glsl', prompts: [
    'colourful pixel noise grid', 'random coloured squares mosaic', 'glitchy blocks of colour'] },
  { file: 'isf/grid_warp.glsl', prompts: [
    'warped grid lines', 'distorted orange mesh grid on black', 'bulging wireframe grid'] },
  { file: 'isf/graph_paper.glsl', prompts: [
    'graph paper', 'blue grid lines on white paper', 'engineering grid paper'] },
  { file: 'isf/spiral.glsl', prompts: [
    'black and white spiral', 'hypnotic spiral line', 'white swirl on black'] },
  { file: 'isf/star.glsl', prompts: [
    'single pink star shape on black', 'simple star icon', 'five pointed star'] },
  { file: 'isf/heart.glsl', prompts: [
    'red heart shape on black', 'love heart symbol', 'simple red heart icon'] },
  { file: 'isf/sine_warp_gradient.glsl', prompts: [
    'soft blurry colour gradient', 'smooth gradient background blue and orange', 'warm and cool blurred gradient'] },
  { file: 'isf/random_checkerboard.glsl', prompts: [
    'pastel colour block grid', 'random coloured tiles', 'grid of soft coloured squares'] },
  { file: 'isf/checkerboard.glsl', prompts: [
    'black and white checkerboard', 'chessboard pattern', 'large checkered squares'] },
  { file: 'isf/color_scales.glsl', prompts: [
    'horizontal colour stripes', 'colour swatch bands', 'striped bands of red yellow and blue'] },
];

const normalize = (v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

async function textEmbeddings(prompts) {
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
  const model = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' });
  const inputs = tokenizer(prompts, { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  const dim = text_embeds.dims[1];
  const data = text_embeds.data;
  return prompts.map((_, i) => normalize(Array.from(data.slice(i * dim, (i + 1) * dim))));
}

async function build() {
  const all = STYLES.flatMap((s) => s.prompts);
  const embeds = await textEmbeddings(all);
  let k = 0;
  const styles = STYLES.map((s) => {
    const mine = s.prompts.map(() => embeds[k++]);
    // Average the descriptions, then re-normalise
    const avg = normalize(mine[0].map((_, d) => mine.reduce((sum, e) => sum + e[d], 0) / mine.length));
    return { file: s.file, prompts: s.prompts, embedding: avg.map((x) => +x.toFixed(5)) };
  });
  const js = `'use strict';\n\n// GENERATED by shaders/build_style_library.mjs: CLIP (${MODEL}) text embeddings\n` +
    `// of each style's descriptions. Edit the STYLES list there and rerun instead of editing this.\n\n` +
    `window.STYLE_LIBRARY = ${JSON.stringify({ model: MODEL, styles })};\n`;
  writeFileSync(OUT, js);
  console.log(`Wrote ${OUT} with ${styles.length} styles (${(js.length / 1024).toFixed(1)} KB)`);
  return styles;
}

async function test(imagePath, styles) {
  const processor = await AutoProcessor.from_pretrained(MODEL);
  const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' });
  const image = await RawImage.read(imagePath);
  const { image_embeds } = await vision(await processor(image));
  const img = normalize(Array.from(image_embeds.data));
  const sims = styles.map((s) => ({ file: s.file, sim: s.embedding.reduce((a, x, i) => a + x * img[i], 0) }));
  const exps = sims.map((s) => Math.exp(100 * s.sim));
  const total = exps.reduce((a, b) => a + b, 0);
  sims.forEach((s, i) => { s.p = exps[i] / total; });
  sims.sort((a, b) => b.p - a.p);
  console.log(`\nMatches for ${imagePath}:`);
  for (const s of sims.slice(0, 5)) console.log(`  ${(s.p * 100).toFixed(1).padStart(5)}%  ${s.file}`);
}

const styles = await build();
const t = process.argv.indexOf('--test');
if (t > 0 && process.argv[t + 1]) await test(process.argv[t + 1], styles);

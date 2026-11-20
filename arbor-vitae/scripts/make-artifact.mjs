// Turns the Vite build (dist/) into one self-contained HTML page for hosting
// as a claude.ai Artifact: CSS and JS inlined, fonts from Google Fonts, and
// no document skeleton (the host adds its own).
// Usage: npm run build && node scripts/make-artifact.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const out = process.argv[2] || join(dist, 'artifact.html');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const cssHref = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)[1];
const jsSrc = html.match(/<script type="module"[^>]*src="([^"]+)"/)[1];
const css = readFileSync(join(dist, cssHref), 'utf8').replace(/@font-face\{[^}]*\}/g, '');
const js = readFileSync(join(dist, jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script');
const title = html.match(/<title>[^<]*<\/title>/)[0];
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .replace(/src="\/(nsig|entig)-logo\.png"/g, 'src="$1-logo.png"');

const fonts =
  'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';

writeFileSync(
  out,
  `${title}
<link rel="stylesheet" href="${fonts}">
<style>:root{color-scheme:dark}${css}</style>
${body.trim()}
<script type="module">${js}</script>
`,
);
console.log('wrote', out);

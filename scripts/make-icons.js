#!/usr/bin/env node
/*
 * Renders the extension's icon (packages/browser-extension/icons/icon.svg,
 * the brand mark: a white "$" on a green rounded square) to every PNG size
 * the three packages need, with a transparent background, through a
 * headless Chrome. Vector rendering at each size keeps the 16 px version
 * crisp instead of a blurry downscale.
 *
 *   node scripts/make-icons.js
 *
 * Chrome or Edge must be installed (CHROME_PATH overrides the lookup).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findBrowser, headless, fileUrl } = require('./lib/browser');
const png = require('./lib/png');

const ROOT = path.resolve(__dirname, '..');
const SVG = path.join(ROOT, 'packages', 'browser-extension', 'icons', 'icon.svg');
const TARGETS = [
  { dir: path.join(ROOT, 'packages', 'browser-extension', 'icons'), sizes: [16, 32, 48, 128] },
  { dir: path.join(ROOT, 'packages', 'outlook-addin', 'assets'), sizes: [16, 32, 64, 80, 128] },
  { dir: path.join(ROOT, 'packages', 'google-workspace-addon'), sizes: [128] }
];

const browser = findBrowser();
if (!browser) {
  console.error('make-icons: no Chrome/Edge found (set CHROME_PATH)');
  process.exit(1);
}
if (!fs.existsSync(SVG)) {
  console.error('make-icons: missing ' + path.relative(ROOT, SVG));
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-icons-'));
fs.copyFileSync(SVG, path.join(tmp, 'icon.svg'));
const rendered = {};

function render(size) {
  if (rendered[size]) return rendered[size];
  const page = path.join(tmp, 'icon-' + size + '.html');
  fs.writeFileSync(page, '<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block}</style></head>' +
    '<body><img src="icon.svg" width="' + size + '" height="' + size + '"></body></html>');
  const out = path.join(tmp, 'icon-' + size + '.png');
  headless(browser, ['--default-background-color=00000000', '--force-device-scale-factor=1',
    '--window-size=' + size + ',' + size, '--screenshot=' + out, fileUrl(page)]);
  const img = png.decode(fs.readFileSync(out));
  if (img.width !== size || img.height !== size) throw new Error('rendered ' + img.width + 'x' + img.height + ' for ' + size);
  rendered[size] = png.encode(img, { alpha: true });
  return rendered[size];
}

for (const target of TARGETS) {
  fs.mkdirSync(target.dir, { recursive: true });
  for (const size of target.sizes) {
    const file = path.join(target.dir, 'icon-' + size + '.png');
    const data = render(size);
    fs.writeFileSync(file, data);
    console.log('wrote', path.relative(ROOT, file), data.length + ' bytes');
  }
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (err) { /* ignore */ }

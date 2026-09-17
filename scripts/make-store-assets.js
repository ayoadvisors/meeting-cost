#!/usr/bin/env node
/*
 * Renders the Chrome Web Store listing images with a headless Chromium and
 * writes them as 24-bit PNGs (no alpha channel, as the store requires):
 *
 *   store/assets/screenshot-1-upcoming.png   1280x800   the Google Calendar bubble, before the meeting
 *   store/assets/screenshot-2-live.png       1280x800   the same meeting, running
 *   store/assets/screenshot-3-outlook.png    1280x800   Outlook on the web
 *   store/assets/screenshot-4-options.png    1280x800   the options page
 *   store/assets/promo-small-440x280.png     440x280    small promo tile
 *   store/assets/promo-marquee-1400x560.png  1400x560   marquee promo tile
 *
 * The screenshots are the real content scripts running on replicas of the
 * calendar UIs (store/src/screenshot.html); the options page is the real one.
 * The promo tiles come from the brand document exported from Claude Design
 * (store/design/unpacked/Meeting Cost Brand Assets.dc.html): its runtime
 * renders the tiles, then a small injected script isolates the tile of the
 * wanted size before the screenshot. That document loads its runtime from a
 * CDN, so the tiles need network access; store/src/promo.html is the
 * fallback when the design export is absent.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { findBrowser, headless, fileUrl } = require('./lib/browser');
const png = require('./lib/png');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'store', 'src');
const DESIGN = path.join(ROOT, 'store', 'design', 'unpacked');
const OUT = path.join(ROOT, 'store', 'assets');

const browser = findBrowser();
if (!browser) {
  console.error('make-store-assets: no Chrome/Edge found (set CHROME_PATH)');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-shots-'));

const brandDoc = path.join(DESIGN, 'Meeting Cost Brand Assets.dc.html');
const haveDesign = fs.existsSync(brandDoc);
if (haveDesign) {
  // Harness copies next to the runtime and the icon the document references.
  for (const f of ['support.js', 'icon.svg']) fs.copyFileSync(path.join(DESIGN, f), path.join(tmp, f));
  const src = fs.readFileSync(brandDoc, 'utf8');
  for (const [name, w, h] of [['small', 440, 280], ['marquee', 1400, 560]]) {
    const isolate = '<script>window.addEventListener("load",function(){setTimeout(function(){' +
      'var t=Array.from(document.querySelectorAll("div")).find(function(d){return d.offsetWidth===' + w + '&&d.offsetHeight===' + h + ';});' +
      'if(!t){document.body.textContent="TILE NOT FOUND";return;}' +
      // Keep what the tile inherited from the wrapper that is about to go.
      'var cs=getComputedStyle(t);t.style.fontFamily=cs.fontFamily;t.style.color=cs.color;t.style.lineHeight=cs.lineHeight;' +
      'document.body.replaceChildren(t);document.body.style.margin="0";},1500);});</script></body>';
    fs.writeFileSync(path.join(tmp, 'tile-' + name + '.html'), src.replace(/<\/body>/i, isolate));
  }
}

const JOBS = [
  { file: 'screenshot-1-upcoming.png', page: path.join(SRC, 'screenshot.html'), query: 'scene=upcoming', width: 1280, height: 800 },
  { file: 'screenshot-2-live.png', page: path.join(SRC, 'screenshot.html'), query: 'scene=live', width: 1280, height: 800 },
  { file: 'screenshot-3-outlook.png', page: path.join(SRC, 'screenshot.html'), query: 'scene=outlook', width: 1280, height: 800 },
  { file: 'screenshot-4-options.png', page: path.join(SRC, 'screenshot.html'), query: 'scene=options', width: 1280, height: 800 },
  { file: 'promo-small-440x280.png', page: haveDesign ? path.join(tmp, 'tile-small.html') : path.join(SRC, 'promo.html'), query: haveDesign ? '' : 'size=small', width: 440, height: 280, budget: 6000 },
  { file: 'promo-marquee-1400x560.png', page: haveDesign ? path.join(tmp, 'tile-marquee.html') : path.join(SRC, 'promo.html'), query: haveDesign ? '' : 'size=marquee', width: 1400, height: 560, budget: 6000 }
];

let failures = 0;
for (const job of JOBS) {
  const raw = path.join(tmp, job.file);
  try {
    headless(browser, [
      '--window-size=' + job.width + ',' + job.height,
      '--force-device-scale-factor=1',
      '--virtual-time-budget=' + (job.budget || 4000),
      '--screenshot=' + raw,
      fileUrl(job.page, job.query)
    ]);
    const img = png.decode(fs.readFileSync(raw));
    if (img.width !== job.width || img.height !== job.height) {
      throw new Error('rendered ' + img.width + 'x' + img.height + ', wanted ' + job.width + 'x' + job.height);
    }
    const out = png.encode(img);   // 24-bit RGB
    fs.writeFileSync(path.join(OUT, job.file), out);
    console.log('wrote store/assets/' + job.file + '  ' + job.width + 'x' + job.height + '  ' + out.length + ' bytes');
  } catch (err) {
    failures++;
    console.error('FAILED ' + job.file + ': ' + (err.stderr || err.message));
  }
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (err) { /* ignore */ }
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/*
 * Builds the store packages from packages/browser-extension:
 *
 *   dist/meeting-cost-chrome-<version>.zip    Chrome Web Store and Microsoft Edge Add-ons
 *   dist/meeting-cost-firefox-<version>.zip   Firefox Add-ons (AMO)
 *   dist/SHA256SUMS.txt                       checksums of both
 *
 * Each archive gets a manifest written for its browser: Chrome's has only
 * background.service_worker and no browser_specific_settings; Firefox's has
 * only background.scripts. The source manifest keeps both so that "Load
 * unpacked" keeps working everywhere during development.
 *
 * Only manifest.json, icons/ and src/ are shipped: no tests, no README, no
 * dot-files. The archive is written by scripts/lib/zip.js with forward-slash
 * entry names and a fixed timestamp, so the same sources always produce the
 * same bytes. Run `npm run validate` afterwards.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { createZip } = require('./lib/zip');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'packages', 'browser-extension');
const DIST = path.join(ROOT, 'dist');

const TARGETS = {
  chrome: 'Chrome Web Store, Microsoft Edge Add-ons',
  firefox: 'Firefox Add-ons (AMO)'
};

// The bundled core must be current before anything is packaged.
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-core.js')], { stdio: 'inherit' });

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const version = manifest.version;

function shippable(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => p.startsWith('.'))) return false;
  if (parts[0] !== 'icons' && parts[0] !== 'src') return false;
  if (/\.(md|txt|map)$/i.test(rel)) return false;
  return true;
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, out);
    else out.push(rel);
  }
  return out;
}

function manifestFor(target) {
  const m = JSON.parse(JSON.stringify(manifest));
  if (target === 'chrome') {
    delete m.browser_specific_settings;
    if (m.background) delete m.background.scripts;
  } else if (target === 'firefox') {
    if (m.background) delete m.background.service_worker;
  }
  return Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8');
}

fs.mkdirSync(DIST, { recursive: true });
const files = walk(SRC, '', []).filter(shippable);
const sums = [];

for (const target of Object.keys(TARGETS)) {
  const entries = [{ name: 'manifest.json', data: manifestFor(target) }];
  for (const rel of files) entries.push({ name: rel, data: fs.readFileSync(path.join(SRC, rel)) });
  const zip = createZip(entries);
  const name = 'meeting-cost-' + target + '-' + version + '.zip';
  fs.writeFileSync(path.join(DIST, name), zip);
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  sums.push(sha + '  ' + name);
  console.log('wrote dist/' + name + '  ' + zip.length + ' bytes, ' + entries.length + ' files  (' + TARGETS[target] + ')');
}

fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log('wrote dist/SHA256SUMS.txt');

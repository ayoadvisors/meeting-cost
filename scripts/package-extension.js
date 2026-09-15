#!/usr/bin/env node
/*
 * Zips packages/browser-extension into dist/meeting-cost-extension.zip, the
 * file you upload to the Chrome Web Store / Edge Add-ons / Firefox AMO, or
 * unzip and "Load unpacked". No dependencies: uses PowerShell on Windows and
 * `zip` elsewhere.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'packages', 'browser-extension');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'meeting-cost-extension.zip');

// Make sure the bundled core is current before packaging.
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-core.js')], { stdio: 'inherit' });

fs.mkdirSync(DIST, { recursive: true });
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

// Stage only what the extension needs (no tests, no README).
const stage = fs.mkdtempSync(path.join(DIST, 'stage-'));
const include = ['manifest.json', 'icons', 'src'];
for (const name of include) {
  fs.cpSync(path.join(SRC, name), path.join(stage, name), { recursive: true });
}

if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Compress-Archive -Path "${stage}\\*" -DestinationPath "${OUT}" -Force`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', OUT, '.'], { cwd: stage, stdio: 'inherit' });
}

fs.rmSync(stage, { recursive: true, force: true });
console.log('wrote', path.relative(ROOT, OUT), fs.statSync(OUT).size + ' bytes');

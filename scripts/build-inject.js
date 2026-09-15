#!/usr/bin/env node
/*
 * Builds a console-injectable copy of the extension, for trying it on
 * calendar.google.com or outlook.office.com without installing anything:
 *
 *   dist/inject.js          everything in one file (paste into DevTools)
 *   dist/inject.part1.js    styles + config + core      } the same thing in
 *   dist/inject.part2.js    extraction                  } three pieces, for
 *   dist/inject.part3.js    widget + entry point        } tools that cap input size
 *
 * Comments and blank lines are stripped to keep the paste small. The config
 * comes from window.MC_DEMO_CONFIG (defaults: $100/hr, tick every second).
 * Re-injecting tears down the previous copy first.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'packages', 'browser-extension', 'src');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');

function strip(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('//'))
    .join('\n');
}

const preamble = [
  '(function () {',
  '  if (window.__meetingCost && window.__meetingCost.stop) window.__meetingCost.stop();',
  '  var old = document.querySelector(\'style[data-mc="style"]\'); if (old) old.remove();',
  '  var s = document.createElement("style"); s.setAttribute("data-mc", "style");',
  '  s.textContent = ' + JSON.stringify(read('content/widget.css')) + ';',
  '  document.head.appendChild(s);',
  '  window.MC_DEMO_CONFIG = window.MC_DEMO_CONFIG || { tickSeconds: 1 };',
  '})();'
].join('\n');

const parts = [
  preamble + '\n' + strip(read('vendor/meeting-cost-core.js')) + "\n'part1 ok'",
  strip(read('content/extract.js')) + "\n'part2 ok'",
  strip(read('content/widget.js')) + '\n' + strip(read('content/main.js')) +
    "\n'part3 ok: provider=' + (window.__meetingCost ? window.__meetingCost.provider : 'none')"
];

fs.mkdirSync(DIST, { recursive: true });
parts.forEach((code, i) => {
  const file = path.join(DIST, 'inject.part' + (i + 1) + '.js');
  fs.writeFileSync(file, code);
  console.log('wrote', path.relative(ROOT, file), code.length + ' chars');
});
const all = path.join(DIST, 'inject.js');
fs.writeFileSync(all, '/* Meeting Cost, console build ' + new Date().toISOString() + ' */\n' + parts.join('\n'));
console.log('wrote', path.relative(ROOT, all), fs.statSync(all).size + ' bytes');

#!/usr/bin/env node
/*
 * Static checks that need no dependencies:
 *   - every .js file parses (node --check)
 *   - every .json file parses
 *   - the Outlook manifest is well-formed enough to catch typos
 *   - the core copies are in sync
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

const files = walk(ROOT, []);

for (const file of files.filter(f => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (err) { failures++; console.error('SYNTAX', path.relative(ROOT, file), '\n' + err.stderr.toString()); }
}

for (const file of files.filter(f => f.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { failures++; console.error('JSON', path.relative(ROOT, file), err.message); }
}

const manifest = fs.readFileSync(path.join(ROOT, 'packages', 'outlook-addin', 'manifest.xml'), 'utf8');
const opens = (manifest.match(/<([A-Za-z:]+)(?=[\s>])(?![^>]*\/>)/g) || []).map(t => t.slice(1));
const closes = (manifest.match(/<\/([A-Za-z:]+)>/g) || []).map(t => t.slice(2, -1));
const stack = [];
let balanced = true;
for (const token of manifest.match(/<\/?[A-Za-z:]+[^>]*>/g) || []) {
  if (token.startsWith('<?') || token.startsWith('<!')) continue;
  if (token.endsWith('/>')) continue;
  const name = token.match(/<\/?([A-Za-z:]+)/)[1];
  if (token.startsWith('</')) {
    if (stack.pop() !== name) { balanced = false; break; }
  } else {
    stack.push(name);
  }
}
if (!balanced || stack.length) { failures++; console.error('XML', 'manifest.xml tags are not balanced (' + opens.length + ' open / ' + closes.length + ' close)'); }

try { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-core.js'), '--check'], { stdio: 'pipe' }); }
catch (err) { failures++; console.error('CORE', err.stdout.toString() + err.stderr.toString()); }

console.log(failures ? failures + ' problem(s)' : 'all checks passed (' + files.length + ' files)');
process.exit(failures ? 1 : 0);

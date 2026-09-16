#!/usr/bin/env node
/*
 * Copies packages/core/src/meeting-cost-core.js into every adapter that
 * ships its own copy (each add-on must be self-contained when deployed).
 *
 *   node scripts/sync-core.js          copy
 *   node scripts/sync-core.js --check  fail if any copy is stale (CI)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'packages', 'core', 'src', 'meeting-cost-core.js');
const COPIES = [
  path.join(ROOT, 'packages', 'browser-extension', 'src', 'vendor', 'meeting-cost-core.js'),
  path.join(ROOT, 'packages', 'google-workspace-addon', 'MeetingCostCore.js'),
  path.join(ROOT, 'packages', 'outlook-addin', 'src', 'meeting-cost-core.js')
];

const check = process.argv.includes('--check');
const source = fs.readFileSync(SOURCE, 'utf8');
let stale = 0;

for (const target of COPIES) {
  const rel = path.relative(ROOT, target);
  let current = null;
  try { current = fs.readFileSync(target, 'utf8'); } catch (err) { /* no copy yet */ }
  if (current === source) { console.log('up to date', rel); continue; }
  if (check) { console.error('STALE', rel); stale++; continue; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
  console.log('copied', rel);
}

if (stale) {
  console.error(stale + ' stale copies; run: node scripts/sync-core.js');
  process.exit(1);
}

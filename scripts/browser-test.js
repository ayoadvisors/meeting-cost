#!/usr/bin/env node
/*
 * Runs the extension's DOM self-test page in a headless Chromium and fails on
 * any FAIL line. The page (packages/browser-extension/test/dom/selftest.html)
 * loads the real content scripts against replicas of the Google Calendar
 * bubble and the Outlook peek plus a set of hostile fixtures, and writes its
 * verdicts into <pre id="results">; --dump-dom prints the DOM.
 *
 *   node scripts/browser-test.js    skips with a warning when no Chrome/Edge is installed
 *   CI=true node scripts/browser-test.js, or --require: a missing browser is a failure
 */
'use strict';
const path = require('path');
const { findBrowser, headless, fileUrl } = require('./lib/browser');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'packages', 'browser-extension', 'test', 'dom', 'selftest.html');
const required = process.argv.includes('--require') || !!process.env.CI;

const browser = findBrowser();
if (!browser) {
  console[required ? 'error' : 'warn']('browser-test: no Chrome/Edge found (set CHROME_PATH); ' + (required ? 'failing' : 'skipping'));
  process.exit(required ? 1 : 0);
}

let dom;
try {
  dom = headless(browser, ['--virtual-time-budget=5000', '--dump-dom', fileUrl(PAGE)]);
} catch (err) {
  console.error('browser-test: could not run ' + browser + ': ' + (err.stderr || err.message));
  process.exit(1);
}

const m = dom.match(/<pre id="results"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) {
  console.error('browser-test: the page produced no results block; the scripts may have thrown before the checks ran');
  process.exit(1);
}
const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
console.log(text.split('\n').map((l) => '  ' + l).join('\n'));
const failed = text.split('\n').filter((l) => l.startsWith('FAIL')).length;
if (failed || !/\d+ passed, 0 failed/.test(text)) {
  console.error('browser-test: ' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('browser-test: all checks passed in ' + path.basename(browser));

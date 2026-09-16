/*
 * Find and drive a headless Chromium (Chrome or Edge) for the DOM self-test
 * and the store screenshots. No dependencies; every run uses a throw-away
 * profile so it never talks to a running browser session.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function findBrowser() {
  const fromEnv = process.env.CHROME_PATH || process.env.CHROME_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  let candidates;
  if (process.platform === 'win32') {
    candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || 'C:\\', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
  } else if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];
  } else {
    candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  }
  for (const c of candidates) {
    if (/[\\/]/.test(c)) { if (fs.existsSync(c)) return c; continue; }
    try {
      execFileSync('sh', ['-c', 'command -v ' + c], { stdio: 'pipe' });
      return c;
    } catch (err) { /* not installed */ }
  }
  return null;
}

/** Run the browser headless with extra args; returns stdout as a string. */
function headless(browser, args, opts) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-headless-'));
  const base = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--hide-scrollbars', '--allow-file-access-from-files',
    '--user-data-dir=' + profile
  ];
  try {
    return execFileSync(browser, base.concat(args), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (opts && opts.timeout) || 90000,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8'
    });
  } finally {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* Windows may still hold a handle */ }
  }
}

function fileUrl(absPath, query) {
  let p = path.resolve(absPath).replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  return 'file://' + encodeURI(p) + (query ? '?' + query : '');
}

module.exports = { findBrowser, headless, fileUrl };

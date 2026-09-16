#!/usr/bin/env node
/*
 * Chrome Web Store pre-flight for the browser extension. Checks the source
 * folder and, when present, the zips in dist/ (or the paths given as
 * arguments). Exits 1 on any error. No dependencies.
 *
 * What the store's own uploader and reviewers reject, checked here first:
 *   - manifest_version 3, name <= 45 chars, description <= 132 chars,
 *     version of 1-4 dotted integers each <= 65535
 *   - every file the manifest names exists; icons are PNGs of the stated size
 *   - no remote code: no eval / new Function / remote <script>, and, as this
 *     extension makes no network requests by design, no fetch / XHR either
 *   - a content_security_policy for extension pages that keeps script-src to
 *     'self', and HTML pages with nothing inline that such a policy would block
 *   - permissions limited to an allow-list, hosts limited to the calendars,
 *     never <all_urls>
 *   - zip entries with forward slashes, manifest.json at the root, no junk
 *     (tests, docs, .DS_Store, __MACOSX), and the per-browser manifest shape
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readZip } = require('./lib/zip');
const png = require('./lib/png');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'packages', 'browser-extension');
const DIST = path.join(ROOT, 'dist');

const ALLOWED_PERMISSIONS = new Set(['storage']);
const ALLOWED_HOSTS = new Set([
  'https://calendar.google.com/*',
  'https://outlook.office.com/*',
  'https://outlook.office365.com/*',
  'https://outlook.live.com/*',
  'https://outlook.cloud.microsoft/*'
]);
const REMOTE_CODE = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\s*\(/, 'WebSocket'],
  [/\bsendBeacon\s*\(/, 'sendBeacon'],
  [/<script[^>]+src\s*=\s*["']https?:/i, 'remote <script src>'],
  [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/, 'HTML injection API'],
  [/\bchrome\.(tabs|cookies|history|webRequest|scripting|downloads|management)\b/, 'an API outside the declared permissions']
];

let errors = 0;
let warnings = 0;
function fail(scope, msg) { errors++; console.error('  ERROR  [' + scope + '] ' + msg); }
function warn(scope, msg) { warnings++; console.warn('  warn   [' + scope + '] ' + msg); }
function ok(scope, msg) { console.log('  ok     [' + scope + '] ' + msg); }

/* ---- checks on a manifest + a way to read its files --------------------- */

function referencedFiles(m) {
  const out = new Set();
  Object.values(m.icons || {}).forEach((f) => out.add(f));
  (m.content_scripts || []).forEach((cs) => { (cs.js || []).forEach((f) => out.add(f)); (cs.css || []).forEach((f) => out.add(f)); });
  if (m.background) {
    if (m.background.service_worker) out.add(m.background.service_worker);
    (m.background.scripts || []).forEach((f) => out.add(f));
  }
  if (m.options_ui && m.options_ui.page) out.add(m.options_ui.page);
  if (m.options_page) out.add(m.options_page);
  if (m.action) {
    if (typeof m.action.default_icon === 'string') out.add(m.action.default_icon);
    else Object.values(m.action.default_icon || {}).forEach((f) => out.add(f));
    if (m.action.default_popup) out.add(m.action.default_popup);
  }
  return Array.from(out);
}

function checkManifest(scope, m, exists, read) {
  if (m.manifest_version !== 3) fail(scope, 'manifest_version must be 3');
  if (typeof m.name !== 'string' || !m.name.trim()) fail(scope, 'name is required');
  else if (m.name.length > 45) fail(scope, 'name is ' + m.name.length + ' chars; the store allows 45');
  if (typeof m.description !== 'string' || !m.description.trim()) fail(scope, 'description is required');
  else if (m.description.length > 132) fail(scope, 'description is ' + m.description.length + ' chars; the store allows 132');
  else ok(scope, 'description ' + m.description.length + '/132 chars');
  if (!/^\d+(\.\d+){0,3}$/.test(m.version || '') || m.version.split('.').some((n) => Number(n) > 65535 || (n.length > 1 && n.startsWith('0')))) {
    fail(scope, 'version must be 1-4 dot-separated integers (0-65535, no leading zeros): ' + m.version);
  }
  if (m.short_name && m.short_name.length > 12) fail(scope, 'short_name longer than 12 chars');
  if (m.homepage_url && !/^https:\/\//.test(m.homepage_url)) warn(scope, 'homepage_url should be https');

  for (const size of ['16', '32', '48', '128']) {
    if (!m.icons || !m.icons[size]) { fail(scope, 'icons.' + size + ' missing (128 is required by the store; 16/32/48 by the browser UI)'); continue; }
    if (!exists(m.icons[size])) { fail(scope, 'icon file missing: ' + m.icons[size]); continue; }
    try {
      const i = png.info(read(m.icons[size]));
      if (i.width !== Number(size) || i.height !== Number(size)) fail(scope, m.icons[size] + ' is ' + i.width + 'x' + i.height + ', expected ' + size + 'x' + size);
    } catch (err) { fail(scope, m.icons[size] + ': ' + err.message); }
  }

  const missing = referencedFiles(m).filter((f) => !exists(f));
  if (missing.length) fail(scope, 'files named in the manifest are missing: ' + missing.join(', '));
  else ok(scope, referencedFiles(m).length + ' referenced files present');

  for (const p of m.permissions || []) if (!ALLOWED_PERMISSIONS.has(p)) fail(scope, 'unexpected permission "' + p + '"');
  for (const p of m.optional_permissions || []) fail(scope, 'unexpected optional permission "' + p + '"');
  const hosts = [].concat(m.host_permissions || [], ...(m.content_scripts || []).map((cs) => cs.matches || []));
  for (const h of hosts) {
    if (/<all_urls>|^\*:\/\/\*\/|^https?:\/\/\*\//.test(h)) fail(scope, 'broad host pattern "' + h + '"');
    else if (!ALLOWED_HOSTS.has(h)) fail(scope, 'unexpected host pattern "' + h + '"');
  }
  ok(scope, 'permissions: ' + JSON.stringify(m.permissions || []) + ', ' + hosts.length + ' calendar hosts');
  if (m.web_accessible_resources && m.web_accessible_resources.length) warn(scope, 'web_accessible_resources are exposed to pages; make sure that is intended');

  const csp = m.content_security_policy && m.content_security_policy.extension_pages;
  if (!csp) fail(scope, 'content_security_policy.extension_pages should be set explicitly');
  else {
    if (!/script-src[^;]*'self'/.test(csp)) fail(scope, 'extension_pages CSP must contain script-src \'self\'');
    if (/unsafe-eval|unsafe-inline|https?:|\*/.test(csp)) fail(scope, 'extension_pages CSP must not allow unsafe-eval, unsafe-inline, remote or wildcard sources');
    ok(scope, 'extension_pages CSP: ' + csp);
  }
  if (m.content_security_policy && m.content_security_policy.sandbox) warn(scope, 'sandbox CSP present');
  if (m.background && m.background.persistent !== undefined) fail(scope, 'background.persistent is MV2 only');
  if (m.browser_action || m.page_action) fail(scope, 'browser_action/page_action are MV2; use action');
}

function checkSources(scope, files, read) {
  for (const f of files) {
    if (!/\.(js|html)$/i.test(f)) continue;
    const text = read(f).toString('utf8');
    for (const [re, label] of REMOTE_CODE) if (re.test(text)) fail(scope, f + ' uses ' + label);
    if (/\.html$/i.test(f)) {
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) fail(scope, f + ' has an inline <script>; the CSP blocks it');
      if (/<style[\s>]/i.test(text)) fail(scope, f + ' has an inline <style>; the CSP blocks it');
      if (/\sstyle\s*=\s*["']/i.test(text)) fail(scope, f + ' has a style= attribute; the CSP blocks it');
      if (/\son[a-z]+\s*=\s*["']/i.test(text)) fail(scope, f + ' has an inline event handler; the CSP blocks it');
      if (/<script[^>]+src\s*=\s*["'][^"']*:\/\//i.test(text) || /<link[^>]+href\s*=\s*["']https?:/i.test(text)) fail(scope, f + ' loads a remote resource');
    }
  }
  ok(scope, files.length + ' files scanned for remote code and inline script/style');
}

/* ---- source folder ------------------------------------------------------ */

console.log('source: packages/browser-extension');
{
  const scope = 'source';
  const exists = (f) => fs.existsSync(path.join(SRC, f));
  const read = (f) => fs.readFileSync(path.join(SRC, f));
  let m = null;
  try { m = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')); }
  catch (err) { fail(scope, 'manifest.json: ' + err.message); }
  if (m) {
    checkManifest(scope, m, exists, read);
    if (!m.browser_specific_settings || !m.browser_specific_settings.gecko || !m.browser_specific_settings.gecko.id) {
      warn(scope, 'no browser_specific_settings.gecko.id (needed for the Firefox package)');
    }
    const walk = (dir, base, out) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? base + '/' + e.name : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), rel, out); else out.push(rel);
      }
      return out;
    };
    checkSources(scope, walk(SRC, '', []).filter((f) => /^(src|icons)\//.test(f)), read);
  }
}

/* ---- packaged zips ------------------------------------------------------ */

const zips = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (fs.existsSync(DIST) ? fs.readdirSync(DIST).filter((f) => /^meeting-cost-.*\.zip$/.test(f)).map((f) => path.join(DIST, f)) : []);

if (!zips.length) console.log('\nno dist/*.zip yet (run: npm run package)');

for (const zipPath of zips) {
  const scope = path.basename(zipPath);
  console.log('\npackage: ' + path.relative(ROOT, zipPath));
  let archive;
  try { archive = readZip(fs.readFileSync(zipPath)); }
  catch (err) { fail(scope, err.message); continue; }
  const names = archive.entries.map((e) => e.name);
  const byName = Object.create(null);
  archive.entries.forEach((e) => { byName[e.name] = e; });

  for (const n of names) {
    if (n.includes('\\')) fail(scope, 'entry uses backslashes: ' + n);
    if (n.startsWith('/') || n.split('/').includes('..')) fail(scope, 'unsafe entry path: ' + n);
    if (/(^|\/)(\.|__MACOSX|Thumbs\.db)/.test(n)) fail(scope, 'junk entry: ' + n);
    if (/(^|\/)(test|tests|node_modules)\//.test(n) || /\.(md|map|zip)$/i.test(n)) fail(scope, 'should not ship: ' + n);
  }
  if (!byName['manifest.json']) { fail(scope, 'manifest.json is not at the archive root'); continue; }
  const size = fs.statSync(zipPath).size;
  if (size > 10 * 1024 * 1024) warn(scope, 'archive is ' + size + ' bytes; expected well under 10 MB');
  ok(scope, names.length + ' entries, ' + size + ' bytes, forward-slash paths');

  let m;
  try { m = JSON.parse(archive.read(byName['manifest.json']).toString('utf8')); }
  catch (err) { fail(scope, 'manifest.json: ' + err.message); continue; }
  const exists = (f) => !!byName[f];
  const read = (f) => archive.read(byName[f]);
  checkManifest(scope, m, exists, read);
  checkSources(scope, names.filter((n) => !/\/$/.test(n)), read);

  if (/-chrome-/.test(scope)) {
    if (m.browser_specific_settings) fail(scope, 'Chrome package must not carry browser_specific_settings');
    if (!m.background || !m.background.service_worker) fail(scope, 'Chrome package needs background.service_worker');
    if (m.background && m.background.scripts) fail(scope, 'Chrome package must not carry background.scripts');
  }
  if (/-firefox-/.test(scope)) {
    if (!m.browser_specific_settings || !m.browser_specific_settings.gecko || !m.browser_specific_settings.gecko.id) fail(scope, 'Firefox package needs browser_specific_settings.gecko.id');
    if (!m.background || !m.background.scripts) fail(scope, 'Firefox package needs background.scripts');
    if (m.background && m.background.service_worker) fail(scope, 'Firefox package must not carry background.service_worker');
  }
  // Every shipped file must match the source tree byte for byte (except the generated manifest).
  for (const n of names) {
    if (n === 'manifest.json') continue;
    const srcFile = path.join(SRC, n);
    if (!fs.existsSync(srcFile)) { fail(scope, n + ' is not in the source tree'); continue; }
    if (!fs.readFileSync(srcFile).equals(read(n))) fail(scope, n + ' differs from the source tree');
  }
}

console.log('\n' + (errors ? errors + ' error(s), ' : 'no errors, ') + warnings + ' warning(s)');
process.exit(errors ? 1 : 0);

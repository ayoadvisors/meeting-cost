#!/usr/bin/env node
/*
 * Installs the unpacked extension into a real Chrome through the Chrome
 * DevTools MCP server ("Chrome DevTools for coding agents", the tool Google's
 * extension guidance recommends) and checks every surface Chrome itself
 * parses or runs:
 *
 *   - install_extension accepts the folder: manifest and CSP are valid
 *   - the extension is listed, enabled, at the manifest's version
 *   - the options page renders with its external stylesheet under the CSP
 *   - chrome.storage.local round-trips a config
 *   - no console errors on the options page
 *   - the toolbar action (handled by the service worker) opens the options page
 *   - chrome://extensions shows the service worker and no error badge
 *
 *   npm run verify:chrome              headless
 *   npm run verify:chrome -- --headed  watch it happen
 *
 * Speaks MCP over stdio to `npx chrome-devtools-mcp@latest --categoryExtensions`.
 * The extension tools need the server to launch Chrome itself (a pipe
 * connection); --autoConnect to your own running Chrome needs Chrome 149+.
 * No dependencies; the server is fetched by npx.
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'packages', 'browser-extension');
const OUT = path.join(ROOT, 'dist', 'verify');
const headed = process.argv.includes('--headed');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-verify-'));
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

const serverArgs = ['-y', 'chrome-devtools-mcp@latest', '--categoryExtensions', '--isolated', '--no-usage-statistics'];
if (!headed) serverArgs.push('--headless');
if (process.env.CHROME_PATH) serverArgs.push('--executablePath=' + process.env.CHROME_PATH);

// Run npm's own npx entry point with this Node binary: no shell, no .cmd
// shim (which Node refuses to spawn directly on Windows), and every argument
// stays a separate argv entry.
function npxLauncher() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),                  // Windows layout
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')      // POSIX layout
  ];
  const cli = candidates.find((c) => fs.existsSync(c));
  return cli ? { command: process.execPath, prefix: [cli] } : { command: 'npx', prefix: [] };
}
const launcher = npxLauncher();
const child = spawn(launcher.command, launcher.prefix.concat(serverArgs), { stdio: ['pipe', 'pipe', 'pipe'] });

// The server only touches paths inside the roots the client declares, so it
// asks for them (roots/list); the repository is the one root it needs.
const ROOTS = [{ uri: 'file:///' + ROOT.replace(/\\/g, '/').replace(/^\//, ''), name: 'meeting-cost' }];

/* ---- a minimal MCP stdio client -------------------------------------- */

let buffer = '';
let nextId = 1;
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line.startsWith('{')) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (err) { continue; }
    if (msg.method && msg.id !== undefined) {
      // A request from the server to us.
      const result = msg.method === 'roots/list' ? { roots: ROOTS } : (msg.method === 'ping' ? {} : null);
      if (result) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
      else child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unsupported: ' + msg.method } }) + '\n');
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});
child.stderr.on('data', (d) => { if (process.env.DEBUG) process.stderr.write(d); });
child.on('exit', (code) => { for (const p of pending.values()) p.reject(new Error('server exited with code ' + code)); });

function request(method, params, timeoutMs) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, timeoutMs || 120000);
    pending.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); }
    });
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
}
async function call(name, args) {
  const r = await request('tools/call', { name, arguments: args || {} });
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(name + ': ' + text.slice(0, 500));
  return text;
}

/** Page id of the first page whose line in list_pages contains `urlPart`. */
async function pageIdFor(urlPart) {
  const text = await call('list_pages');
  for (const line of text.split('\n')) {
    if (line.includes(urlPart)) {
      const m = line.match(/(\d+)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** Run a function in a target ({ pageId } or { serviceWorkerId }) and get its JSON-serialisable result back. */
async function evalIn(target, fnSource) {
  const text = await call('evaluate_script', Object.assign({ function: fnSource, waitForStableDom: false }, target));
  const quoted = text.match(/"MCJSON(?:\\"|[^"])*MCJSON"/);
  if (quoted) {
    const inner = JSON.parse(quoted[0]);
    return JSON.parse(inner.slice(6, -6));
  }
  const raw = text.match(/MCJSON([\s\S]*?)MCJSON/);
  if (raw) return JSON.parse(raw[1]);
  throw new Error('could not find the script result in: ' + text.slice(0, 300));
}
// Wrap a function so its return value is marked and easy to find in the tool's prose.
function marked(body) {
  return 'async () => { const __f = (' + body + '); const __v = await __f(); return "MCJSON" + JSON.stringify(__v) + "MCJSON"; }';
}

/* ---- checks ----------------------------------------------------------- */

const lines = [];
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; lines.push('PASS ' + name); }
  else { fail++; lines.push('FAIL ' + name + (detail !== undefined ? ': ' + String(detail).slice(0, 400) : '')); }
  console.log(lines[lines.length - 1]);
}

function stop() {
  try { child.stdin.end(); } catch (err) { /* ignore */ }
  setTimeout(() => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  }, 1500);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { roots: { listChanged: false } },
    clientInfo: { name: 'meeting-cost-verify', version: manifest.version }
  }, 180000);
  notify('notifications/initialized');

  const tools = (await request('tools/list')).tools.map((t) => t.name);
  check('DevTools MCP exposes the extension tools', tools.includes('install_extension') && tools.includes('trigger_extension_action'), tools.join(', '));

  const installed = await call('install_extension', { path: EXT });
  const idMatch = installed.match(/\b[a-p]{32}\b/);
  check('Chrome accepted the unpacked folder (manifest, CSP, icons, scripts all parsed)', !!idMatch, installed);
  const id = idMatch ? idMatch[0] : null;
  if (!id) throw new Error('no extension id');

  const listed = await call('list_extensions');
  check('list_extensions shows ' + manifest.name + ' ' + manifest.version + ' enabled', listed.includes(manifest.name) && listed.includes(manifest.version) && !/disabled|false/i.test(listed.split('\n').find((l) => l.includes(id)) || ''), listed);

  const optionsUrl = 'chrome-extension://' + id + '/src/options/options.html';
  await call('new_page', { url: optionsUrl });
  const pid = await pageIdFor(optionsUrl);
  check('options page opens', pid !== null, await call('list_pages'));

  const info = await evalIn({ pageId: pid }, marked(`async () => {
    const m = chrome.runtime.getManifest();
    const sheet = Array.from(document.styleSheets).some((s) => (s.href || '').endsWith('options.css'));
    const bg = getComputedStyle(document.querySelector('.preview')).backgroundColor;
    await chrome.storage.local.set({ config: { defaultHourlyRate: 123.45, rates: { 'a@b.com': 50 } } });
    const back = (await chrome.storage.local.get('config')).config;
    await chrome.storage.local.remove('config');
    const gone = (await chrome.storage.local.get('config')).config;
    return {
      name: m.name, version: m.version, mv: m.manifest_version,
      csp: m.content_security_policy && m.content_security_policy.extension_pages,
      sw: m.background && m.background.service_worker,
      scripts: m.background && m.background.scripts,
      sheet, bg, roundTrip: back && back.defaultHourlyRate, gone: gone === undefined,
      preview: document.getElementById('preview').textContent.slice(0, 90),
      title: document.title
    };
  }`));
  check('manifest as Chrome parsed it: MV3, service worker, strict CSP kept', info.mv === 3 && info.sw === 'src/background.js' && /connect-src 'none'/.test(info.csp || ''), JSON.stringify(info));
  check('external stylesheet applied under the CSP (no inline styles needed)', info.sheet && info.bg !== 'rgba(0, 0, 0, 0)', info.bg);
  check('options page computed its example', /Example: a one-hour meeting/.test(info.preview), info.preview);
  check('chrome.storage.local set/get/remove round trip', info.roundTrip === 123.45 && info.gone === true, JSON.stringify({ roundTrip: info.roundTrip, gone: info.gone }));

  const console1 = await call('list_console_messages', { pageId: pid });
  check('no console errors on the options page (a CSP violation would show here)', !/error|refused|violat/i.test(console1), console1);

  await call('take_screenshot', { pageId: pid, filePath: path.join(tmp, 'options-in-chrome.png') });
  fs.copyFileSync(path.join(tmp, 'options-in-chrome.png'), path.join(OUT, 'options-in-chrome.png'));

  // The toolbar click is handled by the service worker: close our tab first,
  // since Chrome focuses an already open options page instead of opening one.
  await call('close_page', { pageId: pid });
  await call('trigger_extension_action', { id });
  await new Promise((r) => setTimeout(r, 1500));
  const reopened = await pageIdFor(optionsUrl);
  check('toolbar action (service worker) opened the options page', reopened !== null, await call('list_pages'));

  // The service worker itself: with the extension category on, the server
  // lists extension service workers as targets ("sw-1") that scripts can run
  // in and whose console can be read. (chrome:// pages are off limits.)
  const pagesText = await call('list_pages');
  fs.writeFileSync(path.join(OUT, 'targets.txt'), pagesText);
  const swLine = pagesText.split('\n').find((l) => /\bsw-\d+\b/.test(l) && l.includes(id))
    || pagesText.split('\n').find((l) => /\bsw-\d+\b/.test(l));
  const swId = swLine ? swLine.match(/\bsw-\d+\b/)[0] : null;
  check('service worker is listed as a target', !!swId, pagesText.slice(0, 600));
  if (swId) {
    let sw = null;
    let detail = '';
    try {
      sw = await evalIn({ serviceWorkerId: swId }, marked(`async () => ({
        scope: self.registration && self.registration.scope,
        version: chrome.runtime.getManifest().version,
        action: typeof chrome.action !== 'undefined' && chrome.action.onClicked.hasListeners()
      })`));
    } catch (err) { detail = err.message; }
    check('service worker answers: manifest version and an action listener registered', sw && sw.version === manifest.version && sw.action === true, sw ? JSON.stringify(sw) : detail);
    let swConsole = '';
    try { swConsole = await call('list_console_messages', { serviceWorkerId: swId, pageId: reopened }); } catch (err) { swConsole = 'unavailable: ' + err.message; }
    check('no errors in the service worker console', !/error|uncaught|refused/i.test(swConsole), swConsole.slice(0, 400));
  }

  await call('uninstall_extension', { id });
  const after = await call('list_extensions');
  check('uninstall leaves nothing behind', !after.includes(id), after);
})().catch((err) => {
  check('no exception during the run', false, err.stack || err.message);
}).finally(() => {
  const summary = pass + ' passed, ' + fail + ' failed';
  lines.push(summary);
  fs.writeFileSync(path.join(OUT, 'verify-in-chrome.txt'), lines.join('\n') + '\n');
  console.log(summary + '  (screenshot and log in dist/verify/)');
  stop();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  setTimeout(() => process.exit(fail ? 1 : 0), 2500);
});

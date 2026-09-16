#!/usr/bin/env node
/*
 * Zero-dependency static file server for local development.
 *
 *   node scripts/serve.js                 serve the repo root on http://localhost:8765
 *   node scripts/serve.js <dir> <port>    serve another folder / port
 *
 * Used for the demo page (demo/index.html). The Outlook add-in has its own
 * HTTPS server (packages/outlook-addin/serve.js) because Office requires TLS.
 *
 * Listens on the loopback interface only (this is a folder of your files),
 * never serves dot-files or dot-directories (.git, .claude, .clasp.json) and
 * refuses paths that escape the root.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const port = parseInt(process.env.PORT || process.argv[3] || '8765', 10);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function handler(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (err) { return send(res, 400, 'text/plain', 'bad request'); }
  if (urlPath.split('/').some((seg) => seg.startsWith('.'))) return send(res, 404, 'text/plain', 'not found');
  // "/" joins to "<root>/" so every path inside the root starts with root + separator.
  let file = path.normalize(path.join(root, urlPath));
  if (!file.startsWith(root + path.sep)) return send(res, 403, 'text/plain', 'forbidden');
  // Read first, ask questions later: a directory answers with its index.html.
  fs.readFile(file, (err, data) => {
    if (err && (err.code === 'EISDIR' || err.code === 'EPERM')) {
      file = path.join(file, 'index.html');
      return fs.readFile(file, (err2, data2) => {
        if (err2) return send(res, 404, 'text/plain', 'not found: ' + urlPath);
        send(res, 200, TYPES['.html'], data2);
      });
    }
    if (err) return send(res, 404, 'text/plain', 'not found: ' + urlPath);
    send(res, 200, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', data);
  });
}

// Loopback only, on both address families so that "localhost" works whether
// it resolves to 127.0.0.1 or ::1.
http.createServer(handler).listen(port, '127.0.0.1', () =>
  console.log('serving ' + root + ' at http://localhost:' + port + '/demo/'));
const v6 = http.createServer(handler);
v6.on('error', () => { /* no IPv6 loopback here; the IPv4 listener is enough */ });
v6.listen(port, '::1');

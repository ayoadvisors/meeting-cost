#!/usr/bin/env node
/*
 * Local HTTPS server for the Outlook add-in (Office requires TLS, even on
 * localhost). Uses the certificate created by `npm run certs`
 * (office-addin-dev-certs), which also trusts it in your OS store.
 *
 *   npm run certs   # once
 *   npm start       # https://localhost:3000
 *
 * Loopback only, no dot-files, no paths outside this folder.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3000', 10);
const CERT_DIR = path.join(os.homedir(), '.office-addin-dev-certs');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.xml': 'application/xml; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function handler(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (err) { return send(res, 400, 'text/plain', 'bad request'); }
  if (urlPath === '/') urlPath = '/src/taskpane.html';
  if (urlPath.split('/').some((seg) => seg.startsWith('.'))) return send(res, 404, 'text/plain', 'not found');
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'text/plain', 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain', 'not found: ' + urlPath);
    send(res, 200, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', data);
  });
}

const certFile = path.join(CERT_DIR, 'localhost.crt');
const keyFile = path.join(CERT_DIR, 'localhost.key');

let make;
let url;
if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  const tls = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  make = () => https.createServer(tls, handler);
  url = 'https://localhost:' + PORT + '/src/taskpane.html';
} else {
  console.warn('No dev certificate found in ' + CERT_DIR + '. Run "npm run certs" first; Outlook refuses plain HTTP.');
  make = () => http.createServer(handler);
  url = 'http://localhost:' + PORT + '/src/taskpane.html (plain HTTP, for a quick look only)';
}

make().listen(PORT, '127.0.0.1', () => console.log('Meeting Cost add-in at ' + url));
const v6 = make();
v6.on('error', () => { /* no IPv6 loopback here */ });
v6.listen(PORT, '::1');

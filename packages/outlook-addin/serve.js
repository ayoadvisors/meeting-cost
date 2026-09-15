#!/usr/bin/env node
/*
 * Local HTTPS server for the Outlook add-in (Office requires TLS, even on
 * localhost). Uses the certificate created by `npm run certs`
 * (office-addin-dev-certs), which also trusts it in your OS store.
 *
 *   npm run certs   # once
 *   npm start       # https://localhost:3000
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

function handler(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.normalize(path.join(ROOT, urlPath === '/' ? '/src/taskpane.html' : urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found: ' + urlPath); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
}

const certFile = path.join(CERT_DIR, 'localhost.crt');
const keyFile = path.join(CERT_DIR, 'localhost.key');

if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, handler)
    .listen(PORT, () => console.log('Meeting Cost add-in at https://localhost:' + PORT + '/src/taskpane.html'));
} else {
  console.warn('No dev certificate found in ' + CERT_DIR + '. Run "npm run certs" first; Outlook refuses plain HTTP.');
  http.createServer(handler)
    .listen(PORT, () => console.log('Serving over plain HTTP (for a quick look only) at http://localhost:' + PORT + '/src/taskpane.html'));
}

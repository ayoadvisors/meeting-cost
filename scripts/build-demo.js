#!/usr/bin/env node
/*
 * Bundles demo/index.html into single self-contained files so the demo can be
 * mailed, dropped on a wiki or published as a page:
 *
 *   demo/dist/meeting-cost-demo.html   complete document, opens from disk
 *   demo/dist/artifact.html            same page as a fragment (title + style + body)
 *
 * It inlines widget.css and the four content scripts in place of their
 * <link>/<script src> tags. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEMO = path.join(ROOT, 'demo');
const DIST = path.join(DEMO, 'dist');

let html = fs.readFileSync(path.join(DEMO, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => /^https?:/.test(href) ? m :
  '<style>\n' + fs.readFileSync(path.resolve(DEMO, href), 'utf8') + '\n</style>');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  '<script>\n' + fs.readFileSync(path.resolve(DEMO, src), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');

fs.mkdirSync(DIST, { recursive: true });
const standalone = path.join(DIST, 'meeting-cost-demo.html');
fs.writeFileSync(standalone, html);

// Fragment for hosts that supply their own <html>/<head>/<body> skeleton.
const title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
const head = (html.match(/<head>[\s\S]*?<\/head>/) || [''])[0];
const headLinks = head.match(/<link rel="stylesheet" href="https?:[^"]+">/g) || [];
const headStyle = head.match(/<style>[\s\S]*?<\/style>/g) || [];
const body = (html.match(/<body>([\s\S]*?)<\/body>/) || ['', ''])[1];
const fragment = [title, ...headLinks, ...headStyle, body.trim()].join('\n');
const fragmentFile = path.join(DIST, 'artifact.html');
fs.writeFileSync(fragmentFile, fragment);

console.log('wrote', path.relative(ROOT, standalone), fs.statSync(standalone).size + ' bytes');
console.log('wrote', path.relative(ROOT, fragmentFile), fs.statSync(fragmentFile).size + ' bytes');

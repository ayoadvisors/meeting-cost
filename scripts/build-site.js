#!/usr/bin/env node
/*
 * Turns the landing page exported from Claude Design
 * (store/design/unpacked/Meeting Cost Landing.dc.html) into a plain static
 * site in site/, published by .github/workflows/pages.yml.
 *
 * The Design export is a "dc" document: an <x-dc> wrapper, a <helmet>, a
 * text/x-dc component script and {{ placeholders }} that a runtime
 * (support.js, which loads React and Babel from a CDN at page load) fills in.
 * None of that belongs on a public page, so this script:
 *   - moves the helmet into a real <head> with a title and description,
 *   - turns the hero's placeholders into ids driven by a small vanilla
 *     script (site/hero.js) that reproduces the component's arithmetic,
 *   - replaces style-hover attributes with a class,
 *   - points every "Add to Chrome" link at STORE_URL.
 * It refuses to run if any of the markup it expects is missing.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESIGN = path.join(ROOT, 'store', 'design', 'unpacked');
const SITE = path.join(ROOT, 'site');
// Replace with the Chrome Web Store listing URL once it exists.
const STORE_URL = 'https://github.com/ayoadvisors/meeting-cost/releases/latest';

let html = fs.readFileSync(path.join(DESIGN, 'Meeting Cost Landing.dc.html'), 'utf8');

function replaceOnce(pattern, replacement, what) {
  const before = html;
  html = html.replace(pattern, replacement);
  if (html === before) throw new Error('build-site: could not find ' + what);
}
function replaceAll(pattern, replacement, what, min) {
  const count = (html.match(pattern) || []).length;
  if (count < (min || 1)) throw new Error('build-site: expected ' + (min || 1) + '+ of ' + what + ', found ' + count);
  html = html.replace(pattern, replacement);
}

// helmet -> head
const helmet = (html.match(/<helmet>([\s\S]*?)<\/helmet>/) || [])[1];
if (!helmet) throw new Error('build-site: no <helmet>');
replaceOnce(/<helmet>[\s\S]*?<\/helmet>\s*/, '', 'helmet');
replaceOnce(/<script src="\.\/support\.js"><\/script>\s*/, '', 'support.js script');
replaceOnce(/<script type="text\/x-dc"[\s\S]*?<\/script>\s*/, '<script src="hero.js"></script>\n', 'component script');
replaceOnce(/<x-dc>\s*/, '', '<x-dc>');
replaceOnce(/<\/x-dc>\s*/, '', '</x-dc>');
replaceOnce(/<head>\s*<meta charset="utf-8">/, '<head>\n<meta charset="utf-8">\n<title>Meeting Cost: see what a meeting costs before you accept it</title>\n' +
  '<meta name="description" content="A free browser extension that shows the combined hourly cost of everyone in a meeting, live and rising, inside Google Calendar and Outlook on the web. Rates never leave your computer.">\n' +
  '<link rel="icon" href="icon.svg" type="image/svg+xml">\n' + helmet.trim() + '\n' +
  '<style>.hov:hover{background:#108000 !important;color:#fff !important}</style>', 'head');

// hero placeholders -> ids
replaceOnce(/\{\{ when \}\}/, '<span id="hero-when"></span>', '{{ when }}');
replaceOnce(/<span style="([^"]*?)color:\{\{ amountColor \}\};"><sc-if value="\{\{ isRunning \}\}" hint-placeholder-val="\{\{ true \}\}">([\s\S]*?)<\/sc-if>\{\{ amount \}\}<\/span>/,
  '<span id="hero-amount" style="$1"><span id="hero-dot" hidden>$2</span><span id="hero-amount-text"></span></span>', 'amount span');
replaceOnce(/<span style="font-weight:500; color:\{\{ labelColor \}\};">\{\{ label \}\}<\/span>/,
  '<span id="hero-label" style="font-weight:500;"></span>', 'label span');
replaceOnce(/onClick="\{\{ sendEmail \}\}"/, 'id="hero-send"', 'send button');
replaceOnce(/\{\{ sub \}\}/, '<span id="hero-sub"></span>', '{{ sub }}');
if (/\{\{/.test(html)) throw new Error('build-site: unhandled placeholder: ' + html.match(/\{\{[^}]*\}\}/)[0]);

// hover styles and store links
replaceAll(/ style-hover="[^"]*"/g, ' class="hov"', 'style-hover', 1);
replaceAll(/href="#"/g, 'href="' + STORE_URL + '"', 'Add to Chrome links', 1);
replaceAll(/ data-screen-label="[^"]*"/g, '', 'screen labels', 0);

const hero = `/* Meeting Cost landing page: the live popup in the hero.
   A vanilla port of the Design component: five people at the rates from the
   post, a meeting that started an hour ago, ticking once a second. */
(function () {
  'use strict';
  var rate = 603.25;
  var perMin = rate / 60;
  var t0 = Date.now();
  function money(v) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  var el = function (id) { return document.getElementById(id); };
  var when = el('hero-when'), amount = el('hero-amount'), amountText = el('hero-amount-text'), dot = el('hero-dot'),
    label = el('hero-label'), sub = el('hero-sub'), send = el('hero-send');
  if (!when || !amount || !amountText || !dot || !label || !sub || !send) return;

  function render() {
    var t = Math.floor((Date.now() - t0) / 1000);
    var elapsed = 60 + t / 60;
    when.textContent = 'Thursday, September 17 \\u22c5 9:00 \\u2013 10:00am';
    dot.hidden = false;
    amount.style.color = '#d52b1e';
    amountText.textContent = money(perMin * elapsed);
    label.textContent = 'and rising';
    label.style.color = '#d52b1e';
    sub.textContent = '5 people \\u00b7 ' + money(rate) + '/hr \\u00b7 ' + money(perMin) + ' per minute \\u00b7 ' + Math.floor(elapsed) + ' min in';
  }
  render();
  setInterval(render, 1000);

  send.addEventListener('click', function (e) {
    e.preventDefault();
    var body = ['Hi all,', '', '"Marketing Sync" is booked for 1 hr with 5 people at a combined ' + money(rate) + '/hour, about ' + money(rate) + ' of our time.', '',
      'Could we handle it over email instead? Here is what I need from you:', '', '1. ', '2. ', '',
      'If anything needs a real conversation, reply and we will book 15 minutes.', '', 'Thanks!'].join('\\n');
    window.open('mailto:olivia.jones@acme.com,justin.mendel@acme.com,vera.katts@acme.com,alex.jones@acme.com?subject=' +
      encodeURIComponent('Re: Marketing Sync (can we do this over email?)') + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
  });
})();
`;

fs.mkdirSync(SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'index.html'), html);
fs.writeFileSync(path.join(SITE, 'hero.js'), hero);
fs.copyFileSync(path.join(DESIGN, 'icon.svg'), path.join(SITE, 'icon.svg'));
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
console.log('wrote site/index.html (' + html.length + ' bytes), site/hero.js, site/icon.svg');

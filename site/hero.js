/* Meeting Cost landing page: the live popup in the hero.
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
    when.textContent = 'Thursday, September 17 \u22c5 9:00 \u2013 10:00am';
    dot.hidden = false;
    amount.style.color = '#d52b1e';
    amountText.textContent = money(perMin * elapsed);
    label.textContent = 'and rising';
    label.style.color = '#d52b1e';
    sub.textContent = '5 people \u00b7 ' + money(rate) + '/hr \u00b7 ' + money(perMin) + ' per minute \u00b7 ' + Math.floor(elapsed) + ' min in';
  }
  render();
  setInterval(render, 1000);

  send.addEventListener('click', function (e) {
    e.preventDefault();
    var body = ['Hi all,', '', '"Marketing Sync" is booked for 1 hr with 5 people at a combined ' + money(rate) + '/hour, about ' + money(rate) + ' of our time.', '',
      'Could we handle it over email instead? Here is what I need from you:', '', '1. ', '2. ', '',
      'If anything needs a real conversation, reply and we will book 15 minutes.', '', 'Thanks!'].join('\n');
    window.open('mailto:olivia.jones@acme.com,justin.mendel@acme.com,vera.katts@acme.com,alex.jones@acme.com?subject=' +
      encodeURIComponent('Re: Marketing Sync (can we do this over email?)') + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
  });
})();

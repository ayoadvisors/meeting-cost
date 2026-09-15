/*! Meeting Cost — options page */
(function () {
  'use strict';

  var core = window.MeetingCostCore;
  var api = typeof browser !== 'undefined' ? browser : chrome;
  var storage = api && api.storage && api.storage.sync;

  var $ = function (id) { return document.getElementById(id); };
  var fields = ['defaultHourlyRate', 'currency', 'hoursPerYear', 'overheadMultiplier', 'tickSeconds',
    'overrunGraceMinutes', 'includeDeclined', 'includeResources'];

  function fill(config) {
    var cfg = core.normalizeConfig(config);
    fields.forEach(function (id) {
      var input = $(id);
      if (input.type === 'checkbox') input.checked = !!cfg[id];
      else input.value = cfg[id];
    });
    $('rates').value = core.serializeRateLines(cfg.rates);
    preview();
  }

  function read() {
    var parsed = core.parseRateLines($('rates').value);
    var partial = {};
    fields.forEach(function (id) {
      var input = $(id);
      partial[id] = input.type === 'checkbox' ? input.checked : input.value;
    });
    partial.rates = parsed.rates;
    return { config: core.normalizeConfig(partial), errors: parsed.errors };
  }

  function showErrors(errors) {
    $('errors').textContent = errors.map(function (e) {
      return 'Line ' + e.line + ': ' + e.message + '  →  ' + e.text.trim();
    }).join('\n');
  }

  function preview() {
    var current = read();
    showErrors(current.errors);
    var cfg = current.config;
    var sample = Object.keys(cfg.rates).filter(function (k) { return k.charAt(0) !== '@'; }).slice(0, 5)
      .map(function (email) { return { email: email }; });
    while (sample.length < 5) sample.push({ email: 'guest' + (sample.length + 1) + '@example.com' });
    var start = new Date(2030, 0, 1, 11, 0);
    var end = new Date(2030, 0, 1, 12, 0);
    var computed = core.computeMeeting({ attendees: sample, start: start, end: end, config: cfg, now: new Date(2030, 0, 1, 9, 0) });
    var box = $('preview');
    box.textContent = '';
    var p = document.createElement('div');
    p.appendChild(document.createTextNode('Example: a one-hour meeting with 5 people at these rates costs '));
    var strong = document.createElement('strong');
    strong.textContent = computed.headline;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(' (' + core.formatMoney(computed.perMinute, cfg) + ' per minute).'));
    box.appendChild(p);
    var who = document.createElement('div');
    who.textContent = computed.people.map(function (person) {
      return person.email + ': ' + core.formatMoney(person.hourlyRate, cfg) + '/hr (' + person.rateSource + ')';
    }).join('  ·  ');
    who.style.color = '#5f6368';
    who.style.fontSize = '12px';
    who.style.marginTop = '6px';
    box.appendChild(who);
  }

  function flash(text) {
    $('status').textContent = text;
    setTimeout(function () { $('status').textContent = ''; }, 2500);
  }

  $('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var current = read();
    showErrors(current.errors);
    if (current.errors.length) { flash(''); return; }
    if (!storage) { flash('Storage unavailable'); return; }
    storage.set({ config: current.config }, function () {
      flash(api.runtime && api.runtime.lastError ? 'Could not save: ' + api.runtime.lastError.message : 'Saved');
    });
  });

  $('reset').addEventListener('click', function () {
    fill({});
    if (storage) storage.remove('config', function () { flash('Defaults restored'); });
  });

  document.querySelectorAll('input, select, textarea').forEach(function (input) {
    input.addEventListener('input', preview);
    input.addEventListener('change', preview);
  });

  if (storage) {
    storage.get('config', function (result) { fill(result && result.config ? result.config : {}); });
  } else {
    fill({});
  }
})();

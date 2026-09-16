/*!
 * Meeting Cost — extension storage
 *
 * The one place that knows where the rate table lives: chrome.storage.local.
 * Hourly rates are salary data, so they stay on this machine. The extension
 * never uses storage.sync, which would copy them to the browser vendor's
 * servers.
 *
 * The `chrome` namespace is used in every browser on purpose: Firefox exposes
 * it with callback support, while `browser.*` returns promises and silently
 * ignores callbacks.
 */
(function (root) {
  'use strict';

  var api = (typeof chrome !== 'undefined' && chrome.storage) ? chrome
    : ((typeof browser !== 'undefined' && browser.storage) ? browser : null);
  var KEY = 'config';
  var store = api && api.storage && api.storage.local ? api.storage.local : null;

  function lastError() {
    var err = api && api.runtime && api.runtime.lastError;
    return err ? new Error(err.message || String(err)) : null;
  }

  /** Load the saved config, un-normalized (callers run normalizeConfig). done(null) when nothing is saved. */
  function load(done) {
    if (!store) return done(null);
    try {
      store.get(KEY, function (result) {
        if (lastError()) return done(null);
        done(result && result[KEY] ? result[KEY] : null);
      });
    } catch (err) {
      done(null);
    }
  }

  /** Save a (normalized) config. done(err|null). */
  function save(config, done) {
    if (!store) return done && done(new Error('Storage unavailable'));
    var payload = {};
    payload[KEY] = config;
    try {
      store.set(payload, function () { if (done) done(lastError()); });
    } catch (err) {
      if (done) done(err);
    }
  }

  /** Delete the saved rates. done(err|null). */
  function clear(done) {
    if (!store) return done && done(null);
    try {
      store.remove(KEY, function () { if (done) done(lastError()); });
    } catch (err) {
      if (done) done(err);
    }
  }

  /** fn(rawConfig|null) whenever the saved config changes (any window). */
  function onChange(fn) {
    if (!api || !api.storage || !api.storage.onChanged) return;
    api.storage.onChanged.addListener(function (changes, name) {
      if (name === 'local' && changes && changes[KEY]) fn(changes[KEY].newValue || null);
    });
  }

  root.MeetingCostStorage = { KEY: KEY, load: load, save: save, clear: clear, onChange: onChange, available: !!store };
})(typeof globalThis !== 'undefined' ? globalThis : this);

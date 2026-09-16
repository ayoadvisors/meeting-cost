/*!
 * Meeting Cost — extension storage
 *
 * The one place that knows where the rate table lives: chrome.storage.local.
 * Hourly rates are salary data, so they stay on this machine and never enter
 * Chrome, Edge or Firefox sync, which would copy them to the browser vendor's
 * servers. Earlier builds used storage.sync; a copy found there is moved to
 * local storage once and then removed from sync.
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

  function area(name) {
    return api && api.storage && api.storage[name] ? api.storage[name] : null;
  }

  function lastError() {
    var err = api && api.runtime && api.runtime.lastError;
    return err ? new Error(err.message || String(err)) : null;
  }

  function get(name, done) {
    var store = area(name);
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

  function remove(name, done) {
    var store = area(name);
    if (!store) return done(null);
    try {
      store.remove(KEY, function () { done(lastError()); });
    } catch (err) {
      done(err);
    }
  }

  /** Save a (normalized) config to local storage. done(err|null). */
  function save(config, done) {
    var store = area('local');
    if (!store) return done && done(new Error('Storage unavailable'));
    var payload = {};
    payload[KEY] = config;
    try {
      store.set(payload, function () { if (done) done(lastError()); });
    } catch (err) {
      if (done) done(err);
    }
  }

  /**
   * Load the saved config, un-normalized (callers run normalizeConfig).
   * done(null) when nothing is saved. Migrates a sync copy once.
   */
  function load(done) {
    get('local', function (local) {
      if (local) return done(local);
      get('sync', function (synced) {
        if (!synced) return done(null);
        save(synced, function (err) {
          if (err) return done(synced);
          remove('sync', function () { done(synced); });
        });
      });
    });
  }

  /** Delete every saved rate, locally and from any leftover sync copy. */
  function clear(done) {
    remove('local', function (err) {
      remove('sync', function () { if (done) done(err); });
    });
  }

  /** fn(rawConfig|null) whenever the saved config changes (any window). */
  function onChange(fn) {
    if (!api || !api.storage || !api.storage.onChanged) return;
    api.storage.onChanged.addListener(function (changes, name) {
      if (name === 'local' && changes && changes[KEY]) fn(changes[KEY].newValue || null);
    });
  }

  root.MeetingCostStorage = { KEY: KEY, load: load, save: save, clear: clear, onChange: onChange, available: !!area('local') };
})(typeof globalThis !== 'undefined' ? globalThis : this);

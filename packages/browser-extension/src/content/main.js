/*!
 * Meeting Cost — content script entry point
 *
 * Picks the provider from the hostname, loads the user's rate table from
 * extension storage, watches the page for an opened event and mounts the
 * widget into it. Re-mounts when a different event is opened and tears down
 * when the event popup closes.
 */
(function (root) {
  'use strict';

  var core = root.MeetingCostCore;
  var extract = root.MeetingCostExtract;
  var widget = root.MeetingCostWidget;
  if (!core || !extract || !widget || typeof document === 'undefined') return;

  // A meeting with fewer people than this is not a meeting; show nothing.
  var MIN_ATTENDEES = 2;

  var PROVIDERS = [
    {
      id: 'google',
      test: /(^|\.)calendar\.google\.com$/i,
      composeUrl: function (draft) { return core.composeUrl.gmail(draft); },
      // "Google Account: Benjamin Brown (ben@example.com)" on the avatar button.
      selfEmail: function () {
        var a = document.querySelector('a[aria-label*="Account"], [aria-label^="Google Account"]');
        var m = a && (a.getAttribute('aria-label') || '').match(extract.EMAIL_G);
        return m ? m[0].toLowerCase() : '';
      }
    },
    {
      id: 'outlook',
      test: /(^|\.)outlook\.(office|office365|live)\.com$|(^|\.)outlook\.cloud\.microsoft$/i,
      composeUrl: function (draft) {
        var host = /outlook\.live\.com$/i.test(location.hostname) ? 'live'
          : (/outlook\.cloud\.microsoft$/i.test(location.hostname) ? 'cloud' : 'office');
        return core.composeUrl.outlook(draft, host);
      },
      selfEmail: function () { return ''; }
    }
  ];

  var provider = null;
  if (root.MC_DEMO_PROVIDER) {
    provider = PROVIDERS.filter(function (p) { return p.id === root.MC_DEMO_PROVIDER; })[0] || PROVIDERS[0];
  } else {
    provider = PROVIDERS.filter(function (p) { return p.test.test(location.hostname); })[0];
  }
  if (!provider) return;

  /* ---- config ------------------------------------------------------- */

  // Rates live in chrome.storage.local (see src/storage.js). Demo pages and
  // the console build have no extension storage and use MC_DEMO_CONFIG.
  var store = root.MeetingCostStorage && root.MeetingCostStorage.available ? root.MeetingCostStorage : null;
  var config = core.normalizeConfig(root.MC_DEMO_CONFIG || {});

  function loadConfig(done) {
    if (!store) return done();
    store.load(function (raw) {
      if (raw) config = core.normalizeConfig(raw);
      done();
    });
  }

  /* ---- mounts -------------------------------------------------------- */

  var mounts = [];

  function signatureOf(ev) {
    return [
      ev.title,
      ev.start.getTime(),
      ev.end.getTime(),
      // Status and flags are part of the signature: an RSVP that changes while
      // the popup stays open must rebuild the widget, not keep the old numbers.
      ev.attendees.map(function (a) {
        return (a.email || a.name) + ':' + a.status + (a.optional ? ':opt' : '') + (a.organizer ? ':org' : '');
      }).sort().join(',')
    ].join('|');
  }

  function scan() {
    var events = extract.findEventContainers(document, { now: new Date() });
    var keep = [];
    var me = '';
    try { me = provider.selfEmail ? provider.selfEmail() : ''; } catch (err) { me = ''; }

    events.forEach(function (ev) {
      if (ev.attendees.length < MIN_ATTENDEES) return;
      if (me) ev.attendees.forEach(function (a) { a.self = a.self || a.email === me; });
      var sig = signatureOf(ev);
      var existing = null;
      for (var i = 0; i < mounts.length; i++) {
        if (mounts[i].container === ev.container) { existing = mounts[i]; break; }
      }
      if (existing && existing.signature === sig && existing.handle.isIntact()) {
        keep.push(existing);
        return;
      }
      if (existing) existing.handle.destroy();
      var handle = widget.mount({
        container: ev.container,
        anchor: ev.anchor,
        attendees: ev.attendees,
        start: ev.start,
        end: ev.end,
        title: ev.title,
        config: config,
        provider: provider.id,
        composeUrl: provider.composeUrl
      });
      keep.push({ container: ev.container, signature: sig, handle: handle });
    });

    mounts.forEach(function (m) {
      if (keep.indexOf(m) < 0) m.handle.destroy();
    });
    mounts = keep;
  }

  function resetAndScan() {
    mounts.forEach(function (m) { m.handle.destroy(); });
    mounts = [];
    scan();
  }

  /* ---- change detection --------------------------------------------- */

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      try { scan(); } catch (err) { console.warn('[meeting-cost] scan failed', err); }
    }, 250);
  }

  function isOurs(node) {
    if (!node) return false;
    if (node.nodeType === 1) return node.hasAttribute('data-mc') || !!(node.closest && node.closest('[data-mc]'));
    return !!(node.parentElement && node.parentElement.closest('[data-mc]'));
  }

  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (isOurs(r.target)) continue;
      var added = Array.prototype.slice.call(r.addedNodes);
      // Our own insertions are not news. Removals of our nodes are: the host
      // re-rendered the popup (Google does this when an add-on card loads)
      // and took the widget with it, so it has to be mounted again.
      if (added.length && added.every(isOurs) && !r.removedNodes.length) continue;
      schedule();
      return;
    }
  });

  // Belt and braces: if a mounted row has vanished or been taken over by the
  // host's re-render, rescan within a second; otherwise put back any guest
  // annotations the re-render dropped.
  var watchdog = setInterval(function () {
    for (var i = 0; i < mounts.length; i++) {
      if (!mounts[i].handle.isIntact()) { schedule(); continue; }
      mounts[i].handle.repair();
    }
  }, 1000);

  if (store) {
    store.onChange(function (raw) {
      config = core.normalizeConfig(raw || {});
      resetAndScan();
    });
  }

  loadConfig(function () {
    try { scan(); } catch (err) { console.warn('[meeting-cost] initial scan failed', err); }
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });

  // Handy for debugging from DevTools and for the demo page's self-checks.
  // Content scripts run in an isolated world, so page scripts cannot reach it.
  root.__meetingCost = {
    provider: provider.id,
    scan: scan,
    rescan: resetAndScan,
    getMounts: function () { return mounts.slice(); },
    getConfig: function () { return config; },
    // Tear everything down (used when a newer build is injected over this one).
    stop: function () {
      observer.disconnect();
      clearInterval(watchdog);
      if (timer) { clearTimeout(timer); timer = null; }
      mounts.forEach(function (m) { m.handle.destroy(); });
      mounts = [];
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

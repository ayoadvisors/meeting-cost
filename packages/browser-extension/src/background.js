/*!
 * Meeting Cost — background script
 * The only job: clicking the toolbar icon opens the options page.
 * Declared as `service_worker` (Chrome/Edge) and `scripts` (Firefox); the
 * packager writes one or the other into each browser's manifest.
 * `chrome.*` is used in every browser: Firefox exposes it too.
 */
(function () {
  'use strict';
  var api = typeof chrome !== 'undefined' ? chrome : (typeof browser !== 'undefined' ? browser : null);
  if (api && api.action && api.action.onClicked) {
    api.action.onClicked.addListener(function () {
      api.runtime.openOptionsPage();
    });
  }
})();

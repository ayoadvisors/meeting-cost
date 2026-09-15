/*!
 * Meeting Cost — background script
 * The only job: clicking the toolbar icon opens the options page.
 * Declared as both `service_worker` (Chrome/Edge) and `scripts` (Firefox).
 */
(function () {
  'use strict';
  var api = typeof browser !== 'undefined' ? browser : chrome;
  if (api && api.action && api.action.onClicked) {
    api.action.onClicked.addListener(function () {
      api.runtime.openOptionsPage();
    });
  }
})();

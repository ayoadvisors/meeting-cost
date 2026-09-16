/*!
 * Meeting Cost — the injected widget
 *
 * Renders the "$603.25 cost of meeting · Send an Email Instead" row and the
 * "($144.23 per hour)" annotations next to every guest, then keeps the number
 * ticking. Built with createElement only: Google's pages enforce Trusted
 * Types, which blocks innerHTML even from content scripts.
 */
(function (root) {
  'use strict';

  var core = root.MeetingCostCore;
  var extract = root.MeetingCostExtract;

  var ICON_PATH = 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21' +
    'c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41' +
    ' 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5' +
    ' 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON_PATH);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  /**
   * @param {Object} spec
   * @param {Element} spec.container   element holding the open event
   * @param {Element} [spec.anchor]    insert the row before this (else append)
   * @param {Array}   spec.attendees   from MeetingCostExtract.collectAttendees
   * @param {Date}    spec.start
   * @param {Date}    spec.end
   * @param {string}  spec.title
   * @param {Object}  spec.config      normalized config
   * @param {string}  spec.provider    'google' | 'outlook' | ...
   * @param {Function} spec.composeUrl draft -> URL for "Send an Email Instead"
   */
  function mount(spec) {
    var config = core.normalizeConfig(spec.config);
    var annotations = [];

    var row = el('div', 'mc-row mc-' + spec.provider);
    row.setAttribute('data-mc', 'widget');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Meeting cost');

    var iconBox = el('div', 'mc-icon');
    iconBox.appendChild(icon());
    row.appendChild(iconBox);

    var body = el('div', 'mc-body');
    var headline = el('div', 'mc-headline');
    var amount = el('span', 'mc-amount', '…');
    var label = el('span', 'mc-label', 'cost of meeting');
    headline.appendChild(amount);
    headline.appendChild(document.createTextNode(' '));
    headline.appendChild(label);
    body.appendChild(headline);

    var button = el('button', 'mc-btn', 'Send an Email Instead');
    button.type = 'button';
    body.appendChild(button);

    var sub = el('div', 'mc-sub', '');
    body.appendChild(sub);
    row.appendChild(body);

    var computed = null;

    function render() {
      computed = core.computeMeeting({
        attendees: spec.attendees,
        start: spec.start,
        end: spec.end,
        config: config,
        now: new Date()
      });
      amount.textContent = computed.headline;
      label.textContent = computed.label;
      sub.textContent = computed.subtitle;
      row.classList.toggle('mc-live', computed.isRunning);
      row.classList.toggle('mc-over', computed.phase === 'overrun');
      row.title = 'Updated ' + computed.now.toLocaleTimeString() + ' · refreshes every ' +
        (config.tickSeconds === 60 ? 'minute' : config.tickSeconds + ' s');
    }

    // People are matched by e-mail when the calendar exposes one, otherwise
    // by display name (Outlook on the web never shows addresses).
    function personKey(p) {
      return p.email ? String(p.email).toLowerCase() : 'name:' + String(p.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function annotate() {
      if (!computed) return;
      var byKey = Object.create(null);
      computed.people.forEach(function (p) { byKey[personKey(p)] = p; });
      spec.attendees.forEach(function (a) {
        var person = byKey[personKey(a)];
        if (!person || !a.rowEl || !a.rowEl.isConnected) return;
        var text = ' (' + core.formatMoney(person.hourlyRate, config) + ' per hour' +
          (person.counted ? '' : ', not counted') + ')';
        // Each attendee owns exactly one annotation; several people can share
        // a row (Outlook's organizer sentence), so never look it up by row.
        if (a.mcSpan && a.mcSpan.isConnected) { a.mcSpan.textContent = text; return; }
        var span = el('span', 'mc-annot', text);
        a.mcSpan = span;
        span.setAttribute('data-mc', 'annot');
        span.title = person.rateSource === 'default'
          ? 'Default rate. Set a real one in the Meeting Cost options.'
          : 'Rate from your Meeting Cost options (' + person.rateSource + ' match)';
        if (a.persona && a.el && a.el.parentNode) {
          // Outlook persona button: annotate right after it, since several
          // people can share one sentence.
          a.el.parentNode.insertBefore(span, a.el.nextSibling);
        } else {
          var nameNode = extract.findNameTextNode(a.rowEl);
          if (!nameNode) return;
          // When the name sits inside a clickable element, annotate next to it, not inside it.
          var host = nameNode.parentElement && nameNode.parentElement.closest('[role="button"], button, a');
          if (host && host !== a.rowEl && a.rowEl.contains(host) && host.parentNode) {
            host.parentNode.insertBefore(span, host.nextSibling);
          } else {
            nameNode.parentNode.insertBefore(span, nameNode.nextSibling);
          }
        }
        annotations.push(span);
      });
    }

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!computed) render();
      var draft = core.buildEmailDraft({ title: spec.title, computed: computed });
      var url = spec.composeUrl ? spec.composeUrl(draft) : core.composeUrl.mailto(draft);
      window.open(url, '_blank', 'noopener');
    });
    // Keep the host page from treating clicks inside the widget as its own.
    row.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    if (spec.anchor && spec.anchor.parentNode) {
      spec.anchor.parentNode.insertBefore(row, spec.anchor);
    } else {
      spec.container.appendChild(row);
    }

    var ticker = core.createTicker(function () {
      render();
      annotate();
    }, config.tickSeconds);

    return {
      row: row,
      container: spec.container,
      destroy: function () {
        ticker.stop();
        annotations.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });
        annotations = [];
        if (row.parentNode) row.parentNode.removeChild(row);
      },
      getComputed: function () { return computed; }
    };
  }

  root.MeetingCostWidget = { mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);

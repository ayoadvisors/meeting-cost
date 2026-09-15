/*!
 * Meeting Cost — DOM extraction for the browser extension
 *
 * Two layers:
 *   1. Pure text parsing (time ranges, dates) — unit-tested in Node.
 *   2. DOM helpers that find an open event (its time line and guest list)
 *      inside Google Calendar / Outlook on the web without depending on
 *      class names, which both products change constantly.
 *
 * Strategy: an "event container" is the nearest ancestor of a visible
 * "11:00am – 12:00pm" line that also contains e-mail addresses (guests).
 * Everything else is heuristics layered on top of that idea.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MeetingCostExtract = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Text parsing                                                        */
  /* ------------------------------------------------------------------ */

  var EMAIL_SRC = "[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\\.[A-Z0-9-]+)*\\.[A-Z]{2,}";
  var EMAIL_G = new RegExp(EMAIL_SRC, 'gi');
  var EMAIL_EXACT = new RegExp('^' + EMAIL_SRC + '$', 'i');

  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var MONTH_SRC = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  var DATE_MDY = new RegExp('\\b' + MONTH_SRC + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4})\\b)?', 'ig');
  var DATE_DMY = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MONTH_SRC + '\\b(?:,?\\s*(\\d{4})\\b)?', 'ig');
  var DATE_NUM = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
  var DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

  // A clock time: "11", "11:00", "11am", "11:00 pm", "11:00 a.m." — the
  // caller insists on a colon or a meridiem so bare numbers never count.
  var TIME_G = /(^|[^\d:])(\d{1,2})(?::(\d{2}))?(?:\s*(a\.?m\.?|p\.?m\.?)(?![a-z]))?(?![\d:])/gi;
  var TIME_QUICK = /\d(?::\d{2}|\s*[ap]\.?m\b)/i;
  // "9:00 – 10:00am": the two times must be joined by a real separator, or
  // the hour gutter of the calendar grid ("12 AM 1 AM 2 AM") reads as a range.
  var SEPARATOR_ONLY = /^\s*(?:-|to|until|till|through)\s*$/i;
  // What may remain between two times of a multi-day range once the date
  // itself is removed: a separator, punctuation, and possibly a weekday.
  var BETWEEN_WITH_DATE = /^[\s,]*(?:-|to|until|till|through)?[\s,]*(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?)?[\s,]*$/i;

  function normalizeText(text) {
    return String(text || '')
      .replace(/[‐-―−]/g, '-')          // dashes → "-"
      .replace(/[⋅·•∙‧]/g, ' ') // dot separators
      .replace(/[    ]/g, ' ')      // odd spaces (Google uses narrow NBSP before am/pm)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function meridiemOf(raw) {
    if (!raw) return null;
    return raw.charAt(0).toLowerCase() === 'p' ? 'pm' : 'am';
  }

  /** All plausible clock times in a normalized string, in order. */
  function timeTokens(norm) {
    var out = [];
    var m;
    TIME_G.lastIndex = 0;
    while ((m = TIME_G.exec(norm)) !== null) {
      var hasColon = m[3] !== undefined;
      var mer = meridiemOf(m[4]);
      if (!hasColon && !mer) continue;
      var h = parseInt(m[2], 10);
      var min = hasColon ? parseInt(m[3], 10) : 0;
      if (min > 59) continue;
      if (mer ? (h < 1 || h > 12) : h > 23) continue;
      var start = m.index + m[1].length;
      out.push({ h: h, m: min, mer: mer, index: start, end: m.index + m[0].length, raw: m[0].slice(m[1].length) });
    }
    return out;
  }

  function minutesOf(token, mer) {
    var h = token.h;
    if (mer) h = (h % 12) + (mer === 'pm' ? 12 : 0);
    return h * 60 + token.m;
  }

  /** Date mentions in a normalized string (times already blanked out). */
  function dateTokens(norm, now) {
    var out = [];
    var m;
    var y = now.getFullYear();

    DATE_MDY.lastIndex = 0;
    while ((m = DATE_MDY.exec(norm)) !== null) {
      out.push({ index: m.index, length: m[0].length, y: m[3] ? parseInt(m[3], 10) : y, mo: MONTHS[m[1].toLowerCase()], d: parseInt(m[2], 10) });
    }
    DATE_DMY.lastIndex = 0;
    while ((m = DATE_DMY.exec(norm)) !== null) {
      out.push({ index: m.index, length: m[0].length, y: m[3] ? parseInt(m[3], 10) : y, mo: MONTHS[m[2].toLowerCase()], d: parseInt(m[1], 10) });
    }
    DATE_NUM.lastIndex = 0;
    while ((m = DATE_NUM.exec(norm)) !== null) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10), yy = parseInt(m[3], 10);
      if (yy < 100) yy += 2000;
      var mo = a > 12 ? b : a;   // 14/2/2023 must be day-first
      var d = a > 12 ? a : b;
      out.push({ index: m.index, length: m[0].length, y: yy, mo: mo - 1, d: d });
    }
    DATE_ISO.lastIndex = 0;
    while ((m = DATE_ISO.exec(norm)) !== null) {
      out.push({ index: m.index, length: m[0].length, y: parseInt(m[1], 10), mo: parseInt(m[2], 10) - 1, d: parseInt(m[3], 10) });
    }
    return out
      .filter(function (t) { return t.mo >= 0 && t.mo <= 11 && t.d >= 1 && t.d <= 31; })
      .sort(function (p, q) { return p.index - q.index; });
  }

  /**
   * Parse the text of a calendar "when" line into { start, end }.
   *
   * Handles, among others:
   *   "Thursday, February 2⋅11:00am – 12:00pm"      (Google Calendar)
   *   "Thursday, February 2, 2023 ⋅ 11:00 – 11:30am"
   *   "Thu 2/2/2023 11:00 AM - 12:00 PM"             (Outlook on the web)
   *   "2 February 2023, 11:00 – 12:00"               (24-hour locales)
   *   "Thursday, February 2, 11:00pm – Friday, February 3, 1:00am"
   *
   * Returns null when the text does not contain a time *range*.
   * @param {string} text
   * @param {Date} [now]  reference for "today" and the current year
   */
  function parseTimeRangeText(text, now) {
    now = now || new Date();
    var norm = normalizeText(text);
    if (!norm || !TIME_QUICK.test(norm)) return null;

    var times = timeTokens(norm);
    if (times.length < 2) return null;
    var t1 = times[0];
    var t2 = times[1];
    if (t2.index - t1.end > 80) return null;

    var between = norm.slice(t1.end, t2.index);
    var blanked = norm.slice(0, t1.index) + ' '.repeat(t1.end - t1.index) +
      norm.slice(t1.end, t2.index) + ' '.repeat(t2.end - t2.index) + norm.slice(t2.end);
    var dates = dateTokens(blanked, now);
    if (!SEPARATOR_ONLY.test(between)) {
      // Multi-day ranges put a date (and maybe a weekday) between the two
      // times. Anything else in there is prose ("...at 12:00 PM ET. The Zoom
      // invite from 2026-05-14 at 10:00 AM...") and not a range.
      var betweenDates = dates.filter(function (d) { return d.index >= t1.end && d.index < t2.index; });
      if (!betweenDates.length) return null;
      var rest = between;
      betweenDates
        .sort(function (p, q) { return q.index - p.index; })
        .forEach(function (d) {
          var rel = d.index - t1.end;
          rest = rest.slice(0, rel) + ' ' + rest.slice(rel + d.length);
        });
      if (!BETWEEN_WITH_DATE.test(rest)) return null;
    }

    // Meridiem inference: "11:00 – 12:00pm" means 11:00am.
    var mer1 = t1.mer;
    var mer2 = t2.mer;
    if (!mer1 && mer2) {
      mer1 = mer2;
      if (minutesOf(t1, mer1) > minutesOf(t2, mer2)) mer1 = mer2 === 'pm' ? 'am' : 'pm';
    } else if (mer1 && !mer2) {
      mer2 = mer1;
      if (minutesOf(t2, mer2) < minutesOf(t1, mer1)) mer2 = mer1 === 'pm' ? 'am' : 'pm';
    }

    var startDate = null;
    var endDate = null;
    for (var i = 0; i < dates.length; i++) {
      if (dates[i].index < t1.index) startDate = dates[i];
      else if (dates[i].index < t2.index && !endDate) endDate = dates[i];
    }
    if (!startDate) startDate = dates.length ? dates[0] : { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() };
    if (!endDate) endDate = startDate;

    var start = new Date(startDate.y, startDate.mo, startDate.d, 0, minutesOf(t1, mer1));
    var end = new Date(endDate.y, endDate.mo, endDate.d, 0, minutesOf(t2, mer2));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60000);

    return { start: start, end: end, text: norm, hasDate: dates.length > 0 };
  }

  /**
   * Google renders "Saturday, September 19" and "9:00 – 10:00am" as sibling
   * spans, so the deepest element with a time range carries no date. Walk up a
   * few levels until a parse that includes a date is found.
   */
  function parseTimeAround(timeEl, now, limitEl) {
    var best = parseTimeRangeText(textOf(timeEl), now);
    var probe = timeEl;
    for (var up = 0; up < 3 && !(best && best.hasDate); up++) {
      probe = probe.parentElement;
      if (!probe || probe === limitEl) break;
      var candidate = parseTimeRangeText(textOf(probe), now);
      if (candidate && (candidate.hasDate || !best)) best = candidate;
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */

  // Subtrees never worth scanning: our own UI, code, the calendar grid
  // itself (thousands of event chips) and site chrome.
  var SKIP_SELECTOR = '[data-mc], script, style, noscript, textarea, input, select, ' +
    '[role="grid"], [role="navigation"], [role="banner"], [role="menu"], nav, header';
  var BOUNDARY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="main"], [role="complementary"], [role="region"], main, aside';
  var ROW_SELECTOR = '[role="listitem"], [role="treeitem"], [role="option"], li, [data-hovercard-id], [data-email], [data-address]';
  // Outlook on the web: every person is a "persona" button that opens a
  // contact card; its accessible name carries the display name.
  var PERSONA_SELECTOR = '[role="button"][aria-label^="Opens card for "], [role="button"][aria-label^="Open card for "], ' +
    '[role="button"][aria-label^="Contact card for "]';
  var PERSONA_PREFIX = /^(?:Opens|Open|Contact) card for /i;

  var STATUS_RULES = [
    [/\b(declined|not going|not attending)\b/i, 'declined'],
    [/\b(tentative|tentatively|maybe)\b/i, 'tentative'],
    [/\b(accepted|going|attending|yes)\b/i, 'accepted'],
    [/\b(awaiting|pending|needs? action|no response|not responded|hasn.t responded|didn.t respond|invited)\b/i, 'pending']
  ];

  function createWalker(root, whatToShow) {
    var doc = root.ownerDocument || root;
    return doc.createTreeWalker(root, whatToShow, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          if (n.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
          return (whatToShow & NodeFilter.SHOW_ELEMENT) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
  }

  function isSkipped(el) {
    return !!(el && el.closest && el.closest(SKIP_SELECTOR));
  }

  /**
   * Visible text of an element, ignoring anything we injected ourselves.
   * Text nodes are joined with spaces on purpose: textContent would glue
   * "<span>Olivia Jones</span><span>Accepted</span>" into "Olivia JonesAccepted"
   * and defeat every word-boundary match.
   */
  function textOf(el) {
    if (!el) return '';
    if (el.nodeType === 3) return el.data || '';
    var walker = createWalker(el, NodeFilter.SHOW_TEXT);
    var parts = [];
    var node;
    while ((node = walker.nextNode())) parts.push(node.data);
    return parts.join(' ');
  }

  // Icon fonts render their glyph names as text ("bedtime", "person"); never
  // mistake those, or avatars and status badges, for a person's name.
  var DECORATIVE_SELECTOR = '[role="img"], [aria-hidden="true"], svg, img, i, ' +
    '[class*="material-icons"], [class*="material-symbols"], .google-symbols';
  var ROLE_WORDS = /^(organi[sz]er|optional|guest|guests|resource|room|you|me)$/i;

  /**
   * Does this text look like a person's display name rather than avatar
   * initials ("JS"), a status icon glyph, or a role label ("Organizer")?
   */
  function isNameLike(text) {
    if (!text || text.length < 3 || text.length > 80) return false;
    if (EMAIL_EXACT.test(text)) return false;
    if (!/[a-zÀ-ɏЀ-ӿ぀-ヿ一-鿿]/i.test(text)) return false; // no letters at all
    if (/^[A-Z]{1,3}$/.test(text)) return false; // initials
    if (ROLE_WORDS.test(text)) return false;
    if (detectStatus(text) !== 'unknown' && text.split(' ').length <= 2) return false;
    return true;
  }

  function nameTextNodes(el) {
    var walker = createWalker(el, NodeFilter.SHOW_TEXT);
    var out = [];
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (parent && parent.closest && parent.closest(DECORATIVE_SELECTOR)) continue;
      var t = normalizeText(node.data);
      if (!t) continue;
      out.push({ node: node, text: t });
    }
    return out;
  }

  /**
   * First text line inside el that reads like a name. Returns '' when the row
   * only shows an e-mail address, so the core can derive "James" from it.
   */
  function firstTextLine(el) {
    var lines = nameTextNodes(el);
    for (var i = 0; i < lines.length; i++) {
      if (isNameLike(lines[i].text)) return lines[i].text;
    }
    return '';
  }

  /**
   * The text node the "($144.23 per hour)" annotation goes after: the display
   * name, else the displayed e-mail address, else the first text in the row.
   */
  function findNameTextNode(rowEl) {
    var lines = nameTextNodes(rowEl);
    var i;
    for (i = 0; i < lines.length; i++) {
      if (isNameLike(lines[i].text)) return lines[i].node;
    }
    for (i = 0; i < lines.length; i++) {
      if (EMAIL_EXACT.test(lines[i].text)) return lines[i].node;
    }
    for (i = 0; i < lines.length; i++) {
      if (/[a-z0-9]/i.test(lines[i].text)) return lines[i].node;
    }
    return null;
  }

  function detectStatus(text) {
    for (var i = 0; i < STATUS_RULES.length; i++) {
      if (STATUS_RULES[i][0].test(text)) return STATUS_RULES[i][1];
    }
    return 'unknown';
  }

  function attrText(el) {
    var parts = [];
    var own = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
    if (own) parts.push(own);
    if (el.querySelectorAll) {
      var nodes = el.querySelectorAll('[aria-label], [title], [alt]');
      for (var i = 0; i < nodes.length && i < 40; i++) {
        var n = nodes[i];
        if (isSkipped(n)) continue;
        parts.push(n.getAttribute('aria-label') || n.getAttribute('title') || n.getAttribute('alt') || '');
      }
    }
    return parts.join(' ');
  }

  /** Deepest elements whose text reads as a time range. */
  function findTimeElements(root, now) {
    var walker = createWalker(root, NodeFilter.SHOW_TEXT);
    var seen = [];
    var node;
    while ((node = walker.nextNode())) {
      var data = node.data;
      if (!TIME_QUICK.test(data)) continue;
      var el = node.parentElement;
      for (var depth = 0; el && depth < 4; depth++, el = el.parentElement) {
        if (seen.indexOf(el) >= 0) break;
        if (parseTimeRangeText(textOf(el), now)) { seen.push(el); break; }
      }
    }
    // Keep only the deepest matches.
    return seen.filter(function (el) {
      return !seen.some(function (other) { return other !== el && el.contains(other); });
    });
  }

  function nameFor(el, email) {
    var candidates = [firstTextLine(el)];
    var label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
    if (label) candidates.push(label.split(/[<(,•·|]/)[0]);
    for (var i = 0; i < candidates.length; i++) {
      var c = normalizeText(candidates[i]).replace(/^"|"$/g, '');
      if (c && c.length <= 80 && !EMAIL_EXACT.test(c) && c.toLowerCase() !== email && detectStatus(c) === 'unknown') return c;
    }
    return '';
  }

  /**
   * Collect the guests shown inside `container`.
   * Returns [{ email, name, status, optional, organizer, el, rowEl }].
   */
  function collectAttendees(container, opts) {
    opts = opts || {};
    var byKey = {};
    var order = [];

    function add(email, el, fromAttribute) {
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_EXACT.test(email) || byKey[email] || isSkipped(el)) return;
      if (/^\d+@/.test(email)) return; // Zoom/SIP dial-in addresses, not people
      if (opts.ignoreEmail && email === opts.ignoreEmail) return;
      byKey[email] = { email: email, name: '', el: el, fromAttribute: fromAttribute };
      order.push(email);
    }

    function addPerson(name, el, rowEl) {
      name = normalizeText(name);
      if (!name || isSkipped(el)) return;
      var key = 'name:' + name.toLowerCase();
      if (byKey[key]) return;
      byKey[key] = { email: '', name: name, el: el, rowEl: rowEl, fromAttribute: true };
      order.push(key);
    }

    var i, el;

    // 1. People chips. Google Calendar tags every guest row (and only real
    //    people) with data-hovercard-id / data-email.
    var chips = container.querySelectorAll('[data-hovercard-id], [data-email], [data-address]');
    for (i = 0; i < chips.length; i++) {
      el = chips[i];
      add(el.getAttribute('data-hovercard-id') || el.getAttribute('data-email') || el.getAttribute('data-address'), el, true);
    }

    // 1b. Persona buttons. Outlook on the web shows people by name only
    //     ("Opens card for Jane Doe"); no e-mail address exists anywhere in
    //     its DOM, so these attendees carry a name and an empty e-mail.
    if (!order.length) {
      // Outlook renders each person as two persona buttons with the same
      // label (the avatar and the name), so group by name first.
      var personas = container.querySelectorAll(PERSONA_SELECTOR);
      var groups = {};
      var groupOrder = [];
      for (i = 0; i < personas.length; i++) {
        el = personas[i];
        var personaName = normalizeText((el.getAttribute('aria-label') || '').replace(PERSONA_PREFIX, ''));
        if (!personaName) continue;
        var gkey = personaName.toLowerCase();
        if (!groups[gkey]) { groups[gkey] = { name: personaName, els: [] }; groupOrder.push(gkey); }
        groups[gkey].els.push(el);
      }
      groupOrder.forEach(function (gkey) {
        var group = groups[gkey];
        // The row is the largest ancestor that holds this person's buttons
        // (avatar, name, RSVP status) but nobody else's.
        var row = group.els[0];
        while (row.parentElement && row.parentElement !== container && !group.els.every(function (e) { return row.contains(e); })) {
          row = row.parentElement;
        }
        for (var up = 0; up < 4; up++) {
          var parent = row.parentElement;
          if (!parent || parent === container) break;
          var others = Array.prototype.filter.call(parent.querySelectorAll(PERSONA_SELECTOR), function (p) {
            return normalizeText((p.getAttribute('aria-label') || '').replace(PERSONA_PREFIX, '')).toLowerCase() !== gkey;
          });
          if (others.length) break;
          row = parent;
        }
        addPerson(group.name, group.els[group.els.length - 1], row);
      });
    }

    // 2. Only when a calendar offers no chips (Outlook on the web) fall back
    //    to mailto links, title/aria-label attributes and plain text. With
    //    chips present those would add addresses that merely appear in the
    //    description (auto-linked text, dial-in lines), which are not guests.
    if (!order.length) {
      var links = container.querySelectorAll('a[href^="mailto:"]');
      for (i = 0; i < links.length; i++) {
        el = links[i];
        add(decodeURIComponent((el.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]), el, true);
      }

      var labelled = container.querySelectorAll('[title], [aria-label]');
      for (i = 0; i < labelled.length; i++) {
        el = labelled[i];
        var text = (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
        var found = text.match(EMAIL_G);
        if (found && found.length === 1) add(found[0], el, true);
      }

      var walker = createWalker(container, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (node.data.indexOf('@') < 0) continue;
        var emails = node.data.match(EMAIL_G);
        if (!emails) continue;
        for (i = 0; i < emails.length; i++) add(emails[i], node.parentElement, false);
      }
    }

    var list = order.map(function (key) {
      var entry = byKey[key];
      var rowEl = entry.rowEl || (entry.el.closest && entry.el.closest(ROW_SELECTOR)) || entry.el;
      if (rowEl === container) rowEl = entry.el;
      return { email: entry.email, name: entry.name, el: entry.el, rowEl: rowEl };
    });

    // A "row" that swallows other guests is really the whole list; shrink it.
    list.forEach(function (a) {
      var swallows = list.some(function (b) { return b !== a && a.rowEl !== a.el && a.rowEl.contains(b.el); });
      if (swallows) a.rowEl = a.el;
    });

    return list.map(function (a) {
      var rowText = normalizeText(textOf(a.rowEl) + ' ' + attrText(a.rowEl));
      return {
        email: a.email,
        name: a.name || nameFor(a.rowEl === a.el ? a.el : a.rowEl, a.email) || nameFor(a.el, a.email),
        status: detectStatus(rowText),
        optional: /\boptional\b/i.test(rowText),
        organizer: /\borgani[sz]er\b/i.test(rowText),
        el: a.el,
        rowEl: a.rowEl
      };
    });
  }

  var NOT_TITLE_SELECTOR = DECORATIVE_SELECTOR + ', button, [role="button"], [role="toolbar"], a';

  /**
   * The event's title: a heading if the calendar marks one, else the first
   * prominent (large) text that is not a control, an icon, an e-mail or the
   * time line. Only used for the "Send an Email Instead" subject.
   */
  function guessTitle(container, timeEl) {
    var heading = container.querySelector('[role="heading"], h1, h2, h3');
    if (heading && !isSkipped(heading)) {
      var t = normalizeText(textOf(heading));
      if (t && !parseTimeRangeText(t)) return t;
    }
    var walker = createWalker(container, NodeFilter.SHOW_TEXT);
    var node;
    var fallback = '';
    var view = (container.ownerDocument && container.ownerDocument.defaultView) || null;
    while ((node = walker.nextNode())) {
      if (timeEl && timeEl.contains(node)) continue;
      var parent = node.parentElement;
      if (!parent || (parent.closest && parent.closest(DECORATIVE_SELECTOR))) continue;
      var text = normalizeText(node.data);
      if (text.length < 3 || EMAIL_EXACT.test(text) || TIME_QUICK.test(text) || !/^[\w"'(\[]/.test(text)) continue;
      // Large text is the title even when it is clickable (Outlook's subject
      // opens the event); otherwise controls, icons and links are not titles.
      if (view) {
        var size = parseFloat(view.getComputedStyle(parent).fontSize) || 0;
        if (size >= 17) return text;
      }
      if (parent.closest && parent.closest(NOT_TITLE_SELECTOR)) continue;
      if (!fallback) fallback = text;
    }
    return fallback;
  }

  /**
   * Find every open event on the page.
   * Returns [{ container, timeEl, anchor, title, start, end, attendees }].
   */
  function findEventContainers(root, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var scope = root.body || root;
    var results = [];
    var used = [];

    findTimeElements(scope, now).forEach(function (timeEl) {
      var node = timeEl;
      var container = null;
      var attendees = [];
      for (var depth = 0; node && node !== scope && depth < (opts.maxClimb || 12); depth++) {
        if (used.indexOf(node) >= 0) return;
        attendees = collectAttendees(node, opts);
        if (attendees.length) { container = node; break; }
        if (node.matches(BOUNDARY_SELECTOR)) break;
        node = node.parentElement;
      }
      if (!container) return;

      var time = parseTimeAround(timeEl, now, container.parentElement);
      if (!time) return;
      used.push(container);

      // The block of the container that holds the guest list; the widget
      // goes right before it (as in the mock-up), or at the end.
      var anchor = attendees[0].rowEl;
      while (anchor.parentElement && anchor.parentElement !== container) anchor = anchor.parentElement;
      if (anchor === container || anchor.parentElement !== container) anchor = null;

      // The subject may sit just outside the block that holds the guests
      // (Outlook's peek puts it above); look a little higher when needed.
      var title = guessTitle(container, timeEl);
      var titleScope = container;
      for (var upTitle = 0; !title && upTitle < 3 && titleScope.parentElement && titleScope.parentElement !== scope; upTitle++) {
        titleScope = titleScope.parentElement;
        title = guessTitle(titleScope, timeEl);
        if (titleScope.matches(BOUNDARY_SELECTOR)) break;
      }

      results.push({
        container: container,
        timeEl: timeEl,
        anchor: anchor,
        title: title,
        start: time.start,
        end: time.end,
        attendees: attendees
      });
    });

    // A time range mentioned elsewhere on the page (a description, a help
    // text) can climb up to an ancestor that merely *contains* the real event.
    // Keep the innermost match only.
    return results.filter(function (r) {
      return !results.some(function (other) { return other !== r && r.container.contains(other.container); });
    });
  }

  return {
    EMAIL_G: EMAIL_G,
    EMAIL_EXACT: EMAIL_EXACT,
    normalizeText: normalizeText,
    timeTokens: timeTokens,
    dateTokens: dateTokens,
    parseTimeRangeText: parseTimeRangeText,
    detectStatus: detectStatus,
    isNameLike: isNameLike,
    findTimeElements: findTimeElements,
    findNameTextNode: findNameTextNode,
    collectAttendees: collectAttendees,
    guessTitle: guessTitle,
    findEventContainers: findEventContainers
  };
});

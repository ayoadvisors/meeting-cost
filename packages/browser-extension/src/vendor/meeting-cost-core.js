/*!
 * Meeting Cost — shared core
 *
 * Dependency-free logic used by every adapter:
 *   - browser extension (content scripts, options page)
 *   - Google Workspace add-on (Apps Script)
 *   - Outlook add-in (Office.js task pane)
 *
 * Written UMD-style so the very same file runs as:
 *   - a CommonJS module in Node            (tests, build scripts)
 *   - a classic <script> or content script (window.MeetingCostCore)
 *   - a plain Apps Script file             (globalThis.MeetingCostCore)
 *
 * Nothing here touches the DOM, the network, or any provider API.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MeetingCostCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Configuration                                                       */
  /* ------------------------------------------------------------------ */

  var DEFAULT_CONFIG = {
    currency: 'USD',
    locale: undefined,          // undefined -> runtime default locale
    defaultHourlyRate: 100,     // used when no override matches
    hoursPerYear: 2080,         // 52 weeks x 40 h, used to convert salaries
    overheadMultiplier: 1,      // 1.25-1.4 gives a "fully loaded" cost
    includeDeclined: false,     // count people who declined?
    includeResources: false,    // count rooms / equipment?
    tickSeconds: 60,            // how often the live number refreshes
    overrunGraceMinutes: 60,    // keep counting this long past the end
    rates: {}                   // 'a@b.com' | '@b.com' -> number | {hourly} | {salary}
  };

  function isFiniteNumber(n) {
    return typeof n === 'number' && isFinite(n);
  }

  // Own-property lookups only: rate tables and de-duplication maps are keyed
  // by names and addresses taken from calendar pages, and a guest called
  // "constructor" or "__proto__" must not resolve to Object.prototype.
  var hasOwn = Object.prototype.hasOwnProperty;
  function has(obj, key) {
    return !!obj && hasOwn.call(obj, key);
  }

  function toNumber(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,\s]/g, ''));
    return isFiniteNumber(n) ? n : fallback;
  }

  function toBoolean(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    var s = String(value).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return fallback;
  }

  /**
   * Merge a partial / untrusted config (storage, form input, JSON) with the
   * defaults, coercing every field to its proper type. Rate keys are
   * lower-cased so lookups are case-insensitive.
   */
  function normalizeConfig(partial) {
    var p = partial || {};
    var cfg = {
      currency: (typeof p.currency === 'string' && /^[A-Za-z]{3}$/.test(p.currency.trim()))
        ? p.currency.trim().toUpperCase() : DEFAULT_CONFIG.currency,
      locale: (typeof p.locale === 'string' && p.locale.trim()) ? p.locale.trim() : undefined,
      defaultHourlyRate: Math.max(0, toNumber(p.defaultHourlyRate, DEFAULT_CONFIG.defaultHourlyRate)),
      hoursPerYear: Math.max(1, toNumber(p.hoursPerYear, DEFAULT_CONFIG.hoursPerYear)),
      overheadMultiplier: Math.max(0, toNumber(p.overheadMultiplier, DEFAULT_CONFIG.overheadMultiplier)),
      includeDeclined: toBoolean(p.includeDeclined, DEFAULT_CONFIG.includeDeclined),
      includeResources: toBoolean(p.includeResources, DEFAULT_CONFIG.includeResources),
      tickSeconds: Math.max(1, toNumber(p.tickSeconds, DEFAULT_CONFIG.tickSeconds)),
      overrunGraceMinutes: Math.max(0, toNumber(p.overrunGraceMinutes, DEFAULT_CONFIG.overrunGraceMinutes)),
      rates: {}
    };
    var src = p.rates;
    if (typeof src === 'string') src = parseRateLines(src).rates;
    if (src && typeof src === 'object') {
      Object.keys(src).forEach(function (key) {
        var k = rateKey(key);
        if (!k) return;
        var entry = normalizeRateEntry(src[key], key);
        if (entry) cfg.rates[k] = entry;
      });
    }
    return cfg;
  }

  /**
   * Rates can be keyed three ways:
   *   'john@acme.com'   exact e-mail
   *   '@acme.com'       everyone at a domain
   *   'name:john smith' a display name, for calendars that never expose
   *                     e-mail addresses (Outlook on the web). Written as
   *                     "John Smith = 150/hr" in the rate list.
   */
  function rateKey(raw) {
    var k = String(raw || '').trim();
    if (!k) return '';
    if (k.indexOf('@') >= 0) return k.toLowerCase();
    if (/^name:/i.test(k)) return 'name:' + normalizeName(k.slice(5));
    return 'name:' + normalizeName(k);
  }

  function normalizeName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizeRateEntry(entry, rawKey) {
    var out = null;
    if (entry === null || entry === undefined) return null;
    if (typeof entry === 'number' || typeof entry === 'string') {
      var n = toNumber(entry, null);
      out = n === null ? null : { hourly: n };
    } else if (typeof entry === 'object') {
      var hourly = toNumber(entry.hourly, null);
      var salary = toNumber(entry.salary !== undefined ? entry.salary : entry.annual, null);
      if (hourly !== null) out = { hourly: hourly };
      else if (salary !== null) out = { salary: salary };
      if (out && typeof entry.label === 'string' && entry.label.trim()) out.label = entry.label.trim();
    }
    if (out && !out.label && rawKey && String(rawKey).indexOf('@') < 0) {
      out.label = String(rawKey).replace(/^name:/i, '').trim();
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Rate resolution                                                     */
  /* ------------------------------------------------------------------ */

  function domainOf(email) {
    var at = email.lastIndexOf('@');
    return at >= 0 ? email.slice(at) : '';
  }

  /** Base hourly rate (before overhead) implied by a rate entry. */
  function hourlyFromEntry(entry, config) {
    if (!entry) return null;
    if (isFiniteNumber(entry.hourly)) return entry.hourly;
    if (isFiniteNumber(entry.salary)) return entry.salary / config.hoursPerYear;
    return null;
  }

  /**
   * Find the hourly rate for a person.
   * Order: exact email -> display name -> "@domain" -> defaultHourlyRate.
   * Returns { hourly, baseHourly, source: 'exact'|'name'|'domain'|'default' }.
   */
  function resolveRate(email, config, name) {
    var cfg = config || DEFAULT_CONFIG;
    var e = (email || '').trim().toLowerCase();
    var n = normalizeName(name);
    var base = null;
    var source = 'default';
    if (e && has(cfg.rates, e)) {
      base = hourlyFromEntry(cfg.rates[e], cfg);
      source = 'exact';
    }
    if (base === null && n && has(cfg.rates, 'name:' + n)) {
      base = hourlyFromEntry(cfg.rates['name:' + n], cfg);
      source = 'name';
    }
    if (base === null && e) {
      var d = domainOf(e);
      if (d && has(cfg.rates, d)) {
        base = hourlyFromEntry(cfg.rates[d], cfg);
        source = 'domain';
      }
    }
    if (base === null) {
      base = cfg.defaultHourlyRate;
      source = 'default';
    }
    return {
      baseHourly: base,
      hourly: base * cfg.overheadMultiplier,
      source: source
    };
  }

  /* ------------------------------------------------------------------ */
  /* Attendees                                                           */
  /* ------------------------------------------------------------------ */

  // Order matters: "not going" contains "going" and "tentatively accepted"
  // contains "accepted", so the negatives and the hedges are tried first. A
  // bare "no" is a decline, but "no response" (pending) is not.
  var STATUS_WORDS = [
    [/\b(declined|no(?!\s+response)|not going|not attending)\b/i, 'declined'],
    [/\b(tentative|maybe|tentatively)\b/i, 'tentative'],
    [/\b(accepted|yes|going|attending)\b/i, 'accepted'],
    [/\b(awaiting|pending|needs ?action|not responded|no response|invited|none)\b/i, 'pending']
  ];

  /**
   * Normalize the many spellings of a response status into one of
   * 'accepted' | 'declined' | 'tentative' | 'pending' | 'unknown'.
   * Understands Google API values, Office.js ResponseType values and the
   * words shown in calendar UIs.
   */
  function normalizeStatus(value) {
    if (value === null || value === undefined) return 'unknown';
    var s = String(value).trim().toLowerCase();
    if (!s) return 'unknown';
    if (s === 'needsaction' || s === 'notresponded' || s === 'none') return 'pending';
    if (s === 'organizer') return 'accepted';
    for (var i = 0; i < STATUS_WORDS.length; i++) {
      if (STATUS_WORDS[i][0].test(s)) return STATUS_WORDS[i][1];
    }
    return 'unknown';
  }

  /** "john.smith" -> "John Smith", used when a guest has no display name. */
  function prettyNameFromEmail(email) {
    var local = (email || '').split('@')[0] || '';
    return local
      .split(/[._\-+]+/)
      .filter(Boolean)
      .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
      .join(' ') || email || 'Guest';
  }

  /**
   * Accept attendee objects from any adapter and return a clean, de-duplicated
   * list: { email, name, status, optional, organizer, self, resource }.
   */
  function normalizeAttendees(list) {
    var seen = Object.create(null);
    var out = [];
    (list || []).forEach(function (a) {
      if (!a) return;
      var email = String(a.email || a.emailAddress || '').trim().toLowerCase();
      var name = String(a.name || a.displayName || '').trim();
      var key = email || name.toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      var shown = !!name && name.toLowerCase() !== email;
      out.push({
        email: email,
        name: shown ? name : prettyNameFromEmail(email),
        // A name made up from the address was never on the calendar and may
        // belong to someone else: it must not match a name-keyed rate.
        nameFromEmail: !shown,
        status: normalizeStatus(a.status !== undefined ? a.status : a.responseStatus),
        optional: !!a.optional,
        organizer: !!a.organizer,
        self: !!a.self,
        resource: !!a.resource || /\b(room|resource)\b/i.test(String(a.recipientType || ''))
      });
    });
    return out;
  }

  function isCounted(attendee, config) {
    if (attendee.resource && !config.includeResources) return false;
    if (attendee.status === 'declined' && !config.includeDeclined) return false;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Cost                                                                */
  /* ------------------------------------------------------------------ */

  function toDate(value) {
    if (value === null || value === undefined || value === '') return null;
    var d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * The heart of the plugin.
   *
   * @param {Object} input
   * @param {Array}  input.attendees  raw attendee objects (any adapter shape)
   * @param {Date|string|number} input.start
   * @param {Date|string|number} input.end
   * @param {Object} input.config     config (normalized or partial)
   * @param {Date}   [input.now]      injectable clock for tests / tickers
   * @returns {Object} everything a UI needs to render
   */
  function computeMeeting(input) {
    var cfg = normalizeConfig(input.config);
    var now = toDate(input.now) || new Date();
    var start = toDate(input.start);
    var end = toDate(input.end);

    var people = normalizeAttendees(input.attendees).map(function (a) {
      var rate = resolveRate(a.email, cfg, a.nameFromEmail ? '' : a.name);
      var counted = isCounted(a, cfg);
      return {
        email: a.email,
        name: a.name,
        status: a.status,
        optional: a.optional,
        organizer: a.organizer,
        self: a.self,
        resource: a.resource,
        hourlyRate: rate.hourly,
        baseHourlyRate: rate.baseHourly,
        rateSource: rate.source,
        counted: counted
      };
    });

    var counted = people.filter(function (p) { return p.counted; });
    var combinedHourlyRate = counted.reduce(function (sum, p) { return sum + p.hourlyRate; }, 0);
    var perMinute = combinedHourlyRate / 60;

    var durationMinutes = (start && end) ? Math.max(0, (end - start) / 60000) : 0;
    var scheduledCost = perMinute * durationMinutes;

    var phase = 'unknown';
    var elapsedMinutes = 0;
    var overrunMinutes = 0;
    var startsInMinutes = null;

    if (start && end && end > start) {
      var graceMs = cfg.overrunGraceMinutes * 60000;
      if (now < start) {
        phase = 'upcoming';
        startsInMinutes = Math.round((start - now) / 60000);
      } else if (now < end) {
        phase = 'live';
        elapsedMinutes = (now - start) / 60000;
      } else if (now < end.getTime() + graceMs) {
        phase = 'overrun';
        elapsedMinutes = (now - start) / 60000;
        overrunMinutes = (now - end) / 60000;
      } else {
        phase = 'ended';
        elapsedMinutes = durationMinutes;
      }
    }

    var isRunning = phase === 'live' || phase === 'overrun';
    var liveCost = isRunning ? perMinute * elapsedMinutes : scheduledCost;
    var headlineAmount = isRunning ? liveCost : scheduledCost;

    var label;
    switch (phase) {
      case 'live': label = 'and rising'; break;
      case 'overrun': label = 'and rising · ' + Math.floor(overrunMinutes) + ' min over'; break;
      default: label = 'cost of meeting';
    }

    var subtitleParts = [];
    subtitleParts.push(counted.length + (counted.length === 1 ? ' person' : ' people'));
    subtitleParts.push(formatMoney(combinedHourlyRate, cfg) + '/hr');
    if (isRunning) {
      subtitleParts.push(formatMoney(perMinute, cfg) + ' per minute');
      subtitleParts.push(Math.floor(elapsedMinutes) + ' min in');
    } else if (durationMinutes > 0) {
      subtitleParts.push(formatDuration(durationMinutes));
    }
    if (cfg.overheadMultiplier !== 1) subtitleParts.push('loaded ×' + cfg.overheadMultiplier);

    return {
      people: people,
      countedPeople: counted.length,
      combinedHourlyRate: combinedHourlyRate,
      perMinute: perMinute,
      start: start,
      end: end,
      durationMinutes: durationMinutes,
      scheduledCost: scheduledCost,
      liveCost: liveCost,
      phase: phase,
      isRunning: isRunning,
      elapsedMinutes: elapsedMinutes,
      overrunMinutes: overrunMinutes,
      startsInMinutes: startsInMinutes,
      headline: formatMoney(headlineAmount, cfg),
      headlineAmount: headlineAmount,
      label: label,
      subtitle: subtitleParts.join(' · '),
      config: cfg,
      now: now
    };
  }

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */

  var formatterCache = Object.create(null);

  function formatMoney(amount, config) {
    var cfg = config || DEFAULT_CONFIG;
    var n = isFiniteNumber(amount) ? amount : 0;
    var key = (cfg.locale || '') + '|' + cfg.currency;
    try {
      if (!formatterCache[key] && typeof Intl !== 'undefined' && Intl.NumberFormat) {
        formatterCache[key] = new Intl.NumberFormat(cfg.locale, {
          style: 'currency',
          currency: cfg.currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }
      if (formatterCache[key]) return formatterCache[key].format(n);
    } catch (err) { /* fall through to the plain formatter */ }
    var fixed = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + '$' + fixed;
  }

  function formatDuration(minutes) {
    var m = Math.round(minutes);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + ' hr ' + rest + ' min' : h + (h === 1 ? ' hr' : ' hrs');
  }

  /* ------------------------------------------------------------------ */
  /* Rate list text format (shared by every settings screen)             */
  /* ------------------------------------------------------------------ */

  var UNIT_HOURLY = /^(hr|h|hour|hourly|ph)$/i;
  var UNIT_ANNUAL = /^(yr|y|year|annual|annually|salary|pa)$/i;
  var LINE_RE = /^(.+?)\s*[=:]\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/\s*|\s+per\s+|\s+)?([A-Za-z]*)\s*$/;
  // LINE_RE has several adjacent optional gaps; on a long run of spaces it
  // backtracks for seconds. Lines are whitespace-collapsed and capped first.
  var MAX_RATE_LINE = 300;

  /**
   * Parse a human-friendly rate list:
   *
   *   # comments and blank lines are ignored
   *   john@acme.com = 144.23/hr
   *   olivia@acme.com = 300000/yr
   *   @acme.com = 95              (domain default, hourly when no unit)
   *   @partner.io = 180k/yr
   *   Benjamin Brown = 150/hr     (display name, for calendars without e-mails)
   *
   * @returns {{ rates: Object, errors: Array<{line:number,text:string,message:string}> }}
   */
  function parseRateLines(text) {
    var rates = {};
    var errors = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, index) {
      var line = raw.replace(/\s+/g, ' ').trim();
      if (!line || line.charAt(0) === '#' || line.indexOf('//') === 0) return;
      if (line.length > MAX_RATE_LINE) {
        errors.push({ line: index + 1, text: raw, message: 'Line is too long (' + MAX_RATE_LINE + ' characters at most)' });
        return;
      }
      var m = LINE_RE.exec(line);
      if (!m) {
        errors.push({ line: index + 1, text: raw, message: 'Expected "email = amount/hr", "@domain = amount/yr" or "Full Name = amount/hr"' });
        return;
      }
      var rawKey = m[1].trim();
      var isEmailish = rawKey.indexOf('@') >= 0;
      if (isEmailish && (rawKey.indexOf('@') !== rawKey.lastIndexOf('@') || /\s/.test(rawKey))) {
        errors.push({ line: index + 1, text: raw, message: 'Key must be an email address, "@domain" or a person\'s name' });
        return;
      }
      var amount = parseFloat(m[2].replace(/,/g, ''));
      if (m[3]) amount *= 1000;
      var unit = m[4] || '';
      if (unit && !UNIT_HOURLY.test(unit) && !UNIT_ANNUAL.test(unit)) {
        errors.push({ line: index + 1, text: raw, message: 'Unknown unit "' + unit + '" (use /hr or /yr)' });
        return;
      }
      var entry = UNIT_ANNUAL.test(unit) ? { salary: amount } : { hourly: amount };
      if (!isEmailish) entry.label = rawKey.replace(/^name:/i, '').trim();
      rates[rateKey(rawKey)] = entry;
    });
    return { rates: rates, errors: errors };
  }

  function serializeRateLines(rates) {
    return Object.keys(rates || {}).sort().map(function (key) {
      var entry = rates[key];
      var shown = (entry && entry.label) || (key.indexOf('name:') === 0 ? key.slice(5) : key);
      if (entry && isFiniteNumber(entry.salary)) return shown + ' = ' + entry.salary + '/yr';
      var hourly = entry && isFiniteNumber(entry.hourly) ? entry.hourly : entry;
      return shown + ' = ' + hourly + '/hr';
    }).join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* "Send an Email Instead"                                             */
  /* ------------------------------------------------------------------ */

  // The title is read off the calendar page, i.e. written by whoever sent
  // the invitation: keep it to one short line before it goes into a URL.
  var MAX_TITLE = 200;

  function buildEmailDraft(input) {
    var computed = input.computed;
    var cfg = computed ? computed.config : normalizeConfig(input.config);
    var title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || 'our meeting';
    var to = (computed ? computed.people : normalizeAttendees(input.attendees))
      .filter(function (p) { return p.email && !p.resource && !p.self; })
      .map(function (p) { return p.email; });

    var lines = ['Hi all,', ''];
    if (computed && computed.durationMinutes > 0) {
      lines.push('"' + title + '" is booked for ' + formatDuration(computed.durationMinutes) +
        ' with ' + computed.countedPeople + ' people at a combined ' +
        formatMoney(computed.combinedHourlyRate, cfg) + '/hour, about ' +
        formatMoney(computed.scheduledCost, cfg) + ' of our time.');
      lines.push('');
      lines.push('Could we handle it over email instead? Here is what I need from you:');
    } else {
      lines.push('Rather than meeting about "' + title + '", could we handle this over email? Here is what I need from you:');
    }
    lines.push('');
    lines.push('1. ');
    lines.push('2. ');
    lines.push('');
    lines.push('If anything needs a real conversation, reply and we will book 15 minutes.');
    lines.push('');
    lines.push('Thanks!');

    return {
      to: to,
      subject: 'Re: ' + title + ' (can we do this over email?)',
      body: lines.join('\n')
    };
  }

  function enc(s) { return encodeURIComponent(s); }
  // Addresses in a mailto: path keep their "@" but nothing else that could
  // be read as a delimiter or an escape.
  function encAddress(a) { return enc(a).replace(/%40/g, '@'); }

  // Recipients may be empty when the calendar never exposed e-mail addresses
  // (Outlook on the web); the draft then opens with just subject and body.
  var composeUrl = {
    gmail: function (draft) {
      return 'https://mail.google.com/mail/?view=cm&fs=1' +
        (draft.to.length ? '&to=' + enc(draft.to.join(',')) : '') +
        '&su=' + enc(draft.subject) + '&body=' + enc(draft.body);
    },
    outlook: function (draft, host) {
      var base = host === 'live'
        ? 'https://outlook.live.com/mail/0/deeplink/compose'
        : (host === 'cloud' ? 'https://outlook.cloud.microsoft/mail/deeplink/compose'
          : 'https://outlook.office.com/mail/deeplink/compose');
      return base + '?' + (draft.to.length ? 'to=' + enc(draft.to.join(';')) + '&' : '') +
        'subject=' + enc(draft.subject) + '&body=' + enc(draft.body);
    },
    mailto: function (draft) {
      return 'mailto:' + draft.to.map(encAddress).join(',') + '?subject=' + enc(draft.subject) + '&body=' + enc(draft.body);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Ticker                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Call `fn` now, then again on every wall-clock boundary of `seconds`
   * (so a 60 s ticker fires exactly when the minute changes).
   * `timers` is injectable for tests. Returns { stop }.
   */
  function createTicker(fn, seconds, timers) {
    var t = timers || {
      setTimeout: function (f, ms) { return setTimeout(f, ms); },
      clearTimeout: function (id) { clearTimeout(id); },
      setInterval: function (f, ms) { return setInterval(f, ms); },
      clearInterval: function (id) { clearInterval(id); },
      now: function () { return Date.now(); }
    };
    var period = Math.max(1, seconds || 60) * 1000;
    var stopped = false;
    var timeoutId = null;
    var intervalId = null;

    fn();
    var untilBoundary = period - (t.now() % period);
    timeoutId = t.setTimeout(function () {
      if (stopped) return;
      fn();
      intervalId = t.setInterval(function () { if (!stopped) fn(); }, period);
    }, untilBoundary);

    return {
      stop: function () {
        stopped = true;
        if (timeoutId !== null) t.clearTimeout(timeoutId);
        if (intervalId !== null) t.clearInterval(intervalId);
      }
    };
  }

  /* ------------------------------------------------------------------ */

  return {
    VERSION: VERSION,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    normalizeConfig: normalizeConfig,
    normalizeName: normalizeName,
    resolveRate: resolveRate,
    normalizeStatus: normalizeStatus,
    normalizeAttendees: normalizeAttendees,
    prettyNameFromEmail: prettyNameFromEmail,
    computeMeeting: computeMeeting,
    formatMoney: formatMoney,
    formatDuration: formatDuration,
    parseRateLines: parseRateLines,
    serializeRateLines: serializeRateLines,
    buildEmailDraft: buildEmailDraft,
    composeUrl: composeUrl,
    createTicker: createTicker
  };
});

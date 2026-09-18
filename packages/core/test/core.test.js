'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/meeting-cost-core.js');

// The exact numbers from the LinkedIn post: five people, 11:00-12:00.
const POST_RATES = {
  'john.smith@acme.com': { hourly: 144.23 },
  'olivia.jones@acme.com': { hourly: 144.23 },
  'justin.mendel@acme.com': { hourly: 84.3 },
  'vera.katts@acme.com': { hourly: 120.19 },
  'alex.jones@acme.com': { hourly: 110.3 }
};

const POST_ATTENDEES = [
  { email: 'john.smith@acme.com', name: 'John Smith', status: 'accepted', organizer: true },
  { email: 'olivia.jones@acme.com', name: 'Olivia Jones', status: 'accepted' },
  { email: 'justin.mendel@acme.com', name: 'Justin Mendel', status: 'needsAction' },
  { email: 'vera.katts@acme.com', name: 'Vera Katts', status: 'accepted' },
  { email: 'alex.jones@acme.com', name: 'Alex Jones', status: 'tentative' }
];

const START = new Date(2023, 1, 2, 11, 0, 0);
const END = new Date(2023, 1, 2, 12, 0, 0);
const CONFIG = { currency: 'USD', locale: 'en-US', rates: POST_RATES };

function at(minutesFromStart) {
  return new Date(START.getTime() + minutesFromStart * 60000);
}

test('normalizeConfig coerces types, lower-cases keys and accepts rate text', () => {
  const cfg = core.normalizeConfig({
    currency: 'eur',
    defaultHourlyRate: '$1,250.50',
    hoursPerYear: '1950',
    overheadMultiplier: '1.3',
    includeDeclined: 'true',
    tickSeconds: '0',
    rates: { 'Bob@Acme.com': 120, '@Acme.com': { salary: '208,000' }, junk: null }
  });
  assert.equal(cfg.currency, 'EUR');
  assert.equal(cfg.defaultHourlyRate, 1250.5);
  assert.equal(cfg.hoursPerYear, 1950);
  assert.equal(cfg.overheadMultiplier, 1.3);
  assert.equal(cfg.includeDeclined, true);
  assert.equal(cfg.tickSeconds, 1, 'tick is clamped to at least one second');
  assert.deepEqual(cfg.rates, { 'bob@acme.com': { hourly: 120 }, '@acme.com': { salary: 208000 } });

  const fromText = core.normalizeConfig({ rates: 'a@b.com = 50/hr' });
  assert.deepEqual(fromText.rates, { 'a@b.com': { hourly: 50 } });

  const bad = core.normalizeConfig({ currency: 'dollars', defaultHourlyRate: 'abc' });
  assert.equal(bad.currency, 'USD');
  assert.equal(bad.defaultHourlyRate, 100);
});

test('resolveRate prefers exact email, then domain, then default; salaries convert', () => {
  const cfg = core.normalizeConfig({
    defaultHourlyRate: 80,
    hoursPerYear: 2000,
    rates: { 'ceo@acme.com': { salary: 400000 }, '@acme.com': { hourly: 95 } }
  });
  assert.deepEqual(core.resolveRate('CEO@acme.com', cfg), { baseHourly: 200, hourly: 200, source: 'exact' });
  assert.deepEqual(core.resolveRate('dev@acme.com', cfg), { baseHourly: 95, hourly: 95, source: 'domain' });
  assert.deepEqual(core.resolveRate('x@other.io', cfg), { baseHourly: 80, hourly: 80, source: 'default' });
  assert.deepEqual(core.resolveRate('', cfg), { baseHourly: 80, hourly: 80, source: 'default' });

  const loaded = core.normalizeConfig({ defaultHourlyRate: 100, overheadMultiplier: 1.4 });
  const r = core.resolveRate('anyone@x.com', loaded);
  assert.equal(r.baseHourly, 100);
  assert.ok(Math.abs(r.hourly - 140) < 1e-9);
});

test('normalizeStatus understands API values and UI words', () => {
  assert.equal(core.normalizeStatus('accepted'), 'accepted');
  assert.equal(core.normalizeStatus('needsAction'), 'pending');
  assert.equal(core.normalizeStatus('notResponded'), 'pending');
  assert.equal(core.normalizeStatus('Awaiting'), 'pending');
  assert.equal(core.normalizeStatus('tentative'), 'tentative');
  assert.equal(core.normalizeStatus('Declined'), 'declined');
  assert.equal(core.normalizeStatus('organizer'), 'accepted');
  assert.equal(core.normalizeStatus('Yes'), 'accepted');
  assert.equal(core.normalizeStatus(undefined), 'unknown');
  assert.equal(core.normalizeStatus('whatever'), 'unknown');
});

test('normalizeAttendees de-duplicates and invents names from emails', () => {
  const list = core.normalizeAttendees([
    { email: 'John.Smith@acme.com', name: 'John Smith' },
    { email: 'john.smith@acme.com', name: 'Dup' },
    { emailAddress: 'olivia.jones@acme.com', displayName: '' },
    { email: 'room-4@resource.calendar.google.com', name: 'Room 4', resource: true },
    { emailAddress: 'proj@acme.com', displayName: 'Projector', recipientType: 'room' },
    null,
    { name: '' }
  ]);
  assert.equal(list.length, 4);
  assert.equal(list[0].email, 'john.smith@acme.com');
  assert.equal(list[0].name, 'John Smith');
  assert.equal(list[1].name, 'Olivia Jones');
  assert.equal(list[2].resource, true);
  assert.equal(list[3].resource, true, 'recipientType "room" marks a resource');
});

test('computeMeeting reproduces the $603.25 from the post before the meeting', () => {
  const r = core.computeMeeting({ attendees: POST_ATTENDEES, start: START, end: END, config: CONFIG, now: at(-120) });
  assert.equal(r.phase, 'upcoming');
  assert.equal(r.countedPeople, 5);
  assert.ok(Math.abs(r.combinedHourlyRate - 603.25) < 1e-9);
  assert.ok(Math.abs(r.scheduledCost - 603.25) < 1e-9);
  assert.equal(r.headline, '$603.25');
  assert.equal(r.label, 'cost of meeting');
  assert.equal(r.durationMinutes, 60);
  assert.equal(r.startsInMinutes, 120);
  assert.equal(r.subtitle, '5 people · $603.25/hr · 1 hr');
  assert.equal(r.people[0].hourlyRate, 144.23);
  assert.equal(r.people[0].rateSource, 'exact');
});

test('computeMeeting rises during the meeting and keeps rising while it runs over', () => {
  const live = core.computeMeeting({ attendees: POST_ATTENDEES, start: START, end: END, config: CONFIG, now: at(30) });
  assert.equal(live.phase, 'live');
  assert.equal(live.isRunning, true);
  assert.ok(Math.abs(live.liveCost - 301.625) < 1e-9);
  assert.equal(live.headline, '$301.63');
  assert.equal(live.label, 'and rising');
  assert.match(live.subtitle, /\$10\.05 per minute · 30 min in/);

  const over = core.computeMeeting({ attendees: POST_ATTENDEES, start: START, end: END, config: CONFIG, now: at(70) });
  assert.equal(over.phase, 'overrun');
  assert.equal(over.overrunMinutes, 10);
  assert.ok(Math.abs(over.liveCost - (603.25 + 10 * 603.25 / 60)) < 1e-9);
  assert.equal(over.headline, '$703.79');
  assert.equal(over.label, 'and rising · 10 min over');

  const ended = core.computeMeeting({ attendees: POST_ATTENDEES, start: START, end: END, config: CONFIG, now: at(60 + 61) });
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.headline, '$603.25');
  assert.equal(ended.label, 'cost of meeting');
});

test('computeMeeting honours includeDeclined and includeResources', () => {
  const attendees = POST_ATTENDEES.concat([
    { email: 'sam@acme.com', name: 'Sam', status: 'declined' },
    { email: 'room@resource.calendar.google.com', name: 'Room 12', resource: true }
  ]);
  const cfg = Object.assign({}, CONFIG, { defaultHourlyRate: 60 });
  const base = core.computeMeeting({ attendees, start: START, end: END, config: cfg, now: at(-1) });
  assert.equal(base.countedPeople, 5);
  assert.equal(base.people.length, 7);
  assert.equal(base.people[5].counted, false);
  assert.equal(base.people[6].counted, false);

  const all = core.computeMeeting({
    attendees, start: START, end: END, now: at(-1),
    config: Object.assign({}, cfg, { includeDeclined: true, includeResources: true })
  });
  assert.equal(all.countedPeople, 7);
  assert.ok(Math.abs(all.combinedHourlyRate - (603.25 + 120)) < 1e-9);
});

test('computeMeeting copes with missing or nonsensical times', () => {
  const r = core.computeMeeting({ attendees: POST_ATTENDEES, config: CONFIG });
  assert.equal(r.phase, 'unknown');
  assert.equal(r.scheduledCost, 0);
  assert.equal(r.headline, '$0.00');
  assert.ok(Math.abs(r.combinedHourlyRate - 603.25) < 1e-9, 'the burn rate is still useful');

  const backwards = core.computeMeeting({ attendees: POST_ATTENDEES, start: END, end: START, config: CONFIG });
  assert.equal(backwards.phase, 'unknown');
  assert.equal(backwards.durationMinutes, 0);
});

test('formatMoney and formatDuration', () => {
  const usd = core.normalizeConfig({ currency: 'USD', locale: 'en-US' });
  assert.equal(core.formatMoney(1234.5, usd), '$1,234.50');
  assert.equal(core.formatMoney(NaN, usd), '$0.00');
  const eur = core.normalizeConfig({ currency: 'EUR', locale: 'de-DE' });
  assert.match(core.formatMoney(1234.5, eur), /1\.234,50/);
  assert.equal(core.formatDuration(45), '45 min');
  assert.equal(core.formatDuration(60), '1 hr');
  assert.equal(core.formatDuration(90), '1 hr 30 min');
  assert.equal(core.formatDuration(120), '2 hrs');
});

test('parseRateLines accepts the documented syntax and reports bad lines', () => {
  const text = [
    '# team',
    'john@acme.com = 144.23/hr',
    'Olivia@acme.com: $300,000 / yr',
    '@acme.com = 95',
    '@partner.io = 180k per year',
    'cfo@acme.com = 250 hourly',
    '',
    'this is not a rate',
    'bob@acme.com = 12/fortnight',
    'Pat Lee = 10'
  ].join('\n');
  const { rates, errors } = core.parseRateLines(text);
  assert.deepEqual(rates, {
    'john@acme.com': { hourly: 144.23 },
    'olivia@acme.com': { salary: 300000 },
    '@acme.com': { hourly: 95 },
    '@partner.io': { salary: 180000 },
    'cfo@acme.com': { hourly: 250 },
    'name:pat lee': { hourly: 10, label: 'Pat Lee' }
  });
  assert.deepEqual(errors.map(e => e.line), [8, 9]);
  assert.match(errors[1].message, /Unknown unit/);
});

test('serializeRateLines round-trips through parseRateLines', () => {
  const rates = { 'b@x.com': { salary: 120000 }, 'a@x.com': { hourly: 55.5 }, '@x.com': { hourly: 40 } };
  const text = core.serializeRateLines(rates);
  assert.equal(text, '@x.com = 40/hr\na@x.com = 55.5/hr\nb@x.com = 120000/yr');
  assert.deepEqual(core.parseRateLines(text).rates, rates);
});

test('buildEmailDraft addresses everyone but me and the rooms, and compose URLs encode it', () => {
  const attendees = POST_ATTENDEES.concat([
    { email: 'me@acme.com', name: 'Me', self: true },
    { email: 'room@resource.calendar.google.com', name: 'Room', resource: true }
  ]);
  const computed = core.computeMeeting({ attendees, start: START, end: END, config: CONFIG, now: at(-5) });
  const draft = core.buildEmailDraft({ title: 'Marketing Sync', computed });
  assert.deepEqual(draft.to, POST_ATTENDEES.map(a => a.email));
  assert.equal(draft.subject, 'Re: Marketing Sync (can we do this over email?)');
  // "me" is counted too: my hour costs money even if I am not on the To: line.
  assert.match(draft.body, /booked for 1 hr with 6 people at a combined \$703\.25\/hour, about \$703\.25 of our time/);

  const gmail = core.composeUrl.gmail(draft);
  assert.ok(gmail.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=john.smith%40acme.com%2C'));
  assert.match(gmail, /&su=Re%3A%20Marketing%20Sync/);

  const outlook = core.composeUrl.outlook(draft);
  assert.ok(outlook.startsWith('https://outlook.office.com/mail/deeplink/compose?to=john.smith%40acme.com%3B'));
  assert.ok(core.composeUrl.outlook(draft, 'live').startsWith('https://outlook.live.com/mail/0/deeplink/compose?'));

  const mailto = core.composeUrl.mailto(draft);
  assert.ok(mailto.startsWith('mailto:john.smith@acme.com,olivia.jones@acme.com'));

  const noTimes = core.buildEmailDraft({ title: '', attendees: POST_ATTENDEES, config: CONFIG });
  assert.equal(noTimes.subject, 'Re: our meeting (can we do this over email?)');
  assert.match(noTimes.body, /Rather than meeting about "our meeting"/);
});

test('createTicker fires now, aligns to the next boundary, then repeats; stop clears everything', () => {
  const calls = [];
  let clock = 1000 * 60 * 10 + 15000; // 10 min 15 s past some epoch minute
  const timeouts = [];
  const intervals = [];
  const timers = {
    now: () => clock,
    setTimeout: (f, ms) => { timeouts.push({ f, ms }); return 't' + timeouts.length; },
    clearTimeout: (id) => { timeouts.cleared = (timeouts.cleared || []).concat(id); },
    setInterval: (f, ms) => { intervals.push({ f, ms }); return 'i' + intervals.length; },
    clearInterval: (id) => { intervals.cleared = (intervals.cleared || []).concat(id); }
  };
  const ticker = core.createTicker(() => calls.push(clock), 60, timers);
  assert.equal(calls.length, 1, 'fires immediately');
  assert.equal(timeouts[0].ms, 45000, 'waits until the next whole minute');

  clock += 45000;
  timeouts[0].f();
  assert.equal(calls.length, 2, 'fires on the minute boundary');
  assert.equal(intervals[0].ms, 60000, 'then every minute');

  intervals[0].f();
  assert.equal(calls.length, 3);

  ticker.stop();
  intervals[0].f();
  assert.equal(calls.length, 3, 'no calls after stop');
  assert.deepEqual(timeouts.cleared, ['t1']);
  assert.deepEqual(intervals.cleared, ['i1']);
});

test('rates can be keyed by display name for calendars that hide e-mail addresses', () => {
  const { rates, errors } = core.parseRateLines('Benjamin Brown = 150/hr\nname:Olivia Jones = 300k/yr\n@acme.com = 95\nbad@@x = 1');
  assert.deepEqual(errors.map(e => e.line), [4]);
  assert.deepEqual(rates, {
    'name:benjamin brown': { hourly: 150, label: 'Benjamin Brown' },
    'name:olivia jones': { salary: 300000, label: 'Olivia Jones' },
    '@acme.com': { hourly: 95 }
  });
  assert.equal(core.serializeRateLines(rates), '@acme.com = 95/hr\nBenjamin Brown = 150/hr\nOlivia Jones = 300000/yr');

  const cfg = core.normalizeConfig({ defaultHourlyRate: 80, hoursPerYear: 2000, rates: { 'Vera  Katts': 120, 'v@acme.com': 200 } });
  assert.deepEqual(core.resolveRate('', cfg, 'vera katts'), { baseHourly: 120, hourly: 120, source: 'name' });
  assert.deepEqual(core.resolveRate('v@acme.com', cfg, 'Vera Katts'), { baseHourly: 200, hourly: 200, source: 'exact' }, 'an e-mail match beats a name match');
  assert.deepEqual(core.resolveRate('', cfg, 'Nobody Known'), { baseHourly: 80, hourly: 80, source: 'default' });

  const r = core.computeMeeting({
    attendees: [{ name: 'Vera Katts', status: 'Accepted' }, { name: 'Sam Lee', status: 'declined' }, { name: 'Vera Katts' }],
    start: START, end: END, config: cfg, now: at(-1)
  });
  assert.equal(r.people.length, 2, 'name-only attendees de-duplicate by name');
  assert.equal(r.countedPeople, 1);
  assert.equal(r.people[0].rateSource, 'name');
  assert.equal(r.headline, '$120.00');
});

test('email draft and compose links cope with no known recipients', () => {
  const computed = core.computeMeeting({ attendees: [{ name: 'A B' }, { name: 'C D' }], start: START, end: END, config: CONFIG, now: at(-1) });
  const draft = core.buildEmailDraft({ title: 'Sync', computed });
  assert.deepEqual(draft.to, []);
  assert.equal(core.composeUrl.outlook(draft, 'cloud'), 'https://outlook.cloud.microsoft/mail/deeplink/compose?subject=' + encodeURIComponent(draft.subject) + '&body=' + encodeURIComponent(draft.body));
  assert.ok(core.composeUrl.outlook(draft).startsWith('https://outlook.office.com/mail/deeplink/compose?subject='));
  assert.ok(core.composeUrl.gmail(draft).startsWith('https://mail.google.com/mail/?view=cm&fs=1&su='));
});

/* ---- hardening: input that anyone who can send an invitation controls ---- */

test('hostile names and addresses never resolve through Object.prototype', () => {
  const people = core.normalizeAttendees([
    { name: 'constructor' }, { name: '__proto__' }, { name: 'toString' }, { name: 'hasOwnProperty' },
    { email: 'valueOf@x.com', name: 'valueOf' }
  ]);
  assert.deepEqual(people.map(p => p.name), ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']);

  const cfg = core.normalizeConfig({ defaultHourlyRate: 80, rates: { '@x.com': 95 } });
  assert.equal(core.resolveRate('', cfg, 'constructor').source, 'default');
  assert.equal(core.resolveRate('', cfg, '__proto__').source, 'default');
  assert.equal(core.resolveRate('constructor@x.com', cfg).source, 'domain');
  assert.equal(core.resolveRate('a@constructor', cfg).source, 'default');

  // A rate table that arrived as JSON with a "__proto__" key must not touch the prototype.
  const polluted = core.normalizeConfig({ rates: JSON.parse('{"__proto__": {"hourly": 1}, "constructor": 2}') });
  assert.equal(({}).hourly, undefined);
  assert.deepEqual(Object.keys(polluted.rates).sort(), ['name:__proto__', 'name:constructor']);
  assert.equal(core.formatMoney(1, core.normalizeConfig({ currency: 'USD', locale: 'en-US' })), '$1.00');
});

test('parseRateLines stays fast on pathological whitespace and rejects overlong lines', () => {
  const t = process.hrtime.bigint();
  const wide = core.parseRateLines('a@b.com = 5' + ' '.repeat(20000) + '!');
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 200, 'took ' + ms.toFixed(0) + ' ms');
  assert.equal(wide.errors.length, 1);
  assert.match(wide.errors[0].message, /Expected/);

  const long = core.parseRateLines('a@b.com = ' + '1'.repeat(400) + '/hr');
  assert.equal(long.errors.length, 1);
  assert.match(long.errors[0].message, /too long/);
  assert.deepEqual(core.parseRateLines('  a@b.com   =   50   /   hr  ').rates, { 'a@b.com': { hourly: 50 } });
});

test('buildEmailDraft keeps a hostile title to one short line; mailto encodes odd addresses', () => {
  const title = 'Sync\n\nBcc: ceo@acme.com\r\n' + 'x'.repeat(500);
  const draft = core.buildEmailDraft({ title, attendees: POST_ATTENDEES, config: CONFIG });
  assert.ok(!/[\r\n]/.test(draft.subject), 'no line breaks in the subject');
  assert.ok(draft.subject.length <= 'Re: '.length + 200 + ' (can we do this over email?)'.length);
  assert.ok(draft.subject.startsWith('Re: Sync Bcc: ceo@acme.com xxxx'));

  const odd = core.composeUrl.mailto({ to: ["o'brien%41@x.com", 'a&b=c@x.com'], subject: 's', body: 'b' });
  assert.ok(odd.startsWith("mailto:o'brien%2541@x.com,a%26b%3Dc@x.com?subject=s&body=b"), odd);
});

test('a bare "no" declines but "no response" is pending', () => {
  assert.equal(core.normalizeStatus('No response'), 'pending');
  assert.equal(core.normalizeStatus('no'), 'declined');
  assert.equal(core.normalizeStatus('Not going'), 'declined');
});

test('a name made up from the address never matches a name-keyed rate', () => {
  const cfg = core.normalizeConfig({ defaultHourlyRate: 80, rates: { 'John Smith': 300 } });
  const r = core.computeMeeting({
    attendees: [
      { email: 'john.smith@othercorp.com' },
      { email: 'js@acme.com', name: 'John Smith' },
      { name: 'John Smith' }
    ],
    start: START, end: END, config: cfg, now: at(-1)
  });
  assert.equal(r.people[0].name, 'John Smith', 'the display name is still derived from the address');
  assert.equal(r.people[0].rateSource, 'default', 'but it does not pick up the name-keyed rate');
  assert.equal(r.people[1].rateSource, 'name', 'a name the calendar showed does');
  assert.equal(r.people[2].rateSource, 'name');
});

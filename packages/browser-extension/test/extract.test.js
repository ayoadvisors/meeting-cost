'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const extract = require('../src/content/extract.js');

const NOW = new Date(2023, 1, 2, 9, 30); // Thursday, February 2 2023, 09:30 local

function local(y, mo, d, h, mi) { return new Date(y, mo, d, h, mi).getTime(); }

test('normalizeText flattens Google and Outlook punctuation', () => {
  assert.equal(extract.normalizeText('Thursday, February 2⋅11:00am – 12:00pm'), 'Thursday, February 2 11:00am - 12:00pm');
  assert.equal(extract.normalizeText('11:00 AM — 12:00 PM'), '11:00 AM - 12:00 PM');
});

test('timeTokens only accepts clock times, never bare numbers', () => {
  const tokens = extract.timeTokens(extract.normalizeText('(US) +1 617-675-4444 PIN: 359 209 497 0102# at 11:00am - 12:00pm on the 2nd'));
  assert.deepEqual(tokens.map(t => [t.h, t.m, t.mer]), [[11, 0, 'am'], [12, 0, 'pm']]);
  assert.deepEqual(extract.timeTokens('12 amazing 3 pmts 25:00 9:75').length, 0);
  assert.deepEqual(extract.timeTokens('Feb 2, 2023 14:30').map(t => [t.h, t.m, t.mer]), [[14, 30, null]]);
});

test('parseTimeRangeText: Google Calendar bubble formats', () => {
  let r = extract.parseTimeRangeText('Thursday, February 2⋅11:00am – 12:00pm', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 11, 0));
  assert.equal(r.end.getTime(), local(2023, 1, 2, 12, 0));

  r = extract.parseTimeRangeText('Thursday, February 2 ⋅ 11:00 – 11:30am', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 11, 0), 'shared meridiem is inferred for the start');
  assert.equal(r.end.getTime(), local(2023, 1, 2, 11, 30));

  r = extract.parseTimeRangeText('Thursday, February 2⋅11:30 – 1:00pm', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 11, 30), '11:30 - 1:00pm crosses noon');
  assert.equal(r.end.getTime(), local(2023, 1, 2, 13, 0));

  r = extract.parseTimeRangeText('Monday, September 14, 2026 ⋅ 1:00 – 2:00pm', NOW);
  assert.equal(r.start.getTime(), local(2026, 8, 14, 13, 0), 'explicit year is honoured');
  assert.equal(r.end.getTime(), local(2026, 8, 14, 14, 0));

  r = extract.parseTimeRangeText('Thursday, February 2 ⋅ 11:00pm – Friday, February 3 ⋅ 1:00am', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 23, 0));
  assert.equal(r.end.getTime(), local(2023, 1, 3, 1, 0), 'multi-day range keeps the second date');
});

test('parseTimeRangeText: Outlook on the web formats', () => {
  let r = extract.parseTimeRangeText('Thu 2/2/2023 11:00 AM - 12:00 PM', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 11, 0));
  assert.equal(r.end.getTime(), local(2023, 1, 2, 12, 0));

  r = extract.parseTimeRangeText('Thursday, February 2, 2023 11:00 AM-12:00 PM', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 11, 0));

  r = extract.parseTimeRangeText('14/2/23 09:00 - 09:30', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 14, 9, 0), 'day-first numeric dates when the first number exceeds 12');
});

test('parseTimeRangeText: 24-hour locales and ISO dates', () => {
  let r = extract.parseTimeRangeText('2 February 2023, 11:00 – 12:00', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 11, 0));
  assert.equal(r.end.getTime(), local(2023, 1, 2, 12, 0));

  r = extract.parseTimeRangeText('2023-02-02 23:00 to 00:30', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 23, 0));
  assert.equal(r.end.getTime(), local(2023, 1, 3, 0, 30), 'end before start rolls to the next day');
});

test('parseTimeRangeText: no date means today', () => {
  const r = extract.parseTimeRangeText('11:00am – 12:00pm', NOW);
  assert.equal(r.start.getTime(), local(2023, 1, 2, 11, 0));
  assert.equal(r.end.getTime(), local(2023, 1, 2, 12, 0));
});

test('parseTimeRangeText rejects things that are not a time range', () => {
  assert.equal(extract.parseTimeRangeText('Weekly on Tuesday, Thursday', NOW), null);
  assert.equal(extract.parseTimeRangeText('meet.google.com/kqv-cvap-hdu', NOW), null);
  assert.equal(extract.parseTimeRangeText('(US) +1 617-675-4444 PIN: 359 209 497 0102#', NOW), null);
  assert.equal(extract.parseTimeRangeText('11:00am', NOW), null, 'a single time is not a range');
  assert.equal(extract.parseTimeRangeText('Starts 11:00am, agenda review, ends around 3:15pm', NOW), null, 'two unrelated times');
  assert.equal(extract.parseTimeRangeText('Feb 2 - 3', NOW), null, 'day ranges are not time ranges');
  assert.equal(extract.parseTimeRangeText('', NOW), null);
});

test('detectStatus reads calendar wording', () => {
  assert.equal(extract.detectStatus('John Smith Organizer Accepted'), 'accepted');
  assert.equal(extract.detectStatus('Vera Katts Tentatively accepted'), 'tentative');
  assert.equal(extract.detectStatus('Justin Mendel Awaiting'), 'pending');
  assert.equal(extract.detectStatus("Alex Jones Hasn't responded"), 'pending');
  assert.equal(extract.detectStatus('Sam Lee Declined'), 'declined');
  assert.equal(extract.detectStatus('Noah Yesler'), 'unknown', 'word boundaries keep names from matching');
});

test('isNameLike rejects initials, icons and role labels but keeps real names', () => {
  assert.equal(extract.isNameLike('John Smith'), true);
  assert.equal(extract.isNameLike('Zoë Müller-Łukasik'), true);
  assert.equal(extract.isNameLike('JS'), false, 'avatar initials');
  assert.equal(extract.isNameLike('✓'), false, 'status glyph');
  assert.equal(extract.isNameLike('Organizer'), false);
  assert.equal(extract.isNameLike('Optional'), false);
  assert.equal(extract.isNameLike('Accepted'), false);
  assert.equal(extract.isNameLike('john.smith@acme.com'), false);
  assert.equal(extract.isNameLike('Noah Yesler'), true, 'names that merely contain status-like syllables pass');
});

test('parseTimeRangeText: prose between two times is not a range, a date between them is', () => {
  // Straight from a real event description on calendar.google.com.
  const prose = 'Recurring biweekly Thursdays at 12:00 PM ET. Originating Zoom invite from 2026-05-14 at 10:00 AM MDT = 12:00 PM EDT.';
  assert.equal(extract.parseTimeRangeText(prose, NOW), null);
  assert.equal(extract.parseTimeRangeText('10:00 AM MDT = 12:00 PM EDT', NOW), null);

  const real = extract.parseTimeRangeText('Saturday, September 19\u22c59:00 \u2013 10:00am', NOW);
  assert.equal(real.start.getTime(), local(2023, 8, 19, 9, 0));
  assert.equal(real.end.getTime(), local(2023, 8, 19, 10, 0));

  const multi = extract.parseTimeRangeText('Thursday, February 2, 11:00pm - Fri, Feb 3, 1:00am', NOW);
  assert.equal(multi.end.getTime(), local(2023, 1, 3, 1, 0), 'weekday and date between the times still read as a range');
});

test('parseTimeRangeText reports whether a date was present and insists on a separator', () => {
  assert.equal(extract.parseTimeRangeText('9:00 \u2013 10:00am', NOW).hasDate, false);
  assert.equal(extract.parseTimeRangeText('Saturday, September 19\u22c59:00 \u2013 10:00am', NOW).hasDate, true);
  // The hour gutter of the calendar grid, joined with spaces.
  assert.equal(extract.parseTimeRangeText('GMT-04 12 AM 1 AM 2 AM 3 AM 4 AM', NOW), null);
  assert.equal(extract.parseTimeRangeText('11:00am 12:00pm', NOW), null, 'two times with nothing between them');
});

test("detectStatus knows Outlook's wording", () => {
  assert.equal(extract.detectStatus("Benjamin Brown, You didn't respond"), 'pending');
  assert.equal(extract.detectStatus('Olivia Jones, Accepted'), 'accepted');
  assert.equal(extract.detectStatus('Sam Lee, Declined'), 'declined');
});

/* ---- hardening: text written by whoever sent the invitation ---- */

test('EMAIL_G stays linear on an adversarial "aaaa@bbbb" run (a hostile description)', () => {
  const s = 'a'.repeat(40000) + '@' + 'b'.repeat(40000);
  const t = process.hrtime.bigint();
  const found = s.match(extract.EMAIL_G);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.equal(found, null);
  assert.ok(ms < 250, 'took ' + ms.toFixed(0) + ' ms');
  assert.deepEqual("mail john.smith@acme.com and o'brien@sub.example.co.uk".match(extract.EMAIL_G),
    ['john.smith@acme.com', "o'brien@sub.example.co.uk"]);
});

test('parseTimeRangeText copes with a very long hostile line', () => {
  const t = process.hrtime.bigint();
  const r = extract.parseTimeRangeText('x '.repeat(50000) + '11:00am – 12:00pm' + ' 9:'.repeat(20000), NOW);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 250, 'took ' + ms.toFixed(0) + ' ms');
  assert.ok(r && r.start.getTime() === local(2023, 1, 2, 11, 0));
});

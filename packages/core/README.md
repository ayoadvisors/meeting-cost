# Meeting Cost core

`src/meeting-cost-core.js` is the engine every plugin in this repo shares.
It is one dependency-free UMD file: `require()` it in Node, load it as a
classic `<script>` or content script (`window.MeetingCostCore`), or drop it
into an Apps Script project (`MeetingCostCore`).

`node scripts/sync-core.js` copies it into each package so they ship
self-contained; `npm run check` fails if a copy drifts.

## API

| Function | Purpose |
|---|---|
| `normalizeConfig(partial)` | merge untrusted config (storage, forms, JSON) with defaults; lower-cases rate keys |
| `resolveRate(email, config, name)` | exact e-mail → display name (`name:jane doe` keys, written `Jane Doe = 150/hr`) → `@domain` → default; salaries divided by `hoursPerYear`; overhead applied |
| `normalizeAttendees(list)` | accept Google / Office.js / DOM attendee shapes, de-duplicate, invent names from e-mails |
| `normalizeStatus(value)` | `needsAction`, `notResponded`, `Awaiting`… → `accepted` / `declined` / `tentative` / `pending` / `unknown` |
| `computeMeeting({attendees,start,end,config,now})` | everything a UI renders: people with rates, combined hourly rate, per-minute burn, scheduled cost, phase (`upcoming` / `live` / `overrun` / `ended`), live cost, headline, label, subtitle |
| `formatMoney`, `formatDuration` | `Intl` currency formatting with a plain fallback |
| `parseRateLines(text)` / `serializeRateLines(rates)` | the `email = 144.23/hr` list format used by every settings screen, with per-line errors |
| `buildEmailDraft({title, computed})` | the "Send an Email Instead" message (To: everyone but you and the rooms) |
| `composeUrl.gmail / outlook / mailto` | deep links that open that draft |
| `createTicker(fn, seconds)` | fire now, then on every wall-clock boundary; injectable timers for tests |

`test/core.test.js` (run with `npm test`) pins the numbers from the post:
five people at $144.23 + $144.23 + $84.30 + $120.19 + $110.30 per hour for
one hour is **$603.25**, half an hour in it reads **$301.63 and rising**, and
ten minutes over it reads **$703.79 and rising · 10 min over**.

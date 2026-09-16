# Meeting Cost browser extension (Chrome, Edge, Firefox)

This is the version that looks like the post: it injects the cost row straight
into the event popup on **calendar.google.com** and into event views on
**Outlook on the web**, annotates every guest with their hourly rate, and
keeps the number rising while the meeting runs.

```
$  $603.25 cost of meeting        [ Send an Email Instead ]
   5 people · $603.25/hr · 1 hr

   John Smith ($144.23 per hour)   Organizer
   Olivia Jones ($144.23 per hour)
```

During the meeting the same row reads `● $240.13 and rising · $10.05 per minute · 23 min in`,
and after the scheduled end it keeps climbing with `7 min over` until the
overrun grace period expires.

## Install (unpacked, 1 minute)

1. `node scripts/sync-core.js` from the repo root (copies the shared engine into `src/vendor/`; already done in this checkout).
2. **Chrome / Edge:** open `chrome://extensions` (or `edge://extensions`), turn on
   *Developer mode*, click **Load unpacked**, choose this folder.
3. **Firefox:** open `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on**, pick `manifest.json`.
4. Click the toolbar icon (or the extension's *Options*) and enter hourly rates.
5. Open any event in Google Calendar or Outlook on the web.

`npm run package` (from the repo root) produces `dist/meeting-cost-chrome-<version>.zip`
for the Chrome Web Store and Edge Add-ons and `dist/meeting-cost-firefox-<version>.zip`
for Firefox Add-ons, each with a manifest written for that browser;
`npm run validate` runs the store pre-flight on them. The listing text, images
and step-by-step publishing notes are in `../../store/`.

## How it finds the event

Both calendars change their markup constantly, so the extension does not rely
on class names. `src/content/extract.js` looks for:

1. an element whose text is a **time range** (`11:00am – 12:00pm`, `Thu 2/2/2023 11:00 AM - 12:00 PM`, 24-hour and multi-day forms),
2. the nearest ancestor that also contains **guest e-mail addresses** (from `data-hovercard-id`, `data-email`, `mailto:` links, `title`/`aria-label` attributes, or plain text),

and calls that the event container. The widget is inserted just before the
guest list; each guest's display name gets a `($144.23 per hour)` suffix.
Response status (accepted, declined, awaiting) and organizer/optional flags are
read from the row's text and icon labels.

A `MutationObserver` re-scans (debounced) when the page changes, so opening a
different event swaps the widget and closing the popup removes it. The
calendar grid, navigation and the extension's own nodes are skipped for speed
and to avoid feedback loops.

### Verified against calendar.google.com (September 2026)

The content scripts were run on a live Google Calendar account (injected from
the console via `node scripts/build-inject.js`) and these are the facts the
heuristics now lean on:

- The date and the time are **separate spans**: `Saturday, September 19` and
  `9:00 – 10:00am`. The deepest time element carries no date, so the parser
  climbs to a dated ancestor (`parseTimeAround`).
- Guests are `div[role="treeitem"]` rows inside `div[role="tree"][aria-label="Guests"]`,
  each with `data-hovercard-id="<email>"` and an `aria-label` such as
  `james@…, Attending, Organizer`. Status lives only in that label; guests who
  have not answered have no status word at all (they still count).
- A guest without a display name shows the e-mail as the name; the core turns
  `james@…` into "James".
- Icon fonts put their glyph names in the DOM (`<i>bedtime</i>`), so `<i>`
  elements are ignored when looking for names.
- Event descriptions are inside the same container and can hold e-mail
  addresses (Zoom SIP lines, auto-linked contacts) and times (`at 12:00 PM ET
  … at 10:00 AM MDT`). When Google's people chips are present, only chips are
  guests; and two times need a real separator between them to count as a range.
- Google **re-renders the popup a few seconds after it opens** (when an
  add-on card loads), silently removing anything injected. Removal of the
  widget's own node triggers a rescan, and a one-second watchdog re-mounts it.
- Events with fewer than two people (an event you created for yourself) show
  no widget.

### Verified against Outlook on the web (September 2026, `outlook.cloud.microsoft`)

The extractor was run on a live Microsoft 365 account (a university tenant):

- The event peek is a plain Fluent UI popover: no `role="dialog"`, class
  names are hashed. The time line is `span[aria-label="Time"]` reading
  `Mon 7/27/2026 7:00 PM - 9:00 PM`.
- **No e-mail address exists anywhere in the peek's DOM.** People are
  "persona" buttons, `span[role="button"][aria-label="Opens card for Jane Doe"]`,
  and Outlook renders two of them per person (the avatar initials and the
  name). The RSVP is plain text next to the name: `Accepted`, `Tentative`,
  `Declined`, `You didn't respond`, or `Organizer`.
- So on Outlook attendees are keyed by **display name**, rates are matched
  with `Full Name = 150/hr` lines, and the "Send an Email Instead" draft opens
  with subject and body but no recipients (there are no addresses to put in).
- The subject sits above the block that holds the people, so the title search
  climbs a few ancestors and prefers large text even when it is clickable.
- Google's people chips take precedence over persona buttons, and both take
  precedence over addresses found in free text, so descriptions never add guests.

- In the **organizer's view** Outlook writes one sentence for everyone
  ("You're the organizer, jane@x.com didn't respond"), so each persona's
  status is the text that follows it up to the next persona. "You" in that
  text marks the current user. A guest without a display name is a persona
  labelled by address; that address is kept, so e-mail rates and the draft's
  recipients still work for them.
- Text walkers must include elements in `whatToShow`, or the filter that
  skips the widget's own nodes is never consulted and the title search reads
  "cost of meeting" back from the widget.

Verified live on a two-person meeting: the row appeared in the peek, both
people were annotated, the organizer and the external guest were told apart,
and the total ticked once the meeting started.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest; content scripts on Google Calendar and Outlook web hosts |
| `src/vendor/meeting-cost-core.js` | shared engine (copied from `packages/core`) |
| `src/storage.js` | the rate table in `chrome.storage.local` (never sync) |
| `src/content/extract.js` | time-range parsing and DOM heuristics |
| `src/content/widget.js` | the injected row and guest annotations |
| `src/content/main.js` | provider detection, config loading, mount lifecycle |
| `src/content/widget.css` | styles (Google and Outlook variants, dark mode) |
| `src/options/` | the rates page (external stylesheet; the manifest's CSP allows nothing inline) |
| `src/background.js` | toolbar icon opens the options page |
| `test/extract.test.js` | parser tests, including adversarial inputs (`npm test` at the repo root) |
| `test/dom/selftest.html` | the real scripts against replica and hostile fixtures (`npm run test:dom`, headless Chrome/Edge) |
| `../../demo/index.html` | a replica of the Google Calendar bubble running these exact scripts |

## Settings

All in the options page and stored in `chrome.storage.local`, on this device only
("Reset and delete saved rates" removes them):

| Setting | Default | Notes |
|---|---|---|
| Default hourly rate | 100 | anyone without a match |
| Rates by person or domain | none | `email = 144.23/hr`, `email = 300000/yr`, `@domain = 95`, `180k/yr` |
| Currency, hours per year, overhead multiplier | USD, 2080, 1 | overhead 1.3 = fully loaded cost |
| Count declined / rooms | off | |
| Refresh | every minute | 10 s and 1 s available |
| Overrun grace | 60 min | keep counting after the scheduled end |

## Limits

- DOM heuristics can miss an event when a calendar redesign changes the
  popup completely. The demo page is the fixture to test against; `extract.js`
  is the one file to adjust.
- Only the guests visible in the popup are counted (Google hides long lists
  behind "N more").
- Google Calendar's full edit page shows times in inputs rather than text, so
  the widget appears in the popup and the event detail view, not while editing.
  The Google Workspace add-on in this repo covers that case.

# Meeting Cost

> A calendar plugin that shows the combined hourly salary of everyone in a
> meeting, in real time. Updates every minute. Let's see how long that
> "quick sync" lasts when the screen says $603 and rising.

This repo turns that idea into working plugins for the calendars people
actually use:

| Package | Provider | What it is | Live ticker |
|---|---|---|---|
| [`packages/browser-extension`](packages/browser-extension) | Google Calendar and Outlook on the web | Chrome / Edge / Firefox extension that injects the cost row into the event popup, exactly like the mock-up | yes |
| [`packages/google-workspace-addon`](packages/google-workspace-addon) | Google Calendar (web and mobile) | official Workspace add-on (Apps Script), installable company-wide by an admin | refresh button (platform limit) |
| [`packages/outlook-addin`](packages/outlook-addin) | Outlook for Windows, Mac, web, mobile | official Office add-in (Office.js task pane), deployable from the Microsoft 365 admin center | yes |
| [`packages/core`](packages/core) | all of the above | the one engine they share: rate lookup, cost math, live phases, formatting, the email draft | |

Every version shows the same three things: the headline
(`$603.25 cost of meeting`, becoming `$240.13 and rising` once the meeting
starts and `and rising · 7 min over` when it runs long), each guest with
`($144.23 per hour)`, and a **Send an Email Instead** button that opens a
draft addressed to the guests with the cost spelled out.

## Status

| Piece | Verified how |
|---|---|
| Core | 24 unit tests, including the post's exact numbers |
| Extension on Google Calendar | installed unpacked and run on a live calendar.google.com account: correct guests, statuses, organizer, date, position in the popup, survives Google's own re-render, tears down on close, hides on solo events, the email button drafts to everyone but you, and saving a `@domain` rate in the options page updates the open popup without a reload |
| Extension on Outlook web | extractor run on a live Microsoft 365 account (`outlook.cloud.microsoft`): people are name-only persona buttons, RSVP text and time line parsed correctly; the multi-attendee widget verified against the matching fixture in `demo/outlook.html` |
| Google Workspace add-on, Outlook add-in | written against the documented APIs, not yet deployed to a real account |

To try the extension on a real calendar without installing it, run
`node scripts/build-inject.js` and paste `dist/inject.js` into the DevTools
console on calendar.google.com, then open an event.

## Try it in 30 seconds

```bash
npm run demo
```

Open <http://localhost:8765/demo/>. That page is a replica of the Google
Calendar event bubble from the post running the unmodified extension scripts;
the buttons switch it between upcoming, live and running-over.

Then install the real thing:

- **Browser extension:** `chrome://extensions` → Developer mode → Load unpacked → `packages/browser-extension`. Set rates from the toolbar icon. Details in its [README](packages/browser-extension/README.md).
- **Google Workspace add-on:** `clasp push` and install a test deployment. Steps in its [README](packages/google-workspace-addon/README.md).
- **Outlook add-in:** `npm run certs && npm start` in `packages/outlook-addin`, then sideload `manifest.xml`. Steps in its [README](packages/outlook-addin/README.md).

## How the number is computed

`packages/core/src/meeting-cost-core.js`, used verbatim by all three plugins:

1. **Rate per person.** Exact e-mail match → `@domain` match → default rate.
   Entries can be hourly (`144.23/hr`) or annual (`300000/yr`, divided by
   *hours per year*, default 2080). An optional *overhead multiplier* turns
   salary into fully loaded cost.
2. **Who counts.** Everyone invited, minus people who declined and minus rooms
   or other resources (both switchable). You count too: your hour costs money
   even though you are not on the To: line of the email.
3. **Phases.**

   | Phase | When | Headline |
   |---|---|---|
   | upcoming | before start | scheduled cost: combined rate × scheduled length |
   | live | start to end | combined rate × minutes elapsed, ticking |
   | overrun | after end, within the grace period (default 60 min) | keeps ticking, labelled `N min over` |
   | ended | after the grace period | scheduled cost |

4. **Ticker.** Fires immediately, then on every wall-clock minute (or 10 s / 1 s
   if you prefer), so the number changes exactly when the clock does.

Rates are entered as plain lines and the same syntax works in every settings
screen:

```
# comments are fine
john.smith@acme.com = 144.23/hr
olivia.jones@acme.com = 300000/yr
@acme.com = 95
@partner.io = 180k/yr
Vera Katts = 120.19/hr      # by display name, for Outlook on the web
```

Exact e-mail wins over a name, which wins over `@domain`, which wins over
the default. Names matter because Outlook on the web never puts an e-mail
address in its event popup; people appear by display name only.

## Privacy

Nothing leaves the user's device or account. The extension stores rates in
`chrome.storage.sync`; the Workspace add-on in the user's script properties;
the Outlook add-in in mailbox roaming settings. No servers, no analytics, no
third-party scripts (Office.js from Microsoft's CDN is the one required load).

Salaries are sensitive: the intended use is your own team's numbers, or
domain-level averages, on your own machine.

## Repo layout

```
packages/
  core/                    shared engine + unit tests
  browser-extension/       MV3 extension (Google Calendar, Outlook web) + parser tests
  google-workspace-addon/  Apps Script add-on (appsscript.json, Code.js)
  outlook-addin/           Office add-in (manifest.xml, task pane)
demo/                      replica of the Google Calendar bubble running the extension
scripts/
  sync-core.js             copy core into each package (they ship self-contained)
  make-icons.js            generate the PNG icons (no image libraries)
  check.js                 syntax / JSON / manifest sanity checks
  package-extension.js     zip the extension for store upload
  build-inject.js          console-injectable build for trying it on a live calendar
  build-demo.js            single-file demo bundle
  serve.js                 static server for the demo
```

```bash
npm test                 # 24 unit tests: cost math, rate parsing, time-range parsing
npm run check            # parse every file, validate manifests, verify core copies
npm run build            # sync-core + icons + check + test
```

## Other providers

- **Apple Calendar (macOS/iOS)** has no third-party plugin API; the closest
  option is iCloud Calendar on the web, which the extension could cover with
  one more adapter (host match + the same generic extractor).
- **Zoho, Fastmail, Proton, and other web calendars** are the same story: add
  the host to `content_scripts.matches` and, if their event view needs it, a
  provider entry in `packages/browser-extension/src/content/main.js`.
- **Zoom / Teams / Meet themselves** are not calendars, but the same core
  could drive a meeting-room overlay; nothing in `packages/core` is
  browser-specific.

## License

MIT.

# Meeting Cost

[![CI](https://github.com/ayoadvisors/meeting-cost/actions/workflows/ci.yml/badge.svg)](https://github.com/ayoadvisors/meeting-cost/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ayoadvisors/meeting-cost/actions/workflows/codeql.yml/badge.svg)](https://github.com/ayoadvisors/meeting-cost/actions/workflows/codeql.yml)

Landing page: <https://ayoadvisors.github.io/meeting-cost/>

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
a `$144.23 per hour` chip, and a **Send an Email Instead** button that opens a
draft addressed to the guests with the cost spelled out.

## Status

| Piece | Verified how |
|---|---|
| Core | 32 unit tests, including the post's exact numbers and adversarial inputs (hostile names, pathological rate lines, oversized titles) |
| Extension on Google Calendar | installed unpacked and run on a live calendar.google.com account: correct guests, statuses, organizer, date, position in the popup, survives Google's own re-render, tears down on close, hides on solo events, the email button drafts to everyone but you, and saving a `@domain` rate in the options page updates the open popup without a reload |
| Extension on Outlook web | run on a live Microsoft 365 account (`outlook.cloud.microsoft`) against a two-person meeting: widget in the peek, both people annotated, organizer and external guest told apart from Outlook's one-sentence RSVP summary, live ticking once the meeting started; plus the fixtures in `demo/outlook.html` |
| Google Workspace add-on, Outlook add-in | written against the documented APIs, not yet deployed to a real account |
| Security | red-team review in [docs/security-review.md](docs/security-review.md): 12 findings fixed, adversarial unit tests, a headless DOM self-test with hostile fixtures (`npm run test:dom`) |
| Store package | `npm run build` produces the Chrome/Edge and Firefox zips and runs the Chrome Web Store pre-flight (`npm run validate`); listing text and images are in [store/](store/) |

For developers only: `node scripts/build-inject.js` builds a console-pastable
copy of the content scripts (`dist/inject.js`) for testing the heuristics
against a live calendar without installing anything. Browsers warn about
pasting code into the DevTools console for good reason; never paste code you
have not read.

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

## Privacy and security

Nothing leaves the user's device. The extension stores rates in
`chrome.storage.local` (never sync, so they are not copied to the browser
vendor's servers); the Workspace add-on in the user's script properties; the
Outlook add-in in mailbox roaming settings. No servers, no analytics, no
third-party scripts (Office.js from Microsoft's CDN is the one required
load), and the extension's own pages carry a content security policy that
forbids network connections outright.

Salaries are sensitive: the intended use is your own team's numbers, or
domain-level averages, on your own machine.

- [PRIVACY.md](PRIVACY.md): the privacy policy the store listing links to.
- [SECURITY.md](SECURITY.md): how to report a vulnerability.
- [docs/security-review.md](docs/security-review.md): the threat model, every
  finding of the September 2026 red-team review, and what was changed.
- [docs/adr/0001-accounts-subscriptions-team-rates.md](docs/adr/0001-accounts-subscriptions-team-rates.md):
  the proposed design for accounts, subscriptions, end-to-end encrypted team
  rate tables and contacts import, and what has to exist before that build
  starts.

## Repo layout

```
packages/
  core/                    shared engine + unit tests
  browser-extension/       MV3 extension (Google Calendar, Outlook web) + parser tests
                           + test/dom/selftest.html (real scripts on replica and hostile fixtures)
  google-workspace-addon/  Apps Script add-on (appsscript.json, Code.js)
  outlook-addin/           Office add-in (manifest.xml, task pane)
demo/                      replica of the Google Calendar bubble running the extension
store/                     Chrome Web Store listing text, publishing steps, screenshots and tiles
docs/                      security review
scripts/
  sync-core.js             copy core into each package (they ship self-contained)
  make-icons.js            generate the PNG icons (no image libraries)
  check.js                 syntax / JSON / manifest sanity checks
  package-extension.js     build dist/meeting-cost-{chrome,firefox}-<version>.zip + SHA256SUMS
  validate-extension.js    Chrome Web Store pre-flight on the sources and the zips
  browser-test.js          run the DOM self-test in a headless Chrome/Edge
  make-store-assets.js     render the listing screenshots and promo tiles
  build-inject.js          console-injectable build for trying it on a live calendar
  build-demo.js            single-file demo bundle
  serve.js                 static server for the demo (loopback only)
  lib/                     zip writer, PNG codec, headless-browser helper
.github/                   CI (check, tests, DOM self-test, package, validate, release on tag), CodeQL, Dependabot
```

```bash
npm test                 # 32 unit tests: cost math, rate parsing, time-range parsing, adversarial inputs
npm run test:dom         # 28 DOM checks in a headless Chrome/Edge (skipped when none is installed)
npm run check            # parse every file, validate manifests, verify core copies
npm run package          # dist/meeting-cost-chrome-1.0.0.zip, dist/meeting-cost-firefox-1.0.0.zip
npm run validate         # Chrome Web Store pre-flight on the sources and the zips
npm run store:assets     # store/assets/*.png (needs Chrome or Edge)
npm run build            # everything above except the assets
```

## Publishing

[store/PUBLISHING.md](store/PUBLISHING.md) walks through the developer
dashboard; [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) is the single source of
truth for every listing field, the permission justifications and the
privacy-practices answers, in the layout Google's
[extension guidance for coding agents](https://developer.chrome.com/docs/extensions/ai/build-with-ai)
asks for. `npm run verify:chrome` installs the extension into a real Chrome
through the Chrome DevTools MCP server and checks every surface before an
upload. Pushing a `vX.Y.Z` tag makes CI attach the packages to a GitHub
release.

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

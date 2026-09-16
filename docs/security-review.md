# Meeting Cost: security review (red team), September 2026

Scope: the browser extension as packaged for the Chrome Web Store, the
shared core it embeds, the two official-channel add-ins, and the build and
release tooling. Method: manual code review of every shipped file, a threat
model, adversarial input fuzzing of every regex that touches calendar text,
prototype-pollution and injection probes, a review of permissions and
manifest against the Chrome Web Store program policies, and a headless
browser run of the real content scripts against hostile page fixtures. Every
finding below was reproduced before it was fixed and has a regression test.

## 1. Threat model

**Assets**

1. The rate table: salary data the user types in. Must stay on the device.
2. The calendar content the extension reads (titles, names, addresses,
   RSVPs). Must not be stored or transmitted.
3. The integrity of the number shown, and the availability of the calendar
   tab (an extension that freezes the page is a denial of service).
4. The user's mail account: the "Send an Email Instead" action must never
   send anything by itself.

**Adversaries and entry points**

| Adversary | What they control | Reaches |
|---|---|---|
| Anyone who can send the user an invitation (external organizers, spammers) | event title, description, guest display names, mailto links, times written in prose | `extract.js`, `widget.js`, `core` via the page DOM |
| A malicious or compromised calendar page script | the page DOM and page-world JavaScript | only the DOM; content scripts run in an isolated world |
| The browser vendor's sync service | anything put in `storage.sync` | the rate table (finding H-2) |
| Someone on the same network during development | the local demo and add-in servers | the repository folder (finding L-1) |
| Supply chain | build tooling, CI actions | packages shipped to the store |

**Trust boundaries**: page DOM → content script (untrusted → trusted);
options page input → storage (user → own data); extension → mail provider
compose URL (must be an https URL to the user's own provider, never
`javascript:`); repository → store package (must be exactly the reviewed
sources).

## 2. Findings

Severity is the usual High / Medium / Low / Informational, judged for this
extension's context: a High is something an external inviter can trigger
that freezes the tab or something that leaks salary data; a Medium breaks the
product for a user or blocks store publication.

### H-1  Quadratic e-mail regex on invitation-controlled text (denial of service)  — fixed

`EMAIL_G` (`[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}`) was run
over every text node containing `@` in the event container. On a run of
address-like characters with an `@` but no dotted suffix, the engine
backtracks once per starting position, so time grows with the square of the
length.

Measured before the fix (Node 24, V8):

| Input | Time |
|---|---|
| `a`×5 000 `@` `b`×5 000 | 54 ms |
| `a`×20 000 `@` `b`×20 000 | 824 ms |
| `a`×40 000 `@` `b`×40 000 | 3 922 ms |

An Outlook event body can be far larger than 80 KB, so an invitation could
freeze the calendar tab for minutes on every open.

Fix: RFC-5321-bounded quantifiers (`{1,64}@{1,63}(?:\.{1,63})*\.{2,24}`),
which make the work per position constant, and text nodes or labels over
10 000 characters are not scanned for addresses at all (no guest list needs
one). After: 13 ms for the 80 KB case. Test: `extract.test.js`, "EMAIL_G
stays linear"; DOM fixture F3.

### H-2  Salary data synced to the browser vendor's servers  — fixed

Rates were saved in `chrome.storage.sync`, which copies them to Google's
(Chrome), Microsoft's (Edge) or Mozilla's (Firefox) sync infrastructure
whenever the user is signed in to the browser. That contradicts the
extension's own promise ("nothing leaves your device") and the privacy
practices a store listing has to certify. Sync storage also caps an item at
8 KB, so a rate list of roughly 150 people silently failed to save.

Fix: a small storage module (`src/storage.js`) that uses `storage.local`
only. On first run it moves any sync copy left by earlier builds into local
storage and deletes it from sync; "Reset" deletes both. The options page and
the privacy policy now say exactly this. Consequence: rates no longer follow
the user between machines, which is the point.

### M-1  Guest names that are `Object.prototype` keys crash or drop guests  — fixed

Three maps were plain objects keyed by strings taken from the page:

- `groups[personaName]` in the Outlook extractor: a persona labelled
  `constructor` made `groups['constructor']` resolve to `Object`, then
  `.els.push` threw `TypeError`, the scan aborted and no widget appeared for
  that event.
- `seen[key]` in `core.normalizeAttendees`: the key is the lower-cased
  name, so a guest named `constructor` or `__proto__` was treated as already
  seen and silently dropped from the cost (reproduced with the pre-fix core:
  3 guests in, 2 out).
- `cfg.rates[key]` lookups in `resolveRate` and the `formatterCache`: not
  reachable with a hostile key today (rate keys always contain `@` or a
  `name:` prefix), hardened as defence in depth.

Fix: `Object.create(null)` maps and own-property checks everywhere a key
comes from outside. Tests: `core.test.js`, "hostile names and addresses";
DOM fixture F2 (personas named `constructor`, `__proto__`, `toString`).
Running the self-test page against the pre-fix files reproduces it exactly:
`TypeError: Cannot read properties of undefined (reading 'push')`, and no
widget on any event of the page; the same page passes all 28 checks now.

### M-2  Rate-list parser hangs on a long run of whitespace  — fixed

`LINE_RE` has several adjacent optional whitespace gaps. A line such as
`a@b.com = 5` followed by 600 spaces and a stray character did not return
within two minutes. The same parser runs in the options page, the Workspace
add-on and the Outlook add-in, on pasted input. Fix: whitespace runs are
collapsed before matching and lines over 300 characters are rejected with a
message. After: under 1 ms for 20 000 spaces. Test: `core.test.js`,
"parseRateLines stays fast".

### M-3  Malformed `mailto:` link aborts the whole scan  — fixed

`decodeURIComponent` on a `mailto:` href with a bad percent sequence
(`mailto:%E0%A4%A@x.com`) throws `URIError` inside `collectAttendees`; the
exception propagated out of `scan()`, so one bad link in a description
removed the widget from every event on the page until the next DOM change.
Fix: a `safeDecode` that returns the raw text on failure. DOM fixture F3.

### M-4  Store package had backslash entry names  — fixed (publication blocker)

The old packager shelled out to PowerShell's `Compress-Archive`, which
writes entries as `icons\icon-16.png`. The Chrome Web Store, Edge Add-ons and
AMO unpack on Linux, where that is a file literally named `icons\icon-16.png`
and the manifest's `icons/icon-16.png` is missing, so the upload is rejected
or the icons are blank. Fix: a dependency-free ZIP writer with forward-slash
names, deflate and fixed timestamps (byte-identical output for identical
sources), plus a validator that refuses backslashes, junk entries and any
shipped file that differs from the source tree.

### M-5  Options page never loaded or saved on Firefox  — fixed

`options.js` preferred the `browser.*` namespace, whose storage calls return
promises and ignore callbacks; the page's callbacks never ran, so Firefox
users saw empty settings and could neither save nor see what was stored.
Fix: `chrome.*` (callback API, present in Firefox too) through the storage
module.

### L-5  Placeholder Firefox add-on id  — fixed (publication blocker)

`browser_specific_settings.gecko.id` was `meeting-cost@example.com`. AMO
rejects placeholder ids and, worse, an id is permanent once published, so a
wrong one can never be changed without becoming a different add-on. It is
now a fixed GUID, and the Firefox package is built with it.

### L-1  Development servers listened on every interface and served dot-files  — fixed

Both `scripts/serve.js` and `packages/outlook-addin/serve.js` called
`listen(port)` with no host, exposing the repository (including `.git/`, a
`.clasp.json` with the Apps Script id, `.claude/`) to anyone on the LAN, with
`Access-Control-Allow-Origin: *` on the add-in server. The path check
`startsWith(root)` also admitted sibling folders whose names share the
prefix, and a malformed percent-escape in the URL crashed the process. Fix:
loopback only (IPv4 and IPv6), dot-files and dot-folders 404, prefix check
with a separator, safe decoding, `X-Content-Type-Options: nosniff`, no CORS
header.

### L-2  Extension pages relied on the default CSP  — fixed

Manifest V3's default (`script-src 'self'; object-src 'self'`) is adequate
but says nothing about network connections, framing or base URLs. The
manifest now sets `default-src 'self'; script-src 'self'; object-src 'none';
connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors
'none'`, which makes "the extension's pages make no network requests" a
policy the browser enforces. The options page's inline styles moved to
`options.css` to satisfy it; the validator fails on any inline script, style
or event handler.

### L-3  Unbounded title in the e-mail draft and compose URL  — fixed

The subject came straight from the page's heading, so a hostile title could
be thousands of characters (oversized URL, truncated draft) or contain line
breaks. It is now collapsed to one line and capped at 200 characters;
`mailto:` recipients are percent-encoded except for `@`.

### L-4  Repeated parsing for descriptions full of times  — fixed

For every text node that looked like a time, up to four ancestors were
re-parsed, including the same ancestors for every one of hundreds of
mentions. A memo of elements that already failed to parse makes the scan
linear in the DOM size. DOM fixture F4 (600 times in a description) checks
that exactly one widget mounts, on the real time line, in under 1.5 s for the
whole page.

### I-1  Workspace add-on scope  — accepted, documented

The Apps Script add-on requests `calendar.events.readonly` because the
event-open trigger payload carries guests but not the title, start or end.
It is broader than ideal (it can read every event, not just the open one),
it is read-only, and the alternative is no total at all. If Google adds times
to the trigger payload the scope can go. The Outlook add-in uses `ReadItem`,
the minimum.

### I-2  Console-injectable build  — documented

`scripts/build-inject.js` produces a script to paste into DevTools for
testing against a live calendar. Browsers warn about exactly this workflow
(self-XSS). It is now described as a developer-only tool.

### I-3  Presence is detectable by the page  — accepted

The widget's nodes carry `data-mc`, so a calendar page script can tell the
extension is installed. Inherent to any content script that draws UI.

### I-4  The number is advisory  — accepted

An organizer cannot change what the extension shows except through the
event's real time and guest list; a description that imitates the time line
is never read first because the real line precedes it in both calendars'
markup. The figure is an estimate from user-entered rates either way.

## 3. Verified non-issues

- **No HTML injection surface.** Every node is built with `createElement`
  and `textContent`; no `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval` or `Function`. Google Calendar's Trusted Types
  policy is respected. Titles containing `<img onerror>` or `<script>` render
  as text (DOM fixture F3).
- **Compose links are always https to the user's own provider** with
  every parameter percent-encoded, opened with `noopener`; the `mailto:`
  path is unused in the extension.
- **Isolated world.** `window.__meetingCost` and the `MC_DEMO_*` hooks live
  in the content-script world; page scripts cannot reach them.
- **Minimal manifest.** One permission (`storage`), five explicit calendar
  origins, no `<all_urls>`, no `web_accessible_resources`, no remote code,
  no `tabs`/`cookies`/`history`/`webRequest`.
- **No dependencies.** Neither the extension nor the build has an npm
  dependency; the supply-chain surface is Node itself and the GitHub
  Actions used by CI.
- **No network.** `grep` finds no `fetch`, `XMLHttpRequest`, `WebSocket`,
  `sendBeacon` or remote `<script>` in any shipped file, and the CSP now
  forbids them from extension pages.
- **Other regexes** (`TIME_G`, the date patterns, `BETWEEN_WITH_DATE`,
  `SEPARATOR_ONLY`, status words) are linear or run on inputs bounded to 80
  characters; a 150 KB hostile line parses in under 10 ms (test).

## 4. What was changed

| Area | Change |
|---|---|
| `packages/core` | own-property lookups, null-prototype maps, whitespace-collapsed and capped rate lines, capped one-line e-mail title, encoded `mailto:` addresses |
| `src/content/extract.js` | bounded e-mail regex, 10 k-char scan cap, safe URI decoding, null-prototype maps, failed-parse memo |
| `src/storage.js` (new) | `storage.local`, one-time migration off sync, delete-all |
| `src/content/main.js`, `src/options/*` | use the storage module; external stylesheet; "Reset and delete saved rates"; privacy text |
| `manifest.json` | strict `extension_pages` CSP, `homepage_url`, fixed Firefox id; `src/storage.js` in the content scripts |
| `scripts/` | dependency-free ZIP writer, per-browser manifests, checksums, store validator, headless DOM self-test, store asset renderer, loopback-only dev servers |
| tests | 5 new adversarial unit tests (32 total), a DOM self-test with 28 checks on 6 fixtures including hostile ones |
| CI | check, tests, DOM self-test, package, validate, artifact upload, CodeQL, Dependabot for actions |

## 5. Residual risk and recommendations

1. **Heuristics drift.** Google and Microsoft change their markup; the DOM
   self-test uses replicas, not the live pages. Re-verify on a live account
   after each of their redesigns, as was done in September 2026.
2. **Local storage is only as safe as the profile.** Anything with access to
   the browser profile can read `storage.local`; that is true of every
   extension and is why the data never leaves the device.
3. **Outlook add-in CSP.** `taskpane.html` has no `Content-Security-Policy`
   because Office.js loads further scripts from Microsoft's CDN and the
   add-in has not yet been deployed to a real tenant; add one and test it
   when it is.
4. **Pin GitHub Actions to commit SHAs** once the repository has a second
   maintainer; Dependabot is configured to keep them current either way.
5. **Branch protection** on `main` (required CI, no force pushes) is worth
   turning on as soon as more than one person pushes.

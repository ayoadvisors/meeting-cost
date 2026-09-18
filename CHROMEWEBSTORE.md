# Chrome Web Store Listing — Meeting Cost

> Last Updated: 2026-09-17

The single source of truth for the Chrome Web Store listing, permission
justifications, privacy disclosures and version history, in the layout
Google's [extension guidance for coding agents](https://developer.chrome.com/docs/extensions/ai/build-with-ai)
asks for. Copy from here into the developer dashboard; keep it current
whenever the manifest, the data practices or the UI change. This file is
not shipped in the package (`npm run validate` fails if any `.md` is).

## Store Listing

**Extension Name** [REQUIRED]
<!-- Must match manifest.json "name". -->

Meeting Cost

**Short Description** [REQUIRED]
<!-- Max 132 characters. Identical to manifest.json "description" (120 characters). -->

Shows the combined hourly cost of everyone in a meeting, live and rising, inside Google Calendar and Outlook on the web.

**Detailed Description** [REQUIRED]
<!-- Plain text; the store strips markdown. Written from the user's side: what it does, not how it is built. -->

```
Meeting Cost shows what the meeting you are looking at costs: everyone's hourly rate, added up, right inside the event in Google Calendar and Outlook on the web.

FEATURES
• Cost of the meeting: the combined hourly rate of the guests times the scheduled length, shown in the event before you accept it
• Live counter: once the meeting starts the number rises every minute, and it keeps counting when the meeting runs over
• A rate for every guest: each person is annotated with their hourly rate; guests who declined and meeting rooms are left out
• Send an Email Instead: one click opens a draft to the guests in your own Gmail or Outlook, with the cost spelled out, for you to edit, send or discard
• Your rates, your way: a default rate, rates per person or per e-mail domain, hourly or as an annual salary, in any currency, with an optional fully loaded multiplier. Outlook on the web hides e-mail addresses, so rates can also be set by name

HOW TO USE
1. Click the Meeting Cost icon in the toolbar to open the options page
2. Enter a default hourly rate and, if you like, rates per person, domain or name
3. Open any event with two or more guests in Google Calendar or Outlook on the web. The cost row appears above the guest list

PRIVACY
Meeting Cost has no server, no account and no analytics. It reads only the event you have open, does the arithmetic inside the page, and sends nothing anywhere. Your rates are stored on this computer only, are never synced, and are deleted when you reset the options or remove the extension. Privacy policy: https://github.com/ayoadvisors/meeting-cost/blob/main/PRIVACY.md

PERMISSIONS
• "Read and change your data on calendar.google.com, outlook.office.com, outlook.office365.com, outlook.live.com and outlook.cloud.microsoft": needed to read the guests and the time of the event you open and to show the cost row in it. The extension runs on no other site.
• Storage: keeps your rate table on this computer.

SUPPORT
Bugs and suggestions: https://github.com/ayoadvisors/meeting-cost/issues

Version 1.0.0: first release.
```

**Category** [REQUIRED]

Productivity

**Single Purpose** [REQUIRED]
<!-- One sentence, narrow. Filled in the dashboard, read by the review team. -->

Shows the cost of the calendar event the user has open, computed from hourly rates the user enters.

**Primary Language** [REQUIRED]

English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `packages/browser-extension/icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `store/assets/screenshot-1-upcoming.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `store/assets/screenshot-2-live.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `store/assets/screenshot-3-outlook.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store/assets/screenshot-4-options.png` |
| Screenshot 5 | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ✅ Ready | `store/assets/promo-small-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready | `store/assets/promo-marquee-1400x560.png` |
| Edge Add-ons store logo (not used by Chrome) | 300×300 | ✅ Ready | `store/assets/icon-300.png` |

<!-- Status options: ⬜ Not created | 🟡 Needs update | ✅ Ready. Regenerate with `npm run store:assets`. -->

### Screenshot Notes

1. The Google Calendar event popup with the cost row ("$603.25 cost of meeting · Send an Email Instead") and every guest annotated with a rate. The real content scripts running on a replica of the popup.
2. The same meeting while it runs: "$412.25 and rising · $10.05 per minute · 41 min in".
3. Outlook on the web: the event peek with rates matched by name, a declined guest marked "not counted".
4. The options page (the real page): defaults, rates by person or domain, the local-only privacy note.

All four are 24-bit PNG with a short caption on the left; none shows a feature the extension does not have. The two promo tiles and the icon come from the brand system designed in Claude Design (`store/design/unpacked/`); the icon's vector is `packages/browser-extension/icons/icon.svg`, from which every PNG size is rendered (`npm run icons`). Refresh everything if the widget, the options page or the brand changes (`npm run store:assets`).

## Permissions Justification

<!-- Every permission and every host needs a specific, plain-English reason tied to a user-facing feature. -->

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves the user's rate table and settings (default rate, currency, hours per year, overhead multiplier, refresh interval, overrun grace, whether to count declined guests and rooms) in the browser's local storage on this device. Nothing else is stored, nothing is synced. |
| `https://calendar.google.com/*` | content script host (`content_scripts.matches`) | The content script has to read the open event's guests, response statuses and time from the Google Calendar page and draw the cost row and per-guest rates into it. |
| `https://outlook.office.com/*` | content script host | The same for Outlook on the web (work and school accounts). |
| `https://outlook.office365.com/*` | content script host | The same; the legacy Outlook on the web host. |
| `https://outlook.live.com/*` | content script host | The same; Outlook.com personal accounts. |
| `https://outlook.cloud.microsoft/*` | content script host | The same; the host Microsoft 365 now serves Outlook on the web from. |

No `host_permissions` key, no `optional_permissions`, no `tabs`, `scripting`, `activeTab`, `cookies` or `webRequest`. The extension makes no network requests at all; its own pages carry a content security policy with `connect-src 'none'`.

## Privacy & Data Use

<!-- Maps to the CWS data use disclosure form. Must match what the code does. -->

### Data Collection

**Does the extension collect user data?** No

The extension reads, inside the page the user already has open, the event's title, times and guests (names, addresses where the page shows them, responses). It uses them only to compute and display a number in that page. Nothing read from the page is stored or transmitted. For the disclosure form every box stays unticked; the table records why.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No (guest names and addresses are read in the page only, never stored) | No | Computing and showing the cost in the open event | No |
| Health info | No | No | | No |
| Financial info | No (the hourly rates the user types are settings, stored locally, never transmitted) | No | | No |
| Authentication info | No | No | | No |
| Personal communications | No | No | | No |
| Location | No | No | | No |
| Web history | No | No | | No |
| User activity | No | No | | No |
| Website content | No (the open event is read in the page only, never stored) | No | Computing and showing the cost in the open event | No |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

**Remote code:** none. All code is in the package.

## Privacy Policy

**Privacy Policy URL** [REQUIRED]

https://github.com/ayoadvisors/meeting-cost/blob/main/PRIVACY.md

<!-- Public, no login wall, consistent with the disclosure above (no collection, local-only settings, no sync). -->

## Distribution

**Visibility**: Public
**Regions**: All regions
**Pricing**: Free
**Mature content**: No

## Developer Info

**Publisher Name** [REQUIRED]
<!-- Set on the dashboard's Account tab; shown on the listing. -->

[fill in on the dashboard: the publisher display name]

**Contact Email** [REQUIRED]
<!-- Must be verified on the dashboard; displayed publicly; Google sends policy notices there, so it must be monitored. -->

[fill in on the dashboard: a monitored, verified address]

**Support URL / Email** [RECOMMENDED]

https://github.com/ayoadvisors/meeting-cost/issues

**Homepage URL** [RECOMMENDED]

https://ayoadvisors.github.io/meeting-cost/ (the landing page; source in `site/`, published by GitHub Pages)

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-09-16 | First release: cost row and live counter in Google Calendar and Outlook on the web, per-guest rates, Send an Email Instead, options page with rates per person, domain or name. Security review applied (see `docs/security-review.md`). | Draft |

<!-- Status options: Draft | Submitted | In Review | Published | Rejected -->

## Review Notes

### Notes for the reviewer (dashboard field)

```
Meeting Cost is a content-script extension for Google Calendar and Outlook on the web. To test: install, click the toolbar icon to open the options page, save a default hourly rate (for example 100), then open any event with two or more guests on calendar.google.com or outlook.office.com. A row "$X cost of meeting · Send an Email Instead" appears above the guest list and each guest gets a "$100.00 per hour" chip. The extension makes no network requests (its manifest's content security policy sets connect-src 'none') and stores only the options-page settings in local storage. Source: https://github.com/ayoadvisors/meeting-cost
```

### Known Issues / Limitations

- The event is found by reading the calendar page, so a redesign of Google Calendar or Outlook on the web can hide the row until the extension is updated. The repository's DOM self-test uses replicas of the September 2026 markup.
- Only the guests visible in the popup are counted; Google collapses long guest lists behind "N more".
- Google Calendar's full edit page shows times in inputs rather than text, so the row appears in the popup and the event view, not while editing.
- The Firefox and Edge packages are built from the same sources (`npm run package`) and are submitted separately to their stores.

### Rejection History

None yet.

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| | | | |

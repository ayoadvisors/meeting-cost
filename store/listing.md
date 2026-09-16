# Chrome Web Store listing: Meeting Cost

Everything the developer dashboard asks for, ready to paste. Character
limits are the store's. The images are in `store/assets/` (regenerate with
`npm run store:assets`).

## Package

Upload `dist/meeting-cost-chrome-1.0.0.zip` (built by `npm run package`,
checked by `npm run validate`). The same file is what Microsoft Edge Add-ons
takes; Firefox Add-ons takes `dist/meeting-cost-firefox-1.0.0.zip`.

## Store listing tab

**Name** (from the manifest): Meeting Cost

**Summary** (from the manifest, 120/132 characters):

> Shows the combined hourly cost of everyone in a meeting, live and rising, inside Google Calendar and Outlook on the web.

**Category:** Productivity → Workflow & Planning

**Language:** English (United States)

**Detailed description** (plain text; the store renders no HTML):

```
Every meeting has a price: the hourly rate of everyone in the room, added up. Meeting Cost puts that number where you decide whether to accept: inside the event itself.

Open any event in Google Calendar or Outlook on the web and a new row appears with the cost of the meeting for its scheduled length, the combined hourly rate, and every guest annotated with their rate. Once the meeting starts the number ticks up every minute ("$240.13 and rising"), and it keeps counting if the meeting runs over. A "Send an Email Instead" button drafts a message to the guests with the cost spelled out, in your own Gmail or Outlook, for you to edit and send or throw away.

Rates are yours to set on the options page: a default for everyone, rates per person or per e-mail domain, hourly or as an annual salary, in any currency, with an optional overhead multiplier for fully loaded cost. Outlook on the web shows people without addresses, so rates can also be set by name.

Privacy: the extension has no server, no account and no analytics. It reads only the event you have open, does its arithmetic in the page, and makes no network requests. Your rates are stored on this computer only (browser local storage, never sync) and are deleted when you reset the options or remove the extension. Full policy: https://github.com/ayoadvisors/meeting-cost/blob/main/PRIVACY.md

Works on calendar.google.com and on Outlook on the web (outlook.office.com, outlook.office365.com, outlook.live.com, outlook.cloud.microsoft). Open source, MIT licensed: https://github.com/ayoadvisors/meeting-cost
```

**Store icon:** `packages/browser-extension/icons/icon-128.png` (128×128).

**Screenshots** (1280×800, 24-bit PNG):

1. `store/assets/screenshot-1-upcoming.png`: the Google Calendar event with the cost row and per-guest rates.
2. `store/assets/screenshot-2-live.png`: the same meeting running, "and rising".
3. `store/assets/screenshot-3-outlook.png`: Outlook on the web, rates by name.
4. `store/assets/screenshot-4-options.png`: the options page.

**Small promo tile** (440×280): `store/assets/promo-small-440x280.png`
**Marquee promo tile** (1400×560): `store/assets/promo-marquee-1400x560.png`

**Official URL / homepage:** https://github.com/ayoadvisors/meeting-cost
**Support URL:** https://github.com/ayoadvisors/meeting-cost/issues

## Privacy practices tab

**Single purpose description:**

> Shows the cost of the calendar event the user has open, computed from hourly rates the user enters, inside Google Calendar and Outlook on the web.

**Permission justifications:**

- `storage`: saves the user's rate table and settings in the browser's local storage on this device. Nothing else is stored.
- Host permission `https://calendar.google.com/*`: the content script has to read the open event's guests and time from the Google Calendar page and draw the cost row into it.
- Host permissions `https://outlook.office.com/*`, `https://outlook.office365.com/*`, `https://outlook.live.com/*`, `https://outlook.cloud.microsoft/*`: the same, for the four hosts Outlook on the web is served from. The extension runs on no other site.

**Are you using remote code?** No. All code is in the package; the manifest's content security policy forbids remote scripts and network connections from extension pages.

**Data usage** (tick nothing): the extension does not collect or transmit any user data. It reads the open event's title, times and guest names/addresses from the page in order to compute a number shown on that page, keeps none of it, and sends nothing to the developer or anyone else. The rate table the user types is stored locally only.

**Certifications** (tick all three):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/ayoadvisors/meeting-cost/blob/main/PRIVACY.md

## Distribution tab

- Visibility: Public
- Regions: all
- Pricing: free
- Mature content: no

## Reviewer notes (the "notes for the reviewer" box)

```
Meeting Cost is a content-script extension for Google Calendar and Outlook on the web. To test: install, click the toolbar icon to open the options page, save a default hourly rate (e.g. 100), then open any event with two or more guests on calendar.google.com or outlook.office.com. A row "$X cost of meeting · Send an Email Instead" appears above the guest list and each guest shows "($100.00 per hour)". The extension makes no network requests (see the connect-src 'none' CSP in the manifest) and stores only the options-page settings in chrome.storage.local. Source: https://github.com/ayoadvisors/meeting-cost
```

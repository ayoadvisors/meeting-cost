# Meeting Cost for Outlook (Office add-in)

The official-channel version for Microsoft: a task pane add-in built on
Office.js. One manifest covers Outlook for Windows, Mac, the web
(outlook.office.com, outlook.live.com) and mobile.

| What you see | Where |
|---|---|
| `$603.25 cost of meeting`, ticking to `$240.13 and rising` once the meeting starts | top of the pane |
| Every guest with `$144.23 per hour` | Guests list |
| **Send an Email Instead** (opens a new message to the guests) | button |
| **Set hourly rates** (stored in your mailbox's roaming settings) | button |

It works both when you *read* an invitation (`AppointmentAttendeeCommandSurface`)
and while you *compose* one (`AppointmentOrganizerCommandSurface`), where it
recomputes as you add people or change the time.

## Files

| File | Purpose |
|---|---|
| `manifest.xml` | add-in manifest (ribbon buttons, task pane URL, permissions) |
| `src/taskpane.html`, `taskpane.js`, `taskpane.css` | the pane |
| `src/meeting-cost-core.js` | the shared engine, copied from `packages/core` (`node scripts/sync-core.js`) |
| `src/commands.html` | empty function file the manifest requires |
| `assets/icon-*.png` | ribbon and store icons |
| `serve.js` | zero-dependency HTTPS dev server |

## Run it locally

```bash
cd packages/outlook-addin
npm run certs      # once: creates and trusts a localhost certificate (office-addin-dev-certs)
npm start          # serves https://localhost:3000
```

Then sideload `manifest.xml`:

- **Outlook on the web / new Outlook for Windows:** open any calendar event,
  **... → Get Add-ins → My add-ins → Add a custom add-in → Add from file**,
  pick `manifest.xml`.
- **Classic Outlook for Windows / Mac:** same dialog via **Get Add-ins** on the
  ribbon, or run `npm run sideload` (uses `office-addin-debugging`).

Open a meeting and click **Meeting Cost** on the ribbon.

## Ship it

1. Host the `src/` and `assets/` folders on any HTTPS origin and replace
   `https://localhost:3000` in `manifest.xml` (also the `AppDomains` entry).
2. Deploy for the company through the Microsoft 365 admin center
   (**Settings → Integrated apps → Upload custom apps**), or submit to AppSource.
   Microsoft's guide: <https://learn.microsoft.com/office/dev/add-ins/publish/publish>.

`npm run validate` checks the manifest with `office-addin-manifest`.

## Privacy

Rates live in `Office.context.roamingSettings`, which Exchange stores with the
mailbox. The pane loads Office.js from Microsoft's CDN (a store requirement)
and nothing else; no data leaves the mailbox.

## Notes

- Requirement set Mailbox 1.1 is enough for read mode; compose-time updates
  (`RecipientsChanged`, `AppointmentTimeChanged`) need 1.7 and are skipped
  gracefully on older hosts.
- The newer unified JSON manifest (Teams-style) also works for Outlook if your
  tenant prefers it; the XML manifest here is the widest-compatible option.

# Meeting Cost for Google Calendar (Workspace add-on)

The official-channel version for Google: an Apps Script add-on that shows a
card in the Calendar side panel whenever you open or edit an event.

| What you see | Where |
|---|---|
| `$603.25 cost of meeting` (or the hourly burn rate while the event is still unsaved) | top of the card |
| Every guest with `$144.23 per hour` | Guests section |
| **Send an Email Instead** (opens a Gmail draft addressed to the guests) | button |
| **Set hourly rates** | footer and add-on menu |

It runs on the web and in the Calendar mobile apps (Workspace add-ons render
natively there), and admins can install it for an entire domain.

## Files

| File | Purpose |
|---|---|
| `appsscript.json` | manifest: scopes, triggers, advanced Calendar service |
| `Code.js` | triggers, cards, settings |
| `MeetingCostCore.js` | the shared engine, copied from `packages/core` (`node scripts/sync-core.js`) |
| `.clasp.json.example` | rename to `.clasp.json` and paste your script ID |

## Deploy for yourself (5 minutes)

1. Install [clasp](https://github.com/google/clasp) and log in:

   ```bash
   npm install -g @google/clasp
   clasp login
   ```

2. Create a standalone script and push the three files:

   ```bash
   cd packages/google-workspace-addon
   clasp create --type standalone --title "Meeting Cost"
   clasp push
   ```

   (`clasp create` writes `.clasp.json` for you; `.claspignore` keeps the README out of the project.)

3. Attach a Google Cloud project, which Workspace add-ons require:
   `clasp open`, then **Project settings → Google Cloud Platform project → Change project**
   and paste a project number. In that Cloud project enable the **Google Calendar API**
   and configure the OAuth consent screen (Internal is fine for a company domain).

4. Install a test deployment: in the Apps Script editor choose
   **Deploy → Test deployments → Install**, then reload Google Calendar.
   Open any event: the card appears in the right-hand panel.

## Deploy for the whole company

Publish through the Google Workspace Marketplace SDK in the same Cloud project
as a **private** (domain-restricted) listing, then a Workspace admin installs
it for everyone from Admin console → Apps → Google Workspace Marketplace apps.
Google's guide: <https://developers.google.com/workspace/marketplace/how-to-publish>.

## Scopes and privacy

| Scope | Why |
|---|---|
| `calendar.addons.execute` | run as a Calendar add-on |
| `calendar.addons.current.event.read` | read the open event's guest list |
| `calendar.events.readonly` | fetch the event's start, end and title (the trigger payload does not carry them) |

Rates are stored in the user's own script properties. The add-on makes no
network calls beyond the Calendar API; nothing is sent anywhere else.

## Known limits

- **No live ticker.** Add-on cards are rendered server-side by Google and
  cannot run a timer, so the card shows the cost as of the moment it was built
  and offers **Refresh**. If you want the number visibly rising during the
  meeting, use the browser extension in `packages/browser-extension`.
- While an event is still being created, Google supplies the guests but no
  time yet, so the card shows the combined hourly rate and says so.
- All-day events show the hourly burn rate only.

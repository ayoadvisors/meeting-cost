# Meeting Cost privacy policy

_Last updated: 16 September 2026. Applies to the Meeting Cost browser
extension for Chrome, Edge and Firefox, version 1.0.0 and later._

## The short version

Meeting Cost runs entirely inside your browser. It has no server, no account,
no analytics and no third-party code. It never sends anything anywhere. The
only thing it stores is the hourly-rate table you type in, and that stays on
the computer you typed it on.

## What the extension reads

When you open an event on **calendar.google.com** or on **Outlook on the web**
(outlook.office.com, outlook.office365.com, outlook.live.com,
outlook.cloud.microsoft), the extension reads, from the page already shown to
you:

- the event's title, start time and end time;
- the guests: display names, e-mail addresses where the page shows them, and
  their response (accepted, declined, tentative, awaiting), and whether they
  are the organizer, optional, or a room;
- on Google Calendar, your own account address from the page header, only so
  that you are left off the "To:" line of the e-mail draft.

It uses this to compute the meeting's cost and to draw the result into that
same page. It does not read any other page, any other event, your mail, or
anything outside the open event. Nothing it reads is stored or transmitted.

## What the extension stores

Only the settings you enter on its options page: default hourly rate,
currency, hours per year, overhead multiplier, refresh interval, overrun
grace, whether to count declined guests and rooms, and the rate list
(addresses, domains or names with an hourly rate or an annual salary).

These are saved in the browser's local extension storage, which keeps them on
this device only. They are **not** placed in Chrome, Edge or Firefox sync, so
they are never copied to Google's, Microsoft's or Mozilla's servers, and the
extension contains no code that could do so.

To delete everything the extension stored, click **Reset and delete saved
rates** on the options page, or uninstall the extension.

## What the extension sends

Nothing. The extension makes no network requests. Its manifest forbids
network connections from its own pages, and its content scripts contain no
network code.

When you click **Send an Email Instead**, the extension opens your own mail
provider's compose page (Gmail for Google Calendar, Outlook for Outlook on the
web) in a new tab with a draft subject, body and recipient list filled in.
That is an ordinary link opened in your browser; nothing is sent until you
press Send in your mail client, and you can edit or discard the draft.

## Permissions, and why

| Permission | Why |
|---|---|
| `storage` | to save your rate table on this device |
| access to `calendar.google.com` and the four Outlook on the web hosts | to read the open event and draw the cost row into it; the extension does not run on any other site |

## Third parties

None. No analytics, no crash reporting, no fonts or scripts loaded from the
network, no advertising, no data sold or shared.

## Children

The extension is a productivity tool for people who manage meetings and is
not directed at children.

## Changes

Changes to this policy are published in this repository with a new date at
the top; material changes are also noted in the release notes of the version
that introduces them.

## Contact

Questions and reports: open an issue at
<https://github.com/ayoadvisors/meeting-cost/issues>. Security reports:
see [SECURITY.md](SECURITY.md).

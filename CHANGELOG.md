# Changelog

## 1.0.0 (2026-09-16)

First store release: Chrome Web Store, Edge Add-ons and Firefox Add-ons
packages, built and checked by `npm run build`.

### Security and privacy (see `docs/security-review.md`)

- Rates live in `storage.local` only; the shipped code never touches sync
  storage. "Reset" deletes everything.
- E-mail regex bounded to RFC lengths: an 80 KB hostile description went
  from 3.9 s to 13 ms; text nodes over 10 000 characters are not scanned.
- Guest names such as `constructor` or `__proto__` no longer crash the
  Outlook extractor or drop guests from the total.
- Rate-list lines are whitespace-collapsed and capped at 300 characters;
  a line with a long run of spaces no longer hangs the options page.
- Malformed `mailto:` links no longer abort the scan.
- Strict content security policy for extension pages (`connect-src 'none'`
  among others); options styles moved to a stylesheet.
- E-mail draft title capped to one line of 200 characters; `mailto:`
  recipients encoded.
- Development servers bind to loopback only and never serve dot-files.

### Brand and site

- The icon, the two store promo tiles and the landing page come from a
  brand system designed in Claude Design (`store/design/`). The icon's
  vector (`icons/icon.svg`) is now the single source every PNG size is
  rendered from, with transparent backgrounds, so the 16 px toolbar icon is
  crisp.
- The landing page is published from `site/` by GitHub Pages at
  https://ayoadvisors.github.io/meeting-cost/, converted from the Design
  export into plain static HTML with a small vanilla script for the live
  hero counter (no runtime, no CDN scripts). The manifest's homepage points
  there.

### Interface

- The injected row and the options page were restyled: QuickBooks-style
  money green for the mark, the button and the per-guest rate chips, cool
  greys for secondary text, warm red only while the meter runs, tabular
  figures throughout. The options page is laid out like a macOS settings
  pane: grouped inset cards with hairline separators, switches, a styled
  select, a code-style rates editor, a preview card, full dark mode.
- The widget now measures the host popup's real background to pick light or
  dark colours instead of trusting the OS preference, since both calendars
  have their own theme switch.
- Per-guest annotations read "$144.23 per hour" in a chip instead of
  "($144.23 per hour)" in plain text.

### Fixes

- Google Calendar: the popup's re-render could take over the widget's `<div>`
  as a guest row, leaving the cost subtitle where a guest's name belonged and
  breaking that row. The widget and its annotations are now custom elements
  the renderer skips, and a taken-over node is treated as lost rather than
  kept. Found on a live 8-guest event and verified fixed there.
- Firefox: the options page loaded and saved nothing because the promise
  API ignores callbacks; it now uses the callback API in every browser.
- Firefox add-on id is a fixed GUID instead of a placeholder.
- Store packages are written by a built-in ZIP encoder with forward-slash
  paths (the previous archives had backslashes, which store unpackers
  reject), one manifest per browser, and reproducible timestamps.

### Tooling

- `npm run package`: Chrome/Edge and Firefox zips plus `SHA256SUMS.txt`.
- `npm run validate`: Chrome Web Store pre-flight for the sources and zips.
- `npm run test:dom`: the real content scripts against replica and hostile
  fixtures in a headless Chrome or Edge (28 checks).
- `npm run store:assets`: listing screenshots and promo tiles as 24-bit PNG.
- GitHub Actions CI, CodeQL, Dependabot.

### Documentation

- `PRIVACY.md`, `SECURITY.md`, `docs/security-review.md`,
  `CHROMEWEBSTORE.md` (the store listing file Google's extension guidance
  for coding agents asks for), `store/PUBLISHING.md`.
- `npm run verify:chrome`: installs the extension into a real Chrome through
  the Chrome DevTools MCP server and checks manifest, CSP, options page,
  storage, service worker and the extensions page; `.mcp.json` configures
  the same server for Claude Code.

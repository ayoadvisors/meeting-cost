# Changelog

## 1.0.0 (2026-09-16)

First store release: Chrome Web Store, Edge Add-ons and Firefox Add-ons
packages, built and checked by `npm run build`.

### Security and privacy (see `docs/security-review.md`)

- Rates now live in `storage.local` only; a copy left in sync storage by
  earlier builds is migrated once and removed. "Reset" deletes everything.
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

### Fixes

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
  `store/listing.md`, `store/PUBLISHING.md`.

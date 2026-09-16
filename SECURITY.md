# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/ayoadvisors/meeting-cost/security/advisories/new)
for this repository, rather than in a public issue. Include the browser and
version, the calendar (Google Calendar or Outlook on the web) and what an
attacker can do. You will get an acknowledgement within a few days and a fix
or a clear answer as soon as one exists.

## What is in scope

- The browser extension (`packages/browser-extension`): content scripts,
  options page, background script, manifest, and the store packages built
  from them.
- The shared engine (`packages/core`).
- The Google Workspace add-on and the Outlook add-in (`packages/*-addon`,
  `packages/outlook-addin`).
- The build and release tooling in `scripts/` and `.github/`.

Findings about the demo pages or the local development servers are welcome
too, but they are development tools and are treated as lower priority.

## Threat model in one paragraph

The extension's untrusted input is the calendar page: anyone who can send you
an invitation controls the title, description, guest names and links the
content script reads. The sensitive asset is the rate table (salary data),
which must stay on the device. The extension has no server and makes no
network requests; the only outbound action is opening your own mail
provider's compose page when you click a button. The full review, with
findings and fixes, is in [docs/security-review.md](docs/security-review.md).

## Supported versions

Only the latest published version receives fixes.

## What we do on our side

- No runtime dependencies at all, in the extension or the build.
- Every commit runs `npm run check`, the unit tests (including adversarial
  inputs), a headless-browser DOM self-test with hostile fixtures, the
  packager and the Chrome Web Store pre-flight validator; CodeQL scans the
  repository weekly and on every push.
- Store packages are built reproducibly (fixed timestamps) and published
  with SHA-256 checksums.

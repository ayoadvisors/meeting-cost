# Publishing Meeting Cost to the Chrome Web Store

The whole path from this repository to a public listing. The text for every
form field, the permission justifications and the privacy answers are in
[CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) at the repository root; the images
are in `assets/`.

## 0. One-time setup

1. A Google account for the developer dashboard:
   <https://chrome.google.com/webstore/devconsole>. Registration costs a
   one-time US$5 fee and requires 2-step verification on the account.
2. Fill in the dashboard's **Account** tab: publisher display name, contact
   e-mail (it must be verified; the store shows it on the listing), and
   accept the developer agreement. Use a role or team address if this will
   be maintained by more than one person.
3. Optional but recommended: publish as a **group publisher** tied to a
   Google Group, so the listing is not tied to one personal account.

## 1. Build and check the package

From the repository root, on any machine with Node 20+ and Chrome or Edge
installed:

```bash
npm run build
```

That runs, in order: core sync, icon generation, syntax/JSON/manifest checks,
32 unit tests, the headless DOM self-test (28 checks), the packager and the
store validator. The result is:

```
dist/meeting-cost-chrome-1.0.0.zip     upload this to Chrome (and Edge)
dist/meeting-cost-firefox-1.0.0.zip    upload this to Firefox Add-ons
dist/SHA256SUMS.txt
```

The validator must end with `no errors`. Re-run `npm run validate` alone at
any time.

Then check the package in a real Chrome, the way Google's extension guidance
for coding agents recommends (through the Chrome DevTools MCP server's
extension tools):

```bash
npm run verify:chrome
```

It installs the unpacked extension, confirms Chrome accepted the manifest and
its content security policy, opens the options page and round-trips a
setting through local storage, clicks the toolbar action so the service
worker opens the options page, reads `chrome://extensions` for an error
badge, then uninstalls. Add `-- --headed` to watch it. The same server is
configured for Claude Code in `.mcp.json` (Chrome 149+ can add
`--autoConnect` to drive your own running Chrome instead of a fresh one).

If the listing images need refreshing (after a UI change):

```bash
npm run store:assets
```

## 2. Create the item

1. Dashboard → **New item** → upload `dist/meeting-cost-chrome-1.0.0.zip`.
2. **Store listing** tab: paste the name, summary, description, category,
   language, upload the four screenshots and the two promo tiles, set the
   homepage and support URLs (all in `CHROMEWEBSTORE.md`).
3. **Privacy practices** tab: paste the single-purpose statement and the
   per-permission justifications, answer "No" to remote code, leave every
   data-collection box unticked, tick the three certifications, set the
   privacy policy URL to
   `https://github.com/ayoadvisors/meeting-cost/blob/main/PRIVACY.md`.
4. **Distribution** tab: public, all regions, free.
5. **Submit for review.** Choose *publish automatically after review* unless
   you want to time the launch. Review of a small content-script extension
   with narrow host permissions usually takes a few hours to a few days.

## 2b. The landing page

`site/` is the landing page, converted from the Claude Design export by
`node scripts/build-site.js` and published by the Pages workflow on every
push that touches it. Once the listing is live, set `STORE_URL` in
`scripts/build-site.js` to the store URL, rebuild, and the "Add to Chrome"
buttons point at the store instead of the GitHub release.

## 3. After it is live

- Tag the release so the store package and the source match:

  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

  CI builds the packages for the tag and attaches them, with checksums, to
  a GitHub release.
- Put the store URL in the README's install section.

## 4. Shipping an update

1. Bump `version` in `packages/browser-extension/manifest.json` (and
   `package.json` to match). The store requires a strictly higher version.
2. Add a `CHANGELOG.md` entry.
3. `npm run build`, upload the new Chrome zip on the item's **Package** tab,
   check whether anything on the listing or privacy tabs changed, submit.
4. Tag `vX.Y.Z` and push the tag.

## 5. The other stores (same package)

- **Microsoft Edge Add-ons** (<https://partner.microsoft.com/dashboard/microsoftedge>):
  free registration; upload the same Chrome zip; the listing fields mirror
  Chrome's.
- **Firefox Add-ons** (<https://addons.mozilla.org/developers/>): upload
  `dist/meeting-cost-firefox-1.0.0.zip`. The add-on id is fixed in the
  manifest (`browser_specific_settings.gecko.id`). AMO accepts the sources
  as-is (nothing is minified or generated).

## 6. What reviewers look for, and where this package stands

| Policy | Status |
|---|---|
| Single purpose | one feature: cost of the open event |
| Minimum permissions | `storage` plus five explicit calendar hosts; no `<all_urls>` |
| No remote code | none; CSP forbids it |
| User data disclosure | no data collected or transmitted; policy published |
| Privacy policy | `PRIVACY.md`, linked from the listing |
| Manifest limits | name 12/45, summary 120/132 characters, version `1.0.0` |
| Icons and images | 128 px icon, four 1280×800 screenshots, 440×280 and 1400×560 tiles, all 24-bit PNG |
| Package hygiene | forward-slash paths, manifest at root, only `manifest.json`, `icons/`, `src/` |
| Manifest V3 | yes, service worker background |

# ADR 0001: Accounts, subscriptions, team rate tables and contacts import

- Status: Proposed (2026-09-17)
- Deciders: Benjamin Brown
- Applies to: the browser extension first; the Workspace add-on and Outlook add-in follow the same API

## Context

Meeting Cost 1.0 has no server. Rates live in the browser's local storage, the
extension makes no network requests, and the store listing says so. That is
its strongest property and it is what the security review verified.

The next step is a paid product: people sign in, pay a subscription, import
contacts from Google and Outlook, and (the part a company will actually pay
for) share one rate table across a team so nobody types rates by hand. Every
one of those needs a backend, and every one of them touches salary data, the
most sensitive thing this product handles.

This record fixes the shape of that backend so the work can start without
re-deciding the basics, and so that the privacy story stays honest.

## Decisions

### D1. The paid tier is shared, synced rate tables; the free tier stays exactly what ships today

| Tier | What you get |
|---|---|
| Free | Everything in 1.0: local rates, live counter, e-mail draft. No account. |
| Pro (per user) | Rate table synced across your devices, contacts import from Google and Microsoft. |
| Team (per seat) | One rate table an admin maintains for the whole organisation, totals-only mode for members, domain-wide install. |

The free tier is never degraded. It is the funnel and the proof that the
product is harmless.

### D2. Per-guest rates are confidential; team members see totals and bands

Annotating every guest with "$144.23 per hour" reveals individual pay. In
Team mode the widget shows the meeting total and the combined rate; the
per-guest annotation shows a **band label** the admin chose ("Senior",
"Contractor") or nothing. Exact figures are visible only to the admins who
entered them. The free and Pro tiers keep per-guest figures because the rates
are the user's own.

### D3. No passwords of our own: hosted identity, Google and Microsoft sign-in, magic links

We never store or verify a password. Sign-in options are "Continue with
Google", "Continue with Microsoft" (the two calendars the product already
lives in) and an e-mail magic link. A hosted identity provider issues the
sessions; the shortlist is Clerk, Supabase Auth or Auth0, chosen on price at
signing time; the API only ever sees a signed JWT and never depends on which
one it was.

The extension never sees a credential. Sign-in happens on our website; the
extension receives a short-lived access token and a refresh token through
`chrome.identity.launchWebAuthFlow`, keeps them in `chrome.storage.local`
(never sync), and refreshes silently.

### D4. Stripe for billing; entitlements are a server-side flag with an offline grace period

Stripe Checkout for sign-up, Stripe Customer Portal for cancellations,
invoices and cards, Stripe webhooks to set `subscriptions.status`. The
extension asks `GET /v1/me` for its entitlements at most once a day and keeps
the last answer for 7 days, so a flaky network or a Stripe incident never
blanks the widget. The Chrome Web Store has no payment system; nothing else
needs consideration.

### D5. Rate tables are end-to-end encrypted; the server stores blobs it cannot read

This is the decision that keeps the current promise almost intact after
adding a server. The extension encrypts the rate table with AES-256-GCM
(WebCrypto) before upload. The server stores ciphertext plus a version
number and never holds a key.

- **Pro (personal):** the extension generates a random 256-bit vault key on
  first sync, wraps it with a key derived from a recovery phrase it shows the
  user once (PBKDF2, 600 000 iterations), and stores the wrapped key on the
  server. A new device asks for the phrase. Lose the phrase, lose the table;
  the user re-enters rates. That trade is right for salary data.
- **Team:** each member's extension generates a P-256 key pair; the public
  key is registered on the server. The admin's extension generates the team
  key and wraps it to every member's public key (ECDH + AES-KW). Adding a
  member wraps the key once more; removing one rotates the team key and
  re-wraps to the remaining members. The admin's device is the only place
  the plaintext table is ever assembled; members decrypt the blob locally
  and see only what D2 allows because the admin uploads two blobs: the
  full table (wrapped to admins) and the bands-only table (wrapped to all).

Consequence: support cannot recover a lost table, and features that need the
server to read rates (server-side reports, e-mailed digests) are off the
table unless the user opts into a separately encrypted export.

### D6. Contacts import runs on the server with the authorization-code flow

Google People API (`contacts.readonly`) and Microsoft Graph (`Contacts.Read`)
both require OAuth consent. The redirect and token exchange happen on our
server so client secrets never ship in the extension. The server fetches the
list, returns name, e-mail and domain to the extension, and **discards the
provider tokens** unless the user turns on periodic refresh. The user picks
which contacts to keep; the extension merges them into the (encrypted) rate
table as `email = <default rate>` lines to be edited. Google classes the
contacts scope as sensitive, so the OAuth app goes through Google's
verification before launch (a form and a review, no paid assessment at this
scope).

### D7. One small API on managed infrastructure

TypeScript on Cloudflare Workers (Hono), Postgres on Neon, Stripe, the
identity provider from D3, all with generous free tiers. No servers to
patch. Regions: US and EU deployments of the Worker with the database
pinned per organisation's chosen region, from day one, because the first
Team customer in Europe will ask.

## Data model

```
users            id, idp_subject, email, created_at, deleted_at
organizations    id, name, region, created_at
memberships      org_id, user_id, role ('admin' | 'member'), public_key (P-256 JWK), created_at
subscriptions    id, owner_type ('user' | 'org'), owner_id, stripe_customer_id,
                 stripe_subscription_id, plan ('pro' | 'team'), seats, status, current_period_end
vaults           id, owner_type, owner_id, kind ('personal' | 'team_full' | 'team_bands'),
                 ciphertext (bytea), nonce, version, updated_at
vault_keys       vault_id, user_id, wrapped_key, wrapping ('pbkdf2' | 'ecdh'), updated_at
contact_imports  id, user_id, provider ('google' | 'microsoft'), imported_at, count
audit_log        id, actor_user_id, org_id, action, target, at
```

Nothing in this model contains a rate in the clear. `contact_imports` keeps a
count and a timestamp, not the contacts; those go into the user's vault.

## API contract (v1)

All endpoints: `Authorization: Bearer <access token>`, JSON, `Idempotency-Key`
on writes. Errors are `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/me` | user, memberships, entitlements `{ plan, features[], validUntil }` |
| `DELETE` | `/v1/me` | delete the account and every vault and key it owns (D8) |
| `GET` | `/v1/vaults/:id` | ciphertext, nonce, version (ETag) |
| `PUT` | `/v1/vaults/:id` | upload ciphertext; `If-Match: <version>` prevents lost updates |
| `PUT` | `/v1/vaults/:id/keys/:userId` | store a wrapped key for a member (admins only for team vaults) |
| `POST` | `/v1/orgs` | create an organisation (creates the team vaults empty) |
| `POST` | `/v1/orgs/:id/invites` | invite by e-mail; the invitee's public key is registered on accept |
| `POST` | `/v1/orgs/:id/members/:userId/remove` | remove and trigger key rotation on the admin's next sync |
| `GET` | `/v1/contacts/connect/:provider` | start OAuth (returns the consent URL) |
| `GET` | `/v1/contacts/callback/:provider` | OAuth redirect target; fetches, returns, discards tokens |
| `POST` | `/v1/billing/checkout` | Stripe Checkout session for `pro` or `team` (+ seats) |
| `POST` | `/v1/billing/portal` | Stripe Customer Portal link |
| `POST` | `/v1/billing/webhook` | Stripe events → `subscriptions` |

Rate limits per user: 60 requests a minute; vault uploads 30 a minute. The
extension syncs on options-page save and on a daily timer, never on every
popup.

## Sign-in sequence (extension)

1. Options page → "Sign in" → `chrome.identity.launchWebAuthFlow` opens
   `https://app.<domain>/extension/login?state=<nonce>`.
2. The website runs the identity provider's flow (Google, Microsoft or magic
   link).
3. The website redirects to `https://<extension-id>.chromiumapp.org/cb#access=...&refresh=...&state=<nonce>`.
4. The extension checks the nonce, stores both tokens in `chrome.storage.local`,
   calls `GET /v1/me`, and shows the plan.
5. Refresh: the extension exchanges the refresh token at the identity
   provider's endpoint when the access token has under five minutes left.
   Sign-out clears storage and revokes the refresh token.

## What changes in the extension

- Manifest: `identity` permission; `host_permissions` for `https://api.<domain>/*`;
  the extension-pages CSP becomes `connect-src https://api.<domain>` and
  otherwise stays as strict as today. The content scripts still make no
  network requests; only the options page and a small sync module in the
  service worker talk to the API.
- Options page: sign-in state, plan, "Sync now", team picker, contacts
  import, recovery phrase display, sign-out, delete account.
- Storage: the decrypted table stays in `chrome.storage.local` exactly as
  now, so the widget works offline and the free tier is unchanged.
- Privacy policy and store disclosure: from "collects nothing" to "collects
  your e-mail address and billing status; contacts if you import them; rate
  tables as ciphertext we cannot read". Every claim in `PRIVACY.md`,
  `CHROMEWEBSTORE.md` and `docs/security-review.md` is re-checked before the
  submission that introduces accounts.

### D8. Deletion is a button and it is complete

`DELETE /v1/me` removes the user, their vaults, wrapped keys, contact import
records and Stripe customer (after the subscription is cancelled), and writes
one audit row. GDPR and CCPA apply the moment accounts exist; a 30-day
export-then-delete on request is not enough, the button is.

## Consequences

- Positive: a real business model; teams get value without anyone typing
  salaries; the server never sees a rate, so a breach exposes e-mails and
  billing status, not pay.
- Negative: a support burden (lost recovery phrases, key rotation), two OAuth
  app reviews (Google, Microsoft), Stripe and identity-provider fees, and the
  store review of a permission and disclosure change.
- The free tier's claim "no network requests" stays true for the content
  scripts and for signed-out users; it is no longer true for the extension
  as a whole, and the copy must say so plainly.

## Phasing

1. **Ship 1.0 as it is.** Installs, reviews, no accounts.
2. **Pro:** accounts (D3), Stripe (D4), encrypted personal sync (D5 personal),
   deletion (D8). One paid feature, to learn whether anyone pays.
3. **Team:** organisations, invites, wrapped team keys, bands-only mode (D2).
4. **Contacts import** (D6), last, because it is the only piece with an
   external review gate.
5. The Workspace add-on and Outlook add-in adopt the same API afterwards;
   Apps Script and Office.js can both do AES-GCM through their runtimes, so
   D5 holds there too.

## Running costs at the start

Cloudflare Workers, Neon, the identity provider and Stripe all have free or
near-free tiers below roughly a thousand users; the first real costs are the
identity provider's monthly-active-user pricing and Stripe's percentage, both
proportional to revenue.

## What is needed before code

Accounts and registrations only the owner can create:

1. A domain for the website and API (for example `meetingcost.app`).
2. A Stripe account, with the two products (Pro, Team seat) created.
3. An identity provider account (Clerk, Supabase or Auth0) with Google and
   Microsoft sign-in configured.
4. A Google Cloud project with an OAuth consent screen (scopes: sign-in,
   `contacts.readonly`) submitted for verification.
5. A Microsoft Entra app registration (scopes: sign-in, `Contacts.Read`).
6. A Cloudflare account and a Neon project.
7. A decision on the two prices.

With those in hand the build order is: API skeleton and `GET /v1/me` → Stripe
→ vault sync with the recovery phrase → extension sign-in UI → store
resubmission → team keys → contacts.

## Alternatives considered

- **Chrome sync storage for cross-device rates:** free, no server, but it
  puts salaries on Google's servers in the clear and offers nothing for
  teams. Rejected in the security review already.
- **Own username/password system:** more code, a breach target, and worse
  for users who already live in Google or Microsoft. Rejected.
- **Server-readable rate tables with encryption at rest:** simpler support
  and enables server-side reports, but the company would then hold every
  customer's salaries; the product's whole pitch is that it does not.
  Rejected for rate tables; acceptable for e-mails and billing.
- **Licence keys instead of accounts:** cheapest possible paid tier, but no
  sync and no teams, which are the reasons to pay. Rejected.

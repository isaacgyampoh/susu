# Security — final audit

**1 September 2026.** Everything below was run against production.

## Verdict

| | |
|---|---|
| Privileged anonymous RPC | **none** — see below |
| Plaintext credentials in the repository | none |
| Predictable passcodes | none (`crypto.getRandomValues`, rejection sampling) |
| Published active secrets | **YES — the `service_role` key. Not rotated.** |
| Default active admin password | **YES — but the console is now gated on it** |
| IDOR | none found; 8/8 database checks pass, enforced by a test |
| Duplicate payment settlement | none — idempotent under lock, proven with 10 replays |
| Payment reference uniqueness bug | fixed in v26; `transactions.reference` is UNIQUE |
| Global multi-membership credit | removed — credit is per membership |
| Client-controlled financial state | none — no endpoint reads an amount or an id from the body |
| Runtime schema guessing | removed, and enforced repo-wide by a test |

## The published service_role key is still live

Two Supabase keys were committed on 12 July 2026 and remain in git history
(the repository has a GitHub remote):

```
role=service_role   issued 2026-07-12   expires 2036-07-12
role=anon           issued 2026-07-12   expires 2036-07-12   (anon is public by design)
```

I tested the service_role key against production this phase. **It returned
rows.** It has not been rotated. It bypasses row-level security entirely:
unrestricted read and write on members, Ghana Card numbers, passcode hashes,
contributions, payments, payouts and the audit log.

Rotate it: Supabase → Project Settings → API → *Reset service_role key*. Edge
functions pick the new one up automatically. Full steps in `ROTATION.md`.

Rotation stops future use; it says nothing about past use. The Supabase API logs
for the exposure window are worth reading for service-role requests from IPs
that are neither Vercel nor Supabase.

## RPC privileges (§28)

Five functions are executable by `anon`/`authenticated`:

```
fn_group_member_count  fn_require_cashout_when_open  fn_revoke_on_suspend
fn_set_member_id       fn_updated_at
```

All five return `trigger`, none is `SECURITY DEFINER`, and PostgreSQL refuses to
call them (`trigger functions can only be called as triggers` — verified).
PostgREST does not expose them (404, verified). **No privileged financial
function is reachable by anon.**

Every function added this phase — `settle_registration_fee`,
`get_registration_public`, `get_registration_queue`,
`reverse_contribution_payment`, `get_reconciliation_queue(int,int)` — is
`REVOKE ALL … FROM PUBLIC, anon, authenticated` and granted only to
`service_role`.

## SECURITY DEFINER (§29)

32 of 32 have a pinned `search_path`, at the minimum each needs:

```
public, extensions, pg_temp   25 functions   (need pgcrypto / uuid-ossp)
public, pg_temp                7 functions
```

`extensions` is not decoration: `pgcrypto` and `uuid-ossp` live there, so the
obvious `public, pg_temp` would break every passcode check on the platform.

## Authorization (§26)

Every one of the 49 repository functions has an explicit guard. The five public
ones are public on purpose:

```
auth-admin-login, auth-member-login   login
groups-public                          the join page's group list
kyc-submit                             the public application form
nalo-webhook                           the provider callback (payload treated as a rumour)
registration-payment                   token-authenticated
```

51 of 52 deployed functions have `verify_jwt = false`. That is correct for this
architecture: the platform issues its own JWTs, verified in `_shared/jwt.ts`.
Supabase's own check would demand a Supabase-issued token no client here holds.
The real boundary is `requireAdmin` / `requireMember`, and it is now enforced by
a test.

## IDOR (§27)

Eight database checks, all passing:

- A's statement scoped to B's membership returns none of B's data
- every membership in A's statement and portal belongs to A
- A's statement never names B
- no allocation, credit entry or contribution crosses members
- no two applications share a payment token

At the HTTP boundary, tested live: applicant A's token resolves only to A's
application; an expired token returns 410; an unknown, malformed and absent
token all return an **identical** 404, so the endpoint is not an oracle for
probing which links are live.

`src/architecture.test.ts` now fails the build if a member endpoint reads a
financial table without binding it to the caller, or takes `member_id` from the
request body.

## Two live settlement engines, removed

`moolre-webhook` and `payments-webhook` were ACTIVE, `verify_jwt = false`, and
**absent from the repository**. Both wrote `contributions.status = 'paid'`
directly. `payments-webhook` settled on a `charge.success` in the request body
with no provider call — finding F-04, still live on a different URL.

Neither had ever settled anything. Both now return 410, verified live with a
success-shaped payload: nothing recorded.

The reason they survived Phase 05's audit is worth keeping: that audit read the
repository, and these had no source in it. Both now live in git.

## Failure modes, tested live

```
unauthenticated admin endpoint       401
forged admin bearer token            401  (rejected at the gateway)
unauthenticated member endpoint      401
webhook: garbage payload             200, nothing recorded
webhook: unknown order id            200, nothing recorded
webhook: claims success, no order id 200, nothing recorded
registration: unknown token          404
registration: unknown action         404
expired registration link            410
```

After all of it: **0 transactions, 0 allocations, 0 settlements created.**

## Secret scan (§30)

```
working tree            credential material found: NO
git history             2 Supabase keys (above); no PAT, no sb_secret, no private key
```

The one working-tree hit was `${{ secrets.SUPABASE_JWT_SECRET }}` in a GitHub
Actions workflow — a reference, not a value.

## Rotation status (§32)

```
PAT                     NOT VERIFIED
service_role            NOT ROTATED — proven live this phase
project JWT secret      NOT VERIFIED
application JWT_SECRET  ROTATED (Phase 05, 96 characters)
default admin password  STILL ACTIVE — console now gated
```

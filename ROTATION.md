# Credential rotation — required before anything else ships

Three credentials for this platform have been published in this git repository.
All three must be treated as compromised. Removing them from the working tree
does **not** revoke them: they remain in git history, and the repository has a
remote at `github.com/isaacgyampoh/susu`.

The code changes in Phase 00 close the doors these credentials open. They do
not, and cannot, revoke the credentials themselves. Only you can do that.

---

## 1. Supabase `service_role` key — CRITICAL

**What was exposed.** A working key, committed at `supabase/.env.example:7`,
present since the "V2 — Full business rules update" commit, roughly 120 commits
ago.

It decodes to:

```
{ "iss": "supabase", "ref": "qaelfwtbaehdwhnxkpid",
  "role": "service_role", "iat": 1783895613, "exp": 2099471613 }
```

Issued 12 July 2026. **Valid until 12 July 2036.**

**What it grants.** `service_role` bypasses row-level security entirely. Anyone
holding this key has unrestricted read and write on every table: members, Ghana
Card numbers, passcode hashes, contributions, payments, payouts, audit logs.
No password, no session, no rate limit stands in the way.

**Rotate it:**

1. Supabase Dashboard → Project Settings → API → **Reset service_role key** (or
   *Rotate*, depending on dashboard version).
2. Edge Functions pick the new key up automatically — `SUPABASE_SERVICE_ROLE_KEY`
   is injected by the platform, not set by hand. Redeploy to be certain:
   `supabase functions deploy`
3. Anywhere you have pasted the old key manually — a local `.env`, a CI secret,
   a Postman collection, a colleague's machine — update or delete it.

**Then check what was done with it.** Rotation stops future use; it says nothing
about past use. In Supabase → Logs, review API request logs for the period the
key was exposed, looking for requests using the service role from IPs that are
not Vercel or Supabase. Also compare `members` and `contributions` row counts
against your own records.

---

## 2. `JWT_SECRET` — CRITICAL

**What was exposed.** `README.md:54` published it as
`a45ff29522fcf5f5347f36b4ca5105ad`.

**What it grants.** This secret signs every admin and member session token.
Anyone holding it forges an admin session directly — no password needed, no
login attempt recorded, nothing to rate-limit.

**Rotate it:**

1. Generate: `openssl rand -hex 32`
2. Supabase → Edge Functions → Manage secrets → set `JWT_SECRET`.
3. `supabase functions deploy`

**Every existing session is invalidated by this**, which is the point. Admins and
members will all sign in again. Tell your admins before you do it, not after.

The code now refuses to run with a missing, short, or previously-published
secret (`_shared/jwt.ts`), so a rotation that fails halfway fails loudly rather
than falling back to a forgeable default.

---

## 3. Seed admin password — HIGH

**What was exposed.** `Admin@1234`, in `20240101000000_initial_schema.sql`, in
`20240106000000_v6_force_password_change.sql`, and until now in `README.md`.

**Rotate it:** sign in and use `/admin/password`, or:

```sql
UPDATE admin_users
SET password_hash        = crypt('<long random password>', gen_salt('bf')),
    must_change_password = false,
    token_version        = COALESCE(token_version, 0) + 1
WHERE email = 'admin@susuplatform.com';
```

Then confirm no account is still on the default:

```sql
SELECT email, must_change_password
FROM admin_users
WHERE password_hash = crypt('Admin@1234', password_hash);
-- must return zero rows
```

---

## 4. Purge the history, or accept it

Rotation is what actually protects you. Rewriting history is optional and
disruptive, and it does not help if the repository was ever cloned or is public.

If you want it gone anyway — after rotating, never before:

```bash
# git-filter-repo is safer and far faster than filter-branch
pip install git-filter-repo
git filter-repo --path supabase/.env.example --invert-paths --force
git push --force --all
```

Everyone with a clone must re-clone. Do not do this while other work is in
flight.

---

## Verification checklist

- [ ] `service_role` key rotated in the Supabase dashboard
- [ ] Old `service_role` key confirmed rejected (a request with it returns 401)
- [ ] `JWT_SECRET` rotated and functions redeployed
- [ ] All admins signed back in successfully after the rotation
- [ ] Seed admin password changed; the query above returns zero rows
- [ ] `CRON_SECRET` rotated too, if it was ever committed or shared
- [ ] Supabase API logs reviewed for unexpected service-role use
- [ ] `grep -rn "eyJ" --include="*.example" --include="*.md" .` returns nothing

# Crave Website v2

Student / Vendor / Management web app for the SRMIST Crave campus food-ordering platform.

- **Frontend (repo root):** Vite + React 19 + TypeScript. One workspace per role, each its own lazy-loaded chunk.
- **`supabase/`:** Postgres schema + RLS + RPCs (migrations `001`–`021`), Razorpay Edge Functions, SQL/Edge tests.
- **Source of truth:** the database. The browser only ever *requests* things; prices, stock, slot capacity, order
  transitions, payment state and roles are decided and enforced server-side.

## Quickstart

```bash
pnpm install
cp .env.example .env      # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public values only)
pnpm dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | production build (`dist/`) |
| `pnpm test` | unit tests (pricing, IST slot rules, error mapping, Razorpay signature/webhook logic) |
| `pnpm test:db` | 150+ security/business-rule checks on an in-process Postgres (PGlite) running migrations 001→021 |
| `pnpm test:all` | all of the above |
| `node supabase/tests/pglite/t_fresh_install.mjs` | proves every migration applies, in order, to an empty database |
| `node scripts/redteam-live.mjs` | live attack regression (needs `CRAVE_*` env vars, see file header). Everything it tries must be *blocked*. |

## Identity and roles

`auth.uid()` → `profiles.id` → `profiles.role` is the only source of identity. The role is never read from
localStorage, the URL, a query string or the login "door" (the door is only a UX hint that is checked against the
profile). A missing profile, a disabled account or an unknown role produces an explicit blocked screen; there is no
fallback profile or default role. `PENDING_VENDOR` accounts see a waiting screen until management approves them.

Roles are protected in the database: `profiles` has a trigger that rejects any non-admin change to `role`,
`is_active` or `email`, and an admin cannot change their own role.

## Payments (Razorpay)

```
student  → place_order(ONLINE)               DB prices the order, holds stock + slot (15 min)
         → create-razorpay-order             Edge Function: amount comes from payments.amount, never from the client
         → Razorpay Checkout (browser)
         → verify-razorpay-payment           Edge Function: HMAC verified with the key secret, bound to the caller's own order
webhook  → razorpay-webhook                  HMAC over the raw body; idempotent; may arrive before or after the browser call
```

All money state changes go through one SQL function, `crave_payment_apply()`: idempotent, amount-checked, never
downgrades a paid order, and callable only by the service role. Unpaid online orders expire after 15 minutes and give
stock and slot back (`crave_expire_unpaid_orders`, scheduled with pg_cron every 5 minutes).
Orders that were paid but cancelled/rejected/expired show up in **Management → Payments → refunds needed**, and
the `refund-razorpay-payment` function refunds them through Razorpay.

### Server secrets (never in `.env`, never in a `VITE_*` variable)

```bash
supabase secrets set \
  RAZORPAY_KEY_ID=rzp_... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=... \
  --project-ref <ref>
supabase functions deploy create-razorpay-order verify-razorpay-payment razorpay-webhook refund-razorpay-payment \
  --project-ref <ref> --use-api          # supabase/config.toml sets verify_jwt=false for the webhook only
```

In the Razorpay dashboard add a webhook to `https://<ref>.supabase.co/functions/v1/razorpay-webhook` with the same
secret and the events `payment.captured`, `payment.failed`, `payment.authorized`, `order.paid`.

## Database

Apply `supabase/migrations/*.sql` in order (`supabase db push`, or the SQL editor). `018`–`021` are idempotent and
drop/recreate the policies they own, because the live project was provisioned with a different subset of the earlier
migrations than this repo contains. Key points:

- Supabase grants `EXECUTE` on every new `public` function to `anon` and `authenticated`. A `REVOKE … FROM PUBLIC`
  does **not** remove that; migrations now revoke explicitly (`crave_lock_function`).
- `orders`, `order_items`, `payments`, `pickup_tokens` are read-only for clients. Status changes only follow legal
  transitions (`crave_guard_order_update`), money columns are server-owned, vendors only reach their own outlets.
- Pickup slots and stock are decremented atomically inside `place_order` (row locks; same food on two cart lines
  cannot oversell). Slot rules use `Asia/Kolkata`.
- Reviews: food reviews use the existing `reviews` / `review_replies` tables and RPCs; outlet reviews and replies are
  new (`outlet_reviews`, `outlet_review_replies`). Hidden reviews are excluded from every student/vendor-facing
  function; only management can hide/restore.

## Deploy (Vercel)

Framework Vite · build `pnpm build` · output `dist` · env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
`vercel.json` adds the SPA rewrite and security headers (CSP allows Supabase + Razorpay only).

## Known gaps

See `AUDIT_REPORT.md` → "Remaining blockers / not implemented".

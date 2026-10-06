# CRAVE WEBSITE AUDIT REPORT

Scope: `PhantomBeast2090/crave_websitev2` (website) audited against the live Supabase project
(`btdmhveaqssuuhyoyanz`) with the three provided test accounts, using `1HPdhruv/Gag` (Android) as business-logic reference.
"Reproduced" = I triggered it against the live project. "Traced" = found by reading source/policies but not exploited.

## 1. Architecture

| | Before | After |
|---|---|---|
| Frontend | Vite + React 19 single `App.tsx`; vendor and management dashboards were **hard-coded demo numbers**, fake QR, seeded demo catalogue used as fallback | Vite + React 19 + TS, one lazily-loaded workspace per role, no demo data in any production path |
| Backend | Supabase Postgres + RLS, 17 migrations (live DB had only a subset applied) | Migrations `001–022`; every rule enforced in the database; RPCs for every state change |
| Auth | Supabase Auth; role read with `fetchUserRole`, which **fell back to STUDENT** on a missing profile/error | `auth.uid() → profiles.id → role`; missing/disabled/unknown → explicit blocked screen; `PENDING_VENDOR` waiting screen |
| Payments | Only pay-at-counter in the UI. Razorpay Edge Functions existed but could never complete (see §4) | Real Razorpay flow: server-priced order → server-created Razorpay order → HMAC-verified on the server + webhook → idempotent DB transition |

Android repo (`d38c776`): a skeleton (`task.md` mostly unchecked, `USE_MOCK` repositories, 2 migrations, no Razorpay, no reviews). Its
order-status enum, slot statuses and 5 % tax match what the website/DB use, so there were no business-rule conflicts to document.
The live DB contains a review system (`reviews`, `review_replies`, `get_food_reviews`, …) that is **not** in either repo; the website reuses it.

## 2. Critical bugs found

| # | Bug | Sev | How found | Root cause | Fix | Result |
|---|---|---|---|---|---|---|
| B1 | Razorpay could never complete: all 9 online orders stuck `PLACED/PENDING` with `razorpay_order_id = NULL` | Critical | Reproduced (live data) | `create-razorpay-order` wrote `payments` with the *user's* client; no UPDATE policy ⇒ 0 rows, no error. Webhook secret unset and function deployed with `verify_jwt=true` ⇒ unreachable | Service-role functions + `crave_payment_*` SQL; webhook `verify_jwt=false` | Live: Razorpay order created for the DB amount; reused on retry |
| B2 | All 1,397 menu items flagged **vegetarian**, incl. ~400 chicken/egg/mutton | High (food labelling) | Reproduced (veg filter returned 0 non-veg) | Column defaulted to `true`; migration 015 only fixed `NULL`s | `022_fix_food_veg_flags.sql` (veg→non-veg only; 407 rows; ids snapshotted) | Live: 990 veg / 407 non-veg |
| B3 | Catalogue silently truncated at 1,000 of 1,397 items | High | Reproduced (`content-range`) | Unpaginated `select *` hit PostgREST's row cap | Server-side filter / sort / pagination (24 per page) | Live: "1397 items found" |
| B4 | Students could not see their own pickup token (QR was a fake pattern) | High | Reproduced (0 rows) | RLS gave tokens to vendors/admin only | Student SELECT policy + real QR | Live: scannable QR, scan completes order |
| B5 | Abandoned online orders held stock + slots forever; double-click created duplicate orders | High | Reproduced (9 stale orders) / traced | No expiry; cart not locked or consumed for ONLINE | 15-min expiry (pg_cron + lazy), `PAYMENT_IN_PROGRESS` guard, cart row lock | Live: 6 parallel submits → 1 order, exact stock |
| B6 | Same food on two cart lines could oversell | High | Traced | Stock decrement was one `UPDATE … FROM cart_items` (applies once per row) | Atomic per-line `UPDATE … WHERE qty >= n` | PGlite regression |
| B7 | Required options could be skipped / foreign options silently dropped; kitchen notes never reached the vendor | Medium | Traced | `place_order` ignored them | Validation + `order_items.special_instructions` | PGlite regression |
| B8 | "Today" computed with UTC (`toISOString`) | Medium | Traced | UTC vs Asia/Kolkata | IST helpers (unit-tested incl. 18:30 UTC rollover) | Unit tests |
| B9 | Vendor / management dashboards and analytics were fake | High | Read source | Hard-coded demo components | Real dashboards (§7) | Live E2E |
| B10 | `fetchUserRole` fell back to STUDENT; sign-up created no profile | High | Traced | Silent fallback | Strict `loadProfile`, blocked states | Browser tests |
| B11 | Fresh `db push` fails: 003 (NEW/OLD in a policy), 009 (`users` table), 013 (enum value used in same txn) | Medium | Reproduced locally | Invalid SQL | Patched; whole chain applies on an empty DB | `t_fresh_install.mjs` |

## 3. Security vulnerabilities

| # | Vulnerability | Sev | Reproduced | Fix | Retest |
|---|---|---|---|---|---|
| V1 | **Any user can set their own `profiles.role`** (student → VENDOR succeeded; reverted immediately; ADMIN inferred, not exercised) | Critical | Yes, live | `crave_guard_profile_update` trigger; admin cannot change own role | `redteam-live` PASS |
| V2 | **`mark_payment_verified()` executable by `anon`** (HTTP 204) ⇒ anyone can mark any order PAID. Supabase's default privileges grant EXECUTE to `anon`/`authenticated`; `REVOKE … FROM PUBLIC` never removed it | Critical | Yes, live (no-op UUID) | `crave_lock_function` revokes explicitly; service-role only | `permission denied` for anon, student, vendor, admin |
| V3 | Student can set own order `payment_status=PAID`, `total`, etc. | High | Yes, live (reverted) | `crave_guard_order_update` (money columns server-owned, legal transitions only) | PASS |
| V4 | Any vendor reads **every** profile (names/emails incl. admin) | High | Yes, live | Vendor sees only customers of their own outlets | PASS |
| V5 | Students can INSERT `order_items` / customizations on own orders | Medium | Traced from `pg_policies` | Orders/items/payments/tokens read-only for clients | PASS |
| V6 | `get_food_reviews` (reviewer names + ids), `data_quality_report`, `generate_pickup_slots` callable by `anon`/students | Medium | Yes (anon 200/204) | Locked to signed-in / service role | PASS |
| V7 | Vendor could forge outlet/food ratings, transfer an outlet, rewrite order totals/tokens | Medium | Traced (`FOR ALL` policies) | Guard triggers; vendor token update limited to `is_used` | PASS |
| V8 | `search_food` leaked other vendors' unavailable items to every vendor | Low | Traced | Scoped to own outlets | PGlite |
| V9 | `.env.example` contains the real project URL + anon key (public by design) | Info | — | Left as you had it; secrets documented as server-only | — |

No service-role key, Razorpay secret or private token exists in `src/`, `public/` or the built bundle (grep-verified). Cross-vendor IDOR could
not be attacked live: the project has a single vendor owning all 9 outlets (covered by the Postgres suite with two vendors).

## 4. Payment audit
- **Order creation:** `place_order(ONLINE)` prices from `food_items` + options, 5 % tax, holds stock + slot for 15 min; the client price is ignored (live: client sent ₹1/unit, server charged ₹140).
- **Razorpay order:** Edge Function `create-razorpay-order`; amount comes from `payments.amount`; compare-and-set so retries reuse the same Razorpay order (live: no second order).
- **Signature verification:** server-side HMAC-SHA256 with the key secret, constant-time compare, strict id/format validation, bound to the caller's own order (`verify-razorpay-payment`). A bad signature writes nothing (cannot be used to fail someone's order). Live: forged signature → 400.
- **Webhook:** HMAC over the raw body, `verify_jwt=false`, event journal, idempotent. Live (signed test events): wrong amount refused (500/retry), forged signature 401, `failed` keeps order retryable, `captured` → PAID, duplicate delivery no-op, late `failed` cannot downgrade, second capture audited as `DUPLICATE_PAYMENT`.
- **Cancel / fail UX:** "Payment cancelled — No amount was charged." (verified live in the real Razorpay widget); "Payment failed — We couldn't complete your payment. Please try again."; success whose verification call fails → "confirming" state that polls instead of claiming failure. No raw gateway JSON is ever shown.
- **Idempotency:** DB-enforced (`PAYMENT_IN_PROGRESS`, cart row lock, unique Razorpay ids), not button-disabling.
- **Late/expired payments:** a paid-then-expired/cancelled order is **not** silently fulfilled; it appears in Management → Payments as "refund needed" with a refund action (`refund-razorpay-payment`).
- **Not machine-verified:** the browser success path (card → bank page → success callback → verify). Razorpay's mock bank page does not load under automation here. See §13.

## 5. Review audit
- **Food reviews (existing tables/RPCs):** purchase + `PICKED_UP` + self-only enforced by the live triggers (verified); I added length ≤ 1000, rating 1–5, visibility lock, reply ownership/visibility triggers.
- **Outlet reviews (new):** one per order, only after `PICKED_UP`, ownership chain `review → outlet → outlets.vendor_id`, edit/delete own, vendor reply/edit/delete, ratings recomputed from **visible** reviews.
- **Moderation:** management search/filter/hide/restore for both kinds. Live: hidden reviews disappear from student RPC, vendor RPC and direct table reads, and from the aggregate ratings; restore brings them back.
- **Verified live in the browser:** student posts both review types → vendor replies to both → student sees both replies → student edits → management hides/restores.

## 6. Role security
| Role | Result | Evidence |
|---|---|---|
| Student | **PASS** | cannot self-promote, tamper orders/payments/catalogue, reach `/vendor` or `/admin`, call vendor/admin RPCs; sees only own profile/orders |
| Vendor | **PASS** (cross-vendor not live-testable: one vendor) | sees only own outlets' orders; no foreign profiles; cannot forge ratings/ownership; blocked from `/admin`, `/orders`, `/checkout` |
| Management | **PASS** | dashboards, moderation, refunds work; cannot change own role/status; cannot call service-only payment functions |

## 7. Feature parity (Android repo vs website vs live DB)
| Feature | Android repo | Website now |
|---|---|---|
| Auth, role routing, profile | mock + Supabase repo | ✅ strict identity, PENDING_VENDOR, disabled accounts |
| Home / Explore / Search / Categories / Food / Outlet / Favorites | ✅ | ✅ server-side filters, sort, paging, veg filter, low-stock |
| Cart / customizations / checkout / pickup slots / preorder (≤ 7 days, IST) | ✅ | ✅ revalidated against server before ordering |
| Order tracking, history, cancellation, QR pickup | ✅ | ✅ realtime, real QR, cancel (unpaid only) |
| Razorpay payments, failure/cancel handling, refunds | ❌ not in repo | ✅ |
| Food reviews + vendor replies | ❌ not in repo (exists in live DB) | ✅ |
| Outlet reviews + replies | ❌ | ✅ |
| Vendor: board, lifecycle, QR verify, multi-outlet, menu/stock/availability, reviews, insights | partial screens | ✅ |
| Management: overview, analytics (IST), orders, payments/refunds, vendors, outlets, menu, inventory, slots, users, review moderation | skeleton | ✅ |
| Management **Content**, **Support**, notifications centre | ❌ | ❌ no backend/spec in either repo (see §13) |

## 8. Performance
Fixed: unpaginated 1,400-row catalogue fetch → 24/page with server filtering; initial JS 632 kB → 480 kB (role code-splitting); embeds instead of N+1;
order status via one realtime subscription; images lazy-loaded; no repeated profile queries (one hydration, deduped). Not measured under load.

## 9. UX / accessibility
Fixed: demo/placeholder UI removed; real loading/empty/error states everywhere; no raw Supabase/Postgres/Razorpay text (`friendlyError`); focus-trapped dialogs;
labelled form controls; real links; keyboard-focusable scrollable tables; contrast raised to WCAG AA; broken mobile bottom-nav; management nav reachable on phones;
"waiting for payment" screen (page previously said "Nothing to check out" behind the Razorpay window); post-login lands on the role's home.
Sweep: every route for all three roles at 1280 px and 390 px — no horizontal overflow, no error states, no console errors (final axe result in §12).

## 10. Files changed
**New:** `src/{types.ts,ui.css}`, `src/lib/{errors,pricing,time,ui-helpers}.ts`, `src/lib/api/*`, `src/state/*`, `src/shell/Shell.tsx`, `src/ui/kit.tsx`, `src/screens/{student,vendor,admin,shared}/*`,
`supabase/functions/_shared/*`, `supabase/functions/refund-razorpay-payment/`, `supabase/config.toml`, `supabase/migrations/018–022`, `supabase/tests/pglite/*`, `tests/unit/*`, `scripts/redteam-live.mjs`, `vercel.json`, `AUDIT_REPORT.md`.
**Rewritten:** `src/App.tsx`, the three Razorpay functions. **Deleted:** `src/data/campusData.ts` (seed/demo data), `src/lib/backend.ts`.
**Edited:** `package.json`/lockfile (+`qrcode`, +`@electric-sql/pglite` dev), `README.md`, `.gitignore`, `.env.example` (comments only), `index.html`, `public/manus-routes.json`, migrations `003`, `009`, `013` (made valid for fresh installs).

## 11. Database changes (applied to the live project, each in its own transaction after a rolled-back dry run)
- `018_security_hardening`: helpers; drop-and-recreate policies on `profiles`, `orders`, `order_items`, `order_item_customizations`, `payments`, `pickup_tokens`; guard triggers (profile, order, token); single capacity/stock-restore trigger (replaces `restore_capacity_on_cancel`); `payment_events`; explicit grant lock-down of sensitive functions.
- `019_payment_and_ordering`: `place_order` rewrite; `crave_expire_unpaid_orders` (+ pg_cron every 5 min); `crave_payment_prepare/attach/apply/mark_refunded`; service-only `mark_payment_verified`; cash settlement on pickup; `cancel_my_order`, `vendor_*` RPCs, `admin_cancel_order`, `verify_pickup_token`; `orders.payment_expires_at`, `payments.paid_at`, `order_items.special_instructions`; unique Razorpay ids.
- `020_reviews`: `outlet_reviews`, `outlet_review_replies` (+RLS, triggers, rating sync), `get_outlet_reviews`, `get_vendor_outlet_reviews`, admin search/moderation RPCs, validation/ownership triggers on the existing food review tables.
- `021_dashboards_and_admin`: `get_management_dashboard`, `get_vendor_dashboard`, `admin_set_user_role/active`, `admin_refund_candidates`, rating/ownership guards on `outlets`/`food_items`, scoped `search_food`.
- `022_fix_food_veg_flags`: data fix (407 rows).
- Side effect: 9 abandoned unpaid online orders were auto-cancelled and their stock/slots released.
- Edge Functions deployed: `create-razorpay-order`, `verify-razorpay-payment`, `razorpay-webhook` (`verify_jwt=false`), `refund-razorpay-payment`.
- Pre-change schema snapshot (policies, functions, triggers, grants) was saved to the audit scratch directory for rollback reference.

## 12. Tests executed
| Suite | Result |
|---|---|
| `pnpm typecheck`, `pnpm build` | clean |
| `pnpm test` (13 unit tests: IST maths, slot rules, pricing parity, error mapping, Razorpay HMAC incl. forged/malformed, webhook decisions) | 13/13 |
| `pnpm test:db` (Postgres emulation: privilege escalation, grants, order tampering, state machine, oversell, slot capacity, payment idempotency/replay/duplicate/late/expiry/refund, outlet + food reviews, moderation visibility, dashboards, catalogue guards) | 153/153; migrations idempotent |
| Fresh install (001→022 on empty DB) | all applied |
| `scripts/redteam-live.mjs` (live attacks as anon/student/vendor/management + payment endpoints) | 67/67 blocked |
| Live browser E2E (Brave via Playwright) | student order → vendor lifecycle → QR verification → reviews/replies → moderation → analytics; online order through Razorpay widget open/cancel/resume, signed webhooks; vendor stock/availability; filters/favourites/profile validation; login errors/door mismatch/logout isolation; all-role route guards |
| Live concurrency | 6 simultaneous `place_order` on one cart → 1 order, exact stock, client price ignored |
| Route sweep with axe-core, desktop + mobile | see below |

Axe/route-sweep final numbers: see the last section of this file (appended after the final run).

## 13. Remaining blockers (genuine)
1. **Razorpay webhook secret.** I set a *temporary* `RAZORPAY_WEBHOOK_SECRET` only to test signed events. Create the webhook in the Razorpay dashboard, choose your own secret, and run
   `supabase secrets set RAZORPAY_WEBHOOK_SECRET=<yours> --project-ref btdmhveaqssuuhyoyanz` (this also invalidates mine).
2. **Browser success path not machine-tested.** In test mode, pay once manually (card `4111 1111 1111 1111`, any future date, any CVV): the order should flip to Paid, appear on the vendor board, and `razorpay_payment_id` should be stored. Server-side verification is covered by unit tests and the live webhook tests, but this end-to-end click-through needs a human because Razorpay's mock bank page would not load in automation.
3. **Refund success path** needs a really captured payment (guards were tested; Razorpay call was not).
4. **Two-student stock race** not run live (one student account). Locking is by row; one-user concurrency and the sequential two-student case are tested. A two-account run of the same script would close this.
5. **Android compatibility** is unverified: the repo has no code for the live schema. Any Android flow that patches `payment_status`/`pickup_tokens` directly, or calls `generate_pickup_slots`, will now be refused (that is the point of the fix) and should move to the new RPCs.
6. **Management "Content" and "Support"** modules: no tables or spec exist in either repo, so nothing was invented. Needs a product decision.
7. **Student / vendor self-registration** and email-confirmation were not exercised live (would create real auth users).
8. Supabase dashboard settings (email confirmation, password policy, rate limits, SMTP) and the `vercel.json` CSP were not testable from here.
9. `get_food_reviews` (Android's RPC) returns reviewers' full names and ids to every signed-in student; left as-is to avoid breaking Android. Consider first-name-only.

## 14. Final status
**NOT PRODUCTION READY**

Every critical security and data-integrity issue found is fixed and verified against the live project, and the payment server logic is verified. It is marked NOT PRODUCTION READY only because
items 1 and 2 (real webhook secret + one manual test-mode payment) have to be done by you before real money flows, and item 5 needs a check against the actual Android build.

---

## Appendix A. Final route sweep (axe-core, serious/critical only)
All routes for all three roles, logged in with the real accounts against the live project:
- 1280 px: **31/31 routes clean** (no horizontal overflow, no error state, no console error, no serious/critical axe violation)
- 390 px: **31/31 routes clean**; management mobile nav re-checked after the final tweak: 12/12.
Earlier runs found and I fixed: colour contrast on inactive nav / orange text, mislabelled links (`aria-label` ≠ visible text), `aria-label` on a role-less span, non-focusable scrollable tables, and the broken mobile bottom-nav.

## Appendix B. Test data left on the live project (created by the end-to-end runs; safe to delete)
Orders (the test student account, outlet *Butty – The Food Paradise*):
`GAG-20261006-62D72B` (counter, picked up, ₹63), `GAG-20261006-7E032D` (online, marked PAID by a **simulated signed webhook** with a fake payment id `pay_TESTGOOD001`, picked up, ₹63),
`GAG-20261006-B11F06` and `GAG-20261006-DF9FD3` (cancelled concurrency / red-team probes).
One food review + one outlet review (both 5★) with vendor replies; Butty's outlet rating is therefore 5.0 (1 review). `payment_events` holds 4 test webhook events.
These make today's management analytics show ₹126 paid revenue (₹63 cash + ₹63 "Razorpay") — the Razorpay half is fake test data.
The earlier 9 abandoned online orders were auto-cancelled by the new expiry job (intended).
Also: the test student's profile role was changed to VENDOR during the first exploit reproduction and **immediately restored to STUDENT** (verified).

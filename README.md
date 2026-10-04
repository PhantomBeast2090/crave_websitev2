# Crave Website v2

Standalone website export from [`1HPdhruv/Crave@manus/crave-web`](https://github.com/1HPdhruv/Crave/tree/manus/crave-web) (branch `manus/crave-web`, commit `2d9bc26`).

This repo contains **everything the website needs to run with full UI + backend sync**:

- **Frontend (repo root):** Vite + React 19 + TypeScript student-first web companion for the SRMIST Crave campus food-ordering app.
- **`supabase/`:** full Postgres backend — 17 migrations (`001`–`017`), 3 Edge Functions (Razorpay), and SQL tests. Apply these to your Supabase project to get catalog, carts, `place_order`, pickup slots/tokens, favorites, profiles/roles, RLS policies, and analytics.

## Quickstart

```bash
pnpm install
cp .env.example .env
# edit .env with your Supabase values
pnpm dev
```

Open http://localhost:3000

## Env

| Var | Required | Notes |
|-----|----------|-------|
| `VITE_SUPABASE_URL` | yes for live data | Supabase project URL. A trailing `/rest/v1` is auto-normalized. |
| `VITE_SUPABASE_ANON_KEY` | yes for live data | Public anon key only. Never put a service-role key in browser code. |

Without these (or if the live catalog request fails), the site falls back to the seeded campus dataset in `src/data/campusData.ts`.

## Scripts

```bash
pnpm dev        # vite dev server
pnpm build      # production build
pnpm preview    # preview dist/
pnpm typecheck  # tsc --noEmit
```

## Product shape

- **Students:** discover open outlets, search/filter live food, customize items from Supabase variants, add to bag, read real pickup slots, sign in with Supabase Auth, place server-authoritative pickup orders through `place_order`, track status with realtime updates, save bites, and reorder.
- **Vendors:** incoming-order views, menu availability, daily metrics — only when `profiles.role = 'VENDOR'`.
- **Management:** campus pulse, outlet health, system metrics — only when `profiles.role = 'ADMIN'`.

Login-first role picker only selects the expected account type; it never grants access. After auth, Crave reads `profiles.role`, rejects mismatches, and gates vendor/management routes in the UI while Supabase RLS protects the data.

Browser adapter: `src/lib/backend.ts` (`src/lib/supabase.ts` for client setup).

## Backend setup (Supabase)

Migrations are in order in `supabase/migrations/`:

```
001_initial_schema.sql … 017_admin_analytics.sql
```

Apply with Supabase CLI from repo root:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or apply the files manually in the Supabase SQL editor in numeric order.

Edge Functions (`supabase/functions/`):

- `create-razorpay-order`
- `razorpay-webhook`
- `verify-razorpay-payment`

Deploy with:

```bash
supabase functions deploy create-razorpay-order
supabase functions deploy razorpay-webhook
supabase functions deploy verify-razorpay-payment
```

Tests: `supabase/tests/` (`004`, `006`–`008` database/catalog/ordering/auth tests).

## Deploy (Vercel)

- Framework: Vite
- Build command: `pnpm build`
- Output dir: `dist`
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Source

Exported from the `web/` folder of the original monorepo plus its `supabase/` backend so this repo is self-contained. Android app (`/app`) from the original repo is intentionally not included.

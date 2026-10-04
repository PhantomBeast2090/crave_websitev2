# Crave Web Conversion Plan

This project implements the approved plan at `/home/ubuntu/plan.md`: convert the existing SRMIST Crave Android app into a poppy, funky, student-first website while preserving the Android app and mirroring the finished website into `/home/ubuntu/Crave/web`.

Key approved decisions:
- Neo-brutalist campus-zine meets playful Y2K editorial visual direction.
- Crave Tangerine `#FF5C35` as the signature brand color.
- Space Grotesk + DM Mono typography system.
- Student discovery, outlets/menus, customization, cart, pickup, checkout, tracking/QR, favorites/history.
- Secondary vendor/admin demo views.
- Live Supabase catalog, authentication, favorites, pickup slots, orders, and realtime status are the source of truth when configured; seeded data remains a graceful offline fallback.
- Browser-safe Supabase URL and anon key are supplied through managed environment values, never committed to Git; all writes remain protected by Supabase Auth and RLS, and checkout uses the existing `place_order` RPC rather than trusting client totals.
- Managed Webdev project for Preview, version history, checkpointing, and later publishing.

## Supabase integration structure

- `src/lib/supabase.ts` owns the browser client and managed environment checks.
- `src/lib/backend.ts` owns catalog mapping, session-aware favorites, pickup-slot reads, order reads, and the server-authoritative cart/order RPC flow.
- `src/data/campusData.ts` keeps the visual fallback dataset and shared UI types; live rows are normalized into the same shape so the existing playful UI does not depend on a second rendering system.
- The app remains static because Supabase is called directly from the browser with the public anon key; RLS and `place_order` enforce access and pricing server-side.

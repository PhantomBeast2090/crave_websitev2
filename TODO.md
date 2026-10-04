# Crave Website ToDo

## Build the student-first discovery and campus food experience

- [x] Preserve the student journey from the Android app in a responsive website: browse campus food outlets and menus, search and filter food, see open-now indicators and pickup timing, and keep the current cart visible.
- [x] Use Crave/SRMIST product vocabulary and seeded campus demo data so the Preview is usable without backend credentials.
- [x] Make the experience focused on college students with a poppy, funky, playful visual system rather than a generic corporate delivery-app layout.

## Implement menu browsing and item customization

- [x] Provide outlet/menu views with categories, food cards, availability, pricing, dietary tags, and add-to-cart controls.
- [x] Provide food detail/customization for variants, add-ons, quantity, and notes, with an obvious add-to-cart confirmation and a clear state change.

## Implement cart, pickup, checkout, tracking, and QR pickup

- [x] Provide cart interactions for quantity updates, removal, subtotal, pickup/delivery treatment, and checkout.
- [x] Provide pickup slot selection, order summary, demo-ready payment confirmation, and a successful order state.
- [x] Provide live order tracking with a visual status timeline and QR pickup token card.

## Implement favorites, history, and role-based views

- [x] Provide favorites and order history with reorder affordances plus a student profile/settings surface.
- [x] Carry over vendor and administrator concepts as secondary role-based demo views for incoming orders, menu availability, simple metrics, active outlets, order volume, popular categories, and system status.

## Validate, brand, and deliver the managed website

- [x] Serve a synchronized `/manus-routes.json` route manifest, register host-managed diagnostics, run available typecheck/build checks, and resolve actionable diagnostics.
- [x] Keep responsive desktop and mobile layouts usable, including navigation, persistent cart/order context, overflow, stickers, and status treatments.
- [x] Set project logo metadata before checkpointing, save a managed checkpoint, and mirror the stable website into `/home/ubuntu/Crave/web` without modifying the Android app under `/home/ubuntu/Crave/app`.

## Connect the website to the real Supabase backend

- [x] Load outlets, categories, food items, variants, availability, images, ratings, and prep times from the existing Supabase schema, while keeping the seeded campus dataset only as an offline/error fallback.
- [x] Use managed environment values for the Supabase URL and public anon key; do not commit credentials or use a service-role key in browser code.
- [x] Add Supabase Auth-aware sign-in/sign-up state and use the authenticated user for favorites, carts, orders, and profile data under the existing RLS policies.
- [x] Read real pickup slots and use the existing `place_order(p_cart_id, p_pickup_slot_id, p_payment_method)` RPC so server-side inventory, customization pricing, totals, slot capacity, and QR token generation remain authoritative.
- [x] Read the user’s real orders and subscribe to realtime order status changes, with a clear fallback message when no session is available or the backend is unreachable.
- [x] Re-run diagnostics, typecheck, production build, live Supabase reads, and Preview checks after the integration; checkpoint the updated managed project and mirror the integration into `/home/ubuntu/Crave/web`.

## Gate vendor and management workspaces by login role

- [x] Open the website on a login-first access page with Student, Vendor, and Management choices; do not open directly into a demo dashboard.
- [x] Read the authoritative `profiles.role` from Supabase after authentication and require the selected login door to match the account’s assigned role.
- [x] Allow only approved Vendor accounts to render vendor routes and only approved ADMIN/Management accounts to render management routes; do not grant access through a client-side role switcher or URL alone.
- [x] Remove demo role switching and show the signed-in user’s assigned role and access policy in the profile surface.

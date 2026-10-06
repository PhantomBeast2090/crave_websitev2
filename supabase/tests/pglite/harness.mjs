// In-process Postgres (PGlite) harness that emulates the pieces of Supabase the
// migrations depend on: roles, default function grants, auth.uid(), extensions.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const migrationsDir = join(here, '..', '..', 'migrations')
const read = (f) => readFileSync(join(migrationsDir, f), 'utf8')

// Migrations that really are present on the live project (003/008/009 never applied there).
const LIVE_BASELINE = ['001_initial_schema.sql', '002_rls_policies.sql', '004_catalogue_harden.sql', '007_profile_insert_policy.sql',
  '010_payment_gateways.sql', '011_razorpay_fixes.sql', '012_preorder_logic.sql', '013_vendor_registration.sql',
  '014_inventory_initialization.sql', '015_is_veg_backfill.sql', '016_fix_pgcrypto_schema.sql', '017_admin_analytics.sql']
export const NEW_MIGRATIONS = ['018_security_hardening.sql', '019_payment_and_ordering.sql', '020_reviews.sql', '021_dashboards_and_admin.sql']

export async function createDb({ withNew = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, pg_trgm } })
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema extensions; create extension pgcrypto with schema extensions;
    create extension "uuid-ossp"; create extension pg_trgm;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    -- Supabase default privileges: new tables/functions in public are open to the API roles.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `)
  const applied = []
  for (const f of LIVE_BASELINE) {
    // ALTER TYPE ... ADD VALUE cannot be used in the same transaction; the SQL editor ran these separately.
    if (f.startsWith('013')) await db.exec(`alter type user_role add value if not exists 'PENDING_VENDOR'`)
    try { await db.exec(read(f)); applied.push(f) } catch (e) { console.warn(`  (baseline) ${f} failed: ${e.message.split('\n')[0]}`) }
  }
  // Live review tables differ from 001's (probed via the API): replace with the live shape.
  await db.exec(`
    drop table if exists reviews cascade;
    create table reviews (id uuid primary key default gen_random_uuid(), student_id uuid not null references profiles(id), food_item_id uuid not null references food_items(id),
      order_id uuid not null references orders(id), order_item_id uuid references order_items(id), rating int not null check (rating between 1 and 5),
      review_text text, is_visible boolean not null default true, created_at timestamptz default now(), updated_at timestamptz default now(), unique (order_item_id));
    create table review_replies (id uuid primary key default gen_random_uuid(), review_id uuid not null unique references reviews(id) on delete cascade,
      vendor_id uuid not null references profiles(id), reply_text text not null, created_at timestamptz default now(), updated_at timestamptz default now());
    alter table reviews enable row level security; alter table review_replies enable row level security;
    create policy r_sel on reviews for select using (true);
    create policy r_ins on reviews for insert with check (student_id = auth.uid());
    create policy r_upd on reviews for update using (student_id = auth.uid() or is_admin());
    create policy r_del on reviews for delete using (student_id = auth.uid() or is_admin());
    create policy rr_sel on review_replies for select using (true);
    create policy rr_all on review_replies for all using (vendor_id = auth.uid()) with check (vendor_id = auth.uid());
  `)
  if (withNew) for (const f of NEW_MIGRATIONS) await db.exec(read(f))
  return { db, applied }
}

export function session(db) {
  const run = async (role, uid, sql, params) => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${role}`)
    try { return await db.query(sql, params) } finally { await db.exec('reset role') }
  }
  return {
    as: (uid, sql, p) => run('authenticated', uid, sql, p),
    anon: (sql, p) => run('anon', null, sql, p),
    service: (sql, p) => run('service_role', null, sql, p),
    admin: (sql, p) => db.query(sql, p),
  }
}

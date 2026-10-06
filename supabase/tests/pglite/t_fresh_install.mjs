// A brand-new project must be able to apply EVERY migration, in order, each in its own transaction.
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { migrationsDir } from './harness.mjs'
import { join } from 'node:path'
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error('FATAL:', String(e?.message ?? e).slice(0, 400)); process.exit(2) })
const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, pg_trgm } })
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp"; create extension pg_trgm;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create publication supabase_realtime;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
let failed = 0
for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(migrationsDir, f), 'utf8')); console.log('applied ', f) }
  catch (e) { failed++; console.log('FAILED  ', f, '->', String(e.message).split('\n')[0].slice(0, 160)) }
}
const fn = (await db.query(`select count(*)::int c from pg_proc where pronamespace='public'::regnamespace and proname in ('place_order','crave_payment_apply','get_management_dashboard','verify_pickup_token')`)).rows[0].c
console.log(failed ? `\n${failed} migration(s) failed` : `\nall migrations applied cleanly (${fn}/4 key functions present)`)
process.exit(failed ? 1 : 0)

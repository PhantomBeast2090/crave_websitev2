import { readFileSync } from 'node:fs'
import { createDb, NEW_MIGRATIONS, migrationsDir } from './harness.mjs'
import { join } from 'node:path'
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error('FATAL:', String(e?.message ?? e).slice(0, 400)); process.exit(2) })
const { db } = await createDb()   // already applied once
for (const f of NEW_MIGRATIONS) { await db.exec(readFileSync(join(migrationsDir, f), 'utf8')); console.log('re-applied OK:', f) }

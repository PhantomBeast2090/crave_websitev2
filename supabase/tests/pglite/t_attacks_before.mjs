// Proves the emulated baseline reproduces the live holes (so the "after" suite means something).
import { createDb, session } from './harness.mjs'
import { seed, ID } from './seed.mjs'
const { db } = await createDb({ withNew: false })
await seed(db); const s = session(db)
const ok = (n, c) => { console.log(`${c ? 'EXPLOITABLE ' : 'blocked     '} ${n}`); return c }
let r
r = await s.as(ID.student, `update profiles set role='ADMIN' where id=$1 returning role`, [ID.student]).catch(() => null); ok('student -> ADMIN via profiles UPDATE', r?.rows[0]?.role === 'ADMIN')
await db.exec(`update profiles set role='STUDENT' where id='${ID.student}'`)
r = await s.anon(`select mark_payment_verified('${ID.student}','x','x','PAID')`).then(() => true).catch(() => false); ok('anon can EXECUTE mark_payment_verified', r)
r = await s.as(ID.vendor, `select count(*)::int c from profiles`); ok('vendor reads all profiles', r.rows[0].c > 1)

// Deterministic fixtures shared by the PGlite suites.
export const ID = {
  student: '11111111-1111-1111-1111-111111111111',
  student2: '11111111-1111-1111-1111-222222222222',
  vendor: '22222222-2222-2222-2222-222222222222',
  vendor2: '22222222-2222-2222-2222-333333333333',
  admin: '33333333-3333-3333-3333-333333333333',
  pending: '44444444-4444-4444-4444-444444444444',
  outletA: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  outletA2: 'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb',
  outletB: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  cat: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  food: 'f0000000-0000-0000-0000-000000000001',   // outlet A, ₹100
  food2: 'f0000000-0000-0000-0000-000000000002',  // outlet A, ₹50 (variants)
  foodB: 'f0000000-0000-0000-0000-0000000000b1',  // outlet B
  var1: 'a0000000-0000-0000-0000-000000000001',
  opt1: 'a0000000-0000-0000-0000-0000000000a1',
  opt2: 'a0000000-0000-0000-0000-0000000000a2',
  slotTomorrow: 's',
}

export async function seed(db) {
  const q = (s, p) => db.query(s, p)
  await db.exec(`set session_replication_role = replica`)   // seed as the service role: skip ownership/audit triggers
  for (const [id, name, role] of [[ID.student, 'Stu Dent', 'STUDENT'], [ID.student2, 'Sam Two', 'STUDENT'], [ID.vendor, 'Vee Vendor', 'VENDOR'],
    [ID.vendor2, 'Vic Other', 'VENDOR'], [ID.admin, 'Ada Admin', 'ADMIN'], [ID.pending, 'Pat Pending', 'PENDING_VENDOR']]) {
    await q(`insert into auth.users(id,email) values ($1,$2)`, [id, `${name.split(' ')[0].toLowerCase()}@x.test`])
    await q(`insert into profiles(id,name,email,role) values ($1,$2,$3,$4)`, [id, name, `${name.split(' ')[0].toLowerCase()}@x.test`, role])
  }
  await q(`insert into categories(id,name,emoji) values ($1,'Mains','🍛')`, [ID.cat])
  for (const [id, name, vendor] of [[ID.outletA, 'Outlet A', ID.vendor], [ID.outletA2, 'Outlet A2', ID.vendor], [ID.outletB, 'Outlet B', ID.vendor2]])
    await q(`insert into outlets(id,name,description,vendor_id,is_open,is_active) values ($1,$2,'d',$3,true,true)`, [id, name, vendor])
  for (const [id, outlet, name, price] of [[ID.food, ID.outletA, 'Biryani', 100], [ID.food2, ID.outletA, 'Dosa', 50], [ID.foodB, ID.outletB, 'Pizza', 200]])
    await q(`insert into food_items(id,outlet_id,category_id,name,description,price,is_available) values ($1,$2,$3,$4,'d',$5,true)`, [id, outlet, ID.cat, name, price])
  await q(`insert into food_variants(id,food_item_id,name,is_required,max_selections) values ($1,$2,'Size',true,1)`, [ID.var1, ID.food2])
  await q(`insert into food_variant_options(id,variant_id,name,extra_price) values ($1,$2,'Large',20),($3,$2,'Small',0)`, [ID.opt1, ID.var1, ID.opt2])
  await q(`insert into inventory(food_item_id, quantity_available) select id, 10 from food_items`)
  await db.exec(`set session_replication_role = origin`)
  // slots: tomorrow 10:00 and day-after for outlet A / B; one later today (23:59) and one already past today.
  const today = `((now() at time zone 'Asia/Kolkata')::date)`
  for (const outlet of [ID.outletA, ID.outletB]) {
    await q(`insert into pickup_slots(outlet_id,slot_date,start_time,end_time,capacity) values
      ($1, ${today}+1, '10:00','10:15', 3), ($1, ${today}+2, '10:00','10:15', 3), ($1, ${today}+30, '10:00','10:15', 3),
      ($1, ${today}-1, '10:00','10:15', 3)`, [outlet])
  }
  await q(`insert into pickup_slots(outlet_id,slot_date,start_time,end_time,capacity) values ($1, ${today}, '00:00','00:01', 3)`, [ID.outletA])
  await q(`insert into pickup_slots(outlet_id,slot_date,start_time,end_time,capacity) values ($1, ${today}, '23:58','23:59', 3)`, [ID.outletA])
}

export const slotId = async (db, outlet, offset, time = '10:00') =>
  (await db.query(`select id from pickup_slots where outlet_id=$1 and slot_date=((now() at time zone 'Asia/Kolkata')::date)+$2::int and start_time=$3::time`, [outlet, offset, time])).rows[0]?.id

// Build the server cart the same way the web does (delete + insert), as the student.
export async function fillCart(s, uid, outlet, lines) {
  const cart = (await s.as(uid, `select id from carts where user_id=$1`, [uid])).rows[0]
    ?? (await s.as(uid, `insert into carts(user_id,outlet_id) values ($1,$2) returning id`, [uid, outlet])).rows[0]
  await s.as(uid, `update carts set outlet_id=$2 where id=$1`, [cart.id, outlet])
  await s.as(uid, `delete from cart_items where cart_id=$1`, [cart.id])
  for (const l of lines) {
    const ci = (await s.as(uid, `insert into cart_items(cart_id,food_item_id,quantity,price,is_veg,special_instructions) values ($1,$2,$3,$4,true,$5) returning id`,
      [cart.id, l.food, l.qty ?? 1, l.price ?? 1, l.note ?? null])).rows[0]
    for (const o of l.opts ?? []) await s.as(uid, `insert into cart_item_customizations(cart_item_id,variant_id,option_id,extra_price) values ($1,$2,$3,0)`, [ci.id, o.variant, o.option])
  }
  return cart.id
}

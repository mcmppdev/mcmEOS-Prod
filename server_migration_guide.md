# server.js Migration Guide — Adding source_env

## Setup (top of server.js)

**Before**
```js
const { Pool } = require("pg");
const pool = new Pool({ ... });
const isProd = process.env.NODE_ENV === "production";
```

**After** — replace with a single import from db.js
```js
const { pool, APP_ENV, envTag, envWhere, envParams, withTx } = require("./db");
```

Remove the inline `const pool = new Pool(...)` block from server.js entirely.

---

## Pattern 1 — SELECT with no existing WHERE params

**Before**
```js
const { rows } = await pool.query(
  `select * from public.leads where lead_status = 'Open' order by follow_up_date`
);
```

**After**
```js
const { rows } = await pool.query(
  `select * from public.leads
   where lead_status = 'Open'
   ${envWhere(1)}
   order by follow_up_date`,
  envParams([])
);
```

---

## Pattern 2 — SELECT with existing WHERE params

**Before**
```js
const { rows } = await pool.query(
  `select * from public.tasks where assigned_user_id = $1 order by due_date`,
  [userId]
);
```

**After**
```js
const { rows } = await pool.query(
  `select * from public.tasks
   where assigned_user_id = $1
   ${envWhere(2)}
   order by due_date`,
  envParams([userId])
);
```

---

## Pattern 3 — INSERT (sales_entries example from your actual code)

**Before**
```js
await client.query(
  `insert into public.sales_entries (
     sale_entry_id, sale_date, cid, aid,
     customer_name_snapshot, company_name_snapshot, customer_mobile_snapshot,
     status, note, total_amount, created_by_user_id, created_by_name,
     updated_by_user_id, updated_by_name
   ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11, $12)`,
  [
    saleEntryId, payload.sale_date, payload.cid, payload.aid,
    payload.customer_name_snapshot, payload.company_name_snapshot,
    payload.customer_mobile_snapshot, payload.status, payload.note,
    total, actorUserId, actorName
  ]
);
```

**After** — add source_env column + param
```js
await client.query(
  `insert into public.sales_entries (
     sale_entry_id, sale_date, cid, aid,
     customer_name_snapshot, company_name_snapshot, customer_mobile_snapshot,
     status, note, total_amount, created_by_user_id, created_by_name,
     updated_by_user_id, updated_by_name,
     source_env
   ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11, $12, $13)`,
  envParams([
    saleEntryId, payload.sale_date, payload.cid, payload.aid,
    payload.customer_name_snapshot, payload.company_name_snapshot,
    payload.customer_mobile_snapshot, payload.status, payload.note,
    total, actorUserId, actorName
  ])
);
// envParams appends envTag() as the last element → $13 = 'dev' or 'prod'
```

---

## Pattern 4 — INSERT (tasks example)

**Before**
```js
await client.query(
  `insert into public.tasks (
     task_id, title, due_date, status, priority,
     assigned_user_id, notes, created_by_user_id, created_by_name,
     updated_by_user_id, updated_by_name
   ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$9)`,
  [taskId, title, dueDate, status, priority, assignedTo, notes, userId, userName]
);
```

**After**
```js
await client.query(
  `insert into public.tasks (
     task_id, title, due_date, status, priority,
     assigned_user_id, notes, created_by_user_id, created_by_name,
     updated_by_user_id, updated_by_name,
     source_env
   ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$9,$10)`,
  envParams([taskId, title, dueDate, status, priority, assignedTo, notes, userId, userName])
);
```

---

## Pattern 5 — Transaction wrapper (withTx)

**Before** (your existing pattern in server.js)
```js
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // ... queries ...
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}
```

**After** — use withTx from db.js
```js
await withTx(async (client) => {
  await client.query(`insert into public.sales_entries ...`, envParams([...]));
  await client.query(`insert into public.sales_line_items ...`, envParams([...]));
});
```

---

## Tables that do NOT need source_env

Skip the pattern for queries against these — they are shared master data:

- `products`, `product_prices`
- `vendors`, `materials`, `material_types`, `material_subtypes`, `material_stock`
- `machines`, `operators`, `employees`
- `organisation`
- `app_users`, `app_modules`, `app_user_module_access`, `app_enum_values`
- `app_sessions`, `app_login_audit`

---

## Vercel environment variables

**Dev project** (already exists, linked to `dev` branch):
```
APP_ENV = dev
```

**Prod project** (linked to `main` branch):
```
APP_ENV = prod
```
(or leave it unset — db.js defaults to `'prod'` when APP_ENV is absent)
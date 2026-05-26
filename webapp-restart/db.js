// db.js
// Drop this file into webapp-restart/ alongside server.js.
//
// Provides:
//   pool        — the pg Pool (replaces the inline pool in server.js)
//   APP_ENV     — 'dev' or 'prod' driven by APP_ENV env var
//   envTag()    — returns the current env string for INSERT values
//   envWhere(n) — returns "and source_env = $n" for SELECT / UPDATE WHERE clauses
//   envParams(existingParams) — appends APP_ENV to a params array (returns new array)
//   withTx(fn)  — convenience wrapper for pool.connect / BEGIN / COMMIT / ROLLBACK
//
// TABLES WITH source_env (transactional):
//   contacts, accounts, leads, sales, sales_entries, sales_line_items,
//   customer_payments, tasks, salary_payments, operational_expenses,
//   expense_advances, material_purchases, vendor_payments, productions,
//   material_usage
//
// TABLES WITHOUT source_env (shared master/reference data):
//   products, product_prices, vendors, materials, material_types,
//   material_subtypes, material_stock, machines, operators, employees,
//   organisation, app_users, app_modules, app_user_module_access,
//   app_enum_values, app_sessions, app_login_audit
 
const { Pool } = require("pg");
 
const isProd = process.env.NODE_ENV === "production";
const APP_ENV = process.env.APP_ENV === "dev" ? "dev" : "prod";

function databaseConnectionString() {
  const raw = String(process.env.DATABASE_URL || "");
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    ["sslmode", "sslcert", "sslkey", "sslrootcert"].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch (_error) {
    return raw;
  }
}

function databaseSslConfig() {
  const mode = String(process.env.DATABASE_SSL || "").trim().toLowerCase();
  const url = String(process.env.DATABASE_URL || "");
  const host = (() => {
    try { return new URL(url).hostname; } catch (_error) { return String(process.env.PGHOST || ""); }
  })();
  const isLocalDb = ["", "localhost", "127.0.0.1", "::1"].includes(host);
  if (isLocalDb && ["true", "1", "require", "required", "on"].includes(mode)) return { rejectUnauthorized: false };
  if (isLocalDb) return false;
  return { rejectUnauthorized: false };
}
 
const pool = new Pool({
  connectionString: databaseConnectionString(),
  ssl: databaseSslConfig(),
  options: `-c app.source_env=${APP_ENV}`,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
 
// ── Environment tag ───────────────────────────────────────────────────────────
// Set APP_ENV=dev in your dev Vercel project env vars.
// Leave it unset (or set APP_ENV=prod) in the production project.
 
if (!isProd) {
  console.log(`[db] APP_ENV = ${APP_ENV}`);
}
 
// ── Helpers ───────────────────────────────────────────────────────────────────
 
/**
 * Returns the current environment tag string.
 * Use as the value when inserting source_env.
 *
 * Example INSERT:
 *   insert into public.tasks (..., source_env) values (..., $n)
 *   params: [...otherParams, envTag()]
 */
function envTag() {
  return APP_ENV;
}
 
/**
 * Returns a SQL fragment for WHERE / AND clauses.
 * @param {number} n  The $n placeholder index for APP_ENV in your params array.
 *
 * Example SELECT:
 *   const { rows } = await pool.query(
 *     `select * from public.tasks where assigned_user_id = $1 ${envWhere(2)} order by due_date`,
 *     [userId, envTag()]
 *   );
 */
function envWhere(n) {
  return `and source_env = $${n}`;
}
 
/**
 * Appends APP_ENV to an existing params array and returns a new array.
 * The index of APP_ENV in the returned array is params.length + 1 (i.e. the
 * position you should use in envWhere / your INSERT columns).
 *
 * Example SELECT — zero existing params:
 *   const params = envParams([]);              // ['prod']  (or 'dev')
 *   const sql = `select * from public.leads where lead_status = 'Open' ${envWhere(1)}`;
 *   const { rows } = await pool.query(sql, params);
 *
 * Example SELECT — with existing params:
 *   const params = envParams([userId]);        // [userId, 'prod']
 *   const sql = `select * from public.tasks
 *                where assigned_user_id = $1 ${envWhere(2)}
 *                order by due_date`;
 *   const { rows } = await pool.query(sql, params);
 *
 * Example INSERT:
 *   const params = envParams([taskId, title, dueDate, userId]);
 *   // params = [taskId, title, dueDate, userId, 'prod']
 *   const sql = `
 *     insert into public.tasks (task_id, title, due_date, assigned_user_id, source_env)
 *     values ($1, $2, $3, $4, $5)
 *   `;
 *   await pool.query(sql, params);
 */
function envParams(existingParams) {
  return [...existingParams, APP_ENV];
}
 
// ── Transaction wrapper ───────────────────────────────────────────────────────
 
/**
 * Runs fn(client) inside a BEGIN/COMMIT block.
 * Automatically rolls back and releases on error.
 *
 * Example:
 *   const result = await withTx(async (client) => {
 *     await client.query('insert into public.sales_entries ...', [...]);
 *     await client.query('insert into public.sales_line_items ...', [...]);
 *     return { ok: true };
 *   });
 */
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
 
module.exports = { pool, APP_ENV, envTag, envWhere, envParams, withTx };

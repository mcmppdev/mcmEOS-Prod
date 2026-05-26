const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 4173;
const sessionTtlMs = 1000 * 60 * 60 * 24;
const sessionTouchIntervalMs = 1000 * 60 * 5;
const sessionRetentionDays = 30;

const isProd = process.env.NODE_ENV === "production";
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
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || "mcm-dev-secret"));
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith(".html") || req.path.startsWith("/ui/")) {
    res.set("Cache-Control", "no-store");
  }
  next();
});
app.use("/ui", express.static(path.join(__dirname, "ui")));
app.use("/assets", express.static(path.join(__dirname, "assets")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/deploy-info", (_req, res) => {
  const dbHost = (() => {
    try { return new URL(String(process.env.DATABASE_URL || "")).hostname; } catch (_error) { return String(process.env.PGHOST || ""); }
  })();
  res.json({
    app: "webapp-restart",
    ui: "mcm-sales-suite",
    expectedAssets: ["/ui/app.js", "/ui/app.css"],
    dbHost,
    dbSsl: Boolean(databaseSslConfig())
  });
});

function sanitizeModuleKey(key) {
  return String(key || "").trim();
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: isProd,
    maxAge: sessionTtlMs
  };
}

async function queryUserByUsername(username) {
  const sql = `
    select user_id, username, display_name, role, is_active, password_hash
    from public.app_users
    where username = $1
    limit 1
  `;
  const { rows } = await pool.query(sql, [username]);
  return rows[0] || null;
}

async function verifyPassword(username, password) {
  const sql = `
    select (password_hash = crypt($2, password_hash)) as is_valid
    from public.app_users
    where username = $1
    limit 1
  `;
  const { rows } = await pool.query(sql, [username, password]);
  return Boolean(rows[0] && rows[0].is_valid);
}

async function queryUserPermissions(userId) {
  const sql = `
    select
      a.module_key,
      m.module_name,
      m.route_path,
      m.display_order,
      a.can_view,
      a.can_create,
      a.can_update,
      a.can_delete,
      a.can_edit_own
    from public.app_user_module_access a
    join public.app_modules m on m.module_key = a.module_key
    where a.user_id = $1
      and m.is_active = true
      and a.can_view = true
    order by m.display_order asc, m.module_name asc
  `;
  const { rows } = await pool.query(sql, [userId]);
  return rows;
}

async function createSession(req, res, user, permissions) {
  const token = crypto.randomBytes(32).toString("hex");
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + sessionTtlMs).toISOString();
  const sql = `
    insert into public.app_sessions (
      session_id,
      user_id,
      created_at,
      last_seen_at,
      expires_at,
      ip_address,
      user_agent
    )
    values ($1, $2, $3::timestamptz, $3::timestamptz, $4::timestamptz, $5, $6)
  `;
  await pool.query(sql, [
    token,
    user.user_id,
    nowIso,
    expiresIso,
    getClientIp(req),
    String(req.headers["user-agent"] || "").slice(0, 512) || null
  ]);
  await pool.query(
    `
    update public.app_users
    set last_login_at = now()
    where user_id = $1
    `,
    [user.user_id]
  );
  res.cookie("mcm_session", token, getCookieOptions());
  return {
    user: {
      userId: user.user_id,
      username: user.username,
      displayName: user.display_name,
      role: user.role
    },
    permissions
  };
}

async function writeLoginAudit(req, { username, userId = null, success, reason = null }) {
  const sql = `
    insert into public.app_login_audit (
      username, user_id, login_at, success, ip_address, user_agent, failure_reason
    )
    values ($1, $2, now(), $3, $4, $5, $6)
  `;
  await pool.query(sql, [
    username || null,
    userId || null,
    Boolean(success),
    getClientIp(req),
    String(req.headers["user-agent"] || "").slice(0, 512) || null,
    reason || null
  ]);
}

async function getSessionData(token) {
  const sessionSql = `
    select
      s.session_id,
      s.user_id,
      s.last_seen_at,
      u.username,
      u.display_name,
      u.role,
      u.is_active
    from public.app_sessions s
    join public.app_users u on u.user_id = s.user_id
    where s.session_id = $1
      and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `;
  const { rows } = await pool.query(sessionSql, [token]);
  const row = rows[0];
  if (!row || !row.is_active) return null;
  const permissions = await queryUserPermissions(row.user_id);
  return {
    user: {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role
    },
    permissions,
    lastSeenAt: row.last_seen_at
  };
}

async function touchSession(token, lastSeenAt) {
  const lastMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  if (Number.isFinite(lastMs) && Date.now() - lastMs < sessionTouchIntervalMs) return;
  const sql = `
    update public.app_sessions
    set last_seen_at = now()
    where session_id = $1
      and revoked_at is null
  `;
  await pool.query(sql, [token]);
}

async function revokeSession(token) {
  const sql = `
    update public.app_sessions
    set revoked_at = now()
    where session_id = $1
      and revoked_at is null
  `;
  await pool.query(sql, [token]);
}

async function pruneOldSessions() {
  const sql = `
    delete from public.app_sessions
    where (expires_at < now() or revoked_at is not null)
      and created_at < now() - ($1::text || ' days')::interval
  `;
  await pool.query(sql, [String(sessionRetentionDays)]);
}

function clearSessionCookie(res) {
  res.clearCookie("mcm_session", getCookieOptions());
}

function clientSafeError(error) {
  const message = String(error?.message || "Unexpected server error");
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    return "Database is not configured locally. Set DATABASE_URL before starting the server.";
  }
  if (message.toLowerCase().includes("connection timeout")) {
    return "Database connection timeout. Check Vercel DATABASE_URL and use the Supabase pooler connection string with SSL.";
  }
  if (message.toLowerCase().includes("relation") && message.toLowerCase().includes("does not exist")) {
    return "Required database schema is missing. Apply the Supabase migrations, especially 014_employees_and_enum_values.sql, before using HR features.";
  }
  return message;
}

async function requireAuth(req, res, next) {
  try {
    const token = req.signedCookies.mcm_session;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const session = await getSessionData(token);
    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Session expired" });
    }
    req.sessionToken = token;
    req.sessionData = session;
    try {
      await touchSession(token, session.lastSeenAt);
    } catch (_error) {}
    next();
  } catch (error) {
    console.error("AUTH_MIDDLEWARE_ERROR", error);
    return res.status(500).json({ error: "Authentication service unavailable" });
  }
}

function modulePermission(req, moduleKey, action) {
  const match = req.sessionData.permissions.find((p) => p.module_key === moduleKey);
  if (!match) return false;
  if (action === "view") return Boolean(match.can_view);
  if (action === "create") return Boolean(match.can_create);
  if (action === "update") return Boolean(match.can_update);
  if (action === "delete") return Boolean(match.can_delete);
  return false;
}

function canViewAny(req, moduleKeys) {
  return isSuperAdmin(req) || moduleKeys.some((moduleKey) => modulePermission(req, moduleKey, "view"));
}

function sectionForbidden(req, moduleKeys) {
  return !canViewAny(req, moduleKeys);
}

function leadershipDateRange(query = {}) {
  const period = String(query.period || "this_month");
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), 1);
  let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (period === "last_month") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (period === "last_3_months") {
    start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (period === "this_year") {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31);
  } else if (period === "all_time") {
    start = new Date(1900, 0, 1);
    end = new Date(9999, 11, 31);
  } else if (period === "custom" && query.start && query.end) {
    start = new Date(String(query.start));
    end = new Date(String(query.end));
  }
  if (Number.isNaN(start.getTime())) start = new Date(now.getFullYear(), now.getMonth(), 1);
  if (Number.isNaN(end.getTime())) end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    period,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function leadershipMonthlyLimit() {
  const parsed = Number(process.env.LEADERSHIP_MONTHLY_LIMIT || 3000);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3000;
}

function leadershipMonthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value || String(date.getUTCFullYear());
  const month = parts.find((p) => p.type === "month")?.value || String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeLeadershipSection(section) {
  const key = String(section || "").trim().toLowerCase();
  const aliases = {
    overall: "sales-payments",
    "sales-payments-dashboard": "sales-payments",
    "sales-dashboard": "sales-payments",
    "customer-payment": "customer-payments",
    payments: "customer-payments",
    "customer-due": "customer-dues",
    dues: "customer-dues",
    "fg-stock": "stock",
    "finished-goods-stock": "stock",
    "material-stock": "materials",
    "materials-stock": "materials",
    "material-purchase": "material-purchased",
    "material-purchases": "material-purchased",
    "material-purchased": "material-purchased",
    "material-usage-report": "material-usage",
    "sales-report": "sales-mom",
    "sales-mom-report": "sales-mom",
    "sales-insights-report": "sales-insights",
    "company-matrix": "sales-matrix",
    "sales-matrix-report": "sales-matrix",
    "profit-loss": "pl",
    "p-and-l": "pl",
    pnl: "pl"
  };
  return aliases[key] || key;
}

async function ensureLeadershipUsageTable() {
  await pool.query(`
    create table if not exists public.leadership_report_usage (
      usage_id bigserial primary key,
      month_key text not null,
      section text not null,
      username text,
      user_id text,
      period text,
      status text not null default 'success',
      remaining_count integer not null default 0,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create index if not exists leadership_report_usage_month_status_idx
    on public.leadership_report_usage (month_key, status)
  `);
}

async function getLeadershipQuota() {
  await ensureLeadershipUsageTable();
  const limit = leadershipMonthlyLimit();
  const monthKey = leadershipMonthKey();
  const { rows } = await pool.query(
    "select count(*)::integer as used from public.leadership_report_usage where month_key = $1 and status = 'success'",
    [monthKey]
  );
  const used = Number(rows[0]?.used || 0);
  return { limit, used, remaining: Math.max(limit - used, 0), monthKey };
}

async function recordLeadershipUsage(req, section, range, remaining) {
  const user = req.sessionData?.user || {};
  const { rows } = await pool.query(
    `
    insert into public.leadership_report_usage (
      month_key, section, username, user_id, period, status, remaining_count
    )
    values ($1, $2, $3, $4, $5, 'success', $6)
    returning usage_id
    `,
    [
      leadershipMonthKey(),
      section,
      user.username || user.displayName || null,
      user.userId ? String(user.userId) : null,
      range?.period || null,
      remaining
    ]
  );
  return rows[0]?.usage_id || null;
}

function leadershipTtlSeconds(section) {
  const ttl = {
    pl: 15 * 60,
    leads: 15 * 60,
    "customer-payments": 15 * 60,
    "sales-mom": 30 * 60,
    "sales-insights": 30 * 60,
    production: 30 * 60,
    "material-purchased": 30 * 60,
    "material-usage": 30 * 60,
    "customer-dues": 60 * 60,
    stock: 60 * 60,
    materials: 60 * 60,
    "sales-matrix": 60 * 60
  };
  return ttl[section] || 30 * 60;
}

function leadershipCacheKey(section, range) {
  return ["v5", section, range?.period || "", range?.start || "", range?.end || ""].join("|");
}

async function ensureLeadershipSnapshotTable() {
  await pool.query(`
    create table if not exists public.leadership_report_snapshots (
      cache_key text primary key,
      section text not null,
      period text not null,
      start_date date,
      end_date date,
      payload jsonb not null,
      generated_at timestamptz not null default now(),
      ttl_seconds integer not null
    )
  `);
  await pool.query(`
    create index if not exists leadership_report_snapshots_section_idx
    on public.leadership_report_snapshots (section, period, generated_at desc)
  `);
}

async function ensureLeadershipReportIndexes() {
  const statements = [
    "create index if not exists leadership_sales_entries_sale_date_idx on public.sales_entries (sale_date)",
    "create index if not exists leadership_customer_payments_payment_date_idx on public.customer_payments (payment_date)",
    "create index if not exists leadership_material_purchases_purchase_date_idx on public.material_purchases (purchase_date)",
    "create index if not exists leadership_vendor_payments_payment_date_idx on public.vendor_payments (payment_date)",
    "create index if not exists leadership_productions_production_date_idx on public.productions (production_date)",
    "create index if not exists leadership_material_usage_usage_date_idx on public.material_usage (usage_date)",
    "create index if not exists leadership_operational_expenses_expense_date_idx on public.operational_expenses (expense_date)",
    "create index if not exists leadership_salary_payments_payment_date_idx on public.salary_payments (payment_date)",
    "create index if not exists leadership_expense_advances_payment_date_idx on public.expense_advances (payment_date)"
  ];
  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (error) {
      console.warn("LEADERSHIP_INDEX_CREATE_SKIPPED", error.message);
    }
  }
}

async function getLeadershipSnapshot(cacheKey) {
  await ensureLeadershipSnapshotTable();
  const { rows } = await pool.query(
    `
    select payload, generated_at, ttl_seconds
    from public.leadership_report_snapshots
    where cache_key = $1
    limit 1
    `,
    [cacheKey]
  );
  return rows[0] || null;
}

function snapshotAgeSeconds(snapshot) {
  const generatedMs = new Date(snapshot?.generated_at || 0).getTime();
  return Number.isFinite(generatedMs) ? Math.max(Math.floor((Date.now() - generatedMs) / 1000), 0) : Number.POSITIVE_INFINITY;
}

function leadershipCacheMeta(snapshot, { hit, forceLimited = false } = {}) {
  const ttlSeconds = Number(snapshot?.ttl_seconds || 0);
  return {
    hit: Boolean(hit),
    generatedAt: snapshot?.generated_at || null,
    ttlSeconds,
    ageSeconds: snapshot ? snapshotAgeSeconds(snapshot) : null,
    forceLimited
  };
}

async function saveLeadershipSnapshot(cacheKey, section, range, payload, ttlSeconds) {
  await ensureLeadershipSnapshotTable();
  await pool.query(
    `
    insert into public.leadership_report_snapshots (
      cache_key, section, period, start_date, end_date, payload, generated_at, ttl_seconds
    )
    values ($1, $2, $3, $4::date, $5::date, $6::jsonb, now(), $7)
    on conflict (cache_key) do update
    set payload = excluded.payload,
        generated_at = excluded.generated_at,
        ttl_seconds = excluded.ttl_seconds
    `,
    [cacheKey, section, range.period, range.start || null, range.end || null, JSON.stringify(payload), ttlSeconds]
  );
  return getLeadershipSnapshot(cacheKey);
}

function pctOf(value, max) {
  const n = Number(value || 0);
  const m = Math.max(Number(max || 0), 1);
  return Math.round((n / m) * 100);
}

function isSuperAdmin(req) {
  return String(req.sessionData?.user?.role || "").toLowerCase() === "super_admin";
}

function canManageUsers(req) {
  return isSuperAdmin(req);
}

let homeSchemaReady = null;

async function ensureHomeSchema() {
  if (homeSchemaReady) return homeSchemaReady;
  homeSchemaReady = (async () => {
    await pool.query(`
      create table if not exists public.tasks (
        task_id text primary key,
        title text not null,
        due_date date not null,
        status text not null default 'Open',
        priority text not null default 'Normal',
        assigned_user_id text references public.app_users(user_id),
        source_type text,
        source_id text,
        source_label text,
        notes text,
        created_by_user_id text references public.app_users(user_id),
        created_by_name text,
        updated_by_user_id text references public.app_users(user_id),
        updated_by_name text,
        completed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await pool.query("create index if not exists idx_tasks_due_date on public.tasks(due_date)");
    await pool.query("create index if not exists idx_tasks_assigned_user on public.tasks(assigned_user_id)");
    await pool.query("create index if not exists idx_tasks_status on public.tasks(status)");
    await pool.query(`
      create table if not exists public.organisation (
        organisation_id text primary key,
        company_name text not null default 'MCM Paper Products',
        address text,
        gst_number text,
        logo_url text,
        is_active boolean not null default true,
        created_by_user_id text references public.app_users(user_id),
        created_by_name text,
        updated_by_user_id text references public.app_users(user_id),
        updated_by_name text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await pool.query(`
      insert into public.organisation (organisation_id, company_name, address, gst_number, logo_url, is_active)
      values ('ORG-DEFAULT', 'MCM Paper Products', '', '', './assets/mcm-logo-cropped.png', true)
      on conflict (organisation_id) do nothing
    `);
  })().catch((error) => {
    homeSchemaReady = null;
    throw error;
  });
  return homeSchemaReady;
}

let accountSchemaReady = null;

async function ensureAccountSchema() {
  if (accountSchemaReady) return accountSchemaReady;
  accountSchemaReady = (async () => {
    await pool.query(`
      alter table if exists public.accounts
        add column if not exists address text,
        add column if not exists state text,
        add column if not exists zipcode text,
        add column if not exists gst_number text,
        add column if not exists created_by_user_id text references public.app_users(user_id),
        add column if not exists created_by_name text,
        add column if not exists updated_by_user_id text references public.app_users(user_id),
        add column if not exists updated_by_name text
    `);
    await pool.query("create index if not exists idx_accounts_cid on public.accounts(cid)");
    await pool.query("create index if not exists idx_accounts_aid_cid on public.accounts(aid, cid)");
    await pool.query(`
      insert into public.accounts (
        aid, cid, contact_name, company, account_status, mobile, city, state, address, zipcode, gst_number
      )
      select
        coalesce(nullif(c.aid, ''), 'AID-' || regexp_replace(c.cid, '[^A-Za-z0-9]+', '-', 'g')),
        c.cid,
        c.name,
        c.company,
        coalesce(nullif(c.contact_status, ''), 'Active'),
        c.mobile,
        c.city,
        c.state,
        '',
        '',
        ''
      from public.contacts c
      where not exists (
        select 1 from public.accounts a where a.aid = c.aid or a.cid = c.cid
      )
      on conflict (aid) do nothing
    `);
    await pool.query(`
      update public.contacts c
      set aid = a.aid
      from public.accounts a
      where a.cid = c.cid
        and (c.aid is null or c.aid = '')
    `);
    tableColumnCache.delete("public.accounts");
    tableColumnCache.delete("public.contacts");
  })().catch((error) => {
    accountSchemaReady = null;
    throw error;
  });
  return accountSchemaReady;
}

function normalizeTaskRow(row) {
  return {
    taskId: row.task_id,
    title: row.title || "",
    dueDate: row.due_date || "",
    status: row.status || "Open",
    priority: row.priority || "Normal",
    assignedUserId: row.assigned_user_id || "",
    sourceType: row.source_type || "task",
    sourceId: row.source_id || "",
    sourceLabel: row.source_label || "",
    notes: row.notes || "",
    createdByName: row.created_by_name || "",
    completedAt: row.completed_at || null,
    isLeadFollowUp: false
  };
}

function normalizeOrganisationRow(row = {}) {
  return {
    organisationId: row.organisation_id || "ORG-DEFAULT",
    companyName: row.company_name || "MCM Paper Products",
    address: row.address || "",
    gstNumber: row.gst_number || "",
    logoUrl: row.logo_url || "./assets/mcm-logo-cropped.png"
  };
}

function tableConfig(moduleKey) {
  const map = {
    salary_payments: {
      table: "public.salary_payments",
      pk: "salary_payment_id",
      dateField: "payment_date",
      columns: ["salary_payment_id", "payment_date", "paid_to", "payment_type", "amount", "payment_method", "comments", "entered_by_user_id", "last_edited_by_user_id", "created_by_name", "updated_by_name", "created_at", "updated_at"],
      createFields: ["payment_date", "paid_to", "payment_type", "amount", "payment_method", "comments"],
      optionalColumns: ["employee_id"],
      optionalCreateFields: ["employee_id"]
    },
    operational_expenses: {
      table: "public.operational_expenses",
      pk: "expense_id",
      dateField: "expense_date",
      columns: ["expense_id", "expense_date", "expense_type", "paid_to", "amount", "comments", "entered_by_user_id", "last_edited_by_user_id", "created_by_name", "updated_by_name", "created_at", "updated_at"],
      createFields: ["expense_date", "expense_type", "paid_to", "amount", "comments"],
      optionalColumns: ["employee_id"],
      optionalCreateFields: ["employee_id"]
    },
    expense_advances: {
      table: "public.expense_advances",
      pk: "expense_advance_id",
      dateField: "payment_date",
      columns: ["expense_advance_id", "payment_date", "paid_to", "amount", "entered_by_user_id", "last_edited_by_user_id", "created_by_name", "updated_by_name", "created_at", "updated_at"],
      createFields: ["payment_date", "paid_to", "amount"],
      optionalColumns: ["employee_id"],
      optionalCreateFields: ["employee_id"]
    }
  };
  return map[moduleKey] || null;
}

const tableColumnCache = new Map();

async function tableColumns(tableName) {
  if (tableColumnCache.has(tableName)) return tableColumnCache.get(tableName);
  const parts = String(tableName).replace(/"/g, "").split(".");
  const schema = parts.length > 1 ? parts[0] : "public";
  const name = parts.length > 1 ? parts[1] : parts[0];
  const { rows } = await pool.query(
    "select column_name from information_schema.columns where table_schema = $1 and table_name = $2",
    [schema, name]
  );
  const cols = new Set(rows.map((r) => r.column_name));
  tableColumnCache.set(tableName, cols);
  return cols;
}

async function effectiveTableConfig(cfg) {
  if (!cfg || (!cfg.optionalColumns && !cfg.optionalCreateFields)) return cfg;
  const existing = await tableColumns(cfg.table);
  return {
    ...cfg,
    columns: [...cfg.columns, ...(cfg.optionalColumns || []).filter((c) => existing.has(c))],
    createFields: [...cfg.createFields, ...(cfg.optionalCreateFields || []).filter((c) => existing.has(c))]
  };
}

let hrSchemaReady = null;
async function ensureHrSchema() {
  if (hrSchemaReady) return hrSchemaReady;
  hrSchemaReady = (async () => {
    await pool.query(`
      create table if not exists public.employees (
        employee_id text primary key,
        employee_name text not null,
        role text,
        department text,
        operator_id text references public.operators(operator_id),
        contact text,
        join_date date,
        status text default 'Active',
        salary_rate numeric(14, 2) default 0,
        notes text,
        entered_by_user_id text references public.app_users(user_id),
        last_edited_by_user_id text references public.app_users(user_id),
        created_by_name text,
        updated_by_name text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    await pool.query("alter table if exists public.operators add column if not exists employee_id text references public.employees(employee_id)");
    await pool.query("alter table if exists public.salary_payments add column if not exists employee_id text references public.employees(employee_id)");
    await pool.query("alter table if exists public.operational_expenses add column if not exists employee_id text references public.employees(employee_id)");
    await pool.query("alter table if exists public.expense_advances add column if not exists employee_id text references public.employees(employee_id)");
    await pool.query("create index if not exists idx_employees_operator on public.employees(operator_id)");
    await pool.query("create index if not exists idx_salary_payments_employee on public.salary_payments(employee_id)");
    await pool.query("create index if not exists idx_operational_expenses_employee on public.operational_expenses(employee_id)");
    await pool.query("create index if not exists idx_expense_advances_employee on public.expense_advances(employee_id)");
    await pool.query(`
      create table if not exists public.app_enum_values (
        enum_id text primary key,
        enum_group text not null,
        enum_value text not null,
        enum_label text not null,
        display_order integer default 100,
        is_active boolean default true,
        notes text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    await pool.query("create unique index if not exists uq_app_enum_values_group_value on public.app_enum_values(enum_group, enum_value)");
    await pool.query(`
      insert into public.app_enum_values (enum_id, enum_group, enum_value, enum_label, display_order, is_active)
      values
        ('ENUM-SALARY-PAYMENT-TYPE-SALARY','salary_payment_type','Salary','Salary',10,true),
        ('ENUM-SALARY-PAYMENT-TYPE-ADVANCE','salary_payment_type','Advance','Advance',20,true),
        ('ENUM-SALARY-PAYMENT-TYPE-BONUS','salary_payment_type','Bonus','Bonus',30,true),
        ('ENUM-SALARY-PAYMENT-TYPE-OTHER','salary_payment_type','Other','Other',100,true),
        ('ENUM-PAYMENT-METHOD-CASH','payment_method','Cash','Cash',10,true),
        ('ENUM-PAYMENT-METHOD-TRANSFER','payment_method','Transfer','Transfer',20,true),
        ('ENUM-PAYMENT-METHOD-UPI','payment_method','UPI','UPI',30,true),
        ('ENUM-PAYMENT-METHOD-CHEQUE','payment_method','Cheque','Cheque',40,true),
        ('ENUM-EXPENSE-TYPE-FUEL','expense_type','Fuel','Fuel',10,true),
        ('ENUM-EXPENSE-TYPE-RENT','expense_type','Rent','Rent',20,true),
        ('ENUM-EXPENSE-TYPE-UTILITIES','expense_type','Utilities','Utilities',30,true),
        ('ENUM-EXPENSE-TYPE-MAINTENANCE','expense_type','Maintenance','Maintenance',40,true),
        ('ENUM-EXPENSE-TYPE-OFFICE','expense_type','Office','Office',50,true),
        ('ENUM-EXPENSE-TYPE-TRAVEL','expense_type','Travel','Travel',60,true),
        ('ENUM-EXPENSE-TYPE-OTHER','expense_type','Other','Other',100,true),
        ('ENUM-CUSTOMER-TYPE-WHOLESALE-RETAIL-SHOPS','customer_type','Wholesale/Retail Shops','Wholesale/Retail Shops',10,true),
        ('ENUM-CUSTOMER-TYPE-WHOLESALE','customer_type','Wholesale','Wholesale',20,true),
        ('ENUM-CUSTOMER-TYPE-HOTELS-JUICE-STALLS-TEA-SHOPS','customer_type','Hotels / Juice Stalls / Tea Shops','Hotels / Juice Stalls / Tea Shops',30,true),
        ('ENUM-CUSTOMER-TYPE-HOSPITALS-COMPANIES-CATERINGS','customer_type','Hospitals / Companies / Caterings','Hospitals / Companies / Caterings',40,true),
        ('ENUM-EMPLOYEE-STATUS-ACTIVE','employee_status','Active','Active',10,true),
        ('ENUM-EMPLOYEE-STATUS-INACTIVE','employee_status','Inactive','Inactive',20,true),
        ('ENUM-EMPLOYEE-DEPARTMENT-FACTORY','employee_department','Factory','Factory',10,true),
        ('ENUM-EMPLOYEE-DEPARTMENT-ADMIN','employee_department','Admin','Admin',20,true),
        ('ENUM-EMPLOYEE-DEPARTMENT-SALES','employee_department','Sales','Sales',30,true),
        ('ENUM-EMPLOYEE-DEPARTMENT-FINANCE','employee_department','Finance','Finance',40,true)
      on conflict (enum_group, enum_value) do nothing;
    `);
    tableColumnCache.delete("public.salary_payments");
    tableColumnCache.delete("public.operational_expenses");
    tableColumnCache.delete("public.expense_advances");
  })().catch((error) => {
    hrSchemaReady = null;
    throw error;
  });
  return hrSchemaReady;
}

const HR_MODULE_KEYS = new Set(["employees", "salary_payments", "operational_expenses", "expense_advances"]);

async function ensureHrSchemaForModule(moduleKey) {
  if (HR_MODULE_KEYS.has(moduleKey)) {
    await ensureHrSchema();
  }
}

function nextId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function nextSequentialId(client, tableName, idColumn, prefix, width) {
  const sql = `select ${idColumn} as id from ${tableName}`;
  const { rows } = await client.query(sql);
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`, "i");
  rows.forEach((row) => {
    const match = String(row.id || "").trim().match(re);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  });
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

function saleDateToken(value) {
  const raw = String(value || "").trim();
  const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) return `${ymdMatch[3]}${ymdMatch[2]}`;
  const dmyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dmyMatch) return `${dmyMatch[1]}${dmyMatch[2]}`;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function nextSaleEntryId(client, saleDate) {
  const prefix = `SE-${saleDateToken(saleDate)}-`;
  const { rows } = await client.query(
    "select sale_entry_id from public.sales_entries where sale_entry_id like $1",
    [`${prefix}%`]
  );
  let max = 0;
  rows.forEach((row) => {
    const match = String(row.sale_entry_id || "").match(/^SE-\d{4}-(\d{4})$/);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  });
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function nextSequentialIds(firstId, prefix, count, width) {
  const start = Number(String(firstId || "").replace(prefix, "")) || 1;
  return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(width, "0")}`);
}

function requireRows(req, res) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : Array.isArray(req.body) ? req.body : [];
  if (!rows.length) {
    res.status(400).json({ error: "At least one record is required." });
    return null;
  }
  return rows;
}

const PRODUCT_PACKAGING_TYPES = ["PACKETS", "BOX", "LIDS"];

function productAdminPermission(req, action) {
  return modulePermission(req, "products", action);
}

function normalizeProduct(row) {
  return {
    productId: row.product_id,
    name: row.name || "",
    category: row.category || "",
    isActive: row.is_active !== false
  };
}

function normalizePricing(row) {
  return {
    priceId: row.price_id,
    productId: row.product_id,
    productName: row.product_name || "",
    productCategory: row.product_category || "",
    packagingType: String(row.packaging_type || "").trim().toUpperCase(),
    unitPrice: Number(row.unit_price || 0),
    effectiveFrom: toDateYmd(row.effective_from),
    isActive: row.is_active !== false
  };
}

function toDateYmd(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mdmPermission(req, action) {
  return modulePermission(req, "materials_master", action);
}

function normalizeVendor(row) {
  return {
    vendorId: row.vendor_id,
    vendorName: row.vendor_name || "",
    contact: row.contact || "",
    notes: row.notes || ""
  };
}

function normalizeMaterialType(row) {
  return {
    typeId: row.type_id,
    typeName: row.type_name || ""
  };
}

function normalizeSubType(row) {
  return {
    subtypeId: row.subtype_id,
    subtypeName: row.subtype_name || ""
  };
}

function normalizeMaterial(row) {
  return {
    materialId: row.material_id,
    materialName: row.material_name || "",
    materialType: row.material_type || "",
    typeId: row.type_id || "",
    notes: row.notes || ""
  };
}

function mmCan(req, action) {
  return modulePermission(req, "purchases", action) || modulePermission(req, "vendor_payments", action);
}

function normalizePurchase(row) {
  return {
    purchaseId: row.purchase_id,
    tripId: row.trip_id || "",
    date: toDateYmd(row.purchase_date),
    vendorId: row.vendor_id || "",
    vendorName: row.vendor_name_snapshot || "",
    materialId: row.material_id || "",
    materialName: row.material_name_snapshot || "",
    materialType: row.material_type || "",
    typeId: row.type_id || "",
    materialSubtype: row.material_subtype || "",
    subtypeId: row.subtype_id || "",
    totalQty: Number(row.total_qty || 0),
    totalKg: Number(row.total_kg || 0),
    blanksPerKg: Number(row.blanks_per_kg || 0),
    costPerKg: Number(row.cost_per_kg || 0),
    totalAmount: Number(row.total_amount || 0),
    notes: row.notes || ""
  };
}

function normalizeVendorPayment(row) {
  return {
    paymentId: row.payment_id,
    date: toDateYmd(row.payment_date),
    vendorId: row.vendor_id || "",
    vendorName: row.vendor_name_snapshot || "",
    amount: Number(row.amount || 0),
    paymentMethod: row.payment_method || "",
    notes: row.notes || ""
  };
}

function normalizeMachine(row) {
  return {
    machineId: row.machine_id,
    machineName: row.machine_name || "",
    machineType: row.machine_type || "",
    status: row.status || "Active",
    capacityPerShift: Number(row.capacity_per_shift || 0),
    location: row.location || "",
    lastMaintenance: toDateYmd(row.last_maintenance),
    notes: row.notes || ""
  };
}

function normalizeOperator(row) {
  return {
    operatorId: row.operator_id,
    operatorName: row.operator_name || "",
    role: row.role || "",
    shift: row.shift || "",
    status: row.status || "Active",
    contact: row.contact || "",
    joinDate: toDateYmd(row.join_date),
    notes: row.notes || ""
  };
}

function normalizeEmployee(row) {
  return {
    employeeId: row.employee_id,
    employeeName: row.employee_name || "",
    role: row.role || "",
    department: row.department || "",
    operatorId: row.operator_id || "",
    contact: row.contact || "",
    joinDate: toDateYmd(row.join_date),
    status: row.status || "Active",
    salaryRate: Number(row.salary_rate || 0),
    notes: row.notes || ""
  };
}

function normalizeEnumValue(row) {
  return {
    enumId: row.enum_id,
    enumGroup: row.enum_group || "",
    enumValue: row.enum_value || "",
    enumLabel: row.enum_label || "",
    displayOrder: Number(row.display_order || 0),
    isActive: row.is_active !== false,
    notes: row.notes || ""
  };
}

function employeeIdForOperator(operatorId) {
  const digits = String(operatorId || "").replace(/\D/g, "");
  return `EMP-${String(digits || "0").padStart(3, "0")}`;
}

async function syncOperatorEmployee(client, operator, user = {}) {
  try {
    const status = String(operator.status || "Active");
    const employeeId = employeeIdForOperator(operator.operator_id);
    if (status.toLowerCase() !== "active") {
      await client.query("update public.employees set status = 'Inactive' where operator_id = $1", [operator.operator_id]);
      return;
    }
    const { rows } = await client.query(
      `
      insert into public.employees (
        employee_id, employee_name, role, department, operator_id, contact,
        join_date, status, notes,
        entered_by_user_id, last_edited_by_user_id, created_by_name, updated_by_name
      )
      values ($1,$2,$3,'Factory',$4,$5,$6::date,'Active',$7,$8,$8,$9,$9)
      on conflict (employee_id) do update set
        employee_name = excluded.employee_name,
        role = excluded.role,
        department = excluded.department,
        operator_id = excluded.operator_id,
        contact = excluded.contact,
        join_date = excluded.join_date,
        status = 'Active',
        notes = excluded.notes,
        last_edited_by_user_id = excluded.last_edited_by_user_id,
        updated_by_name = excluded.updated_by_name
      returning employee_id
      `,
      [
        employeeId,
        operator.operator_name || "",
        operator.role || "",
        operator.operator_id,
        operator.contact || "",
        operator.join_date || null,
        operator.notes || "",
        user.userId || null,
        user.displayName || ""
      ]
    );
    await client.query("update public.operators set employee_id = $1 where operator_id = $2", [rows[0].employee_id, operator.operator_id]);
  } catch (error) {
    if (!["42P01", "42703", "23503"].includes(error.code)) throw error;
  }
}

async function syncEmployeeOperatorStatus(client, employee) {
  try {
    if (!employee.operator_id) return;
    await client.query(
      "update public.operators set employee_id = $1, status = $2 where operator_id = $3",
      [employee.employee_id, employee.status || "Active", employee.operator_id]
    );
  } catch (error) {
    if (!["42P01", "42703", "23503"].includes(error.code)) throw error;
  }
}

async function resolveEmployeeIdByName(client, payload, nameField = "paid_to") {
  if (payload.employee_id) return payload.employee_id;
  const employeeName = String(payload[nameField] || "").trim();
  if (!employeeName) return null;
  try {
    const { rows } = await client.query(
      `
      select employee_id
      from public.employees
      where lower(trim(employee_name)) = lower(trim($1))
      order by case when lower(coalesce(status, 'Active')) = 'active' then 0 else 1 end, employee_id asc
      limit 1
      `,
      [employeeName]
    );
    return rows[0]?.employee_id || null;
  } catch (error) {
    if (["42P01", "42703"].includes(error.code)) return null;
    throw error;
  }
}

async function resolveOperatorRef(client, payload) {
  const operatorId = String(payload.operatorId || payload.operator_id || "").trim();
  const operatorName = String(payload.operator || payload.operatorName || payload.operator_name_snapshot || "").trim();
  if (operatorId) {
    try {
      const { rows } = await client.query("select operator_id, operator_name from public.operators where operator_id = $1 limit 1", [operatorId]);
      if (rows[0]) return { operatorId: rows[0].operator_id, operatorName: rows[0].operator_name || operatorName };
    } catch (error) {
      if (!["42P01", "42703"].includes(error.code)) throw error;
    }
  }
  if (operatorName) {
    try {
      const { rows } = await client.query("select operator_id, operator_name from public.operators where lower(trim(operator_name)) = lower(trim($1)) order by operator_id asc limit 1", [operatorName]);
      if (rows[0]) return { operatorId: rows[0].operator_id, operatorName: rows[0].operator_name || operatorName };
    } catch (error) {
      if (!["42P01", "42703"].includes(error.code)) throw error;
    }
  }
  return { operatorId: operatorId || null, operatorName };
}

async function resolveMachineRef(client, payload) {
  const machineId = String(payload.machineId || payload.machine_id || "").trim();
  const machineName = String(payload.machine || payload.machineName || payload.machine_name_snapshot || "").trim();
  if (machineId) {
    try {
      const { rows } = await client.query("select machine_id, machine_name from public.machines where machine_id = $1 limit 1", [machineId]);
      if (rows[0]) return { machineId: rows[0].machine_id, machineName: rows[0].machine_name || machineName };
    } catch (error) {
      if (!["42P01", "42703"].includes(error.code)) throw error;
    }
  }
  if (machineName) {
    try {
      const { rows } = await client.query("select machine_id, machine_name from public.machines where lower(trim(machine_name)) = lower(trim($1)) order by machine_id asc limit 1", [machineName]);
      if (rows[0]) return { machineId: rows[0].machine_id, machineName: rows[0].machine_name || machineName };
    } catch (error) {
      if (!["42P01", "42703"].includes(error.code)) throw error;
    }
  }
  return { machineId: machineId || null, machineName };
}

function normalizeProduction(row) {
  return {
    productionId: row.prod_id,
    date: toDateYmd(row.production_date),
    productName: row.product_name_snapshot || "",
    productId: row.product_id || "",
    cupsPerPacket: Number(row.cups_per_packet || 0),
    packetsQty: Number(row.packets_qty || 0),
    boxQty: Number(row.box_qty || 0),
    totalCups: Number(row.total_cups || 0),
    operator: row.operator_name_snapshot || "",
    operatorId: row.operator_id || "",
    machine: row.machine_name_snapshot || "",
    machineId: row.machine_id || "",
    shift: row.shift || "",
    status: row.status || "Completed",
    notes: row.notes || ""
  };
}

function normalizeMaterialUsage(row) {
  return {
    usageId: row.usage_id,
    productionId: row.prod_id || "",
    date: toDateYmd(row.usage_date),
    materialName: row.material_name_snapshot || "",
    materialId: row.material_id || "",
    materialType: row.material_type || "",
    qtyUsed: Number(row.qty_used || 0),
    unit: row.unit || "KG",
    operator: row.operator_name_snapshot || "",
    operatorId: row.operator_id || "",
    machine: row.machine_name_snapshot || "",
    machineId: row.machine_id || "",
    shift: row.shift || "",
    notes: row.notes || ""
  };
}

function normalizeMaterialStock(row) {
  return {
    stockId: row.stock_id,
    materialId: row.material_id || "",
    materialName: row.material_name_snapshot || "",
    materialType: row.material_type || "",
    openingStock: Number(row.opening_stock || 0),
    closingStock: Number(row.closing_stock || 0),
    unit: row.unit || "KG",
    date: toDateYmd(row.stock_date),
    notes: row.notes || ""
  };
}

function liveModuleConfig(moduleKey) {
  const map = {
    customers: {
      table: "public.contacts",
      pk: "cid",
      prefix: "CID",
      dateField: "created_at",
      titleField: "name",
      amountField: null,
      columns: ["cid", "name", "company", "customer_type", "mobile", "city", "state", "contact_status", "aid", "created_by_name", "updated_by_name", "created_at", "updated_at"],
      createFields: ["name", "company", "customer_type", "mobile", "city", "state", "contact_status"],
      actorMode: "created_by"
    },
    leads: {
      table: "public.leads",
      pk: "lid",
      prefix: "LID",
      dateField: "follow_up_date",
      titleField: "name",
      amountField: null,
      columns: ["lid", "name", "company", "customer_type", "mobile", "city", "state", "lead_status", "source", "assigned_to", "follow_up_date", "notes", "converted_cid"],
      createFields: ["name", "company", "customer_type", "mobile", "city", "state", "lead_status", "source", "assigned_to", "follow_up_date", "notes", "converted_cid"],
      actorMode: "created_by"
    },
    sales: {
      table: "public.sales",
      pk: "sale_id",
      prefix: "SAL",
      dateField: "sale_date",
      titleField: "customer_name_snapshot",
      amountField: "total_amount",
      columns: ["sale_id", "sale_date", "customer_name_snapshot", "company_name_snapshot", "product_name_snapshot", "packaging_type", "packets_quantity", "box_quantity", "total_amount", "status", "note"],
      createFields: ["sale_date", "customer_name_snapshot", "company_name_snapshot", "customer_mobile_snapshot", "product_name_snapshot", "packaging_type", "unit_price", "packets_quantity", "box_quantity", "total_amount", "status", "note"],
      actorMode: "created_by"
    },
    payments: {
      table: "public.customer_payments",
      pk: "payment_id",
      dateField: "payment_date",
      titleField: "customer_name_snapshot",
      amountField: "amount_paid",
      columns: ["payment_id", "payment_date", "cid", "aid", "customer_name_snapshot", "company_name_snapshot", "customer_mobile_snapshot", "amount_paid", "payment_mode"],
      createFields: ["payment_date", "cid", "aid", "customer_name_snapshot", "company_name_snapshot", "customer_mobile_snapshot", "amount_paid", "payment_mode"],
      actorMode: "created_by"
    },
    products: {
      table: "public.products",
      pk: "product_id",
      prefix: "PRD",
      dateField: "created_at",
      titleField: "name",
      amountField: null,
      columns: ["product_id", "name", "category", "is_active", "created_at"],
      createFields: ["name", "category", "is_active"],
      actorMode: "created_by"
    },
    materials_master: {
      table: "public.materials",
      pk: "material_id",
      prefix: "MAT",
      dateField: "created_at",
      titleField: "material_name",
      amountField: null,
      columns: ["material_id", "material_name", "material_type", "type_id", "notes", "created_at"],
      createFields: ["material_name", "material_type", "type_id", "notes"],
      actorMode: "created_by"
    },
    purchases: {
      table: "public.material_purchases",
      pk: "purchase_id",
      prefix: "PUR",
      dateField: "purchase_date",
      titleField: "material_name_snapshot",
      amountField: "total_amount",
      columns: ["purchase_id", "trip_id", "purchase_date", "vendor_name_snapshot", "material_name_snapshot", "material_type", "total_qty", "total_kg", "cost_per_kg", "total_amount", "notes"],
      createFields: ["trip_id", "purchase_date", "vendor_name_snapshot", "material_name_snapshot", "material_type", "total_qty", "total_kg", "cost_per_kg", "total_amount", "notes"],
      actorMode: "created_by"
    },
    vendor_payments: {
      table: "public.vendor_payments",
      pk: "payment_id",
      prefix: "VPAY",
      dateField: "payment_date",
      titleField: "vendor_name_snapshot",
      amountField: "amount",
      columns: ["payment_id", "payment_date", "vendor_name_snapshot", "amount", "payment_method", "notes"],
      createFields: ["payment_date", "vendor_name_snapshot", "amount", "payment_method", "notes"],
      actorMode: "created_by"
    },
    production: {
      table: "public.productions",
      pk: "prod_id",
      prefix: "PR",
      dateField: "production_date",
      titleField: "product_name_snapshot",
      amountField: "total_cups",
      columns: ["prod_id", "production_date", "product_name_snapshot", "cups_per_packet", "packets_qty", "box_qty", "total_cups", "operator_name_snapshot", "machine_name_snapshot", "shift", "status", "notes"],
      createFields: ["production_date", "product_name_snapshot", "cups_per_packet", "packets_qty", "box_qty", "total_cups", "operator_name_snapshot", "machine_name_snapshot", "shift", "status", "notes"],
      actorMode: "created_by"
    },
    material_usage: {
      table: "public.material_usage",
      pk: "usage_id",
      prefix: "MU",
      dateField: "usage_date",
      titleField: "material_name_snapshot",
      amountField: "qty_used",
      columns: ["usage_id", "prod_id", "usage_date", "material_name_snapshot", "material_type", "qty_used", "unit", "operator_name_snapshot", "machine_name_snapshot", "shift", "notes"],
      createFields: ["prod_id", "usage_date", "material_name_snapshot", "material_type", "qty_used", "unit", "operator_name_snapshot", "machine_name_snapshot", "shift", "notes"],
      actorMode: "created_by"
    },
    material_stock: {
      table: "public.material_stock",
      pk: "stock_id",
      prefix: "SK",
      dateField: "stock_date",
      titleField: "material_name_snapshot",
      amountField: "closing_stock",
      columns: ["stock_id", "material_id", "material_name_snapshot", "material_type", "opening_stock", "closing_stock", "unit", "stock_date", "notes"],
      createFields: ["material_id", "material_name_snapshot", "material_type", "opening_stock", "closing_stock", "unit", "stock_date", "notes"],
      actorMode: "created_by"
    },
    resources: {
      table: "public.machines",
      pk: "machine_id",
      prefix: "MC",
      dateField: "updated_at",
      titleField: "machine_name",
      amountField: "capacity_per_shift",
      columns: ["machine_id", "machine_name", "machine_type", "status", "capacity_per_shift", "location", "last_maintenance", "notes"],
      createFields: ["machine_name", "machine_type", "status", "capacity_per_shift", "location", "last_maintenance", "notes"],
      actorMode: "created_by"
    },
    users: {
      table: "public.app_users",
      pk: "user_id",
      dateField: "created_at",
      titleField: "display_name",
      amountField: null,
      columns: ["user_id", "username", "display_name", "role", "is_active", "last_login_at", "created_at"],
      createFields: []
    },
    salary_payments: {
      table: "public.salary_payments",
      pk: "salary_payment_id",
      dateField: "payment_date",
      titleField: "paid_to",
      amountField: "amount",
      columns: ["salary_payment_id", "payment_date", "paid_to", "payment_type", "amount", "payment_method", "comments", "created_at"],
      createFields: ["payment_date", "paid_to", "payment_type", "amount", "payment_method", "comments"],
      actorMode: "entered_by"
    },
    operational_expenses: {
      table: "public.operational_expenses",
      pk: "expense_id",
      dateField: "expense_date",
      titleField: "paid_to",
      amountField: "amount",
      columns: ["expense_id", "expense_date", "expense_type", "paid_to", "amount", "comments", "created_at"],
      createFields: ["expense_date", "expense_type", "paid_to", "amount", "comments"],
      actorMode: "entered_by"
    },
    expense_advances: {
      table: "public.expense_advances",
      pk: "expense_advance_id",
      dateField: "payment_date",
      titleField: "paid_to",
      amountField: "amount",
      columns: ["expense_advance_id", "payment_date", "paid_to", "amount", "created_at"],
      createFields: ["payment_date", "paid_to", "amount"],
      actorMode: "entered_by"
    }
  };
  return map[moduleKey] || null;
}

function coerceLiveValue(value) {
  if (value === "" || value === undefined) return null;
  return value;
}

function customerAccountValue(payload, ...keys) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) return String(payload[key]).trim();
  }
  return "";
}

function customerSelectSql(whereSql = "") {
  return `
    select
      c.cid,
      c.name,
      c.company,
      c.customer_type,
      c.mobile,
      c.city,
      c.state,
      c.contact_status,
      coalesce(c.aid, a.aid) as aid,
      c.created_by_name,
      c.updated_by_name,
      c.created_at,
      c.updated_at,
      a.aid as account_aid,
      a.address as account_address,
      a.city as account_city,
      a.state as account_state,
      a.zipcode as account_zipcode,
      a.gst_number as account_gst_number
    from public.contacts c
    left join lateral (
      select a.*
      from public.accounts a
      where a.aid = c.aid or a.cid = c.cid
      order by case when a.aid = c.aid then 0 else 1 end
      limit 1
    ) a on true
    ${whereSql}
  `;
}

async function queryCustomerById(client, customerId) {
  const { rows } = await client.query(`${customerSelectSql("where c.cid = $1")} limit 1`, [customerId]);
  return rows[0] || null;
}

async function listCustomersWithAccounts() {
  await ensureAccountSchema();
  const [summary, list] = await Promise.all([
    pool.query(`
      select
        count(*)::integer as total_count,
        0::numeric as amount_total,
        count(*) filter (where created_at >= date_trunc('month', current_date))::integer as month_count
      from public.contacts
    `),
    pool.query(`${customerSelectSql()} order by c.created_at desc nulls last, c.cid desc limit 100`)
  ]);
  return { summary: summary.rows[0], rows: list.rows };
}

async function createCustomerWithAccount(req, payload) {
  await ensureAccountSchema();
  const client = await pool.connect();
  try {
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const cid = nextId("CID");
    const aid = nextId("AID");
    const contactStatus = customerAccountValue(payload, "contact_status") || "Active";
    const name = customerAccountValue(payload, "name");
    const company = customerAccountValue(payload, "company") || name;
    const city = customerAccountValue(payload, "city");
    const state = customerAccountValue(payload, "state", "account_state");
    await client.query("begin");
    await client.query(
      `
      insert into public.contacts (
        cid, name, company, customer_type, mobile, city, state, contact_status, aid,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $11)
      `,
      [
        cid,
        name || null,
        company || null,
        customerAccountValue(payload, "customer_type") || null,
        customerAccountValue(payload, "mobile") || null,
        city || null,
        state || null,
        contactStatus,
        aid,
        actorUserId,
        actorName
      ]
    );
    await client.query(
      `
      insert into public.accounts (
        aid, cid, contact_name, company, account_status, mobile, city, state, address, zipcode, gst_number,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $12, $13)
      `,
      [
        aid,
        cid,
        name || null,
        company || null,
        contactStatus,
        customerAccountValue(payload, "mobile") || null,
        customerAccountValue(payload, "account_city", "city") || null,
        customerAccountValue(payload, "account_state", "state") || null,
        customerAccountValue(payload, "account_address", "address") || null,
        customerAccountValue(payload, "account_zipcode", "zipcode") || null,
        customerAccountValue(payload, "account_gst_number", "gst_number") || null,
        actorUserId,
        actorName
      ]
    );
    const row = await queryCustomerById(client, cid);
    await client.query("commit");
    return row;
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    throw error;
  } finally {
    client.release();
  }
}

async function updateCustomerWithAccount(req, customerId, payload) {
  await ensureAccountSchema();
  const client = await pool.connect();
  try {
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    await client.query("begin");
    const existing = await queryCustomerById(client, customerId);
    if (!existing) {
      await client.query("rollback");
      return null;
    }
    const aid = existing.aid || nextId("AID");
    const name = customerAccountValue(payload, "name");
    const company = customerAccountValue(payload, "company") || name;
    const contactStatus = customerAccountValue(payload, "contact_status") || "Active";
    await client.query(
      `
      update public.contacts
      set name = $2,
          company = $3,
          customer_type = $4,
          mobile = $5,
          city = $6,
          state = $7,
          contact_status = $8,
          aid = $9,
          updated_by_user_id = $10,
          updated_by_name = $11
      where cid = $1
      `,
      [
        customerId,
        name || null,
        company || null,
        customerAccountValue(payload, "customer_type") || null,
        customerAccountValue(payload, "mobile") || null,
        customerAccountValue(payload, "city") || null,
        customerAccountValue(payload, "state") || null,
        contactStatus,
        aid,
        actorUserId,
        actorName
      ]
    );
    await client.query(
      `
      insert into public.accounts (
        aid, cid, contact_name, company, account_status, mobile, city, state, address, zipcode, gst_number,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $12, $13)
      on conflict (aid) do update
      set cid = excluded.cid,
          contact_name = excluded.contact_name,
          company = excluded.company,
          account_status = excluded.account_status,
          mobile = excluded.mobile,
          city = excluded.city,
          state = excluded.state,
          address = excluded.address,
          zipcode = excluded.zipcode,
          gst_number = excluded.gst_number,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_by_name = excluded.updated_by_name,
          updated_at = now()
      `,
      [
        aid,
        customerId,
        name || null,
        company || null,
        contactStatus,
        customerAccountValue(payload, "mobile") || null,
        customerAccountValue(payload, "account_city", "city") || null,
        customerAccountValue(payload, "account_state", "state") || null,
        customerAccountValue(payload, "account_address", "address") || null,
        customerAccountValue(payload, "account_zipcode", "zipcode") || null,
        customerAccountValue(payload, "account_gst_number", "gst_number") || null,
        actorUserId,
        actorName
      ]
    );
    const row = await queryCustomerById(client, customerId);
    await client.query("commit");
    return row;
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    throw error;
  } finally {
    client.release();
  }
}

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!username || !password) {
      await writeLoginAudit(req, { username, success: false, reason: "Missing username or password" });
      return res.status(400).json({ error: "Username and password are required" });
    }
    const user = await queryUserByUsername(username);
    if (!user || !user.is_active) {
      await writeLoginAudit(req, { username, success: false, reason: "Invalid credentials" });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const valid = await verifyPassword(username, password);
    if (!valid) {
      await writeLoginAudit(req, { username, userId: user.user_id, success: false, reason: "Invalid credentials" });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const permissions = await queryUserPermissions(user.user_id);
    const session = await createSession(req, res, user, permissions);
    await writeLoginAudit(req, { username, userId: user.user_id, success: true });
    return res.json(session);
  } catch (error) {
    console.error("LOGIN_ERROR", error);
    return res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/logout", requireAuth, async (req, res) => {
  await revokeSession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: req.sessionData.user,
    permissions: req.sessionData.permissions
  });
});

app.get("/api/session", requireAuth, (req, res) => {
  res.json({
    user: req.sessionData.user,
    permissions: req.sessionData.permissions
  });
});

app.get("/api/home", requireAuth, async (req, res) => {
  try {
    await ensureHomeSchema();
    const userId = req.sessionData.user.userId;
    const tasksSql = `
      select task_id, title, due_date::text as due_date, status, priority, assigned_user_id,
             source_type, source_id, source_label, notes, created_by_name, completed_at
      from public.tasks
      where coalesce(status, 'Open') <> 'Completed'
        and (assigned_user_id is null or assigned_user_id = $1 or created_by_user_id = $1)
      order by due_date asc, created_at desc
      limit 200
    `;
    const leadSql = `
      select lid, name, company, mobile, city, follow_up_date::text as follow_up_date, lead_status, assigned_to, notes
      from public.leads
      where follow_up_date is not null
        and coalesce(lead_status, '') not in ('Converted', 'Lost')
      order by follow_up_date asc
      limit 200
    `;
    const [tasksRes, leadsRes] = await Promise.all([
      pool.query(tasksSql, [userId]),
      modulePermission(req, "leads", "view") || isSuperAdmin(req) ? pool.query(leadSql) : Promise.resolve({ rows: [] })
    ]);
    const leadTasks = (leadsRes.rows || []).map((row) => ({
      taskId: `LEAD-${row.lid}`,
      title: `Follow up: ${row.company || row.name || row.lid}`,
      dueDate: row.follow_up_date || "",
      status: row.lead_status || "Open",
      priority: "Follow-up",
      assignedUserId: "",
      sourceType: "lead",
      sourceId: row.lid,
      sourceLabel: row.company || row.name || row.lid,
      notes: row.notes || "",
      createdByName: row.assigned_to || "",
      completedAt: null,
      isLeadFollowUp: true
    }));
    res.json({
      user: req.sessionData.user,
      tasks: [...(tasksRes.rows || []).map(normalizeTaskRow), ...leadTasks]
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/tasks", requireAuth, async (req, res) => {
  try {
    await ensureHomeSchema();
    const userId = req.sessionData.user.userId;
    const { rows } = await pool.query(
      `
      select task_id, title, due_date::text as due_date, status, priority, assigned_user_id,
             source_type, source_id, source_label, notes, created_by_name, completed_at
      from public.tasks
      where assigned_user_id is null or assigned_user_id = $1 or created_by_user_id = $1
      order by due_date asc, created_at desc
      limit 300
      `,
      [userId]
    );
    res.json({ tasks: rows.map(normalizeTaskRow) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/tasks", requireAuth, async (req, res) => {
  try {
    await ensureHomeSchema();
    const title = String(req.body?.title || "").trim();
    const dueDate = String(req.body?.dueDate || req.body?.due_date || "").trim();
    if (!title) return res.status(400).json({ error: "Task title is required" });
    if (!dueDate) return res.status(400).json({ error: "Due date is required" });
    const taskId = nextId("TASK");
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const { rows } = await pool.query(
      `
      insert into public.tasks (
        task_id, title, due_date, status, priority, assigned_user_id, source_type, source_id, source_label, notes,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11, $12)
      returning task_id, title, due_date::text as due_date, status, priority, assigned_user_id,
                source_type, source_id, source_label, notes, created_by_name, completed_at
      `,
      [
        taskId,
        title,
        dueDate,
        String(req.body?.status || "Open").trim() || "Open",
        String(req.body?.priority || "Normal").trim() || "Normal",
        req.body?.assignedUserId || actorUserId,
        req.body?.sourceType || "task",
        req.body?.sourceId || null,
        req.body?.sourceLabel || null,
        req.body?.notes || null,
        actorUserId,
        actorName
      ]
    );
    res.json({ success: true, task: normalizeTaskRow(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.put("/api/tasks/:taskId", requireAuth, async (req, res) => {
  try {
    await ensureHomeSchema();
    const taskId = String(req.params.taskId || "").trim();
    const title = String(req.body?.title || "").trim();
    const dueDate = String(req.body?.dueDate || req.body?.due_date || "").trim();
    if (!taskId) return res.status(400).json({ error: "taskId is required" });
    if (!title) return res.status(400).json({ error: "Task title is required" });
    if (!dueDate) return res.status(400).json({ error: "Due date is required" });
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const { rows } = await pool.query(
      `
      update public.tasks
      set title = $2,
          due_date = $3::date,
          status = $4,
          priority = $5,
          notes = $6,
          updated_by_user_id = $7,
          updated_by_name = $8
      where task_id = $1
        and (created_by_user_id = $7 or assigned_user_id = $7 or $9 = true)
      returning task_id, title, due_date::text as due_date, status, priority, assigned_user_id,
                source_type, source_id, source_label, notes, created_by_name, completed_at
      `,
      [
        taskId,
        title,
        dueDate,
        String(req.body?.status || "Open").trim() || "Open",
        String(req.body?.priority || "Normal").trim() || "Normal",
        req.body?.notes || null,
        actorUserId,
        actorName,
        isSuperAdmin(req)
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true, task: normalizeTaskRow(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/tasks/:taskId/complete", requireAuth, async (req, res) => {
  try {
    await ensureHomeSchema();
    const taskId = String(req.params.taskId || "").trim();
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const { rows } = await pool.query(
      `
      update public.tasks
      set status = 'Completed',
          completed_at = now(),
          updated_by_user_id = $2,
          updated_by_name = $3
      where task_id = $1
        and (created_by_user_id = $2 or assigned_user_id = $2 or $4 = true)
      returning task_id, title, due_date::text as due_date, status, priority, assigned_user_id,
                source_type, source_id, source_label, notes, created_by_name, completed_at
      `,
      [taskId, actorUserId, actorName, isSuperAdmin(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true, task: normalizeTaskRow(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/organisation", requireAuth, async (_req, res) => {
  try {
    await ensureHomeSchema();
    const { rows } = await pool.query("select * from public.organisation where is_active = true order by created_at asc limit 1");
    res.json({ organisation: normalizeOrganisationRow(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/admin/organisation", requireAuth, async (req, res) => {
  try {
    await ensureHomeSchema();
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    const { rows } = await pool.query("select * from public.organisation where is_active = true order by created_at asc limit 1");
    res.json({ organisation: normalizeOrganisationRow(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.put("/api/admin/organisation", requireAuth, async (req, res) => {
  try {
    await ensureHomeSchema();
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    const companyName = String(req.body?.companyName || req.body?.company_name || "").trim();
    if (!companyName) return res.status(400).json({ error: "Company name is required" });
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const { rows } = await pool.query(
      `
      insert into public.organisation (
        organisation_id, company_name, address, gst_number, logo_url, is_active,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ('ORG-DEFAULT', $1, $2, $3, $4, true, $5, $6, $5, $6)
      on conflict (organisation_id) do update
      set company_name = excluded.company_name,
          address = excluded.address,
          gst_number = excluded.gst_number,
          logo_url = excluded.logo_url,
          is_active = true,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_by_name = excluded.updated_by_name
      returning *
      `,
      [
        companyName,
        req.body?.address || "",
        req.body?.gstNumber || req.body?.gst_number || "",
        req.body?.logoUrl || req.body?.logo_url || "",
        actorUserId,
        actorName
      ]
    );
    res.json({ success: true, organisation: normalizeOrganisationRow(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/admin/modules", requireAuth, async (req, res) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    const sql = `
      select module_key, module_name, module_group, display_order, is_active
      from public.app_modules
      order by display_order asc, module_name asc
    `;
    const { rows } = await pool.query(sql);
    res.json({ modules: rows });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/admin/dashboard", requireAuth, async (req, res) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });

    const countsSql = `
      select
        count(*)::integer as total_users,
        count(*) filter (where is_active = true)::integer as active_users,
        count(*) filter (where is_active = false)::integer as inactive_users,
        count(*) filter (where role = 'super_admin')::integer as super_admins,
        count(*) filter (where must_change_password = true)::integer as must_change_password
      from public.app_users
    `;
    const todayLoginsSql = `
      select
        count(*)::integer as login_attempts_today,
        count(*) filter (where success = true)::integer as login_success_today,
        count(*) filter (where success = false)::integer as login_failed_today
      from public.app_login_audit
      where login_at >= date_trunc('day', now())
    `;
    const sessionsSql = `
      select count(*)::integer as active_sessions
      from public.app_sessions
      where revoked_at is null
        and expires_at > now()
    `;
    const recentSql = `
      select
        a.login_at,
        a.success,
        a.username,
        u.display_name,
        a.failure_reason,
        a.ip_address
      from public.app_login_audit a
      left join public.app_users u on u.user_id = a.user_id
      order by a.login_at desc
      limit 20
    `;

    const [countsRes, todayRes, sessionsRes, recentRes] = await Promise.all([
      pool.query(countsSql),
      pool.query(todayLoginsSql),
      pool.query(sessionsSql),
      pool.query(recentSql)
    ]);

    res.json({
      summary: {
        ...(countsRes.rows[0] || {}),
        ...(todayRes.rows[0] || {}),
        ...(sessionsRes.rows[0] || {})
      },
      recent_logins: recentRes.rows || []
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.patch("/api/admin/modules/:moduleKey", requireAuth, async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: "Only Super Admin can toggle applications" });
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    const isActive = Boolean(req.body?.is_active);
    const sql = `
      update public.app_modules
      set is_active = $2
      where module_key = $1
      returning module_key, module_name, module_group, display_order, is_active
    `;
    const { rows } = await pool.query(sql, [moduleKey, isActive]);
    if (!rows.length) return res.status(404).json({ error: "Module not found" });
    res.json({ module: rows[0] });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/admin/users", requireAuth, async (req, res) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    const sql = `
      select user_id, username, display_name, role, is_active, must_change_password, last_login_at, created_at
      from public.app_users
      order by created_at desc
      limit 300
    `;
    const { rows } = await pool.query(sql);
    res.json({ users: rows });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/admin/users/:userId/access", requireAuth, async (req, res) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    const userId = String(req.params.userId || "").trim();
    const sql = `
      select module_key, can_view, can_create, can_update, can_delete, can_edit_own
      from public.app_user_module_access
      where user_id = $1
      order by module_key asc
    `;
    const { rows } = await pool.query(sql, [userId]);
    res.json({ access: rows });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/admin/users", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    if (!isSuperAdmin(req)) return res.status(403).json({ error: "Only Super Admin can create users" });
    const username = String(req.body?.username || "").trim();
    const displayName = String(req.body?.display_name || "").trim();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "user").trim() || "user";
    const isActive = req.body?.is_active !== false;
    const access = Array.isArray(req.body?.access) ? req.body.access : [];
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    if (!username || !displayName || !password) return res.status(400).json({ error: "username, display_name and password are required" });

    await client.query("begin");
    const userId = nextId("USR");
    await client.query(
      `
      insert into public.app_users (
        user_id, username, display_name, password_hash, role, is_active, must_change_password,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      ) values (
        $1, $2, $3, crypt($4, gen_salt('bf')), $5, $6, true, $7, $8, $7, $8
      )
      `,
      [userId, username, displayName, password, role, isActive, actorUserId, actorName]
    );

    for (const row of access) {
      await client.query(
        `
        insert into public.app_user_module_access (
          user_id, module_key, can_view, can_create, can_update, can_delete, can_edit_own
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (user_id, module_key) do update set
          can_view = excluded.can_view,
          can_create = excluded.can_create,
          can_update = excluded.can_update,
          can_delete = excluded.can_delete,
          can_edit_own = excluded.can_edit_own
        `,
        [
          userId,
          row.module_key,
          Boolean(row.can_view),
          Boolean(row.can_create),
          Boolean(row.can_update),
          Boolean(row.can_delete),
          Boolean(row.can_edit_own)
        ]
      );
    }

    await client.query("commit");
    res.json({ success: true, user_id: userId });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/admin/users/:userId", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    const userId = String(req.params.userId || "").trim();
    const displayName = String(req.body?.display_name || "").trim();
    const role = String(req.body?.role || "user").trim() || "user";
    const isActive = req.body?.is_active !== false;
    const access = Array.isArray(req.body?.access) ? req.body.access : [];
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    if (!displayName) return res.status(400).json({ error: "display_name is required" });

    await client.query("begin");
    await client.query(
      `
      update public.app_users
      set display_name = $2, role = $3, is_active = $4, updated_by_user_id = $5, updated_by_name = $6
      where user_id = $1
      `,
      [userId, displayName, role, isActive, actorUserId, actorName]
    );

    await client.query("delete from public.app_user_module_access where user_id = $1", [userId]);
    for (const row of access) {
      await client.query(
        `
        insert into public.app_user_module_access (
          user_id, module_key, can_view, can_create, can_update, can_delete, can_edit_own
        ) values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          userId,
          row.module_key,
          Boolean(row.can_view),
          Boolean(row.can_create),
          Boolean(row.can_update),
          Boolean(row.can_delete),
          Boolean(row.can_edit_own)
        ]
      );
    }
    await client.query("commit");
    res.json({ success: true });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.post("/api/admin/users/:userId/reset-password", requireAuth, async (req, res) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ error: "Forbidden" });
    if (!isSuperAdmin(req)) return res.status(403).json({ error: "Only Super Admin can reset passwords" });
    const userId = String(req.params.userId || "").trim();
    const password = String(req.body?.password || "");
    if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const sql = `
      update public.app_users
      set password_hash = crypt($2, gen_salt('bf')),
          must_change_password = true
      where user_id = $1
    `;
    await pool.query(sql, [userId, password]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/sales/entries", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "sales", "view")) return res.status(403).json({ error: "Forbidden" });
    await ensureAccountSchema();
    const sql = `
      select
        s.sale_entry_id,
        s.sale_date,
        s.cid,
        coalesce(s.aid, max(a.aid), max(c.aid)) as aid,
        s.customer_name_snapshot,
        s.company_name_snapshot,
        s.customer_mobile_snapshot,
        s.status,
        s.note,
        s.total_amount,
        s.created_by_name,
        s.updated_by_name,
        s.created_at,
        s.updated_at,
        max(a.address) as account_address,
        coalesce(max(a.city), max(c.city)) as account_city,
        coalesce(max(a.state), max(c.state)) as account_state,
        max(a.zipcode) as account_zipcode,
        max(a.gst_number) as account_gst_number,
        coalesce(json_agg(
          json_build_object(
            'sale_line_id', l.sale_line_id,
            'product_id', l.product_id,
            'price_id', l.price_id,
            'packaging_type', l.packaging_type,
            'product_name_snapshot', l.product_name_snapshot,
            'unit_price', l.unit_price,
            'package_qty', l.package_qty,
            'list_sale_packet_price', l.list_sale_packet_price,
            'updated_list_sale_packet_price', l.updated_list_sale_packet_price,
            'sale_price_per_cup', l.sale_price_per_cup,
            'source_product_id', l.source_product_id,
            'packets_quantity', l.packets_quantity,
            'box_quantity', l.box_quantity,
            'total_amount', l.total_amount
          )
          order by l.created_at asc
        ) filter (where l.sale_line_id is not null), '[]'::json) as lines
      from public.sales_entries s
      left join public.contacts c on c.cid = s.cid
      left join lateral (
        select a.*
        from public.accounts a
        where a.aid = s.aid
           or a.aid = c.aid
           or a.cid = s.cid
        order by case when a.aid = s.aid then 0 when a.aid = c.aid then 1 else 2 end
        limit 1
      ) a on true
      left join public.sales_line_items l on l.sale_entry_id = s.sale_entry_id
      group by s.sale_entry_id
      order by s.sale_date desc nulls last, s.created_at desc
      limit 300
    `;
    const { rows } = await pool.query(sql);
    res.json({ rows });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/sales/entries", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "sales", "create")) return res.status(403).json({ error: "Forbidden" });
    const payload = req.body || {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!payload.sale_date) return res.status(400).json({ error: "sale_date is required" });
    if (!payload.customer_name_snapshot) return res.status(400).json({ error: "customer is required" });
    if (!lines.length) return res.status(400).json({ error: "at least one line item is required" });
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const total = lines.reduce((sum, l) => sum + Number(l.total_amount || 0), 0);

    await client.query("begin");
    const saleEntryId = await nextSaleEntryId(client, payload.sale_date);
    await client.query(
      `
      insert into public.sales_entries (
        sale_entry_id, sale_date, cid, aid, customer_name_snapshot, company_name_snapshot, customer_mobile_snapshot,
        status, note, total_amount, created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11, $12
      )
      `,
      [
        saleEntryId,
        payload.sale_date,
        payload.cid || null,
        payload.aid || null,
        payload.customer_name_snapshot || null,
        payload.company_name_snapshot || null,
        payload.customer_mobile_snapshot || null,
        payload.status || null,
        payload.note || null,
        total,
        actorUserId,
        actorName
      ]
    );

    for (const line of lines) {
      await client.query(
        `
        insert into public.sales_line_items (
          sale_line_id, sale_entry_id, product_id, price_id, packaging_type, product_name_snapshot,
          unit_price, package_qty, list_sale_packet_price, updated_list_sale_packet_price, sale_price_per_cup, source_product_id,
          packets_quantity, box_quantity, total_amount
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        `,
        [
          nextId("SL"),
          saleEntryId,
          line.product_id || null,
          line.price_id || null,
          line.packaging_type || null,
          line.product_name_snapshot || null,
          Number(line.unit_price || 0),
          Number(line.package_qty || 0),
          Number(line.list_sale_packet_price || 0),
          Number(line.updated_list_sale_packet_price || 0),
          Number(line.sale_price_per_cup || 0),
          line.source_product_id || null,
          Number(line.packets_quantity || 0),
          Number(line.box_quantity || 0),
          Number(line.total_amount || 0)
        ]
      );
    }

    await client.query("commit");
    res.json({ success: true, sale_entry_id: saleEntryId });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/sales/entries/:saleEntryId", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "sales", "update")) return res.status(403).json({ error: "Forbidden" });
    const saleEntryId = String(req.params.saleEntryId || "").trim();
    const payload = req.body || {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!saleEntryId) return res.status(400).json({ error: "saleEntryId is required" });
    if (!payload.sale_date) return res.status(400).json({ error: "sale_date is required" });
    if (!payload.customer_name_snapshot) return res.status(400).json({ error: "customer is required" });
    if (!lines.length) return res.status(400).json({ error: "at least one line item is required" });
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const total = lines.reduce((sum, l) => sum + Number(l.total_amount || 0), 0);

    await client.query("begin");
    await client.query(
      `
      update public.sales_entries
      set sale_date = $2,
          cid = $3,
          aid = $4,
          customer_name_snapshot = $5,
          company_name_snapshot = $6,
          customer_mobile_snapshot = $7,
          status = $8,
          note = $9,
          total_amount = $10,
          updated_by_user_id = $11,
          updated_by_name = $12
      where sale_entry_id = $1
      `,
      [
        saleEntryId,
        payload.sale_date,
        payload.cid || null,
        payload.aid || null,
        payload.customer_name_snapshot || null,
        payload.company_name_snapshot || null,
        payload.customer_mobile_snapshot || null,
        payload.status || null,
        payload.note || null,
        total,
        actorUserId,
        actorName
      ]
    );
    await client.query("delete from public.sales_line_items where sale_entry_id = $1", [saleEntryId]);
    for (const line of lines) {
      await client.query(
        `
        insert into public.sales_line_items (
          sale_line_id, sale_entry_id, product_id, price_id, packaging_type, product_name_snapshot,
          unit_price, package_qty, list_sale_packet_price, updated_list_sale_packet_price, sale_price_per_cup, source_product_id,
          packets_quantity, box_quantity, total_amount
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        `,
        [
          nextId("SL"),
          saleEntryId,
          line.product_id || null,
          line.price_id || null,
          line.packaging_type || null,
          line.product_name_snapshot || null,
          Number(line.unit_price || 0),
          Number(line.package_qty || 0),
          Number(line.list_sale_packet_price || 0),
          Number(line.updated_list_sale_packet_price || 0),
          Number(line.sale_price_per_cup || 0),
          line.source_product_id || null,
          Number(line.packets_quantity || 0),
          Number(line.box_quantity || 0),
          Number(line.total_amount || 0)
        ]
      );
    }

    await client.query("commit");
    res.json({ success: true });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.delete("/api/sales/entries/:saleEntryId", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "sales", "delete")) return res.status(403).json({ error: "Forbidden" });
    const saleEntryId = String(req.params.saleEntryId || "").trim();
    if (!saleEntryId) return res.status(400).json({ error: "saleEntryId is required" });
    await client.query("begin");
    await client.query("delete from public.sales_line_items where sale_entry_id = $1", [saleEntryId]);
    const { rowCount } = await client.query("delete from public.sales_entries where sale_entry_id = $1", [saleEntryId]);
    if (!rowCount) {
      await client.query("rollback");
      return res.status(404).json({ error: "Sale entry not found" });
    }
    await client.query("commit");
    res.json({ success: true });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.get("/api/admin/products-pricing", requireAuth, async (req, res) => {
  try {
    if (!productAdminPermission(req, "view")) return res.status(403).json({ error: "Forbidden" });
    const [productsRes, pricingRes] = await Promise.all([
      pool.query(`
        select product_id, name, category, is_active
        from public.products
        order by name asc, product_id asc
      `),
      pool.query(`
        select
          px.price_id,
          px.product_id,
          p.name as product_name,
          p.category as product_category,
          px.packaging_type,
          px.unit_price,
          px.effective_from,
          px.is_active
        from public.product_prices px
        left join public.products p on p.product_id = px.product_id
        order by p.name asc nulls last, px.product_id asc, px.packaging_type asc, px.effective_from desc nulls last
      `)
    ]);
    res.json({
      products: productsRes.rows.map(normalizeProduct),
      pricing: pricingRes.rows.map(normalizePricing),
      packagingTypes: PRODUCT_PACKAGING_TYPES
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/admin/products", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!productAdminPermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    const payload = req.body || {};
    const name = String(payload.name || "").trim();
    const category = String(payload.category || "").trim();
    const isActive = payload.isActive !== false;
    if (!name) return res.status(400).json({ error: "Product name is required." });
    if (!category) return res.status(400).json({ error: "Category is required." });

    await client.query("begin");
    const dupe = await client.query(
      `
      select product_id
      from public.products
      where lower(name) = lower($1)
        and lower(coalesce(category, '')) = lower($2)
      limit 1
      `,
      [name, category]
    );
    if (dupe.rows.length) {
      await client.query("rollback");
      return res.status(409).json({ error: "A product with this name and category already exists." });
    }

    const productId = await nextSequentialId(client, "public.products", "product_id", "P", 3);
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const { rows } = await client.query(
      `
      insert into public.products (
        product_id, name, category, is_active,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3, $4, $5, $6, $5, $6)
      returning product_id, name, category, is_active
      `,
      [productId, name, category, isActive, actorUserId, actorName]
    );
    await client.query("commit");
    res.json({ success: true, productId, product: normalizeProduct(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/admin/products/:productId", requireAuth, async (req, res) => {
  try {
    if (!productAdminPermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    const productId = String(req.params.productId || "").trim();
    const payload = req.body || {};
    const name = String(payload.name || "").trim();
    const category = String(payload.category || "").trim();
    const isActive = payload.isActive !== false;
    if (!productId) return res.status(400).json({ error: "Product ID is required." });
    if (!name) return res.status(400).json({ error: "Product name is required." });
    if (!category) return res.status(400).json({ error: "Category is required." });

    const dupe = await pool.query(
      `
      select product_id
      from public.products
      where product_id <> $1
        and lower(name) = lower($2)
        and lower(coalesce(category, '')) = lower($3)
      limit 1
      `,
      [productId, name, category]
    );
    if (dupe.rows.length) return res.status(409).json({ error: "A product with this name and category already exists." });

    const { rows } = await pool.query(
      `
      update public.products
      set name = $2,
          category = $3,
          is_active = $4,
          updated_by_user_id = $5,
          updated_by_name = $6
      where product_id = $1
      returning product_id, name, category, is_active
      `,
      [productId, name, category, isActive, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Product not found." });
    res.json({ success: true, product: normalizeProduct(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/admin/products/:productId", requireAuth, async (req, res) => {
  try {
    if (!productAdminPermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    const productId = String(req.params.productId || "").trim();
    const { rowCount } = await pool.query(
      `
      update public.products
      set is_active = false,
          updated_by_user_id = $2,
          updated_by_name = $3
      where product_id = $1
      `,
      [productId, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rowCount) return res.status(404).json({ error: "Product not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/admin/pricing", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!productAdminPermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    const payload = req.body || {};
    const productId = String(payload.productId || "").trim();
    const packagingType = String(payload.packagingType || "").trim().toUpperCase();
    const unitPrice = Number(payload.unitPrice || 0);
    const effectiveFrom = String(payload.effectiveFrom || "").trim() || null;
    const isActive = payload.isActive !== false;
    if (!productId) return res.status(400).json({ error: "Product is required." });
    if (!PRODUCT_PACKAGING_TYPES.includes(packagingType)) return res.status(400).json({ error: `Packaging type must be one of: ${PRODUCT_PACKAGING_TYPES.join(", ")}.` });
    if (!unitPrice || unitPrice <= 0) return res.status(400).json({ error: "Valid unit price is required." });

    await client.query("begin");
    const product = await client.query("select product_id from public.products where product_id = $1 limit 1", [productId]);
    if (!product.rows.length) {
      await client.query("rollback");
      return res.status(404).json({ error: `Product not found: ${productId}` });
    }
    if (isActive) {
      const dupe = await client.query(
        `
        select price_id
        from public.product_prices
        where product_id = $1
          and upper(packaging_type) = $2
          and is_active = true
        limit 1
        `,
        [productId, packagingType]
      );
      if (dupe.rows.length) {
        await client.query("rollback");
        return res.status(409).json({ error: "An active pricing row already exists for this product and packaging type." });
      }
    }

    const priceId = await nextSequentialId(client, "public.product_prices", "price_id", "PX", 3);
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const { rows } = await client.query(
      `
      insert into public.product_prices (
        price_id, product_id, packaging_type, unit_price, effective_from, is_active,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3, $4, $5::date, $6, $7, $8, $7, $8)
      returning price_id
      `,
      [priceId, productId, packagingType, unitPrice, effectiveFrom, isActive, actorUserId, actorName]
    );
    await client.query("commit");
    res.json({ success: true, priceId: rows[0].price_id });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/admin/pricing/:priceId", requireAuth, async (req, res) => {
  try {
    if (!productAdminPermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    const priceId = String(req.params.priceId || "").trim();
    const payload = req.body || {};
    const unitPrice = Number(payload.unitPrice || 0);
    const effectiveFrom = String(payload.effectiveFrom || "").trim() || null;
    const isActive = payload.isActive !== false;
    if (!priceId) return res.status(400).json({ error: "Price ID is required." });
    if (!unitPrice || unitPrice <= 0) return res.status(400).json({ error: "Valid unit price is required." });

    if (isActive) {
      const current = await pool.query("select product_id, packaging_type from public.product_prices where price_id = $1 limit 1", [priceId]);
      if (!current.rows.length) return res.status(404).json({ error: "Pricing row not found." });
      const dupe = await pool.query(
        `
        select price_id
        from public.product_prices
        where price_id <> $1
          and product_id = $2
          and upper(packaging_type) = upper($3)
          and is_active = true
        limit 1
        `,
        [priceId, current.rows[0].product_id, current.rows[0].packaging_type]
      );
      if (dupe.rows.length) return res.status(409).json({ error: "Another active pricing row already exists for this product and packaging type." });
    }

    const { rows } = await pool.query(
      `
      update public.product_prices
      set unit_price = $2,
          effective_from = $3::date,
          is_active = $4,
          updated_by_user_id = $5,
          updated_by_name = $6
      where price_id = $1
      returning price_id
      `,
      [priceId, unitPrice, effectiveFrom, isActive, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Pricing row not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/admin/pricing/:priceId", requireAuth, async (req, res) => {
  try {
    if (!productAdminPermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    const priceId = String(req.params.priceId || "").trim();
    const { rowCount } = await pool.query(
      `
      update public.product_prices
      set is_active = false,
          updated_by_user_id = $2,
          updated_by_name = $3
      where price_id = $1
      `,
      [priceId, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rowCount) return res.status(404).json({ error: "Pricing row not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/mdm/initial", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "view")) return res.status(403).json({ error: "Forbidden" });
    const [vendorsRes, typesRes, subtypesRes, materialsRes] = await Promise.all([
      pool.query("select vendor_id, vendor_name, contact, notes from public.vendors order by vendor_name asc, vendor_id asc"),
      pool.query("select type_id, type_name from public.material_types order by type_name asc, type_id asc"),
      pool.query("select subtype_id, subtype_name from public.material_subtypes order by subtype_name asc, subtype_id asc"),
      pool.query("select material_id, material_name, material_type, type_id, notes from public.materials order by material_name asc, material_id asc")
    ]);
    res.json({
      vendors: vendorsRes.rows.map(normalizeVendor),
      types: typesRes.rows.map(normalizeMaterialType),
      subtypes: subtypesRes.rows.map(normalizeSubType),
      materials: materialsRes.rows.map(normalizeMaterial)
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/mdm/vendors", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!mdmPermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    const vendorName = String(req.body?.vendorName || "").trim();
    const contact = String(req.body?.contact || "").trim();
    const notes = String(req.body?.notes || "").trim();
    if (!vendorName) return res.status(400).json({ error: "Vendor name is required." });
    await client.query("begin");
    const dupe = await client.query("select vendor_id from public.vendors where lower(vendor_name) = lower($1) limit 1", [vendorName]);
    if (dupe.rows.length) {
      await client.query("rollback");
      return res.status(409).json({ error: "Vendor already exists." });
    }
    const vendorId = await nextSequentialId(client, "public.vendors", "vendor_id", "VD-", 3);
    const { rows } = await client.query(
      `
      insert into public.vendors (
        vendor_id, vendor_name, contact, notes,
        entered_by_user_id, last_edited_by_user_id,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3, $4, $5, $5, $5, $6, $5, $6)
      returning vendor_id, vendor_name, contact, notes
      `,
      [vendorId, vendorName, contact, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await client.query("commit");
    res.json({ success: true, vendorId, vendor: normalizeVendor(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/mdm/vendors/:vendorId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    const vendorId = String(req.params.vendorId || "").trim();
    const vendorName = String(req.body?.vendorName || "").trim();
    const contact = String(req.body?.contact || "").trim();
    const notes = String(req.body?.notes || "").trim();
    if (!vendorName) return res.status(400).json({ error: "Vendor name is required." });
    const dupe = await pool.query("select vendor_id from public.vendors where vendor_id <> $1 and lower(vendor_name) = lower($2) limit 1", [vendorId, vendorName]);
    if (dupe.rows.length) return res.status(409).json({ error: "Vendor already exists." });
    const { rows } = await pool.query(
      `
      update public.vendors
      set vendor_name = $2,
          contact = $3,
          notes = $4,
          last_edited_by_user_id = $5,
          updated_by_user_id = $5,
          updated_by_name = $6
      where vendor_id = $1
      returning vendor_id, vendor_name, contact, notes
      `,
      [vendorId, vendorName, contact, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Vendor not found." });
    res.json({ success: true, vendor: normalizeVendor(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/mdm/vendors/:vendorId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    const vendorId = String(req.params.vendorId || "").trim();
    const { rowCount } = await pool.query("delete from public.vendors where vendor_id = $1", [vendorId]);
    if (!rowCount) return res.status(404).json({ error: "Vendor not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/mdm/material-types", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!mdmPermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    const typeName = String(req.body?.typeName || "").trim();
    if (!typeName) return res.status(400).json({ error: "Material type name is required." });
    await client.query("begin");
    const dupe = await client.query("select type_id from public.material_types where lower(type_name) = lower($1) limit 1", [typeName]);
    if (dupe.rows.length) {
      await client.query("rollback");
      return res.status(409).json({ error: "Material type already exists." });
    }
    const typeId = await nextSequentialId(client, "public.material_types", "type_id", "MT-", 2);
    const { rows } = await client.query(
      "insert into public.material_types (type_id, type_name, entered_by_user_id, last_edited_by_user_id) values ($1, $2, $3, $3) returning type_id, type_name",
      [typeId, typeName, req.sessionData.user.userId]
    );
    await client.query("commit");
    res.json({ success: true, typeId, type: normalizeMaterialType(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/mdm/material-types/:typeId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    const typeId = String(req.params.typeId || "").trim();
    const typeName = String(req.body?.typeName || "").trim();
    if (!typeName) return res.status(400).json({ error: "Material type name is required." });
    const dupe = await pool.query("select type_id from public.material_types where type_id <> $1 and lower(type_name) = lower($2) limit 1", [typeId, typeName]);
    if (dupe.rows.length) return res.status(409).json({ error: "Material type already exists." });
    const { rows } = await pool.query("update public.material_types set type_name = $2, last_edited_by_user_id = $3 where type_id = $1 returning type_id, type_name", [typeId, typeName, req.sessionData.user.userId]);
    if (!rows.length) return res.status(404).json({ error: "Material type not found." });
    res.json({ success: true, type: normalizeMaterialType(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/mdm/material-types/:typeId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    const typeId = String(req.params.typeId || "").trim();
    const referenced = await pool.query("select material_id from public.materials where type_id = $1 limit 1", [typeId]);
    if (referenced.rows.length) return res.status(409).json({ error: "Cannot delete: materials reference this type." });
    const { rowCount } = await pool.query("delete from public.material_types where type_id = $1", [typeId]);
    if (!rowCount) return res.status(404).json({ error: "Material type not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/mdm/material-subtypes", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!mdmPermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    const subtypeName = String(req.body?.subtypeName || "").trim();
    if (!subtypeName) return res.status(400).json({ error: "Subtype name is required." });
    await client.query("begin");
    const dupe = await client.query("select subtype_id from public.material_subtypes where lower(subtype_name) = lower($1) limit 1", [subtypeName]);
    if (dupe.rows.length) {
      await client.query("rollback");
      return res.status(409).json({ error: "Subtype already exists." });
    }
    const subtypeId = await nextSequentialId(client, "public.material_subtypes", "subtype_id", "ST-", 2);
    const { rows } = await client.query(
      "insert into public.material_subtypes (subtype_id, subtype_name, entered_by_user_id, last_edited_by_user_id) values ($1, $2, $3, $3) returning subtype_id, subtype_name",
      [subtypeId, subtypeName, req.sessionData.user.userId]
    );
    await client.query("commit");
    res.json({ success: true, subtypeId, subtype: normalizeSubType(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/mdm/material-subtypes/:subtypeId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    const subtypeId = String(req.params.subtypeId || "").trim();
    const subtypeName = String(req.body?.subtypeName || "").trim();
    if (!subtypeName) return res.status(400).json({ error: "Subtype name is required." });
    const dupe = await pool.query("select subtype_id from public.material_subtypes where subtype_id <> $1 and lower(subtype_name) = lower($2) limit 1", [subtypeId, subtypeName]);
    if (dupe.rows.length) return res.status(409).json({ error: "Subtype already exists." });
    const { rows } = await pool.query("update public.material_subtypes set subtype_name = $2, last_edited_by_user_id = $3 where subtype_id = $1 returning subtype_id, subtype_name", [subtypeId, subtypeName, req.sessionData.user.userId]);
    if (!rows.length) return res.status(404).json({ error: "Subtype not found." });
    res.json({ success: true, subtype: normalizeSubType(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/mdm/material-subtypes/:subtypeId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    const subtypeId = String(req.params.subtypeId || "").trim();
    const referenced = await pool.query("select purchase_id from public.material_purchases where subtype_id = $1 limit 1", [subtypeId]);
    if (referenced.rows.length) return res.status(409).json({ error: "Cannot delete: purchases reference this subtype." });
    const { rowCount } = await pool.query("delete from public.material_subtypes where subtype_id = $1", [subtypeId]);
    if (!rowCount) return res.status(404).json({ error: "Subtype not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/mdm/materials", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!mdmPermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    const materialName = String(req.body?.materialName || "").trim();
    const materialType = String(req.body?.materialType || "").trim();
    const typeId = String(req.body?.typeId || "").trim() || null;
    const notes = String(req.body?.notes || "").trim();
    if (!materialName) return res.status(400).json({ error: "Material name is required." });
    if (!materialType) return res.status(400).json({ error: "Material type is required." });
    await client.query("begin");
    const dupe = await client.query(
      "select material_id from public.materials where lower(material_name) = lower($1) and lower(coalesce(material_type, '')) = lower($2) limit 1",
      [materialName, materialType]
    );
    if (dupe.rows.length) {
      await client.query("rollback");
      return res.status(409).json({ error: "Material with this name and type already exists." });
    }
    if (typeId) {
      const type = await client.query("select type_id from public.material_types where type_id = $1 limit 1", [typeId]);
      if (!type.rows.length) {
        await client.query("rollback");
        return res.status(404).json({ error: `Material type not found: ${typeId}` });
      }
    }
    const materialId = await nextSequentialId(client, "public.materials", "material_id", "MR-", 2);
    const { rows } = await client.query(
      `
      insert into public.materials (
        material_id, material_name, material_type, type_id, notes,
        entered_by_user_id, last_edited_by_user_id,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1, $2, $3, $4, $5, $6, $6, $6, $7, $6, $7)
      returning material_id, material_name, material_type, type_id, notes
      `,
      [materialId, materialName, materialType, typeId, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await client.query("commit");
    res.json({ success: true, materialId, material: normalizeMaterial(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/mdm/materials/:materialId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    const materialId = String(req.params.materialId || "").trim();
    const materialName = String(req.body?.materialName || "").trim();
    const materialType = String(req.body?.materialType || "").trim();
    const typeId = String(req.body?.typeId || "").trim() || null;
    const notes = String(req.body?.notes || "").trim();
    if (!materialName) return res.status(400).json({ error: "Material name is required." });
    if (!materialType) return res.status(400).json({ error: "Material type is required." });
    const dupe = await pool.query(
      "select material_id from public.materials where material_id <> $1 and lower(material_name) = lower($2) and lower(coalesce(material_type, '')) = lower($3) limit 1",
      [materialId, materialName, materialType]
    );
    if (dupe.rows.length) return res.status(409).json({ error: "Material with this name and type already exists." });
    if (typeId) {
      const type = await pool.query("select type_id from public.material_types where type_id = $1 limit 1", [typeId]);
      if (!type.rows.length) return res.status(404).json({ error: `Material type not found: ${typeId}` });
    }
    const { rows } = await pool.query(
      `
      update public.materials
      set material_name = $2,
          material_type = $3,
          type_id = $4,
          notes = $5,
          last_edited_by_user_id = $6,
          updated_by_user_id = $6,
          updated_by_name = $7
      where material_id = $1
      returning material_id, material_name, material_type, type_id, notes
      `,
      [materialId, materialName, materialType, typeId, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Material not found." });
    res.json({ success: true, material: normalizeMaterial(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/mdm/materials/:materialId", requireAuth, async (req, res) => {
  try {
    if (!mdmPermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    const materialId = String(req.params.materialId || "").trim();
    const referenced = await pool.query("select purchase_id from public.material_purchases where material_id = $1 limit 1", [materialId]);
    if (referenced.rows.length) return res.status(409).json({ error: "Cannot delete: purchases reference this material." });
    const { rowCount } = await pool.query("delete from public.materials where material_id = $1", [materialId]);
    if (!rowCount) return res.status(404).json({ error: "Material not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/mm/initial", requireAuth, async (req, res) => {
  try {
    const canViewPurchases = modulePermission(req, "purchases", "view");
    const canViewPayments = modulePermission(req, "vendor_payments", "view");
    if (!canViewPurchases && !canViewPayments) return res.status(403).json({ error: "Forbidden" });
    const [purchasesRes, paymentsRes, vendorsRes, materialsRes, subtypesRes] = await Promise.all([
      canViewPurchases ? pool.query(`
        select purchase_id, trip_id, purchase_date, vendor_id, vendor_name_snapshot,
               material_id, material_name_snapshot, material_type, type_id,
               material_subtype, subtype_id, total_qty, total_kg, blanks_per_kg,
               cost_per_kg, total_amount, notes
        from public.material_purchases
        order by purchase_date desc nulls last, purchase_id desc
        limit 500
      `) : Promise.resolve({ rows: [] }),
      canViewPayments ? pool.query(`
        select payment_id, payment_date, vendor_id, vendor_name_snapshot, amount, payment_method, notes
        from public.vendor_payments
        order by payment_date desc nulls last, payment_id desc
        limit 500
      `) : Promise.resolve({ rows: [] }),
      pool.query("select vendor_id, vendor_name, contact, notes from public.vendors order by vendor_name asc, vendor_id asc"),
      pool.query("select material_id, material_name, material_type, type_id, notes from public.materials order by material_name asc, material_id asc"),
      pool.query("select subtype_id, subtype_name from public.material_subtypes order by subtype_name asc, subtype_id asc")
    ]);
    res.json({
      purchases: purchasesRes.rows.map(normalizePurchase),
      payments: paymentsRes.rows.map(normalizeVendorPayment),
      vendors: vendorsRes.rows.map(normalizeVendor),
      materials: materialsRes.rows.map(normalizeMaterial),
      subtypes: subtypesRes.rows.map(normalizeSubType)
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/mm/purchases", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "purchases", "create")) return res.status(403).json({ error: "Forbidden" });
    const p = req.body || {};
    const date = String(p.date || "").trim();
    const vendorId = String(p.vendorId || "").trim();
    const vendorName = String(p.vendorName || "").trim();
    const materialId = String(p.materialId || "").trim();
    const materialName = String(p.materialName || "").trim();
    const materialType = String(p.materialType || "").trim();
    const typeId = String(p.typeId || "").trim() || null;
    const subtypeId = String(p.subtypeId || "").trim() || null;
    const materialSubtype = String(p.materialSubtype || "").trim();
    const tripId = String(p.tripId || "").trim();
    const notes = String(p.notes || "").trim();
    const totalQty = Number(p.totalQty || 0);
    const totalKg = Number(p.totalKg || 0);
    const blanksPerKg = Number(p.blanksPerKg || 0);
    const costPerKg = Number(p.costPerKg || 0);
    const totalAmount = Number(p.totalAmount || 0) || ((totalKg || totalQty) * costPerKg);
    if (!date) return res.status(400).json({ error: "Purchase date is required." });
    if (!vendorId || !vendorName) return res.status(400).json({ error: "Vendor is required." });
    if (!materialId || !materialName) return res.status(400).json({ error: "Material is required." });
    if (!costPerKg || costPerKg <= 0) return res.status(400).json({ error: "Cost per KG is required." });
    await client.query("begin");
    const purchaseId = await nextSequentialId(client, "public.material_purchases", "purchase_id", "PO-", 3);
    const { rows } = await client.query(
      `
      insert into public.material_purchases (
        purchase_id, trip_id, purchase_date, vendor_id, vendor_name_snapshot,
        material_id, material_name_snapshot, material_type, type_id,
        material_subtype, subtype_id, total_qty, total_kg, blanks_per_kg,
        cost_per_kg, total_amount, notes,
        entered_by_user_id, last_edited_by_user_id,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$18,$19,$18,$19)
      returning purchase_id, trip_id, purchase_date, vendor_id, vendor_name_snapshot,
        material_id, material_name_snapshot, material_type, type_id,
        material_subtype, subtype_id, total_qty, total_kg, blanks_per_kg,
        cost_per_kg, total_amount, notes
      `,
      [purchaseId, tripId, date, vendorId, vendorName, materialId, materialName, materialType, typeId, materialSubtype, subtypeId, totalQty, totalKg, blanksPerKg, costPerKg, totalAmount, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await client.query("commit");
    res.json({ success: true, purchaseId, purchase: normalizePurchase(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.post("/api/mm/purchases/bulk", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "purchases", "create")) return res.status(403).json({ error: "Forbidden" });
    const rowsIn = requireRows(req, res);
    if (!rowsIn) return;
    const prepared = rowsIn.map((p, idx) => {
      const rowNo = idx + 1;
      const date = String(p.date || "").trim();
      const vendorId = String(p.vendorId || "").trim();
      const vendorName = String(p.vendorName || "").trim();
      const materialId = String(p.materialId || "").trim();
      const materialName = String(p.materialName || "").trim();
      const materialType = String(p.materialType || "").trim();
      const costPerKg = Number(p.costPerKg || 0);
      const totalQty = Number(p.totalQty || 0);
      const totalKg = Number(p.totalKg || 0);
      const totalAmount = Number(p.totalAmount || 0) || ((totalKg || totalQty) * costPerKg);
      if (!date) throw new Error(`Row ${rowNo}: purchase date is required.`);
      if (!vendorId || !vendorName) throw new Error(`Row ${rowNo}: vendor is required.`);
      if (!materialId || !materialName) throw new Error(`Row ${rowNo}: material is required.`);
      if (!costPerKg || costPerKg <= 0) throw new Error(`Row ${rowNo}: cost per KG is required.`);
      return {
        tripId: String(p.tripId || "").trim(),
        date,
        vendorId,
        vendorName,
        materialId,
        materialName,
        materialType,
        typeId: String(p.typeId || "").trim() || null,
        materialSubtype: String(p.materialSubtype || "").trim(),
        subtypeId: String(p.subtypeId || "").trim() || null,
        totalQty,
        totalKg,
        blanksPerKg: Number(p.blanksPerKg || 0),
        costPerKg,
        totalAmount,
        notes: String(p.notes || "").trim()
      };
    });
    await client.query("begin");
    const firstId = await nextSequentialId(client, "public.material_purchases", "purchase_id", "PO-", 3);
    const ids = nextSequentialIds(firstId, "PO-", prepared.length, 3);
    const created = [];
    for (let i = 0; i < prepared.length; i += 1) {
      const p = prepared[i];
      const { rows } = await client.query(
        `
        insert into public.material_purchases (
          purchase_id, trip_id, purchase_date, vendor_id, vendor_name_snapshot,
          material_id, material_name_snapshot, material_type, type_id,
          material_subtype, subtype_id, total_qty, total_kg, blanks_per_kg,
          cost_per_kg, total_amount, notes,
          entered_by_user_id, last_edited_by_user_id,
          created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
        )
        values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$18,$19,$18,$19)
        returning purchase_id, trip_id, purchase_date, vendor_id, vendor_name_snapshot,
          material_id, material_name_snapshot, material_type, type_id,
          material_subtype, subtype_id, total_qty, total_kg, blanks_per_kg,
          cost_per_kg, total_amount, notes
        `,
        [ids[i], p.tripId, p.date, p.vendorId, p.vendorName, p.materialId, p.materialName, p.materialType, p.typeId, p.materialSubtype, p.subtypeId, p.totalQty, p.totalKg, p.blanksPerKg, p.costPerKg, p.totalAmount, p.notes, req.sessionData.user.userId, req.sessionData.user.displayName]
      );
      created.push(normalizePurchase(rows[0]));
    }
    await client.query("commit");
    res.json({ success: true, count: created.length, purchases: created });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/mm/purchases/:purchaseId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "purchases", "update")) return res.status(403).json({ error: "Forbidden" });
    const purchaseId = String(req.params.purchaseId || "").trim();
    const p = req.body || {};
    const totalQty = Number(p.totalQty || 0);
    const totalKg = Number(p.totalKg || 0);
    const costPerKg = Number(p.costPerKg || 0);
    const totalAmount = Number(p.totalAmount || 0) || ((totalKg || totalQty) * costPerKg);
    const { rows } = await pool.query(
      `
      update public.material_purchases
      set trip_id=$2, purchase_date=$3::date, vendor_id=$4, vendor_name_snapshot=$5,
          material_id=$6, material_name_snapshot=$7, material_type=$8, type_id=$9,
          material_subtype=$10, subtype_id=$11, total_qty=$12, total_kg=$13,
          blanks_per_kg=$14, cost_per_kg=$15, total_amount=$16, notes=$17,
          last_edited_by_user_id=$18, updated_by_user_id=$18, updated_by_name=$19
      where purchase_id=$1
      returning purchase_id, trip_id, purchase_date, vendor_id, vendor_name_snapshot,
        material_id, material_name_snapshot, material_type, type_id,
        material_subtype, subtype_id, total_qty, total_kg, blanks_per_kg,
        cost_per_kg, total_amount, notes
      `,
      [purchaseId, p.tripId || "", p.date || null, p.vendorId || null, p.vendorName || "", p.materialId || null, p.materialName || "", p.materialType || "", p.typeId || null, p.materialSubtype || "", p.subtypeId || null, totalQty, totalKg, Number(p.blanksPerKg || 0), costPerKg, totalAmount, p.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Purchase not found." });
    res.json({ success: true, purchase: normalizePurchase(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/mm/purchases/:purchaseId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "purchases", "delete")) return res.status(403).json({ error: "Forbidden" });
    const { rowCount } = await pool.query("delete from public.material_purchases where purchase_id = $1", [String(req.params.purchaseId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Purchase not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/mm/vendor-payments", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "vendor_payments", "create")) return res.status(403).json({ error: "Forbidden" });
    const p = req.body || {};
    const date = String(p.date || "").trim();
    const vendorId = String(p.vendorId || "").trim();
    const vendorName = String(p.vendorName || "").trim();
    const amount = Number(p.amount || 0);
    const paymentMethod = String(p.paymentMethod || "").trim();
    const notes = String(p.notes || "").trim();
    if (!date) return res.status(400).json({ error: "Payment date is required." });
    if (!vendorId || !vendorName) return res.status(400).json({ error: "Vendor is required." });
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount is required." });
    if (!paymentMethod) return res.status(400).json({ error: "Payment method is required." });
    await client.query("begin");
    const paymentId = await nextSequentialId(client, "public.vendor_payments", "payment_id", "VP-", 3);
    const { rows } = await client.query(
      `
      insert into public.vendor_payments (
        payment_id, payment_date, vendor_id, vendor_name_snapshot, amount, payment_method, notes,
        entered_by_user_id, last_edited_by_user_id,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1,$2::date,$3,$4,$5,$6,$7,$8,$8,$8,$9,$8,$9)
      returning payment_id, payment_date, vendor_id, vendor_name_snapshot, amount, payment_method, notes
      `,
      [paymentId, date, vendorId, vendorName, amount, paymentMethod, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await client.query("commit");
    res.json({ success: true, paymentId, payment: normalizeVendorPayment(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/mm/vendor-payments/:paymentId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "vendor_payments", "update")) return res.status(403).json({ error: "Forbidden" });
    const p = req.body || {};
    const { rows } = await pool.query(
      `
      update public.vendor_payments
      set payment_date=$2::date, vendor_id=$3, vendor_name_snapshot=$4,
          amount=$5, payment_method=$6, notes=$7,
          last_edited_by_user_id=$8, updated_by_user_id=$8, updated_by_name=$9
      where payment_id=$1
      returning payment_id, payment_date, vendor_id, vendor_name_snapshot, amount, payment_method, notes
      `,
      [String(req.params.paymentId || "").trim(), p.date || null, p.vendorId || null, p.vendorName || "", Number(p.amount || 0), p.paymentMethod || "", p.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Payment not found." });
    res.json({ success: true, payment: normalizeVendorPayment(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/mm/vendor-payments/:paymentId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "vendor_payments", "delete")) return res.status(403).json({ error: "Forbidden" });
    const { rowCount } = await pool.query("delete from public.vendor_payments where payment_id = $1", [String(req.params.paymentId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Payment not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/pm/initial", requireAuth, async (req, res) => {
  try {
    const canProd = modulePermission(req, "production", "view");
    const canUsage = modulePermission(req, "material_usage", "view");
    const canStock = modulePermission(req, "material_stock", "view");
    if (!canProd && !canUsage && !canStock) return res.status(403).json({ error: "Forbidden" });
    const [productionsRes, usageRes, stockRes, productsRes, materialsRes, machinesRes, operatorsRes] = await Promise.all([
      canProd ? pool.query(`
        select prod_id, production_date, product_name_snapshot, cups_per_packet,
               packets_qty, box_qty, total_cups, operator_name_snapshot, operator_id,
               machine_name_snapshot, machine_id, shift, status, notes
        from public.productions
        order by production_date desc nulls last, prod_id desc
        limit 500
      `) : Promise.resolve({ rows: [] }),
      canUsage ? pool.query(`
        select usage_id, prod_id, usage_date, material_name_snapshot, material_type,
               material_id, qty_used, unit, operator_name_snapshot, operator_id,
               machine_name_snapshot, machine_id, shift, notes
        from public.material_usage
        order by usage_date desc nulls last, usage_id desc
        limit 500
      `) : Promise.resolve({ rows: [] }),
      canStock ? pool.query(`
        select stock_id, material_id, material_name_snapshot, material_type,
               opening_stock, closing_stock, unit, stock_date, notes
        from public.material_stock
        order by stock_date desc nulls last, stock_id desc
        limit 500
      `) : Promise.resolve({ rows: [] }),
      pool.query("select product_id, name, category, is_active from public.products where coalesce(is_active, true) = true order by name asc, product_id asc"),
      pool.query("select material_id, material_name, material_type, type_id, notes from public.materials order by material_name asc, material_id asc"),
      pool.query("select machine_id, machine_name, machine_type, status, capacity_per_shift, location, last_maintenance, notes from public.machines where lower(coalesce(status, 'Active')) = 'active' order by machine_name asc, machine_id asc"),
      pool.query("select operator_id, operator_name, role, shift, status, contact, join_date, notes from public.operators where lower(coalesce(status, 'Active')) = 'active' order by operator_name asc, operator_id asc")
    ]);
    res.json({
      productions: productionsRes.rows.map(normalizeProduction),
      usage: usageRes.rows.map(normalizeMaterialUsage),
      stock: stockRes.rows.map(normalizeMaterialStock),
      products: productsRes.rows.map((p) => ({ productId: p.product_id, productName: p.name || "", category: p.category || "", isActive: p.is_active !== false })),
      materials: materialsRes.rows.map(normalizeMaterial),
      machines: machinesRes.rows.map(normalizeMachine),
      operators: operatorsRes.rows.map(normalizeOperator)
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/pm/productions", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "production", "create")) return res.status(403).json({ error: "Forbidden" });
    const p = req.body || {};
    const date = String(p.date || "").trim();
    const productName = String(p.productName || "").trim();
    const cupsPerPacket = Number(p.cupsPerPacket || 0);
    const packetsQty = Number(p.packetsQty || 0);
    const boxQty = Number(p.boxQty || 0);
    const totalCups = Number(p.totalCups || 0) || (cupsPerPacket * packetsQty * (boxQty || 1));
    const operatorRef = await resolveOperatorRef(client, p);
    const machineRef = await resolveMachineRef(client, p);
    const operator = operatorRef.operatorName;
    const machine = machineRef.machineName;
    const shift = String(p.shift || "").trim();
    const status = String(p.status || "Completed").trim();
    const notes = String(p.notes || "").trim();
    if (!date) return res.status(400).json({ error: "Production date is required." });
    if (!productName) return res.status(400).json({ error: "Product is required." });
    if (!cupsPerPacket || !packetsQty) return res.status(400).json({ error: "Cups per packet and packets quantity are required." });
    if (!operator || !machine || !shift) return res.status(400).json({ error: "Operator, machine, and shift are required." });
    await client.query("begin");
    const productionId = await nextSequentialId(client, "public.productions", "prod_id", "PR-", 3);
    const { rows } = await client.query(
      `
      insert into public.productions (
        prod_id, production_date, product_name_snapshot, cups_per_packet,
        packets_qty, box_qty, total_cups, operator_name_snapshot, operator_id,
        machine_name_snapshot, machine_id, shift, status, notes,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15,$16)
      returning prod_id, production_date, product_name_snapshot, cups_per_packet,
        packets_qty, box_qty, total_cups, operator_name_snapshot, operator_id,
        machine_name_snapshot, machine_id, shift, status, notes
      `,
      [productionId, date, productName, cupsPerPacket, packetsQty, boxQty, totalCups, operator, operatorRef.operatorId, machine, machineRef.machineId, shift, status, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await client.query("commit");
    res.json({ success: true, productionId, production: normalizeProduction(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.post("/api/pm/productions/bulk", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "production", "create")) return res.status(403).json({ error: "Forbidden" });
    const rowsIn = requireRows(req, res);
    if (!rowsIn) return;
    const prepared = [];
    for (let i = 0; i < rowsIn.length; i += 1) {
      const p = rowsIn[i] || {};
      const rowNo = i + 1;
      const date = String(p.date || "").trim();
      const productName = String(p.productName || "").trim();
      const cupsPerPacket = Number(p.cupsPerPacket || 0);
      const packetsQty = Number(p.packetsQty || 0);
      const boxQty = Number(p.boxQty || 0);
      const totalCups = Number(p.totalCups || 0) || (cupsPerPacket * packetsQty * (boxQty || 1));
      const operatorRef = await resolveOperatorRef(client, p);
      const machineRef = await resolveMachineRef(client, p);
      const shift = String(p.shift || "").trim();
      if (!date) throw new Error(`Row ${rowNo}: production date is required.`);
      if (!productName) throw new Error(`Row ${rowNo}: product is required.`);
      if (!cupsPerPacket || !packetsQty) throw new Error(`Row ${rowNo}: cups per packet and packets quantity are required.`);
      if (!operatorRef.operatorName || !machineRef.machineName || !shift) throw new Error(`Row ${rowNo}: operator, machine, and shift are required.`);
      prepared.push({ date, productName, cupsPerPacket, packetsQty, boxQty, totalCups, operatorRef, machineRef, shift, status: String(p.status || "Completed").trim(), notes: String(p.notes || "").trim() });
    }
    await client.query("begin");
    const firstId = await nextSequentialId(client, "public.productions", "prod_id", "PR-", 3);
    const ids = nextSequentialIds(firstId, "PR-", prepared.length, 3);
    const created = [];
    for (let i = 0; i < prepared.length; i += 1) {
      const p = prepared[i];
      const { rows } = await client.query(
        `
        insert into public.productions (
          prod_id, production_date, product_name_snapshot, cups_per_packet,
          packets_qty, box_qty, total_cups, operator_name_snapshot, operator_id,
          machine_name_snapshot, machine_id, shift, status, notes,
          created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
        )
        values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15,$16)
        returning prod_id, production_date, product_name_snapshot, cups_per_packet,
          packets_qty, box_qty, total_cups, operator_name_snapshot, operator_id,
          machine_name_snapshot, machine_id, shift, status, notes
        `,
        [ids[i], p.date, p.productName, p.cupsPerPacket, p.packetsQty, p.boxQty, p.totalCups, p.operatorRef.operatorName, p.operatorRef.operatorId, p.machineRef.machineName, p.machineRef.machineId, p.shift, p.status, p.notes, req.sessionData.user.userId, req.sessionData.user.displayName]
      );
      created.push(normalizeProduction(rows[0]));
    }
    await client.query("commit");
    res.json({ success: true, count: created.length, productions: created });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/pm/productions/:productionId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "production", "update")) return res.status(403).json({ error: "Forbidden" });
    const p = req.body || {};
    const cupsPerPacket = Number(p.cupsPerPacket || 0);
    const packetsQty = Number(p.packetsQty || 0);
    const boxQty = Number(p.boxQty || 0);
    const totalCups = Number(p.totalCups || 0) || (cupsPerPacket * packetsQty * (boxQty || 1));
    const operatorRef = await resolveOperatorRef(pool, p);
    const machineRef = await resolveMachineRef(pool, p);
    const { rows } = await pool.query(
      `
      update public.productions
          set production_date=$2::date, product_name_snapshot=$3, cups_per_packet=$4,
          packets_qty=$5, box_qty=$6, total_cups=$7, operator_name_snapshot=$8,
          operator_id=$9, machine_name_snapshot=$10, machine_id=$11, shift=$12,
          status=$13, notes=$14, updated_by_user_id=$15, updated_by_name=$16
      where prod_id=$1
      returning prod_id, production_date, product_name_snapshot, cups_per_packet,
        packets_qty, box_qty, total_cups, operator_name_snapshot, operator_id,
        machine_name_snapshot, machine_id, shift, status, notes
      `,
      [String(req.params.productionId || "").trim(), p.date || null, p.productName || "", cupsPerPacket, packetsQty, boxQty, totalCups, operatorRef.operatorName, operatorRef.operatorId, machineRef.machineName, machineRef.machineId, p.shift || "", p.status || "Completed", p.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Production record not found." });
    res.json({ success: true, production: normalizeProduction(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/pm/productions/:productionId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "production", "delete")) return res.status(403).json({ error: "Forbidden" });
    const { rowCount } = await pool.query("delete from public.productions where prod_id = $1", [String(req.params.productionId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Production record not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/pm/material-usage", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "material_usage", "create")) return res.status(403).json({ error: "Forbidden" });
    const u = req.body || {};
    const date = String(u.date || "").trim();
    const materialName = String(u.materialName || "").trim();
    const materialType = String(u.materialType || "").trim();
    const qtyUsed = Number(u.qtyUsed || 0);
    const unit = String(u.unit || "KG").trim();
    const operatorRef = await resolveOperatorRef(client, u);
    const machineRef = await resolveMachineRef(client, u);
    const operator = operatorRef.operatorName;
    const machine = machineRef.machineName;
    const shift = String(u.shift || "").trim();
    const notes = String(u.notes || "").trim();
    if (!date) return res.status(400).json({ error: "Usage date is required." });
    if (!materialName) return res.status(400).json({ error: "Material is required." });
    if (!qtyUsed || qtyUsed <= 0) return res.status(400).json({ error: "Quantity used is required." });
    if (!operator || !machine || !shift) return res.status(400).json({ error: "Operator, machine, and shift are required." });
    await client.query("begin");
    const usageId = await nextSequentialId(client, "public.material_usage", "usage_id", "MU-", 3);
    const { rows } = await client.query(
      `
      insert into public.material_usage (
        usage_id, prod_id, usage_date, material_name_snapshot, material_type,
        material_id, qty_used, unit, operator_name_snapshot, operator_id,
        machine_name_snapshot, machine_id, shift, notes,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$15)
      returning usage_id, prod_id, usage_date, material_name_snapshot, material_type,
        material_id, qty_used, unit, operator_name_snapshot, operator_id,
        machine_name_snapshot, machine_id, shift, notes
      `,
      [usageId, String(u.productionId || "").trim(), date, materialName, materialType, String(u.materialId || "").trim() || null, qtyUsed, unit, operator, operatorRef.operatorId, machine, machineRef.machineId, shift, notes, req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await client.query("commit");
    res.json({ success: true, usageId, usage: normalizeMaterialUsage(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.post("/api/pm/material-usage/bulk", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "material_usage", "create")) return res.status(403).json({ error: "Forbidden" });
    const rowsIn = requireRows(req, res);
    if (!rowsIn) return;
    const prepared = [];
    for (let i = 0; i < rowsIn.length; i += 1) {
      const u = rowsIn[i] || {};
      const rowNo = i + 1;
      const date = String(u.date || "").trim();
      const materialName = String(u.materialName || "").trim();
      const materialType = String(u.materialType || "").trim();
      const qtyUsed = Number(u.qtyUsed || 0);
      const unit = String(u.unit || "KG").trim();
      const operatorRef = await resolveOperatorRef(client, u);
      const machineRef = await resolveMachineRef(client, u);
      const shift = String(u.shift || "").trim();
      if (!date) throw new Error(`Row ${rowNo}: usage date is required.`);
      if (!materialName) throw new Error(`Row ${rowNo}: material is required.`);
      if (!qtyUsed || qtyUsed <= 0) throw new Error(`Row ${rowNo}: quantity used is required.`);
      if (!operatorRef.operatorName || !machineRef.machineName || !shift) throw new Error(`Row ${rowNo}: operator, machine, and shift are required.`);
      prepared.push({ productionId: String(u.productionId || "").trim(), date, materialName, materialId: String(u.materialId || "").trim() || null, materialType, qtyUsed, unit, operatorRef, machineRef, shift, notes: String(u.notes || "").trim() });
    }
    await client.query("begin");
    const firstId = await nextSequentialId(client, "public.material_usage", "usage_id", "MU-", 3);
    const ids = nextSequentialIds(firstId, "MU-", prepared.length, 3);
    const created = [];
    for (let i = 0; i < prepared.length; i += 1) {
      const u = prepared[i];
      const { rows } = await client.query(
        `
        insert into public.material_usage (
          usage_id, prod_id, usage_date, material_name_snapshot, material_type,
          material_id, qty_used, unit, operator_name_snapshot, operator_id,
          machine_name_snapshot, machine_id, shift, notes,
          created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
        )
        values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15,$16)
        returning usage_id, prod_id, usage_date, material_name_snapshot, material_type,
          material_id, qty_used, unit, operator_name_snapshot, operator_id,
          machine_name_snapshot, machine_id, shift, notes
        `,
        [ids[i], u.productionId, u.date, u.materialName, u.materialType, u.materialId, u.qtyUsed, u.unit, u.operatorRef.operatorName, u.operatorRef.operatorId, u.machineRef.machineName, u.machineRef.machineId, u.shift, u.notes, req.sessionData.user.userId, req.sessionData.user.displayName]
      );
      created.push(normalizeMaterialUsage(rows[0]));
    }
    await client.query("commit");
    res.json({ success: true, count: created.length, usage: created });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/pm/material-usage/:usageId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "material_usage", "update")) return res.status(403).json({ error: "Forbidden" });
    const u = req.body || {};
    const operatorRef = await resolveOperatorRef(pool, u);
    const machineRef = await resolveMachineRef(pool, u);
    const { rows } = await pool.query(
      `
      update public.material_usage
      set prod_id=$2, usage_date=$3::date, material_name_snapshot=$4,
          material_type=$5, material_id=$6, qty_used=$7, unit=$8,
          operator_name_snapshot=$9, operator_id=$10,
          machine_name_snapshot=$11, machine_id=$12, shift=$13, notes=$14,
          updated_by_user_id=$15, updated_by_name=$16
      where usage_id=$1
      returning usage_id, prod_id, usage_date, material_name_snapshot, material_type,
        material_id, qty_used, unit, operator_name_snapshot, operator_id,
        machine_name_snapshot, machine_id, shift, notes
      `,
      [String(req.params.usageId || "").trim(), u.productionId || "", u.date || null, u.materialName || "", u.materialType || "", String(u.materialId || "").trim() || null, Number(u.qtyUsed || 0), u.unit || "KG", operatorRef.operatorName, operatorRef.operatorId, machineRef.machineName, machineRef.machineId, u.shift || "", u.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Usage record not found." });
    res.json({ success: true, usage: normalizeMaterialUsage(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/pm/material-usage/:usageId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "material_usage", "delete")) return res.status(403).json({ error: "Forbidden" });
    const { rowCount } = await pool.query("delete from public.material_usage where usage_id = $1", [String(req.params.usageId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Usage record not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/rm/initial", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "resources", "view")) return res.status(403).json({ error: "Forbidden" });
    const [machinesRes, operatorsRes] = await Promise.all([
      pool.query("select machine_id, machine_name, machine_type, status, capacity_per_shift, location, last_maintenance, notes from public.machines order by machine_name asc, machine_id asc"),
      pool.query("select operator_id, operator_name, role, shift, status, contact, join_date, notes from public.operators order by operator_name asc, operator_id asc")
    ]);
    res.json({ machines: machinesRes.rows.map(normalizeMachine), operators: operatorsRes.rows.map(normalizeOperator) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/rm/operators", requireAuth, async (req, res) => {
  try {
    const canLinkOperators = modulePermission(req, "resources", "view") || employeePermission(req, "view") || employeePermission(req, "create") || employeePermission(req, "update");
    if (!canLinkOperators) return res.status(403).json({ error: "Forbidden" });
    const { rows } = await pool.query(`
      select operator_id, operator_name, role, shift, status, contact, join_date, notes
      from public.operators
      order by operator_name asc, operator_id asc
    `);
    res.json({ operators: rows.map(normalizeOperator) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/rm/machines", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "resources", "create")) return res.status(403).json({ error: "Forbidden" });
    const m = req.body || {};
    const name = String(m.machineName || "").trim();
    if (!name) return res.status(400).json({ error: "Machine name is required." });
    await client.query("begin");
    const dupe = await client.query("select machine_id from public.machines where lower(machine_name) = lower($1) limit 1", [name]);
    if (dupe.rows.length) { await client.query("rollback"); return res.status(409).json({ error: "Machine with this name already exists." }); }
    const machineId = await nextSequentialId(client, "public.machines", "machine_id", "MC-", 3);
    const { rows } = await client.query(
      `
      insert into public.machines (
        machine_id, machine_name, machine_type, status, capacity_per_shift, location,
        last_maintenance, notes, created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$9,$10)
      returning machine_id, machine_name, machine_type, status, capacity_per_shift, location, last_maintenance, notes
      `,
      [machineId, name, m.machineType || "", m.status || "Active", Number(m.capacityPerShift || 0), m.location || "", m.lastMaintenance || null, m.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await client.query("commit");
    res.json({ success: true, machineId, machine: normalizeMachine(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/rm/machines/:machineId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "resources", "update")) return res.status(403).json({ error: "Forbidden" });
    const m = req.body || {};
    const { rows } = await pool.query(
      `
      update public.machines
      set machine_name=$2, machine_type=$3, status=$4, capacity_per_shift=$5,
          location=$6, last_maintenance=$7::date, notes=$8,
          updated_by_user_id=$9, updated_by_name=$10
      where machine_id=$1
      returning machine_id, machine_name, machine_type, status, capacity_per_shift, location, last_maintenance, notes
      `,
      [String(req.params.machineId || "").trim(), m.machineName || "", m.machineType || "", m.status || "Active", Number(m.capacityPerShift || 0), m.location || "", m.lastMaintenance || null, m.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) return res.status(404).json({ error: "Machine not found." });
    res.json({ success: true, machine: normalizeMachine(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/rm/machines/:machineId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "resources", "delete")) return res.status(403).json({ error: "Forbidden" });
    const { rowCount } = await pool.query("delete from public.machines where machine_id = $1", [String(req.params.machineId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Machine not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/rm/operators", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "resources", "create")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchema();
    const o = req.body || {};
    const name = String(o.operatorName || "").trim();
    if (!name) return res.status(400).json({ error: "Operator name is required." });
    await client.query("begin");
    const dupe = await client.query("select operator_id from public.operators where lower(operator_name) = lower($1) limit 1", [name]);
    if (dupe.rows.length) { await client.query("rollback"); return res.status(409).json({ error: "Operator with this name already exists." }); }
    const operatorId = await nextSequentialId(client, "public.operators", "operator_id", "OP-", 3);
    const { rows } = await client.query(
      `
      insert into public.operators (
        operator_id, operator_name, role, shift, status, contact, join_date, notes,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      )
      values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$9,$10)
      returning operator_id, operator_name, role, shift, status, contact, join_date, notes
      `,
      [operatorId, name, o.role || "", o.shift || "", o.status || "Active", o.contact || "", o.joinDate || null, o.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    await syncOperatorEmployee(client, rows[0], req.sessionData.user);
    await client.query("commit");
    res.json({ success: true, operatorId, operator: normalizeOperator(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.put("/api/rm/operators/:operatorId", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!modulePermission(req, "resources", "update")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchema();
    const o = req.body || {};
    await client.query("begin");
    const { rows } = await client.query(
      `
      update public.operators
      set operator_name=$2, role=$3, shift=$4, status=$5, contact=$6,
          join_date=$7::date, notes=$8, updated_by_user_id=$9, updated_by_name=$10
      where operator_id=$1
      returning operator_id, operator_name, role, shift, status, contact, join_date, notes
      `,
      [String(req.params.operatorId || "").trim(), o.operatorName || "", o.role || "", o.shift || "", o.status || "Active", o.contact || "", o.joinDate || null, o.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]
    );
    if (!rows.length) { await client.query("rollback"); return res.status(404).json({ error: "Operator not found." }); }
    await syncOperatorEmployee(client, rows[0], req.sessionData.user);
    await client.query("commit");
    res.json({ success: true, operator: normalizeOperator(rows[0]) });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: clientSafeError(error) });
  } finally {
    client.release();
  }
});

app.delete("/api/rm/operators/:operatorId", requireAuth, async (req, res) => {
  try {
    if (!modulePermission(req, "resources", "delete")) return res.status(403).json({ error: "Forbidden" });
    const { rowCount } = await pool.query("delete from public.operators where operator_id = $1", [String(req.params.operatorId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Operator not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

function employeePermission(req, action) {
  if (action === "view") {
    return modulePermission(req, "employees", "view") ||
      modulePermission(req, "salary_payments", "view") ||
      modulePermission(req, "operational_expenses", "view") ||
      modulePermission(req, "expense_advances", "view");
  }
  return modulePermission(req, "employees", action) || modulePermission(req, "salary_payments", action);
}

app.get("/api/finance/employees", requireAuth, async (req, res) => {
  try {
    if (!employeePermission(req, "view")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchema();
    const { rows } = await pool.query(`
      select employee_id, employee_name, role, department, operator_id, contact,
             join_date, status, salary_rate, notes
      from public.employees
      order by employee_name asc, employee_id asc
    `);
    res.json({ employees: rows.map(normalizeEmployee) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/finance/employees", requireAuth, async (req, res) => {
  try {
    if (!employeePermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchema();
    const e = req.body || {};
    const name = String(e.employeeName || "").trim();
    if (!name) return res.status(400).json({ error: "Employee name is required" });
    const employeeId = await nextSequentialId(pool, "public.employees", "employee_id", "EMP-", 3);
    const { rows } = await pool.query(`
      insert into public.employees (
        employee_id, employee_name, role, department, operator_id, contact,
        join_date, status, salary_rate, notes,
        entered_by_user_id, last_edited_by_user_id, created_by_name, updated_by_name
      )
      values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$11,$12,$12)
      returning employee_id, employee_name, role, department, operator_id, contact,
                join_date, status, salary_rate, notes
    `, [employeeId, name, e.role || "", e.department || "", e.operatorId || null, e.contact || "", e.joinDate || null, e.status || "Active", Number(e.salaryRate || 0), e.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]);
    await syncEmployeeOperatorStatus(pool, rows[0]);
    res.json({ success: true, employee: normalizeEmployee(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.put("/api/finance/employees/:employeeId", requireAuth, async (req, res) => {
  try {
    if (!employeePermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchema();
    const e = req.body || {};
    const employeeId = String(req.params.employeeId || "").trim();
    const { rows } = await pool.query(`
      update public.employees
      set employee_name=$2, role=$3, department=$4, operator_id=$5, contact=$6,
          join_date=$7::date, status=$8, salary_rate=$9, notes=$10,
          last_edited_by_user_id=$11, updated_by_name=$12
      where employee_id=$1
      returning employee_id, employee_name, role, department, operator_id, contact,
                join_date, status, salary_rate, notes
    `, [employeeId, e.employeeName || "", e.role || "", e.department || "", e.operatorId || null, e.contact || "", e.joinDate || null, e.status || "Active", Number(e.salaryRate || 0), e.notes || "", req.sessionData.user.userId, req.sessionData.user.displayName]);
    if (!rows.length) return res.status(404).json({ error: "Employee not found" });
    await pool.query("update public.operators set employee_id = null where employee_id = $1 and operator_id <> coalesce($2, '')", [employeeId, e.operatorId || null]);
    await syncEmployeeOperatorStatus(pool, rows[0]);
    res.json({ success: true, employee: normalizeEmployee(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/finance/employees/:employeeId", requireAuth, async (req, res) => {
  try {
    if (!employeePermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchema();
    const { rowCount } = await pool.query("delete from public.employees where employee_id = $1", [String(req.params.employeeId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Employee not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

function enumPermission(req, action) {
  return modulePermission(req, "enum_values", action) || modulePermission(req, "users", action);
}

app.get("/api/admin/enums", requireAuth, async (req, res) => {
  try {
    if (!enumPermission(req, "view")) return res.status(403).json({ error: "Forbidden" });
    const { rows } = await pool.query(`
      select enum_id, enum_group, enum_value, enum_label, display_order, is_active, notes
      from public.app_enum_values
      order by enum_group asc, display_order asc, enum_label asc
    `);
    res.json({ values: rows.map(normalizeEnumValue) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/admin/enums", requireAuth, async (req, res) => {
  try {
    if (!enumPermission(req, "create")) return res.status(403).json({ error: "Forbidden" });
    const v = req.body || {};
    const enumGroup = String(v.enumGroup || "").trim();
    const enumValue = String(v.enumValue || "").trim();
    const enumLabel = String(v.enumLabel || enumValue).trim();
    if (!enumGroup || !enumValue) return res.status(400).json({ error: "Group and value are required" });
    const enumId = `ENUM-${enumGroup.replace(/[^a-z0-9]+/gi, "-").toUpperCase()}-${enumValue.replace(/[^a-z0-9]+/gi, "-").toUpperCase()}`;
    const { rows } = await pool.query(`
      insert into public.app_enum_values (enum_id, enum_group, enum_value, enum_label, display_order, is_active, notes)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (enum_group, enum_value) do update set
        enum_label=excluded.enum_label, display_order=excluded.display_order,
        is_active=excluded.is_active, notes=excluded.notes
      returning enum_id, enum_group, enum_value, enum_label, display_order, is_active, notes
    `, [enumId, enumGroup, enumValue, enumLabel, Number(v.displayOrder || 100), v.isActive !== false, v.notes || ""]);
    res.json({ success: true, value: normalizeEnumValue(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.put("/api/admin/enums/:enumId", requireAuth, async (req, res) => {
  try {
    if (!enumPermission(req, "update")) return res.status(403).json({ error: "Forbidden" });
    const v = req.body || {};
    const { rows } = await pool.query(`
      update public.app_enum_values
      set enum_group=$2, enum_value=$3, enum_label=$4, display_order=$5, is_active=$6, notes=$7
      where enum_id=$1
      returning enum_id, enum_group, enum_value, enum_label, display_order, is_active, notes
    `, [String(req.params.enumId || "").trim(), v.enumGroup || "", v.enumValue || "", v.enumLabel || v.enumValue || "", Number(v.displayOrder || 100), v.isActive !== false, v.notes || ""]);
    if (!rows.length) return res.status(404).json({ error: "Value not found" });
    res.json({ success: true, value: normalizeEnumValue(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/admin/enums/:enumId", requireAuth, async (req, res) => {
  try {
    if (!enumPermission(req, "delete")) return res.status(403).json({ error: "Forbidden" });
    const { rowCount } = await pool.query("delete from public.app_enum_values where enum_id = $1", [String(req.params.enumId || "").trim()]);
    if (!rowCount) return res.status(404).json({ error: "Value not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/lookups", requireAuth, async (_req, res) => {
  try {
    await ensureAccountSchema();
    const [contactsRes, productsRes, productPricesRes, vendorsRes, materialsRes, machinesRes, operatorsRes, enumsRes] = await Promise.all([
      pool.query(`
        select
          c.cid,
          c.name,
          c.company,
          c.customer_type,
          c.mobile,
          c.city,
          c.state,
          c.contact_status,
          coalesce(c.aid, a.aid) as aid,
          a.address as account_address,
          a.city as account_city,
          a.state as account_state,
          a.zipcode as account_zipcode,
          a.gst_number as account_gst_number
        from public.contacts c
        left join lateral (
          select a.*
          from public.accounts a
          where a.aid = c.aid or a.cid = c.cid
          order by case when a.aid = c.aid then 0 else 1 end
          limit 1
        ) a on true
        order by c.name asc
        limit 1000
      `),
      pool.query(`
        select product_id, name, category, is_active
        from public.products
        where is_active = true
        order by name asc
        limit 1000
      `),
      pool.query(`
        select price_id, product_id, packaging_type, unit_price, effective_from, is_active
        from public.product_prices
        where is_active = true
        order by product_id asc, effective_from desc nulls last
      `),
      pool.query(`
        select vendor_id, vendor_name
        from public.vendors
        order by vendor_name asc
        limit 1000
      `),
      pool.query(`
        select material_id, material_name, material_type
        from public.materials
        order by material_name asc
        limit 1000
      `),
      pool.query(`
        select machine_id, machine_name, machine_type, status
        from public.machines
        where lower(coalesce(status, 'Active')) = 'active'
        order by machine_name asc
        limit 1000
      `),
      pool.query(`
        select operator_id, operator_name, role, status
        from public.operators
        where lower(coalesce(status, 'Active')) = 'active'
        order by operator_name asc
        limit 1000
      `),
      pool.query(`
        select enum_group, enum_value, enum_label, display_order, is_active
        from public.app_enum_values
        where enum_group = 'customer_type'
          and is_active = true
        order by display_order asc, enum_label asc
      `)
    ]);

    res.json({
      contacts: contactsRes.rows || [],
      products: productsRes.rows || [],
      product_prices: productPricesRes.rows || [],
      vendors: vendorsRes.rows || [],
      materials: materialsRes.rows || [],
      machines: machinesRes.rows || [],
      operators: operatorsRes.rows || [],
      enums: {
        customer_type: enumsRes.rows || []
      }
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/dashboard/summary", requireAuth, async (req, res) => {
  try {
    const allowed = req.sessionData.permissions.map((p) => p.module_key);
    const results = {};
    await Promise.all(allowed.map(async (moduleKey) => {
      const cfg = liveModuleConfig(moduleKey) || tableConfig(moduleKey);
      if (!cfg) return;
      const amountSql = cfg.amountField ? `coalesce(sum(${cfg.amountField}), 0)::numeric as amount_total,` : "0::numeric as amount_total,";
      const datePredicate = cfg.dateField ? `count(*) filter (where ${cfg.dateField} >= date_trunc('month', current_date))::integer as month_count` : "0::integer as month_count";
      const sql = `
        select
          count(*)::integer as total_count,
          ${amountSql}
          ${datePredicate}
        from ${cfg.table}
      `;
      const { rows } = await pool.query(sql);
      results[moduleKey] = rows[0] || { total_count: 0, amount_total: 0, month_count: 0 };
    }));
    res.json({ modules: results });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/leadership/quota", requireAuth, async (req, res) => {
  try {
    if (sectionForbidden(req, ["sales", "payments", "customers", "dues", "leads", "purchases", "vendor_payments", "production", "material_usage", "material_stock", "operational_expenses", "salary_payments", "expense_advances"])) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const quota = await getLeadershipQuota();
    res.json({ quota });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/leadership/:section", requireAuth, async (req, res) => {
  try {
    const section = normalizeLeadershipSection(req.params.section);
    const range = leadershipDateRange(req.query);
    const params = [range.start, range.end];
    const inRange = (field) => `${field} between $1::date and $2::date`;
    const ttlSeconds = leadershipTtlSeconds(section);
    const cacheKey = leadershipCacheKey(section, range);
    const forceRefresh = String(req.query.force || "") === "1";
    const quotaBefore = await getLeadershipQuota();
    const cached = await getLeadershipSnapshot(cacheKey);
    if (cached && !forceRefresh && snapshotAgeSeconds(cached) <= ttlSeconds) {
      return res.json({ ...cached.payload, quota: quotaBefore, cache: leadershipCacheMeta(cached, { hit: true }) });
    }
    if (cached && forceRefresh && snapshotAgeSeconds(cached) < 120) {
      return res.json({ ...cached.payload, quota: quotaBefore, cache: leadershipCacheMeta(cached, { hit: true, forceLimited: true }) });
    }
    if (quotaBefore.remaining <= 0) {
      return res.status(429).json({
        error: `Monthly leadership report quota exhausted. ${quotaBefore.used} of ${quotaBefore.limit} report calls have been used for ${quotaBefore.monthKey}.`,
        quota: quotaBefore
      });
    }
    await ensureLeadershipReportIndexes();
    const returnLeadershipReport = async (payload) => {
      const quotaAfter = { ...quotaBefore, used: quotaBefore.used + 1, remaining: Math.max(quotaBefore.remaining - 1, 0) };
      await recordLeadershipUsage(req, section, payload.range || range, quotaAfter.remaining);
      const saved = await saveLeadershipSnapshot(cacheKey, section, payload.range || range, payload, ttlSeconds);
      return res.json({ ...payload, quota: quotaAfter, cache: leadershipCacheMeta(saved, { hit: false }) });
    };

    if (section === "sales-payments") {
      if (sectionForbidden(req, ["sales", "payments", "purchases", "vendor_payments", "operational_expenses", "salary_payments", "expense_advances"])) return res.status(403).json({ error: "Forbidden" });
      const [sales, custPay, purchases, vendPay, expenses, salaries, advances] = await Promise.all([
        canViewAny(req, ["sales"]) ? pool.query(`
          select to_char(date_trunc('month', sale_date), 'YYYY-MM') as sort_key,
                 to_char(date_trunc('month', sale_date), 'Mon YYYY') as month,
                 coalesce(sum(total_amount), 0)::numeric as amount
          from public.sales_entries
          where ${inRange("sale_date")}
          group by 1, 2
        `, params) : Promise.resolve({ rows: [] }),
        canViewAny(req, ["payments"]) ? pool.query(`
          select to_char(date_trunc('month', payment_date), 'YYYY-MM') as sort_key,
                 to_char(date_trunc('month', payment_date), 'Mon YYYY') as month,
                 coalesce(sum(amount_paid), 0)::numeric as amount
          from public.customer_payments
          where ${inRange("payment_date")}
          group by 1, 2
        `, params) : Promise.resolve({ rows: [] }),
        canViewAny(req, ["purchases"]) ? pool.query(`
          select to_char(date_trunc('month', purchase_date), 'YYYY-MM') as sort_key,
                 to_char(date_trunc('month', purchase_date), 'Mon YYYY') as month,
                 coalesce(sum(total_amount), 0)::numeric as amount
          from public.material_purchases
          where ${inRange("purchase_date")}
          group by 1, 2
        `, params) : Promise.resolve({ rows: [] }),
        canViewAny(req, ["vendor_payments"]) ? pool.query(`
          select to_char(date_trunc('month', payment_date), 'YYYY-MM') as sort_key,
                 to_char(date_trunc('month', payment_date), 'Mon YYYY') as month,
                 coalesce(sum(amount), 0)::numeric as amount
          from public.vendor_payments
          where ${inRange("payment_date")}
          group by 1, 2
        `, params) : Promise.resolve({ rows: [] }),
        canViewAny(req, ["operational_expenses"]) ? pool.query(`
          select to_char(date_trunc('month', expense_date), 'YYYY-MM') as sort_key,
                 to_char(date_trunc('month', expense_date), 'Mon YYYY') as month,
                 coalesce(sum(amount), 0)::numeric as amount
          from public.operational_expenses
          where ${inRange("expense_date")}
          group by 1, 2
        `, params) : Promise.resolve({ rows: [] }),
        canViewAny(req, ["salary_payments"]) ? pool.query(`
          select to_char(date_trunc('month', payment_date), 'YYYY-MM') as sort_key,
                 to_char(date_trunc('month', payment_date), 'Mon YYYY') as month,
                 coalesce(sum(amount), 0)::numeric as amount
          from public.salary_payments
          where ${inRange("payment_date")}
          group by 1, 2
        `, params) : Promise.resolve({ rows: [] }),
        canViewAny(req, ["expense_advances"]) ? pool.query(`
          select to_char(date_trunc('month', payment_date), 'YYYY-MM') as sort_key,
                 to_char(date_trunc('month', payment_date), 'Mon YYYY') as month,
                 coalesce(sum(amount), 0)::numeric as amount
          from public.expense_advances
          where ${inRange("payment_date")}
          group by 1, 2
        `, params) : Promise.resolve({ rows: [] })
      ]);
      const monthMap = new Map();
      const merge = (rows, key) => rows.forEach((r) => {
        if (!monthMap.has(r.sort_key)) monthMap.set(r.sort_key, { sortKey: r.sort_key, month: r.month, sales: 0, custPay: 0, purchase: 0, vendPay: 0, expenses: 0, salaries: 0, advances: 0 });
        monthMap.get(r.sort_key)[key] = Number(r.amount || 0);
      });
      merge(sales.rows, "sales"); merge(custPay.rows, "custPay"); merge(purchases.rows, "purchase"); merge(vendPay.rows, "vendPay"); merge(expenses.rows, "expenses"); merge(salaries.rows, "salaries"); merge(advances.rows, "advances");
      const rows = [...monthMap.values()].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
      const totals = rows.reduce((a, r) => ({
        sales: a.sales + r.sales,
        custPay: a.custPay + r.custPay,
        purchase: a.purchase + r.purchase,
        vendPay: a.vendPay + r.vendPay,
        expenses: a.expenses + r.expenses,
        salaries: a.salaries + r.salaries,
        advances: a.advances + r.advances
      }), { sales: 0, custPay: 0, purchase: 0, vendPay: 0, expenses: 0, salaries: 0, advances: 0 });
      return returnLeadershipReport({ range, rows, totals });
    }

    if (section === "pl") {
      if (sectionForbidden(req, ["sales", "payments", "purchases", "vendor_payments", "operational_expenses", "salary_payments", "expense_advances"])) return res.status(403).json({ error: "Forbidden" });
      const sumIf = (can, sql) => can ? pool.query(sql, params).then((r) => Number(r.rows[0]?.amount || 0)) : Promise.resolve(0);
      const [sales, purchases, generalExpenses, expenseAdvances, salaries, custPayments, vendorPayments] = await Promise.all([
        sumIf(canViewAny(req, ["sales"]), `select coalesce(sum(total_amount), 0)::numeric as amount from public.sales_entries where ${inRange("sale_date")}`),
        sumIf(canViewAny(req, ["purchases"]), `select coalesce(sum(total_amount), 0)::numeric as amount from public.material_purchases where ${inRange("purchase_date")}`),
        sumIf(canViewAny(req, ["operational_expenses"]), `select coalesce(sum(amount), 0)::numeric as amount from public.operational_expenses where ${inRange("expense_date")}`),
        sumIf(canViewAny(req, ["expense_advances"]), `select coalesce(sum(amount), 0)::numeric as amount from public.expense_advances where ${inRange("payment_date")}`),
        sumIf(canViewAny(req, ["salary_payments"]), `select coalesce(sum(amount), 0)::numeric as amount from public.salary_payments where ${inRange("payment_date")} and lower(coalesce(payment_type, '')) <> 'advance'`),
        sumIf(canViewAny(req, ["payments"]), `select coalesce(sum(amount_paid), 0)::numeric as amount from public.customer_payments where ${inRange("payment_date")}`),
        sumIf(canViewAny(req, ["vendor_payments"]), `select coalesce(sum(amount), 0)::numeric as amount from public.vendor_payments where ${inRange("payment_date")}`)
      ]);
      const outflow = purchases + generalExpenses + salaries;
      return returnLeadershipReport({ range, totals: { sales, purchases, generalExpenses, expenseAdvances, salaries, custPayments, vendorPayments, outflow, net: sales - outflow } });
    }

    if (section === "sales-mom") {
      if (sectionForbidden(req, ["sales"])) return res.status(403).json({ error: "Forbidden" });
      const { rows } = await pool.query(`
        select to_char(date_trunc('month', s.sale_date), 'YYYY-MM') as key,
               to_char(date_trunc('month', s.sale_date), 'Mon YYYY') as label,
               coalesce(sum(l.box_quantity), 0)::numeric as boxes,
               coalesce(sum(l.total_amount), 0)::numeric as revenue,
               count(distinct s.sale_entry_id)::integer as orders
        from public.sales_entries s
        left join public.sales_line_items l on l.sale_entry_id = s.sale_entry_id
        where ${inRange("s.sale_date")}
        group by 1, 2
        order by 1 asc
      `, params);
      return returnLeadershipReport({ range, rows, totals: rows.reduce((a, r) => ({ boxes: a.boxes + Number(r.boxes || 0), revenue: a.revenue + Number(r.revenue || 0), orders: a.orders + Number(r.orders || 0) }), { boxes: 0, revenue: 0, orders: 0 }) });
    }

    if (section === "sales-matrix") {
      if (sectionForbidden(req, ["sales"])) return res.status(403).json({ error: "Forbidden" });
      const { rows } = await pool.query(`
        select upper(coalesce(s.company_name_snapshot, 'Unknown')) as company,
               to_char(date_trunc('month', s.sale_date), 'Mon YYYY') as month,
               to_char(date_trunc('month', s.sale_date), 'YYYY-MM') as sort_key,
               coalesce(sum(l.box_quantity), 0)::numeric as boxes,
               coalesce(sum(l.total_amount), 0)::numeric as revenue
        from public.sales_entries s
        left join public.sales_line_items l on l.sale_entry_id = s.sale_entry_id
        where ${inRange("s.sale_date")}
        group by 1, 2, 3
        order by 3 desc, revenue desc
        limit 300
      `, params);
      const companies = [...new Set(rows.map((r) => r.company))].sort();
      const months = [...new Map(rows.map((r) => [r.month, r.sort_key])).entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([m]) => m);
      const values = {};
      rows.forEach((r) => {
        values[r.company] = values[r.company] || {};
        values[r.company][r.month] = { boxes: Number(r.boxes || 0), revenue: Number(r.revenue || 0) };
      });
      return returnLeadershipReport({ range, companies, months, values });
    }

    if (section === "sales-insights") {
      if (sectionForbidden(req, ["sales"])) return res.status(403).json({ error: "Forbidden" });
      const [products, daily] = await Promise.all([
        pool.query(`
          select coalesce(l.product_name_snapshot, 'Unknown') as product,
                 coalesce(sum(l.total_amount), 0)::numeric as revenue,
                 coalesce(sum(l.box_quantity), 0)::numeric as boxes,
                 coalesce(sum(case
                   when upper(coalesce(l.packaging_type, '')) = 'BOX' then coalesce(l.package_qty, 0) * coalesce(l.packets_quantity, 0) * coalesce(l.box_quantity, 0)
                   when upper(coalesce(l.packaging_type, '')) = 'PACKETS' then coalesce(l.package_qty, 0) * coalesce(l.packets_quantity, 0)
                   else coalesce(l.packets_quantity, 0)
                 end), 0)::numeric as units,
                 count(*)::integer as lines
          from public.sales_entries s
          join public.sales_line_items l on l.sale_entry_id = s.sale_entry_id
          where ${inRange("s.sale_date")}
          group by 1
          order by revenue desc
          limit 25
        `, params),
        pool.query(`
          select s.sale_date::text as date,
                 coalesce(sum(l.total_amount), 0)::numeric as revenue,
                 coalesce(sum(l.box_quantity), 0)::numeric as boxes
          from public.sales_entries s
          left join public.sales_line_items l on l.sale_entry_id = s.sale_entry_id
          where ${inRange("s.sale_date")}
          group by s.sale_date
          order by s.sale_date asc
        `, params)
      ]);
      const rows = products.rows.map((r) => {
        const revenue = Number(r.revenue || 0);
        const boxes = Number(r.boxes || 0);
        const units = Number(r.units || 0);
        return { ...r, revenue, boxes, units, avgPrice: units ? Number((revenue / units).toFixed(4)) : 0 };
      });
      return returnLeadershipReport({ range, rows, daily: daily.rows, totals: rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, boxes: a.boxes + r.boxes, units: a.units + r.units, lines: a.lines + Number(r.lines || 0) }), { revenue: 0, boxes: 0, units: 0, lines: 0 }) });
    }

    if (section === "customer-payments") {
      if (sectionForbidden(req, ["payments"])) return res.status(403).json({ error: "Forbidden" });
      const { rows } = await pool.query(`
        select payment_id::text as payment_id, payment_date::text as payment_date, cid,
               customer_name_snapshot, company_name_snapshot, customer_mobile_snapshot,
               amount_paid::numeric as amount_paid, payment_mode
        from public.customer_payments
        where ${inRange("payment_date")}
        order by payment_date desc nulls last, payment_id desc
        limit 100
      `, params);
      const totals = rows.reduce((a, r) => ({ amount: a.amount + Number(r.amount_paid || 0), count: a.count + 1 }), { amount: 0, count: 0 });
      return returnLeadershipReport({ range, rows, totals });
    }

    if (section === "customer-dues") {
      if (sectionForbidden(req, ["sales", "payments", "customers"])) return res.status(403).json({ error: "Forbidden" });
      const { rows } = await pool.query(`
        with sales_totals as (
          select cid, coalesce(company_name_snapshot, 'Unknown') as company_name,
                 max(customer_name_snapshot) as customer_name,
                 sum(coalesce(total_amount, 0)) as total_sales
          from public.sales_entries
          group by cid, coalesce(company_name_snapshot, 'Unknown')
        ),
        payment_totals as (
          select cid, coalesce(company_name_snapshot, 'Unknown') as company_name,
                 sum(coalesce(amount_paid, 0)) as total_paid
          from public.customer_payments
          group by cid, coalesce(company_name_snapshot, 'Unknown')
        ),
        due_rows as (
          select coalesce(s.customer_name, c.name, coalesce(s.company_name, p.company_name), 'Unknown') as customer,
                 (coalesce(s.total_sales, 0) - coalesce(p.total_paid, 0))::numeric as balance
          from sales_totals s
          full outer join payment_totals p on p.cid = s.cid and p.company_name = s.company_name
          left join public.contacts c on c.cid = coalesce(s.cid, p.cid)
        )
        select customer,
               balance,
               sum(balance) over()::numeric as total_balance
        from due_rows
        where balance > 0
        order by balance desc
        limit 150
      `);
      const dueRows = rows.map((r) => ({ customer: r.customer, balance: Number(r.balance || 0) }));
      return returnLeadershipReport({ rows: dueRows, totals: { balance: Number(rows[0]?.total_balance || 0) } });
    }

    if (section === "production") {
      if (sectionForbidden(req, ["production"])) return res.status(403).json({ error: "Forbidden" });
      const [summary, rows] = await Promise.all([
        pool.query(`select coalesce(sum(total_cups), 0)::numeric as total_cups, coalesce(sum(packets_qty), 0)::numeric as total_packets, coalesce(sum(box_qty), 0)::numeric as total_boxes from public.productions where ${inRange("production_date")}`, params),
        pool.query(`
          select coalesce(product_name_snapshot, 'Unknown') as product,
                 coalesce(sum(total_cups), 0)::numeric as cups,
                 coalesce(sum(packets_qty), 0)::numeric as packets,
                 coalesce(sum(box_qty), 0)::numeric as boxes
          from public.productions
          where ${inRange("production_date")}
          group by 1
          order by cups desc
          limit 25
        `, params)
      ]);
      return returnLeadershipReport({ range, rows: rows.rows, totals: summary.rows[0] || { total_cups: 0, total_packets: 0, total_boxes: 0 } });
    }

    if (section === "material-usage") {
      if (sectionForbidden(req, ["material_usage"])) return res.status(403).json({ error: "Forbidden" });
      const [summary, rows] = await Promise.all([
        pool.query(`
          select
            coalesce(sum(qty_used) filter (where lower(coalesce(material_type, '') || ' ' || coalesce(material_name_snapshot, '')) like '%blank%'), 0)::numeric as total_blanks_qty,
            coalesce(sum(qty_used) filter (where lower(coalesce(material_type, '') || ' ' || coalesce(material_name_snapshot, '')) like '%bottom%'), 0)::numeric as total_bottom_qty
          from public.material_usage
          where ${inRange("usage_date")}
        `, params),
        pool.query(`
          select coalesce(material_name_snapshot, 'Unknown') as material,
                 coalesce(material_type, 'Unknown') as material_type,
                 coalesce(unit, '') as unit,
                 coalesce(sum(qty_used), 0)::numeric as qty
          from public.material_usage
          where ${inRange("usage_date")}
          group by 1, 2, 3
          order by qty desc
          limit 100
        `, params)
      ]);
      return returnLeadershipReport({ range, rows: rows.rows, totals: summary.rows[0] || { total_blanks_qty: 0, total_bottom_qty: 0 } });
    }

    if (section === "material-purchased") {
      if (sectionForbidden(req, ["purchases", "vendor_payments"])) return res.status(403).json({ error: "Forbidden" });
      const [summary, purchases, payments, spendByVendorRes, paidByVendorRes] = await Promise.all([
        pool.query(`
          select
            (select coalesce(sum(total_amount), 0) from public.material_purchases where ${inRange("purchase_date")})::numeric as total_spend,
            (select coalesce(sum(amount), 0) from public.vendor_payments where ${inRange("payment_date")})::numeric as total_paid,
            (select count(*) from public.material_purchases where ${inRange("purchase_date")})::integer as purchases
        `, params),
        pool.query(`
          select
            coalesce(vendor_name_snapshot, 'Unknown') as vendor,
            coalesce(material_type, '') as material_type,
            coalesce(material_name_snapshot, 'Unknown') as material_name,
            coalesce(total_qty, 0)::numeric as total_qty,
            coalesce(total_kg, 0)::numeric as total_kgs,
            coalesce(total_amount, 0)::numeric as total_amount
          from public.material_purchases
          where ${inRange("purchase_date")}
          order by purchase_date desc nulls last, purchase_id desc
          limit 100
        `, params),
        pool.query(`
          select
            payment_id::text as payment_id,
            coalesce(vendor_name_snapshot, 'Unknown') as vendor,
            coalesce(amount, 0)::numeric as amount,
            coalesce(payment_method, '') as payment_method,
            payment_date::text as payment_date
          from public.vendor_payments
          where ${inRange("payment_date")}
          order by payment_date desc nulls last, payment_id desc
          limit 100
        `, params),
        pool.query(`
          select
            coalesce(vendor_name_snapshot, 'Unknown') as vendor,
            coalesce(sum(total_amount), 0)::numeric as total_amount
          from public.material_purchases
          where ${inRange("purchase_date")}
          group by 1
          order by total_amount desc
        `, params),
        pool.query(`
          select
            coalesce(vendor_name_snapshot, 'Unknown') as vendor,
            coalesce(sum(amount), 0)::numeric as amount
          from public.vendor_payments
          where ${inRange("payment_date")}
          group by 1
          order by amount desc
        `, params)
      ]);
      const totalSpend = Number(summary.rows[0]?.total_spend || 0);
      const totalPaid = Number(summary.rows[0]?.total_paid || 0);
      const spendByVendor = {};
      const paidByVendor = {};
      spendByVendorRes.rows.forEach((row) => { spendByVendor[row.vendor] = Number(row.total_amount || 0); });
      paidByVendorRes.rows.forEach((row) => { paidByVendor[row.vendor] = Number(row.amount || 0); });
      const vendorBalances = Object.keys({ ...spendByVendor, ...paidByVendor }).map((vendor) => ({
        vendor,
        spend: spendByVendor[vendor] || 0,
        paid: paidByVendor[vendor] || 0,
        balance: (spendByVendor[vendor] || 0) - (paidByVendor[vendor] || 0)
      }));
      return returnLeadershipReport({
        range,
        rows: purchases.rows,
        recentPurchases: purchases.rows.slice(0, 8),
        recentPayments: payments.rows.slice(0, 8),
        vendorBalances,
        spendByVendor,
        totals: { totalSpend, totalPaid, outstanding: totalSpend - totalPaid, purchases: Number(summary.rows[0]?.purchases || 0) }
      });
    }

    if (section === "stock") {
      if (sectionForbidden(req, ["production", "sales"])) return res.status(403).json({ error: "Forbidden" });
      const [periodSummary, stockRows] = await Promise.all([
        pool.query(`
          select
            (select coalesce(sum(box_qty), 0) from public.productions where ${inRange("production_date")})::numeric as produced,
            (select coalesce(sum(l.box_quantity), 0)
             from public.sales_entries s
             join public.sales_line_items l on l.sale_entry_id = s.sale_entry_id
             where ${inRange("s.sale_date")})::numeric as sold
        `, params),
        pool.query(`
        with produced as (
          select coalesce(product_id, product_name_snapshot) as key,
                 max(coalesce(product_name_snapshot, product_id, 'Unknown')) as product,
                 coalesce(cups_per_packet, 0)::numeric as package_qty,
                 coalesce(sum(box_qty), 0)::numeric as produced_boxes
          from public.productions
          group by coalesce(product_id, product_name_snapshot), coalesce(cups_per_packet, 0)
        ),
        sold as (
          select coalesce(l.product_id, l.product_name_snapshot) as key,
                 max(coalesce(l.product_name_snapshot, l.product_id, 'Unknown')) as product,
                 coalesce(l.package_qty, 0)::numeric as package_qty,
                 coalesce(sum(l.box_quantity), 0)::numeric as sold_boxes
          from public.sales_line_items l
          group by coalesce(l.product_id, l.product_name_snapshot), coalesce(l.package_qty, 0)
        )
        select coalesce(p.product, s.product) as product,
               coalesce(p.package_qty, s.package_qty) as package_qty,
               (coalesce(p.produced_boxes, 0) - coalesce(s.sold_boxes, 0))::numeric as stock_boxes
        from produced p
        full outer join sold s on s.key = p.key and s.package_qty = p.package_qty
        order by product asc, package_qty asc
        limit 150
      `)
      ]);
      return returnLeadershipReport({
        range,
        rows: stockRows.rows,
        totals: {
          produced: Number(periodSummary.rows[0]?.produced || 0),
          sold: Number(periodSummary.rows[0]?.sold || 0)
        }
      });
    }

    if (section === "materials") {
      if (sectionForbidden(req, ["purchases", "material_usage"])) return res.status(403).json({ error: "Forbidden" });
      const [periodSummary, stockRows] = await Promise.all([
        pool.query(`
          select
            (select coalesce(sum(total_qty), 0) from public.material_purchases where ${inRange("purchase_date")})::numeric as purchased,
            (select coalesce(sum(qty_used), 0) from public.material_usage where ${inRange("usage_date")})::numeric as used
        `, params),
        pool.query(`
        with purchased as (
          select coalesce(material_id, material_name_snapshot) as key,
                 max(coalesce(material_name_snapshot, material_id, 'Unknown')) as material,
                 max(coalesce(material_type, '')) as type,
                 coalesce(sum(total_qty), 0)::numeric as purchased_qty
          from public.material_purchases
          group by coalesce(material_id, material_name_snapshot)
        ),
        used as (
          select coalesce(material_id, material_name_snapshot) as key,
                 max(coalesce(material_name_snapshot, material_id, 'Unknown')) as material,
                 max(coalesce(material_type, '')) as type,
                 max(coalesce(unit, '')) as unit,
                 coalesce(sum(qty_used), 0)::numeric as used_qty
          from public.material_usage
          group by coalesce(material_id, material_name_snapshot)
        )
        select coalesce(p.material, u.material) as material,
               coalesce(nullif(p.type, ''), u.type, '') as type,
               case
                 when lower(coalesce(nullif(u.unit, ''), '')) like 'roll%' then 'Rolls'
                 when lower(coalesce(nullif(u.unit, ''), '')) like 'bag%' then 'Bags'
                 when lower(coalesce(nullif(p.type, ''), u.type, '')) like '%roll%' then 'Rolls'
                 else 'Bags'
               end as unit,
               (coalesce(p.purchased_qty, 0) - coalesce(u.used_qty, 0))::numeric as stock_qty
        from purchased p
        full outer join used u on u.key = p.key
        order by type asc, material asc
        limit 150
      `)
      ]);
      return returnLeadershipReport({
        range,
        rows: stockRows.rows,
        totals: {
          purchased: Number(periodSummary.rows[0]?.purchased || 0),
          used: Number(periodSummary.rows[0]?.used || 0)
        }
      });
    }

    if (section === "leads") {
      if (sectionForbidden(req, ["leads"])) return res.status(403).json({ error: "Forbidden" });
      const [summary, status, source, followups] = await Promise.all([
        pool.query("select count(*)::integer as total, count(*) filter (where lead_status = 'Converted')::integer as converted, count(*) filter (where lead_status = 'Hot')::integer as hot from public.leads"),
        pool.query("select coalesce(lead_status, 'Cold') as name, count(*)::integer as count from public.leads group by 1 order by count desc"),
        pool.query("select coalesce(source, 'Unknown') as name, count(*)::integer as count from public.leads group by 1 order by count desc limit 10"),
        pool.query("select lid, company, follow_up_date::text as follow_up_date, lead_status from public.leads where follow_up_date is not null and coalesce(lead_status, '') not in ('Converted', 'Lost') and follow_up_date <= current_date order by follow_up_date asc limit 20")
      ]);
      const total = Number(summary.rows[0]?.total || 0);
      const converted = Number(summary.rows[0]?.converted || 0);
      return returnLeadershipReport({ totals: { ...summary.rows[0], conversionRate: total ? (converted / total) * 100 : 0 }, byStatus: status.rows, bySource: source.rows, followups: followups.rows });
    }

    return res.status(404).json({ error: "Unknown leadership section" });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/live-module/:moduleKey", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    if (!modulePermission(req, moduleKey, "view")) return res.status(403).json({ error: "Forbidden" });
    const cfg = liveModuleConfig(moduleKey);
    if (!cfg) return res.status(404).json({ error: "Unknown live module" });
    if (moduleKey === "customers") {
      const { summary, rows } = await listCustomersWithAccounts();
      return res.json({
        config: {
          pk: cfg.pk,
          titleField: cfg.titleField,
          amountField: cfg.amountField,
          dateField: cfg.dateField,
          columns: [
            ...cfg.columns,
            "account_aid",
            "account_address",
            "account_city",
            "account_state",
            "account_zipcode",
            "account_gst_number"
          ],
          createFields: [...cfg.createFields, "address", "zipcode", "gst_number"]
        },
        summary: summary || { total_count: 0, amount_total: 0, month_count: 0 },
        rows
      });
    }
    const amountSql = cfg.amountField ? `coalesce(sum(${cfg.amountField}), 0)::numeric as amount_total,` : "0::numeric as amount_total,";
    const summarySql = `
      select
        count(*)::integer as total_count,
        ${amountSql}
        count(*) filter (where ${cfg.dateField} >= date_trunc('month', current_date))::integer as month_count
      from ${cfg.table}
    `;
    const listSql = `
      select ${cfg.columns.join(", ")}
      from ${cfg.table}
      order by ${cfg.dateField} desc nulls last, ${cfg.pk} desc
      limit 100
    `;
    const [summary, list] = await Promise.all([
      pool.query(summarySql),
      pool.query(listSql)
    ]);
    res.json({
      config: {
        pk: cfg.pk,
        titleField: cfg.titleField,
        amountField: cfg.amountField,
        dateField: cfg.dateField,
        columns: cfg.columns,
        createFields: cfg.createFields
      },
      summary: summary.rows[0] || { total_count: 0, amount_total: 0, month_count: 0 },
      rows: list.rows
    });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.post("/api/live-module/:moduleKey", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    if (!modulePermission(req, moduleKey, "create")) return res.status(403).json({ error: "Forbidden" });
    const cfg = liveModuleConfig(moduleKey);
    if (!cfg || !cfg.createFields.length) return res.status(404).json({ error: "Module does not support quick create yet" });
    const payload = req.body || {};
    if (moduleKey === "customers") {
      const row = await createCustomerWithAccount(req, payload);
      return res.json({ row });
    }
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const actorMode = cfg.actorMode || "created_by";
    const fields = [...cfg.createFields];
    const values = fields.map((field) => coerceLiveValue(payload[field]));
    if (cfg.prefix) {
      fields.unshift(cfg.pk);
      values.unshift(nextId(cfg.prefix));
    }
    if (actorMode === "entered_by") {
      fields.push("entered_by_user_id", "last_edited_by_user_id", "created_by_name", "updated_by_name");
      values.push(actorUserId, actorUserId, actorName, actorName);
    } else {
      fields.push("created_by_user_id", "created_by_name", "updated_by_user_id", "updated_by_name");
      values.push(actorUserId, actorName, actorUserId, actorName);
    }
    const params = values.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `
      insert into ${cfg.table} (${fields.join(", ")})
      values (${params})
      returning ${cfg.columns.join(", ")}
    `;
    const { rows } = await pool.query(sql, values);
    res.json({ row: rows[0] });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.put("/api/live-module/:moduleKey/:recordId", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    const recordId = String(req.params.recordId || "").trim();
    if (!modulePermission(req, moduleKey, "update")) return res.status(403).json({ error: "Forbidden" });
    const cfg = liveModuleConfig(moduleKey);
    if (!cfg || !cfg.createFields.length) return res.status(404).json({ error: "Module does not support update yet" });
    const payload = req.body || {};
    if (moduleKey === "customers") {
      const row = await updateCustomerWithAccount(req, recordId, payload);
      if (!row) return res.status(404).json({ error: "Record not found" });
      return res.json({ row });
    }
    const actorUserId = req.sessionData.user.userId;
    const actorName = req.sessionData.user.displayName;
    const actorMode = cfg.actorMode || "created_by";

    const sets = cfg.createFields.map((field, i) => `${field} = $${i + 1}`);
    let values;
    if (actorMode === "entered_by") {
      sets.push(`last_edited_by_user_id = $${cfg.createFields.length + 1}`);
      sets.push(`updated_by_name = $${cfg.createFields.length + 2}`);
      values = [
        ...cfg.createFields.map((field) => coerceLiveValue(payload[field])),
        actorUserId,
        actorName,
        recordId
      ];
    } else {
      sets.push(`updated_by_user_id = $${cfg.createFields.length + 1}`);
      sets.push(`updated_by_name = $${cfg.createFields.length + 2}`);
      values = [
        ...cfg.createFields.map((field) => coerceLiveValue(payload[field])),
        actorUserId,
        actorName,
        recordId
      ];
    }

    const sql = `
      update ${cfg.table}
      set ${sets.join(", ")}
      where ${cfg.pk} = $${cfg.createFields.length + 3}
      returning ${cfg.columns.join(", ")}
    `;
    const { rows } = await pool.query(sql, values);
    if (!rows.length) return res.status(404).json({ error: "Record not found" });
    res.json({ row: rows[0] });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.delete("/api/live-module/:moduleKey/:recordId", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    const recordId = String(req.params.recordId || "").trim();
    if (!modulePermission(req, moduleKey, "delete")) return res.status(403).json({ error: "Forbidden" });
    const cfg = liveModuleConfig(moduleKey);
    if (!cfg) return res.status(404).json({ error: "Unknown live module" });
    const sql = `delete from ${cfg.table} where ${cfg.pk} = $1`;
    const { rowCount } = await pool.query(sql, [recordId]);
    if (!rowCount) return res.status(404).json({ error: "Record not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: clientSafeError(error) });
  }
});

app.get("/api/module/:moduleKey", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    if (!modulePermission(req, moduleKey, "view")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchemaForModule(moduleKey);
    const cfg = await effectiveTableConfig(tableConfig(moduleKey));
    if (!cfg) return res.status(404).json({ error: "Unknown module" });
    const sql = `
      select ${cfg.columns.join(", ")}
      from ${cfg.table}
      order by ${cfg.dateField} desc nulls last, ${cfg.pk} desc
      limit 300
    `;
    const { rows } = await pool.query(sql);
    res.json({ rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/module/:moduleKey", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    if (!modulePermission(req, moduleKey, "create")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchemaForModule(moduleKey);
    const cfg = await effectiveTableConfig(tableConfig(moduleKey));
    if (!cfg) return res.status(404).json({ error: "Unknown module" });

    const idPrefix = moduleKey === "salary_payments" ? "SALX" : moduleKey === "operational_expenses" ? "EXPX" : "EADX";
    const recordId = nextId(idPrefix);
    const userId = req.sessionData.user.userId;
    const userName = req.sessionData.user.displayName;
    const payload = req.body || {};
    if (["salary_payments", "operational_expenses", "expense_advances"].includes(moduleKey) && cfg.createFields.includes("employee_id")) {
      payload.employee_id = await resolveEmployeeIdByName(pool, payload);
    }
    const fields = [cfg.pk, ...cfg.createFields, "entered_by_user_id", "last_edited_by_user_id", "created_by_name", "updated_by_name"];
    const values = [recordId, ...cfg.createFields.map((f) => payload[f] ?? null), userId, userId, userName, userName];
    const params = values.map((_, i) => `$${i + 1}`).join(", ");

    const sql = `
      insert into ${cfg.table} (${fields.join(", ")})
      values (${params})
      returning ${cfg.columns.join(", ")}
    `;
    const { rows } = await pool.query(sql, values);
    res.json({ row: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/module/:moduleKey/bulk", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    if (!["operational_expenses", "salary_payments"].includes(moduleKey)) return res.status(404).json({ error: "Unknown bulk module" });
    if (!modulePermission(req, moduleKey, "create")) return res.status(403).json({ error: "Forbidden" });
    await ensureHrSchemaForModule(moduleKey);
    const cfg = await effectiveTableConfig(tableConfig(moduleKey));
    if (!cfg) return res.status(404).json({ error: "Unknown module" });
    const rowsIn = requireRows(req, res);
    if (!rowsIn) return;
    const idPrefix = moduleKey === "salary_payments" ? "SALX" : "EXPX";
    const userId = req.sessionData.user.userId;
    const userName = req.sessionData.user.displayName;
    const prepared = [];
    for (let i = 0; i < rowsIn.length; i += 1) {
      const row = { ...(rowsIn[i] || {}) };
      const rowNo = i + 1;
      if (cfg.createFields.includes("employee_id")) {
        row.employee_id = await resolveEmployeeIdByName(client, row);
      }
      if (moduleKey === "operational_expenses") {
        if (!row.expense_date) throw new Error(`Row ${rowNo}: expense date is required.`);
        if (!row.expense_type) throw new Error(`Row ${rowNo}: expense type is required.`);
        if (!Number(row.amount || 0)) throw new Error(`Row ${rowNo}: amount is required.`);
      }
      if (moduleKey === "salary_payments") {
        if (!row.payment_date) throw new Error(`Row ${rowNo}: payment date is required.`);
        if (!row.employee_id || !row.paid_to) throw new Error(`Row ${rowNo}: employee is required.`);
        if (!Number(row.amount || 0)) throw new Error(`Row ${rowNo}: amount is required.`);
      }
      prepared.push(row);
    }
    await client.query("begin");
    const created = [];
    for (const payload of prepared) {
      const recordId = nextId(idPrefix);
      const fields = [cfg.pk, ...cfg.createFields, "entered_by_user_id", "last_edited_by_user_id", "created_by_name", "updated_by_name"];
      const values = [recordId, ...cfg.createFields.map((f) => payload[f] ?? null), userId, userId, userName, userName];
      const params = values.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `
        insert into ${cfg.table} (${fields.join(", ")})
        values (${params})
        returning ${cfg.columns.join(", ")}
      `;
      const { rows } = await client.query(sql, values);
      created.push(rows[0]);
    }
    await client.query("commit");
    res.json({ success: true, count: created.length, rows: created });
  } catch (error) {
    try { await client.query("rollback"); } catch (_err) {}
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.put("/api/module/:moduleKey/:recordId", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    const recordId = String(req.params.recordId || "").trim();
    await ensureHrSchemaForModule(moduleKey);
    const cfg = await effectiveTableConfig(tableConfig(moduleKey));
    if (!cfg) return res.status(404).json({ error: "Unknown module" });
    if (!modulePermission(req, moduleKey, "update")) return res.status(403).json({ error: "Forbidden" });
    const userId = req.sessionData.user.userId;
    const userName = req.sessionData.user.displayName;
    const payload = req.body || {};
    if (["salary_payments", "operational_expenses", "expense_advances"].includes(moduleKey) && cfg.createFields.includes("employee_id")) {
      payload.employee_id = await resolveEmployeeIdByName(pool, payload);
    }
    const sets = cfg.createFields.map((f, i) => `${f} = $${i + 1}`);
    sets.push(`last_edited_by_user_id = $${cfg.createFields.length + 1}`);
    sets.push(`updated_by_name = $${cfg.createFields.length + 2}`);
    const values = [...cfg.createFields.map((f) => payload[f] ?? null), userId, userName, recordId];
    const sql = `
      update ${cfg.table}
      set ${sets.join(", ")}
      where ${cfg.pk} = $${cfg.createFields.length + 3}
      returning ${cfg.columns.join(", ")}
    `;
    const { rows } = await pool.query(sql, values);
    if (!rows.length) return res.status(404).json({ error: "Record not found" });
    res.json({ row: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/module/:moduleKey/:recordId", requireAuth, async (req, res) => {
  try {
    const moduleKey = sanitizeModuleKey(req.params.moduleKey);
    const recordId = String(req.params.recordId || "").trim();
    await ensureHrSchemaForModule(moduleKey);
    const cfg = await effectiveTableConfig(tableConfig(moduleKey));
    if (!cfg) return res.status(404).json({ error: "Unknown module" });
    if (!modulePermission(req, moduleKey, "delete")) return res.status(403).json({ error: "Forbidden" });
    const sql = `delete from ${cfg.table} where ${cfg.pk} = $1`;
    await pool.query(sql, [recordId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`MCM web app listening on http://localhost:${port}`);
  });
}

module.exports = app;

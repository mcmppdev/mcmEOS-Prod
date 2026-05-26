# MCM EOS System Architecture

## Current Architecture

MCM EOS currently uses a simple full-stack JavaScript architecture:

```text
Browser
  -> Express static frontend
  -> Express JSON APIs
  -> Supabase Postgres
```

There is no frontend build step in the active app. Vercel can deploy `webapp-restart` directly as the project root.

## Runtime Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Express server | `webapp-restart/server.js` | Static file serving, auth, sessions, permissions, APIs, report SQL |
| HTML shell | `webapp-restart/index.html` | Page containers, forms, navigation structure |
| Frontend JS | `webapp-restart/ui/app.js` | Routing, state, form logic, API calls, rendering |
| Frontend CSS | `webapp-restart/ui/app.css` | App visual design and responsive layout |
| Assets | `webapp-restart/assets/` | MCM logo and image assets |
| Vercel config | `webapp-restart/vercel.json` | Deployment behavior |
| Database migrations | `supabase/migrations/` | Schema evolution |
| Seed data | `supabase/seeds/` | Imported historical data and validation scripts |

## Server Architecture

`server.js` is currently a monolithic Express server. It includes:

- imports and app setup
- database pool setup
- static file serving
- session cookie helpers
- password verification
- login audit writing
- session lookup/touch/revoke
- permission helpers
- normalizers for database rows
- route handlers for each domain
- report SQL
- generic module CRUD handlers

### Database Pool

The app uses `pg.Pool`:

```js
new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
})
```

The low pool size is friendly to serverless deployment but can limit concurrent long-running reports. If the app is moved to a long-running Node service, pool sizing should be revisited.

### Environment Variables

Required:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase/Postgres connection string |
| `SESSION_SECRET` | Signed cookie secret |
| `NODE_ENV` | Enables production cookie and SSL behavior |
| `PORT` | Local port, defaults to `4173` |

## Frontend Architecture

The frontend is a plain JavaScript single-page app.

### Core Patterns

| Pattern | Implementation |
| --- | --- |
| App routing | `switchApp`, `showPage`, `appDefaultPage` |
| Page metadata | `PAGE_META` |
| Sub-tabs | `SUB_TABS` |
| Permission-aware UI | `sessionCan`, `sessionCanView`, `appCanOpen` |
| Page initialization | `initPage(pageId)` |
| API wrapper | `api(path, options)` |
| Domain state | Global arrays/objects such as `MM`, `MDM`, `ADMIN` |

### Active App Shell

`index.html` contains all page containers. `showPage(pageId)` hides inactive pages and shows the selected page. `initPage(pageId)` lazy-loads data for that page.

This is fast to build and deploy, but page ownership must be handled carefully because all domains share one JS file and one HTML file.

## Database Architecture

The schema is organized by business domain.

### Identity and Permissions

| Table | Purpose |
| --- | --- |
| `app_users` | Login users |
| `app_modules` | Permission module catalog |
| `app_user_module_access` | User-module permissions |
| `app_sessions` | Active login sessions |
| `app_login_audit` | Login attempts |

### CRM and Sales

| Table | Purpose |
| --- | --- |
| `contacts` | Customer contacts |
| `accounts` | Company/account records |
| `leads` | Marketing leads |
| `sales` | Legacy imported sales |
| `sales_entries` | New grouped sales header records |
| `sales_line_items` | New sales line item records |
| `customer_payments` | Customer collections |

### Products

| Table | Purpose |
| --- | --- |
| `products` | Product master |
| `product_prices` | Product pricing by packaging/effective date |

### Materials

| Table | Purpose |
| --- | --- |
| `material_types` | Material category/type |
| `material_subtypes` | Material subtype |
| `materials` | Material master |
| `vendors` | Vendor master |
| `material_purchases` | Material purchase transactions |
| `vendor_payments` | Vendor payment transactions |
| `material_stock` | Material stock records |

### Production and Resources

| Table | Purpose |
| --- | --- |
| `productions` | Production runs |
| `material_usage` | Material consumption logs |
| `machines` | Machine master |
| `operators` | Operator master |

### Finance

| Table | Purpose |
| --- | --- |
| `employees` | Employee master |
| `salary_payments` | Salary payments |
| `operational_expenses` | Expenses |
| `expense_advances` | Expense advances |
| `app_enum_values` | Dropdown/config values |

### Reporting and System Support

| Table | Purpose |
| --- | --- |
| `leadership_report_snapshots` | Cached Leadership report payloads |
| `leadership_report_usage` or related quota table | Monthly report usage tracking, depending on migration state |
| `tasks` | Home/task workflow |
| `organisation` | Organisation profile/settings |

## API Architecture

### Dedicated Domain APIs

The active server exposes dedicated route groups:

| Route group | Domain |
| --- | --- |
| `/api/login`, `/api/logout`, `/api/auth/me` | Auth/session |
| `/api/home`, `/api/tasks` | Home and tasks |
| `/api/admin/*` | User, module, product, enum, organisation admin |
| `/api/sales/entries` | Sales entries |
| `/api/mdm/*` | Material master data |
| `/api/mm/*` | Material Purchase Management |
| `/api/pm/*` | Production Management |
| `/api/rm/*` | Resource Management |
| `/api/finance/employees` | Employee management |
| `/api/lookups` | Cross-domain form lookups |
| `/api/dashboard/summary` | Dashboard summary |
| `/api/leadership/*` | Leadership reporting |

### Generic Module APIs

Generic module routes support module-driven CRUD for simpler data modules:

- `/api/live-module/:moduleKey`
- `/api/module/:moduleKey`

These reduce duplicated code but require careful metadata, validation, and permission checks.

## Deployment Architecture

### Current Deployment Candidate

Vercel project root:

```text
webapp-restart
```

Production environment variables:

```text
DATABASE_URL
SESSION_SECRET
NODE_ENV=production
```

### Recommended Deployment Environments

| Environment | Branch/repo | Database | Vercel project | Purpose |
| --- | --- | --- | --- | --- |
| Local | working branch | local/dev Supabase | local server | Development |
| Dev/Staging | `dev` branch or dev repo | dev Supabase project | Vercel preview/dev | Testing and UAT |
| Production | `main` branch or prod repo | production Supabase project | Vercel production | Live operations |

Never test schema-changing work directly against production data.

## Security Architecture

### Current Controls

- Signed HTTP-only session cookie
- Server-side password verification
- Server-side permission checks
- Login audit
- Active session table
- Production `secure` cookies when `NODE_ENV=production`
- No direct database credentials in frontend code

### Needed Controls

- Separate dev/prod databases
- Strong production `SESSION_SECRET`
- Database backup schedule
- Admin-only password reset policy
- Report quota admin visibility
- Production deploy checklist
- Optional IP/device audit for sensitive roles

## Data Integrity Architecture

Important data integrity choices:

- Keep original legacy IDs where available.
- Use snapshot fields on transaction records.
- Use numeric columns for money and quantities.
- Use date columns for business dates.
- Use ownership columns for audit and permission checks.
- Prefer database constraints for uniqueness where stable business rules exist.

## Reporting Architecture

Leadership reports combine:

- shared date range resolver
- section normalization
- module permission checks
- SQL aggregates
- report snapshots
- monthly usage quota
- frontend rendering helpers

Report queries should prefer grouped SQL aggregates over deriving totals from limited display rows.

## Maintainability Recommendations

### Short Term

1. Keep `webapp-restart` as the active app.
2. Create smoke tests for static assets and critical APIs.
3. Add a developer checklist before every production deploy.
4. Avoid broad refactors while active operational bugs are being fixed.

### Medium Term

1. Split `server.js` into route files by domain.
2. Split `ui/app.js` into frontend modules.
3. Add a small build step only when module splitting becomes necessary.
4. Add report tests for critical aggregate calculations.
5. Add database migration review and rollback notes.

### Long Term

1. Consider a typed API layer.
2. Introduce automated browser tests for top workflows.
3. Add role-based test fixtures.
4. Add admin cache-clear and report-debug screens.
5. Add deployment automation from dev to production.


# MCM EOS Project Design

## Purpose

MCM EOS is the operating system for MCM Paper Products. It replaces the earlier Google Sheets, Apps Script, and Google Sites workflows with a Supabase-backed web application that can be developed, tested, versioned, and deployed through GitHub and Vercel.

The system is designed for daily operational entry and management across:

- Sales and customer payments
- Customer/contact/account management
- Leads and marketing follow-up
- Product and pricing administration
- Material master data
- Material purchases and vendor payments
- Production runs and material usage
- Machine and operator resources
- Finance, salary, expenses, and advances
- Leadership reporting
- User and permission administration

## Current Repository Shape

The repository contains three important layers:

| Path | Role | Status |
| --- | --- | --- |
| `webapp-restart/` | Active app implementation and Vercel root candidate | Primary working code |
| `webapp/` | Earlier web app / legacy migration build | Reference and fallback only |
| `supabase/migrations/` | Database schema history | Source of truth for database structure |
| `supabase/seeds/` | Imported seed data and verification SQL | Source of truth for historical imported data |
| `docs/` | Migration maps and project documentation | Documentation hub |
| `scripts/` | PowerShell seed-generation utilities | Migration support |

Going forward, new application work should happen in `webapp-restart/` unless a deliberate refactor or framework migration is planned.

## Product Design Principles

### Operations First

The application is not a marketing site. It is an internal operational tool. Screens should be compact, predictable, and optimized for repeated daily use. The design favors:

- Dense but readable information
- Quick forms for transaction entry
- Clear module separation
- Permission-aware navigation
- Mobile-friendly layouts for factory/field use
- Simple dashboards that answer operational questions quickly

### One Shell, Many Apps

The active frontend is a single-page application shell served from `webapp-restart/index.html`, with behavior in `webapp-restart/ui/app.js` and styling in `webapp-restart/ui/app.css`.

The shell exposes app-level areas:

| App key | Label | Purpose |
| --- | --- | --- |
| `sales` | SM | Sales, customers, customer payments, sales reports |
| `marketing` | MM | Leads and lead dashboards |
| `finance` | FM | Employees, salary, expenses, advances |
| `mm` | MPM | Material Purchase Management |
| `pm` | PM | Production Management |
| `leadership` | LD | Executive reports |
| `admin` | Admin | Users, products, materials, resources, dropdown values |

Each app has page IDs, metadata, sub-tabs, bottom navigation, and lazy initialization handlers in `ui/app.js`.

### Permission-Aware UX

Navigation is driven by the logged-in user's module permissions. The UI hides apps, sub-tabs, and create actions when the session lacks the relevant permission. The server also enforces permissions before returning or mutating data.

Permissions are stored in:

- `app_users`
- `app_modules`
- `app_user_module_access`
- `app_sessions`
- `app_login_audit`

Permission flags:

- `can_view`
- `can_create`
- `can_update`
- `can_delete`
- `can_edit_own`

Delete is intentionally stricter than edit. Own-record editing can allow update, but delete requires explicit delete permission.

## Visual Design

The application uses a card-and-tab operational dashboard style:

- Top header with menu, logo, current page title, app badge, and logout
- App switcher cards for available applications
- Horizontal sub-tabs for related pages
- Bottom mobile-style navigation per app
- Filter cards for date/search/status controls
- KPI stat cards for key totals
- Repeated list rows for transactional records
- Compact tables for reports
- Toast messages for success/error feedback

The current UI is implemented in plain HTML/CSS/JavaScript without a frontend framework. This keeps deployment simple and allows fast iteration, but it also means UI conventions must be documented and followed carefully.

## Domain Design

### Customers, Sales, and Payments

Sales are stored through newer sales-entry tables:

- `sales_entries`
- `sales_line_items`

Legacy imported sales may also exist in:

- `sales`

Customer/account data is stored in:

- `contacts`
- `accounts`

Customer payments are stored in:

- `customer_payments`

Important rule: transaction rows keep snapshot fields such as customer name, company name, product name, and price details so historical records remain readable even if master records change later.

### Products and Pricing

Product admin manages:

- `products`
- `product_prices`

Pricing supports packaging types such as `BOX`, `PACKETS`, and `LIDS`. The current app keeps active pricing logic server-side and returns lookup data to the sales form.

### Materials

Material master data is split into:

- `vendors`
- `material_types`
- `material_subtypes`
- `materials`

Material purchases and payments are split into:

- `material_purchases`
- `vendor_payments`

Vendor balance rule:

```text
vendor balance = total material purchase amount - total vendor payment amount
```

### Production

Production uses:

- `productions`
- `material_usage`
- `machines`
- `operators`
- `material_stock`

Production total-cup rule:

```text
total_cups = cups_per_packet * packets_qty * (box_qty > 0 ? box_qty : 1)
```

### Finance

Finance uses:

- `employees`
- `salary_payments`
- `operational_expenses`
- `expense_advances`
- `app_enum_values`

Dropdown values are managed through app enum records rather than hard-coded UI lists where practical.

### Leadership

Leadership Dashboard is a reporting layer over operational tables. It supports shared period filters and report-specific aggregation. The current sections include:

- Overall
- Sales MoM
- Sales Insights
- Customer Payments
- Customer Dues
- FG Stock
- Material Stock
- Production
- Material Usage
- Material Purchased
- Leads

Leadership reports are cached in `leadership_report_snapshots` and rate-limited through monthly quota tracking.

## Design Risks

| Risk | Why it matters | Recommendation |
| --- | --- | --- |
| Single large `ui/app.js` | Hard to reason about and easy to break unrelated pages | Introduce module files or a build step later |
| Duplicate legacy data paths | `sales` and `sales_entries` both exist | Make report source selection explicit per report |
| Plain JS state | Hidden coupling between pages and global variables | Document page ownership and refactor gradually |
| Production data mutation risk | Active app talks directly to Supabase | Use separate dev/prod databases before broader testing |
| Report cache confusion | Users may see stale aggregates | Add visible cache metadata and admin cache clear tooling |

## Target Design Direction

The next design iteration should keep the current operational UX but improve maintainability:

1. Keep `webapp-restart` as the active app root.
2. Split `ui/app.js` into domain modules when build tooling is introduced.
3. Keep server-side validation authoritative.
4. Add automated smoke tests for all critical pages and APIs.
5. Create separate development and production deployment environments.
6. Treat Supabase migrations as mandatory review items before production deployment.


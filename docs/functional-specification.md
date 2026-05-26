# MCM EOS Functional Specification

## Scope

This document describes the current functional behavior of the MCM EOS application based on the repository files, existing project documents, migrations, seeds, and the active `webapp-restart` implementation.

The active app is a custom Express + PostgreSQL + plain JavaScript web application. It uses server-side session cookies and module permissions stored in Supabase/Postgres tables.

## Roles and Access

### Login

Users authenticate through:

```text
POST /api/login
```

The server:

1. Looks up the user in `app_users`.
2. Verifies the submitted password with Postgres `crypt`.
3. Checks `is_active`.
4. Loads viewable module permissions from `app_user_module_access`.
5. Creates a session in `app_sessions`.
6. Sets the signed HTTP-only `mcm_session` cookie.
7. Writes login audit information to `app_login_audit`.

### Session

Session endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/me` | Return current user and permissions |
| `GET /api/session` | Return session data |
| `POST /api/logout` | Revoke session and clear cookie |

Sessions expire after one day by default and are periodically touched while in use.

### Permissions

Every module can define:

- view permission
- create permission
- update permission
- delete permission
- edit-own permission

The frontend uses permissions to hide unavailable pages and actions. The backend repeats permission checks before executing protected data operations.

## Home and Tasks

### Home

Home loads operational summary data from:

```text
GET /api/home
```

It is intended to provide a high-level landing screen after login.

### Tasks

Task endpoints:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/tasks` | List tasks |
| `POST /api/tasks` | Create task |
| `PUT /api/tasks/:taskId` | Update task |
| `POST /api/tasks/:taskId/complete` | Mark task complete |

Tasks support assignment, due dates, status, and ownership fields.

## Sales Management

### Sales Pages

Important page IDs:

| Page ID | Label / Purpose |
| --- | --- |
| `sales-dash` | Sales Dashboard |
| `dashboard` | Sales list/report |
| `sale` | New Sale |
| `sales-quote` | Generate Quote |

### Sales APIs

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/sales/entries` | GET | List sales entries |
| `/api/sales/entries` | POST | Create sales entry with line items |
| `/api/sales/entries/:saleEntryId` | PUT | Update sale entry |
| `/api/sales/entries/:saleEntryId` | DELETE | Delete sale entry |

### Sales Entry Behavior

The current implementation uses `sales_entries` and `sales_line_items` for new sale entry workflows.

Expected behavior:

1. User selects or creates customer/account context.
2. User adds line items.
3. Line totals are calculated from packaging, quantity, and price.
4. Server validates and inserts the sale entry plus line items.
5. Snapshot fields preserve customer and product text at transaction time.

## Customer Management

### Customer Pages

| Page ID | Purpose |
| --- | --- |
| `cust-dash` | Customer overview |
| `contacts` | Contact list |
| `accounts` | Account list |
| `customer` | New customer |
| `account-new` | New account |

### Functional Rules

- Contacts and accounts are linked by IDs.
- Legacy imports preserve original IDs.
- Customer payment and sales rows keep snapshots to preserve history.
- Customer dues are calculated from sales minus customer payments.

## Customer Payments

### Pages

| Page ID | Purpose |
| --- | --- |
| `cp-dash` | Customer payments dashboard |
| `paydash` | Payment list |
| `payment` | New payment |

### Expected Behavior

Payment entry records:

- payment date
- customer/contact/account identifiers
- customer/company snapshot
- payment amount
- payment mode/method
- notes when available

Customer payments contribute to customer dues, leadership customer payment reports, and overall financial reporting.

## Marketing and Leads

### Pages

| Page ID | Purpose |
| --- | --- |
| `leads-dash` | Leads dashboard |
| `leads` | Leads list |
| `leads-add` | Add lead |

### Functional Behavior

Leads support:

- lead source
- city
- status
- contact details
- follow-up tracking
- conversion status

Lead conversion should create or reuse customer records and mark the lead as converted. Lost leads should not be converted.

## Finance Management

### Pages

| Page ID | Purpose |
| --- | --- |
| `finance-dash` | Finance dashboard |
| `fin-employees` | Employees |
| `fin-employee-new` | New employee |
| `fin-expenses` | Operational expenses |
| `fin-expense-new` | New expense |
| `fin-salary` | Salary payments |
| `fin-salary-new` | New salary payment |
| `fin-advances` | Expense advances |
| `fin-advance-new` | New expense advance |

### APIs

| Endpoint group | Purpose |
| --- | --- |
| `/api/finance/employees` | Employee CRUD |
| `/api/module/salary_payments` | Generic salary payment module CRUD |
| `/api/module/operational_expenses` | Generic operational expense CRUD |
| `/api/module/expense_advances` | Generic expense advance CRUD |

### Functional Behavior

Finance records are included in Leadership overall reporting:

- salary payments
- operational expenses
- expense advances

These records support ownership metadata for audit and edit-own permissions.

## Product and Pricing Admin

### Pages

| Page ID | Purpose |
| --- | --- |
| `prod-dash` | Product dashboard |
| `prod-list` | Product list |
| `prod-new` | New/edit product |
| `prod-pricing` | Pricing list |
| `prod-px-new` | New/edit price |

### APIs

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/admin/products-pricing` | GET | Load products, pricing, packaging types |
| `/api/admin/products` | POST | Create product |
| `/api/admin/products/:productId` | PUT | Update product |
| `/api/admin/products/:productId` | DELETE | Deactivate/delete product |
| `/api/admin/pricing` | POST | Create pricing row |
| `/api/admin/pricing/:priceId` | PUT | Update pricing row |
| `/api/admin/pricing/:priceId` | DELETE | Deactivate/delete pricing row |

### Functional Rules

- Product names and categories are required.
- Active pricing controls sales lookup behavior.
- A product can have pricing by packaging type.
- Historical sales should keep product price snapshots.

## Material Master Data

### Pages

| Page ID | Purpose |
| --- | --- |
| `mdm-dash` | Master data dashboard |
| `mdm-vendors` | Vendors |
| `mdm-vendor-new` | New/edit vendor |
| `mdm-types` | Material types |
| `mdm-subtypes` | Material subtypes |
| `mdm-materials` | Materials |
| `mdm-mat-new` | New/edit material |

### APIs

| Endpoint group | Purpose |
| --- | --- |
| `/api/mdm/initial` | Load vendors, types, subtypes, materials |
| `/api/mdm/vendors` | Vendor CRUD |
| `/api/mdm/material-types` | Material type CRUD |
| `/api/mdm/material-subtypes` | Material subtype CRUD |
| `/api/mdm/materials` | Material CRUD |

## Material Purchase Management

### Pages

| Page ID | Purpose |
| --- | --- |
| `mm-dash` | Dashboard |
| `mm-purchases` | Purchase list |
| `mm-pur-new` | New purchase |
| `mm-payments` | Vendor payments |
| `mm-pay-new` | New vendor payment |

### APIs

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/mm/initial` | GET | Load purchases, payments, vendors, materials |
| `/api/mm/purchases` | POST | Create purchase |
| `/api/mm/purchases/bulk` | POST | Create purchase batch |
| `/api/mm/purchases/:purchaseId` | PUT | Update purchase |
| `/api/mm/purchases/:purchaseId` | DELETE | Delete purchase |
| `/api/mm/vendor-payments` | POST | Create vendor payment |
| `/api/mm/vendor-payments/:paymentId` | PUT | Update vendor payment |
| `/api/mm/vendor-payments/:paymentId` | DELETE | Delete vendor payment |

### Functional Rules

Material purchase amount is stored as `total_amount`. Vendor payment amount is stored as `amount`.

Vendor spend is:

```text
sum(material_purchases.total_amount) grouped by vendor
```

Vendor paid is:

```text
sum(vendor_payments.amount) grouped by vendor
```

Outstanding is:

```text
total spend - total paid
```

## Production Management

### Pages

| Page ID | Purpose |
| --- | --- |
| `pm-dash` | Production dashboard |
| `pm-runs` | Production runs |
| `pm-run-new` | New production run |
| `pm-usage` | Material usage |
| `pm-usage-new` | Log material usage |

### APIs

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/pm/initial` | GET | Load production/material usage support data |
| `/api/pm/productions` | POST | Create production |
| `/api/pm/productions/bulk` | POST | Create production batch |
| `/api/pm/productions/:productionId` | PUT | Update production |
| `/api/pm/productions/:productionId` | DELETE | Delete production |
| `/api/pm/material-usage` | POST | Create material usage |
| `/api/pm/material-usage/bulk` | POST | Create material usage batch |
| `/api/pm/material-usage/:usageId` | PUT | Update material usage |
| `/api/pm/material-usage/:usageId` | DELETE | Delete material usage |

## Resource Management

### Pages

| Page ID | Purpose |
| --- | --- |
| `rm-dash` | Resource dashboard |
| `rm-machines` | Machines |
| `rm-machine-new` | New/edit machine |
| `rm-operators` | Operators |
| `rm-operator-new` | New/edit operator |

### APIs

| Endpoint group | Purpose |
| --- | --- |
| `/api/rm/initial` | Load machines and operators |
| `/api/rm/machines` | Machine CRUD |
| `/api/rm/operators` | Operator CRUD |

## User and System Administration

### Pages

| Page ID | Purpose |
| --- | --- |
| `admin-dash` | User management dashboard |
| `admin-users` | Users and access |
| `admin-user-new` | New/edit user access |
| `admin-apps` | Apps |
| `admin-modules` | Modules |
| `admin-org` | Organisation settings |
| `admin-enums` | Dropdown values |

### APIs

| Endpoint | Purpose |
| --- | --- |
| `/api/admin/dashboard` | Admin dashboard data |
| `/api/admin/users` | User list/create |
| `/api/admin/users/:userId` | User update |
| `/api/admin/users/:userId/access` | User access |
| `/api/admin/users/:userId/reset-password` | Password reset |
| `/api/admin/modules` | Module definitions |
| `/api/admin/organisation` | Organisation settings |
| `/api/admin/enums` | Dropdown value CRUD |

## Leadership Dashboard

### Period Filters

Leadership reports support:

- This Month
- Last Month
- Last 3 Months
- This Year
- All Time
- Custom

### API

```text
GET /api/leadership/:section
```

Query parameters:

- `period`
- `start`
- `end`
- `force=1`

### Sections

| Section key | Label | Functional summary |
| --- | --- | --- |
| `sales-payments` | Overall | Sales, payments, purchases, expenses, salaries, advances |
| `sales-mom` | Sales MoM | Sales trends by month |
| `sales-insights` | Sales Insights | Product/order/revenue insights |
| `customer-payments` | Customer Payments | Payment history and totals |
| `customer-dues` | Customer Dues | Billed, collected, balance |
| `stock` | FG Stock | Produced minus sold stock view |
| `materials` | Material Stock | Purchased minus used material position |
| `production` | Production | Production totals and product/machine breakdown |
| `material-usage` | Material Usage | Material consumption totals |
| `material-purchased` | Material Purchased | Purchase spend, vendor payments, vendor balances |
| `leads` | Leads | Lead counts, conversion, source/status breakdown |

### Caching and Quota

Leadership reports use:

- `leadership_report_snapshots`
- monthly quota tracking
- report TTL by section
- force refresh protection for recently refreshed snapshots

This keeps dashboard usage controlled and reduces repeated expensive report queries.

## Generic Module APIs

The server also exposes generic module endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/live-module/:moduleKey` | Live module records |
| `POST /api/live-module/:moduleKey` | Create live module record |
| `PUT /api/live-module/:moduleKey/:recordId` | Update live module record |
| `DELETE /api/live-module/:moduleKey/:recordId` | Delete live module record |
| `GET /api/module/:moduleKey` | Generic module records |
| `POST /api/module/:moduleKey` | Create generic module record |
| `POST /api/module/:moduleKey/bulk` | Bulk create generic module records |
| `PUT /api/module/:moduleKey/:recordId` | Update generic module record |
| `DELETE /api/module/:moduleKey/:recordId` | Delete generic module record |

These are useful for structured CRUD modules where a dedicated API is not yet necessary.

## Functional Test Checklist

Before release, test:

1. Login and logout.
2. App switcher permissions for each role.
3. Sales entry create/update/delete.
4. Customer payment create/update/delete.
5. Material purchase create/bulk/update/delete.
6. Vendor payment create/update/delete.
7. Production batch create/update/delete.
8. Material usage batch create/update/delete.
9. Admin user access update.
10. Leadership reports for all period filters, including All Time.
11. Report cache behavior after data changes.
12. Mobile viewport navigation.


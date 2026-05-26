# MCM EOS System Flow

## Overview

MCM EOS has three major runtime flows:

1. User authentication and permission loading
2. Operational data entry and CRUD
3. Leadership reporting and cached aggregation

The active runtime is `webapp-restart/server.js`, which serves the frontend and API from one Express app.

## Request Flow

```mermaid
flowchart TD
  Browser["User Browser"] --> Static["Express Static Files"]
  Browser --> Api["Express API Routes"]
  Static --> Html["index.html"]
  Static --> Js["ui/app.js"]
  Static --> Css["ui/app.css"]
  Api --> Auth["Session Middleware"]
  Auth --> Perms["Permission Checks"]
  Perms --> Pg["Supabase Postgres"]
  Pg --> Api
  Api --> Browser
```

## Login Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Browser UI
  participant API as Express API
  participant DB as Supabase Postgres

  U->>UI: Submit username/password
  UI->>API: POST /api/login
  API->>DB: Find app_users row
  API->>DB: Verify password_hash using crypt
  API->>DB: Load app_user_module_access
  API->>DB: Insert app_sessions row
  API->>DB: Insert app_login_audit row
  API-->>UI: Set signed mcm_session cookie + session JSON
  UI->>UI: Show app shell
  UI->>UI: Hide unavailable app switcher cards
```

## Authenticated API Flow

```mermaid
sequenceDiagram
  participant UI as Browser UI
  participant API as Express API
  participant DB as Supabase Postgres

  UI->>API: Request protected API with mcm_session cookie
  API->>DB: Load active app_sessions row
  API->>DB: Join app_users
  API->>DB: Load module permissions
  API->>API: Check can_view/can_create/can_update/can_delete
  alt allowed
    API->>DB: Query or mutate business table
    API-->>UI: JSON response
  else denied
    API-->>UI: 403 Forbidden
  end
```

## Frontend Navigation Flow

```mermaid
flowchart TD
  Boot["boot()"] --> AuthMe["GET /api/auth/me"]
  AuthMe -->|success| ShowApp["showApp()"]
  AuthMe -->|failure| Login["showLogin()"]
  ShowApp --> Home["showPage('home')"]
  Home --> Switcher["App Switcher"]
  Switcher --> DefaultPage["appDefaultPage(appKey)"]
  DefaultPage --> ShowPage["showPage(pageId)"]
  ShowPage --> Meta["PAGE_META title/badge/nav"]
  ShowPage --> Tabs["SUB_TABS render"]
  ShowPage --> Init["initPage(pageId)"]
  Init --> DomainLoad["Domain-specific data load"]
```

## Operational CRUD Flow

The operational modules follow a common pattern:

```mermaid
flowchart TD
  PageOpen["Open page"] --> Init["Page init function"]
  Init --> Load["Load initial data"]
  Load --> Render["Render list/form/dashboard"]
  Render --> UserAction["User creates/updates/deletes"]
  UserAction --> ValidateClient["Client-side required-field checks"]
  ValidateClient --> ApiCall["POST/PUT/DELETE API call"]
  ApiCall --> ValidateServer["Server permission + data validation"]
  ValidateServer --> DbWrite["Database write"]
  DbWrite --> Invalidate["Invalidate local cache/state"]
  Invalidate --> Reload["Reload affected data"]
  Reload --> Render
```

## Sales Entry Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Sales Form
  participant API as Express API
  participant DB as Postgres

  U->>UI: Open New Sale
  UI->>API: GET /api/lookups
  API->>DB: Load contacts/accounts/products/prices
  API-->>UI: Lookup data
  U->>UI: Add sale lines
  UI->>UI: Calculate preview totals
  U->>UI: Submit sale
  UI->>API: POST /api/sales/entries
  API->>API: Check sales create permission
  API->>DB: Insert sales_entries
  API->>DB: Insert sales_line_items
  API-->>UI: Success response
  UI->>UI: Clear form and reload sales data
```

## Material Purchase Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as MPM App
  participant API as Express API
  participant DB as Postgres

  U->>UI: Open MPM Dashboard or Purchase tab
  UI->>API: GET /api/mm/initial
  API->>DB: Load purchases/payments/vendors/materials/subtypes
  API-->>UI: MPM initial data
  U->>UI: Create purchase or batch
  UI->>API: POST /api/mm/purchases or /api/mm/purchases/bulk
  API->>API: Check purchases create permission
  API->>DB: Insert material_purchases
  API-->>UI: Success
  UI->>UI: Invalidate MPM state
  UI->>API: GET /api/mm/initial
```

## Vendor Payment Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as MPM App
  participant API as Express API
  participant DB as Postgres

  U->>UI: Open Vendor Payment form
  UI->>API: GET /api/mm/initial
  API-->>UI: Vendor list and payments
  U->>UI: Submit payment
  UI->>API: POST /api/mm/vendor-payments
  API->>API: Check vendor_payments create permission
  API->>DB: Insert vendor_payments
  API-->>UI: Success
  UI->>UI: Reload MPM state
```

## Production Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as PM App
  participant API as Express API
  participant DB as Postgres

  U->>UI: Open Production app
  UI->>API: GET /api/pm/initial
  API->>DB: Load productions/material usage/products/machines/operators/materials
  API-->>UI: Initial production data
  U->>UI: Submit production run or batch
  UI->>API: POST /api/pm/productions or /bulk
  API->>API: Check production create permission
  API->>DB: Insert productions
  API-->>UI: Success
```

## Leadership Report Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Leadership UI
  participant API as Express API
  participant DB as Postgres

  U->>UI: Select report tab and period
  UI->>UI: Build period params
  UI->>API: GET /api/leadership/:section
  API->>API: Normalize section and date range
  API->>DB: Check leadership_report_snapshots
  alt fresh snapshot exists
    DB-->>API: Cached payload
    API-->>UI: Cached report JSON
  else no usable cache
    API->>DB: Check monthly quota
    API->>DB: Run aggregate report SQL
    API->>DB: Record usage
    API->>DB: Save leadership snapshot
    API-->>UI: Fresh report JSON
  end
  UI->>UI: Render KPI cards/table/report cards
```

## Leadership Material Purchased Flow

```mermaid
flowchart TD
  Range["Period range"] --> Summary["Summary SQL: total spend, total paid, purchase count"]
  Range --> RecentPurchases["Recent purchases query limited for display"]
  Range --> RecentPayments["Recent payments query limited for display"]
  Range --> SpendByVendor["Grouped spend SQL: sum material_purchases.total_amount by vendor"]
  Range --> PaidByVendor["Grouped paid SQL: sum vendor_payments.amount by vendor"]
  SpendByVendor --> Balance["Vendor balances"]
  PaidByVendor --> Balance
  Summary --> Response["Report JSON"]
  RecentPurchases --> Response
  RecentPayments --> Response
  Balance --> Response
```

Important distinction: recent purchases are display rows only. Spend by vendor must come from the grouped SQL aggregate over all matching purchases.

## Deployment Flow

```mermaid
flowchart TD
  Dev["Developer edits code"] --> Local["Run local server"]
  Local --> Checks["Syntax/smoke checks"]
  Checks --> Git["Commit to Git"]
  Git --> DevBranch["Development branch/repo"]
  DevBranch --> Preview["Vercel preview/dev deployment"]
  Preview --> QA["Manual QA with dev database"]
  QA --> Promote["Promote approved changes"]
  Promote --> ProdBranch["Production branch/repo"]
  ProdBranch --> VercelProd["Vercel production deployment"]
  VercelProd --> Smoke["Production smoke test"]
```

## Error Flow

Common errors:

- `401` when no valid session exists
- `403` when permission is missing
- `400` when required form data is invalid
- `429` when Leadership quota is exhausted
- `500` for unhandled server/database errors

The frontend generally shows errors through toast messages or inline empty-state cards.

## Cache Flow

Frontend caches:

- page loaded-state set
- domain arrays such as `MM`, `MDM`, admin product/pricing data
- Leadership in-memory cache by section and period

Server caches:

- Leadership report snapshots in Postgres

Cache invalidation examples:

- Material purchase write calls `invalidateMM()`
- Material master write calls `invalidateMDM()`
- Product/pricing changes clear lookup cache
- Leadership period changes clear frontend Leadership cache
- Leadership cache version changes invalidate old server snapshots


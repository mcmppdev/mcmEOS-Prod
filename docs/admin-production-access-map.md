# Admin, Production, Materials, and User Access Migration Map

This file maps the second legacy Apps Script bundle into the Supabase/Vercel app. It covers production, resources, products/pricing, materials management, and custom app users.

## Custom User Module

The app will use its own login screen backed by Supabase tables, not Supabase Auth.

| Legacy need | New route | Supabase objects |
| --- | --- | --- |
| Login screen | `/login` | `app_users` |
| Module access after login | App shell/navigation | `app_modules`, `app_user_module_access` |
| User/access admin | `/admin/users` | `app_users`, `app_modules`, `app_user_module_access` |
| Login history | `/admin/login-audit` later | `app_login_audit` |

Important implementation rule: store only `password_hash`, never plain passwords. The Vercel server route should verify credentials server-side, create a signed HTTP-only session cookie, then load allowed modules from `app_user_module_access`.

Recommended permission behavior:

- `can_view`: show module and allow list/detail pages.
- `can_create`: allow new forms and inserts.
- `can_update`: allow edit forms and updates.
- `can_delete`: allow delete actions.
- `can_edit_own`: allow users to edit records where they are the original creator.
- `role = 'admin'`: can manage users and access.

Default access rule:

```text
User can view module:
  app_modules.is_active = true
  and app_user_module_access.can_view = true

User can create:
  can_create = true

User can update:
  can_update = true
  or (can_edit_own = true and record.entered_by_user_id = current_user.user_id)

User can delete:
  can_delete = true
```

Delete is never granted by ownership alone. A user can edit what they entered, but cannot delete it unless an admin explicitly grants delete permission for that module.

Migration `004_ownership_permissions.sql` adds ownership columns to app-managed tables:

- `entered_by_user_id`
- `last_edited_by_user_id`

New inserts should set both fields to the current app user. Updates should keep `entered_by_user_id` unchanged and set `last_edited_by_user_id` to the current app user.

## Production Management

| Legacy screen/function | New route | Supabase objects | Notes |
| --- | --- | --- | --- |
| Production runs list | `/production/runs` | `productions`, `production_daily_summary` | Preserve week/month/custom filters. |
| New production batch | `/production/runs/new` | `productions`, `products`, `machines`, `operators` | Keep multi-line batch entry. |
| Edit production run | `/production/runs/[prod_id]` | `productions` | Single-row edit mode. |
| Material usage list | `/production/material-usage` | `material_usage`, `material_usage_summary` | Preserve material/operator filters. |
| Log material usage batch | `/production/material-usage/new` | `material_usage`, `materials`, `machines`, `operators`, `productions` | Keep optional production ID. |
| Material stock | `/materials/stock` | `material_stock`, `materials` | Added because the legacy code has CRUD but no imported stock file yet. |

Production total-cup rule:

```text
total_cups = cups_per_packet * packets_qty * (box_qty > 0 ? box_qty : 1)
```

Legacy exception kept from import: `material_usage.prod_id = 'LEGACY'` can have `production_id = null`.

## Resource Management

| Legacy screen/function | New route | Supabase objects |
| --- | --- | --- |
| Machines dashboard/list | `/resources/machines` | `machines` |
| Add/edit machine | `/resources/machines/new`, `/resources/machines/[machine_id]` | `machines` |
| Operators list | `/resources/operators` | `operators` |
| Add/edit operator | `/resources/operators/new`, `/resources/operators/[operator_id]` | `operators` |

Migration `003_admin_access_enhancements.sql` adds resource fields used by the legacy app:

- Machines: `machine_type`, `capacity_per_shift`, `location`, `last_maintenance`, `notes`
- Operators: `role`, `shift`, `contact`, `join_date`, `notes`

## Products and Pricing Admin

| Legacy screen/function | New route | Supabase objects |
| --- | --- | --- |
| Products dashboard/list | `/admin/products` | `products`, `product_prices` |
| Add/edit product | `/admin/products/new`, `/admin/products/[product_id]` | `products` |
| Pricing list | `/admin/pricing` | `product_prices`, `products` |
| Add/edit pricing | `/admin/pricing/new`, `/admin/pricing/[price_id]` | `product_prices` |

The legacy duplicate rule is preserved with a partial unique index:

```text
one active price per product + packaging_type
```

## Material Master Data

| Legacy screen/function | New route | Supabase objects |
| --- | --- | --- |
| Vendors | `/admin/vendors` | `vendors` |
| Material types | `/admin/material-types` | `material_types` |
| Material subtypes | `/admin/material-subtypes` | `material_subtypes` |
| Materials | `/admin/materials` | `materials`, `material_types` |

## Material Purchases and Vendor Payments

| Legacy screen/function | New route | Supabase objects |
| --- | --- | --- |
| Materials dashboard | `/materials/dashboard` | `material_purchases`, `vendor_payments`, `vendor_balances` |
| Purchases list | `/purchases` | `material_purchases` |
| New purchase batch | `/purchases/new` | `material_purchases`, `vendors`, `materials`, `material_subtypes` |
| Vendor payments | `/vendor-payments` | `vendor_payments`, `vendors` |

Vendor balance rule:

```text
balance = total_material_purchases - total_vendor_payments
```

## Build Order

1. App shell, custom login, session cookie, and module-gated navigation.
2. CRM/Sales MVP from the first migration map.
3. Products/pricing admin, because sales entry depends on active prices.
4. Materials master and purchases/payments.
5. Production runs, material usage, material stock, and resources.

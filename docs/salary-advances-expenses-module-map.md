# Salary, Advances, and Expenses Module Map

This module migrates the three new CSV exports into dedicated tables and app modules.

## Source Files

| Source CSV | Rows | Target table |
| --- | ---: | --- |
| `MCM Salary _ Advances _ Expenses - Salary Payments (1).csv` | 60 | `salary_payments` |
| `MCM Salary _ Advances _ Expenses - Expenses (1).csv` | 854 | `operational_expenses` |
| `MCM Salary _ Advances _ Expenses - Expenses Advance (1).csv` | 41 | `expense_advances` |

## New Supabase Objects

Migration: `supabase/migrations/005_salary_advances_expenses.sql`

- `salary_payments`
- `operational_expenses`
- `expense_advances`
- App modules seeded in `app_modules`:
  - `salary_payments`
  - `operational_expenses`
  - `expense_advances`

## Ownership and Permissions

These tables include:

- `entered_by_user_id`
- `last_edited_by_user_id`

Permission handling follows the same rules already defined:

- module visibility from `app_user_module_access.can_view`
- CRUD from `can_create`, `can_update`, `can_delete`
- own-record edit fallback from `can_edit_own`

## Seed Generation

Script:

- `scripts/generate-salary-expense-seeds.ps1`

Generated SQL files:

- `supabase/seeds/009_salary_payments.sql`
- `supabase/seeds/010_operational_expenses.sql`
- `supabase/seeds/011_expense_advances.sql`

Validation:

- `supabase/seeds/012_verify_salary_adv_expenses.sql`

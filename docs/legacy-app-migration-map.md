# Legacy Apps Script to Supabase/Vercel Migration Map

This maps the current Google Apps Script + Google Sites CRM/Sales app to the new Supabase-backed web app.

## Legacy Modules

| Legacy page/module | Apps Script functions | Supabase tables | New app route suggestion |
| --- | --- | --- | --- |
| Sale Entry | `getInitialData`, `submitSale`, `handleCustomerAutomation_` | `products`, `product_prices`, `contacts`, `accounts`, `sales` | `/sales/new` |
| New Customer Bot | `checkExistingMobile`, `saveToSheet` | `contacts`, `accounts` | `/customers/new` |
| All Customers | `getAllContacts` | `contacts`, `accounts` | `/customers` |
| Payment Entry | `getCustomerList`, `processPayment` | `contacts`, `accounts`, `customer_payments` | `/payments/new` |
| Payments Dashboard | `getPaymentHistory` | `customer_payments` | `/payments` |
| Customer Dues | `getAllCustomerDues` | `sales`, `customer_payments`, `contacts` | `/dues` |
| Customer Ledger | `getLedgerData`, `getCustomerSuggestions`, `consolidateByCompany_` | `sales`, `customer_payments`, `contacts` | `/customers/[cid]/ledger` |
| Sales Dashboard | `getDashboardData` | `sales`, `contacts`, `products` | `/reports/sales` |
| Sales MoM | `getFilterOptions`, `getProcessedSalesData` | `sales` | `/reports/mom` |
| Monthly Sales Matrix | `getMonthlyMatrixData` | `sales` | `/reports/matrix` |
| Product Insights | `getProductInsightOptions`, `getProductInsightData` | `sales`, `products` | `/reports/products` |
| Leads List | `getAllLeads`, `getLeadsFilterOptions`, `getFilteredLeads` | `leads` | `/leads` |
| Add Lead | `saveLead` | `leads`, `contacts` | `/leads/new` |
| Lead Edit/Status | `updateLead`, `convertLead` | `leads`, `contacts`, `accounts` | `/leads/[lid]` |
| Leads Dashboard | `getLeadsDashboardData` | `leads` | `/leads/dashboard` |

## Core Business Rules to Preserve

### Sales Line Calculation

The legacy formula is:

```text
Box     = cups_or_lids * packets_quantity * box_quantity * sale_price_per_cup
Packets = cups_or_lids * packets_quantity * sale_price_per_cup
Lids    = packets_quantity * sale_price_per_cup
```

In the Supabase app this should live in a shared utility, not be duplicated independently between client and server.

Suggested function:

```ts
export function calculateLineTotal(input: {
  packagingType: string;
  cupsOrLids?: number;
  packetsQuantity?: number;
  boxQuantity?: number;
  salePricePerCup?: number;
}) {
  const packaging = input.packagingType.trim().toUpperCase();
  const cups = Number(input.cupsOrLids || 0);
  const packets = Number(input.packetsQuantity || 0);
  const boxes = Number(input.boxQuantity || 0);
  const price = Number(input.salePricePerCup || 0);

  if (packaging === "BOX") return cups * packets * boxes * price;
  if (packaging === "PACKETS") return cups * packets * price;
  if (packaging === "LIDS") return packets * price;
  return 0;
}
```

### Customer Automation

Legacy behavior:

1. Sale entry searches contacts by exact mobile.
2. If found, sale uses existing `cid` and `aid`.
3. If not found, it creates a new contact and account.
4. The new contact receives the new account ID.

New implementation:

- Use a server action/API route with a transaction.
- Look up `contacts.mobile`.
- If missing, create `contacts` and `accounts`.
- Use generated IDs or a database helper for `C###` and `A###`.
- Insert sale rows after customer/account resolution.

### Lead Conversion

Legacy behavior:

1. Lost leads cannot be converted.
2. Already converted leads return the existing converted CID.
3. Conversion creates or finds a customer using the same mobile automation.
4. Lead status becomes `Converted`.
5. `converted_cid` is set.

New implementation:

- Wrap conversion in a transaction.
- Reuse the same customer/account resolution function as sales.
- Update `leads.lead_status`, `leads.converted_cid`, and `updated_at`.

### Payment Entry

Legacy behavior:

- Payment is appended with customer/account snapshots and payment date.

New implementation:

- Insert into `customer_payments`.
- Keep snapshots from the selected customer at time of payment.
- Require `amount_paid > 0`.

## Reports to Rebuild First

1. Customer Dues
   - Most valuable operational report.
   - Query: aggregate `sales.total_amount` by `cid`/company, aggregate `customer_payments.amount_paid`, compute balance.

2. Customer Ledger
   - Merge sale and payment entries by date for one customer.
   - Running balance should be computed by SQL window function or app code.

3. Sales Dashboard
   - Date/product/city/packaging filters.
   - Uses `sales` joined to `contacts`.

4. Product Insights
   - Revenue, units, boxes by product.
   - Preserve packaging calculation rules.

5. Leads Dashboard
   - Status counts, conversion rate, overdue follow-ups.

## SQL Views Recommended

### Customer Balances

```sql
create or replace view public.customer_balances as
with sales_totals as (
  select
    cid,
    company_name_snapshot,
    sum(coalesce(total_amount, 0)) as total_sales
  from public.sales
  group by cid, company_name_snapshot
),
payment_totals as (
  select
    cid,
    company_name_snapshot,
    sum(coalesce(amount_paid, 0)) as total_paid
  from public.customer_payments
  group by cid, company_name_snapshot
)
select
  coalesce(s.cid, p.cid) as cid,
  coalesce(s.company_name_snapshot, p.company_name_snapshot) as company_name,
  coalesce(s.total_sales, 0) as total_sales,
  coalesce(p.total_paid, 0) as total_paid,
  coalesce(s.total_sales, 0) - coalesce(p.total_paid, 0) as balance
from sales_totals s
full outer join payment_totals p on p.cid = s.cid;
```

### Daily Customer Ledger

```sql
create or replace view public.customer_ledger_entries as
select
  sale_date as entry_date,
  cid,
  aid,
  company_name_snapshot,
  customer_name_snapshot,
  'sale' as entry_type,
  total_amount as debit,
  0::numeric as credit,
  sale_id as source_id
from public.sales
union all
select
  payment_date as entry_date,
  cid,
  aid,
  company_name_snapshot,
  customer_name_snapshot,
  'payment' as entry_type,
  0::numeric as debit,
  amount_paid as credit,
  payment_id::text as source_id
from public.customer_payments;
```

## Implementation Notes

- The old UI has many pages in one HTML file. The new app should split them into route-level pages and reusable components.
- Google Charts can be replaced with lightweight chart components later. First priority is correct data.
- The old mobile-first layout is worth preserving, but the Vercel app should use real navigation/routes instead of manually hiding/showing pages.
- Avoid duplicating calculations in multiple places. Shared TypeScript utilities should power both form previews and server validation.
- Keep snapshot fields on transactions, even when joined master data exists.

## Suggested First App Milestone

Build the CRM/Sales MVP:

1. Supabase client/server setup.
2. `/sales/new`
   - Customer search/create.
   - Product price selection.
   - Add multiple line items.
   - Submit rows into `sales`.
3. `/payments/new`
   - Customer search.
   - Payment insert.
4. `/dues`
   - Customer balances from `customer_balances`.
5. `/customers`
   - Searchable customer list.

Factory/production screens can follow after the sales/payment workflows are live.


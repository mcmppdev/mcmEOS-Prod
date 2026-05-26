# MCM Google Sheets to Supabase Database Map

## Source Files Reviewed

| Domain | CSV | Rows | Supabase target |
| --- | --- | ---: | --- |
| CRM | Copy of MCM LeadsDB - MCM_Leads (1).csv | 191 | `leads` |
| CRM | Copy of MCM Contacts DB - MCM_Contacts (1).csv | 68 | `contacts` |
| CRM | Copy of MCM Accounts DB - MCM_Accounts (1).csv | 70 | `accounts` |
| Sales | Sales DB_MCM - MCM_Sales (2).csv | 3058 | `sales` |
| Sales | Customer Payments_MCM - MCM_Payments (1).csv | 1026 | `customer_payments` |
| Sales | Customer Payments_MCM - MCM_Payments_Old.csv | 720 | historical duplicate/reference only |
| Products | Products DB_MCM - MCM_Products (1).csv | 20 | `products` |
| Products | Products DB_MCM - MCM_Pricing (1).csv | 38 | `product_prices` |
| Factory | MCM_Production_DB - MM_Productions (3).csv | 2391 | `productions` |
| Factory | MCM_Production_DB - MM_Material_Usage (1).csv | 797 | `material_usage` |
| Factory | MCM_Resource_DB - MM_Machines (1).csv | 9 | `machines` |
| Factory | MCM_Resource_DB - MM_Operators (1).csv | 13 | `operators` |
| Materials | MCM_Materials_DB - MM_MaterialTypes (1).csv | 6 | `material_types` |
| Materials | MCM_Materials_DB - MM_SubTypes (1).csv | 9 | `material_subtypes` |
| Materials | MCM_Materials_DB - MM_Materials (1).csv | 35 | `materials` |
| Materials | MCM_Materials_DB - MM_Vendors (1).csv | 14 | `vendors` |
| Materials | Material_Purchase_DB - MM_Purchases (2).csv | 375 | `material_purchases` |
| Materials | Material_Purchase_DB - MM_Payments (2).csv | 363 | `vendor_payments` |
| HR/Office | MCM Salary _ Advances _ Expenses - Salary Payments (1).csv | 60 | `salary_payments` |
| HR/Office | MCM Salary _ Advances _ Expenses - Expenses (1).csv | 854 | `operational_expenses` |
| HR/Office | MCM Salary _ Advances _ Expenses - Expenses Advance (1).csv | 41 | `expense_advances` |

## Important Data Notes

- `contacts`, `accounts`, and `sales` share clean `CID` and `AID` references.
- `products` use `P001` style IDs, while historical `sales.PRODUCT_ID` contains mixed legacy values like `PR14` and newer price IDs like `PX002`.
- Because of that, `sales` should keep a `source_product_id` text column and product snapshots. After import, rows can be mapped to `products` by `PRODUCT NAME` and packaging/price where possible.
- `product_prices` correctly references `products`.
- `productions` references machines/operators by name. Two legacy machine values are not in the machine master: `-`, `75ml Machine`.
- Two legacy operator names are not in the operator master: `Old`, `Sudheer`.
- `material_usage.PROD_ID` contains `LEGACY` rows that do not map to a production record.
- `material_usage.MATERIAL_NAME` has names that are not in the material master: `100ml`, `110ml`, `85ml`, `90ml Nescafe Print`.
- Use staging tables or nullable foreign keys for historical imports, then tighten constraints after cleanup.

## Recommended App Modules

1. CRM
   - Leads
   - Contacts
   - Accounts
   - Conversion from lead to contact/account

2. Sales
   - Sales entry
   - Customer ledger
   - Customer payments
   - Outstanding balance report

3. Products
   - Product master
   - Pricing by packaging type and effective date

4. Factory
   - Production entry
   - Material usage entry
   - Machine/operator masters
   - Daily production report

5. Materials
   - Material master
   - Vendors
   - Purchase entry
   - Vendor payments
   - Stock/consumption report

6. HR/Office
   - Salary payments
   - Operational expenses
   - Expense advances

## Migration Order

1. Import master tables:
   - products
   - product_prices
   - contacts
   - accounts
   - material_types
   - material_subtypes
   - materials
   - vendors
   - machines
   - operators

2. Import transactional tables:
   - leads
   - sales
   - customer_payments
   - productions
   - material_usage
   - material_purchases
   - vendor_payments
   - salary_payments
   - operational_expenses
   - expense_advances

3. Reconcile legacy references:
   - map sales source product IDs to product/pricing rows
   - create legacy machine/operator records or normalize old names
   - map material usage names to material IDs
   - decide whether `Customer Payments_Old` should be archived or merged

## Supabase Design Choices

- Keep original Google Sheet IDs as stable primary keys where they already exist.
- Keep `contacts.aid` as plain text during the first import because contacts and accounts reference each other; `accounts.cid` is the enforced relationship.
- Add `created_at` and `updated_at` timestamps for app operations.
- Keep snapshot fields on transactions, such as customer name and product name, because historical business records should remain readable even if masters change later.
- Use numeric columns for money and quantities.
- Use dates as `date`; use timestamp columns only where source data contains time.
- Add Row Level Security later after confirming user roles: admin, sales, factory, accounts, viewer.

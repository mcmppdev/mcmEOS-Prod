# MCM EOS Documentation Index

## Core Project Documents

| Document | Purpose |
| --- | --- |
| [Project Design](project-design.md) | Product design, app areas, UX principles, domain design |
| [Functional Specification](functional-specification.md) | Current user-facing functionality and API behavior |
| [System Flow](system-flow.md) | End-to-end flows for login, navigation, CRUD, reporting, deployment |
| [System Architecture](system-architecture.md) | Runtime architecture, database organization, API structure |
| [Dev and Production Repository Strategy](dev-prod-repository-strategy.md) | Recommended dev/prod branching or separate repo process |

## Existing Migration Documents

| Document | Purpose |
| --- | --- |
| [Database Map](database-map.md) | Google Sheets to Supabase table mapping |
| [Legacy App Migration Map](legacy-app-migration-map.md) | CRM/sales Apps Script migration mapping |
| [Admin, Production, Access Map](admin-production-access-map.md) | Production/resources/materials/access migration mapping |
| [Salary, Advances, Expenses Map](salary-advances-expenses-module-map.md) | Finance module import and mapping |

## Active Code Locations

| Path | Purpose |
| --- | --- |
| `../server.js` | Active Express API/server |
| `../index.html` | Active app shell |
| `../ui/app.js` | Active frontend logic |
| `../ui/app.css` | Active frontend styles |
| `../supabase/migrations/` | Database schema migrations |

## Recommended Reading Order

1. Project Design
2. Functional Specification
3. System Architecture
4. System Flow
5. Dev and Production Repository Strategy
6. Existing migration maps

# mcmEOS Production Web App

Clean production deployment repository for the MCM EOS web app.

This repository promotes the `webapp-restart` application to the repository root so Vercel can deploy from the root directory.

## Contents

- `server.js`, `api/`, `index.html`, `ui/`, and `assets/`: production web app runtime
- `db.js`: shared database pool helper and environment tagging utilities
- `supabase/migrations/`: production database migrations
- `docs/`: operational and architecture documentation
- `server_migration_guide.md`: source environment migration notes

## Vercel Production Deployment

Configure Vercel with:

```text
Git repo: mcmppdev/mcmEOS-Prod
Branch: main
Root Directory: <empty / repository root>
Build Command: <empty>
Install Command: npm install
Output Directory: <empty>
```

Required environment variables:

```text
DATABASE_URL=<Supabase pooler URL>
SESSION_SECRET=<strong production secret>
NODE_ENV=production
APP_ENV=prod
```

Use the Supabase pooler connection string for `DATABASE_URL`. Do not commit `.env` files or secrets.

## Local Smoke Test

```powershell
npm install
node --check server.js
node --check ui/app.js
$env:DATABASE_URL="postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=no-verify"
$env:SESSION_SECRET="local-test-secret"
$env:NODE_ENV="production"
$env:APP_ENV="prod"
npm start
```

Open `http://localhost:4173` and verify:

```text
/
/api/deploy-info
/ui/app.js
/ui/app.css
```

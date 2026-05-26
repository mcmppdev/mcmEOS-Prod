# mcmEOS Production Web App

Clean production deployment repository for the MCM EOS web app.

This repository mirrors the development repository shape: the deployable web app lives in `webapp-restart/`.

## Contents

- `webapp-restart/server.js`, `webapp-restart/api/`, `webapp-restart/index.html`, `webapp-restart/ui/`, and `webapp-restart/assets/`: production web app runtime
- `webapp-restart/db.js`: shared database pool helper and environment tagging utilities
- `supabase/migrations/`: production database migrations
- `docs/`: operational and architecture documentation
- `server_migration_guide.md`: source environment migration notes

## Vercel Production Deployment

Configure Vercel with:

```text
Git repo: mcmppdev/mcmEOS-Prod
Branch: main
Root Directory: webapp-restart
Build Command: <empty>
Install Command: npm install
Output Directory: <empty>
```

Required environment variables:

```text
DATABASE_URL=<production Supabase shared pooler URL>
SESSION_SECRET=<strong production secret>
NODE_ENV=production
APP_ENV=prod
```

Use the Supabase shared transaction pooler connection string for `DATABASE_URL`, not the IPv6-only direct database endpoint. A production URL should look like:

```text
postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres?sslmode=require
```

Do not commit `.env` files or secrets.

## Local Smoke Test

```powershell
cd webapp-restart
npm install
node --check server.js
node --check ui/app.js
$env:DATABASE_URL="postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres?sslmode=require"
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

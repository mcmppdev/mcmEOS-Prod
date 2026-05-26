# Dev and Production Repository Strategy

## Goal

The goal is to separate day-to-day development and testing from production operations so new changes can be built, reviewed, tested, and then promoted safely.

The current repository contains active code, legacy/reference code, migrations, seed data, and documentation together. That is workable during migration, but production needs a cleaner promotion process.

## Current State

Current repository:

```text
mcmEOS
```

Important folders:

```text
webapp-restart/   active app
webapp/           earlier/legacy app
supabase/         migrations and seeds
docs/             documentation
scripts/          migration utilities
```

Active deployable app root:

```text
webapp-restart
```

## Recommendation

Use one of these two models.

## Option A: One GitHub Repository, Dev and Prod Branches

This is the recommended approach unless there is a strong business reason to use separate repositories.

### Branches

| Branch | Purpose |
| --- | --- |
| `dev` | Active development and testing |
| `main` | Production-ready code only |

### Vercel Projects

| Vercel project | Git source | Database |
| --- | --- | --- |
| MCM EOS Dev | `dev` branch | Dev Supabase project |
| MCM EOS Prod | `main` branch | Prod Supabase project |

### Benefits

- Keeps full history in one place.
- Pull requests show exact changes from dev to production.
- Easier to compare, review, and revert.
- Less risk of copying the wrong files between repositories.
- GitHub branch protection can prevent accidental production pushes.

### Promotion Flow

```text
feature branch -> dev -> test on dev Vercel + dev Supabase -> pull request -> main -> production deploy
```

### Recommended Branch Rules

For `main`:

- Require pull request before merge.
- Require at least one approval.
- Require status checks.
- Block force pushes.
- Require branch to be up to date before merge.

For `dev`:

- Allow faster merges.
- Still require syntax/smoke checks.
- Use dev database only.

## Option B: Separate Dev and Prod Repositories

Use this only if the team explicitly wants physical repository separation.

### Repositories

| Repository | Purpose |
| --- | --- |
| `mcmEOS-dev` | All development work |
| `mcmEOS-prod` | Production deployable code only |

### Benefits

- Strong separation between development and production.
- Production repo can be locked down to fewer people.
- Easy for non-technical stakeholders to identify production code.

### Risks

- Code drift between repos.
- Manual copying mistakes.
- Harder history comparison.
- More maintenance work.
- Migrations can be applied from the wrong repo if process is not strict.

### Safe Promotion Method

Do not manually drag/drop files. Use Git:

```powershell
git remote add prod <production-repo-url>
git push prod main
```

Or use a pull-based promotion:

```powershell
git clone <production-repo-url> mcmEOS-prod
cd mcmEOS-prod
git remote add dev <development-repo-url>
git fetch dev
git merge dev/main
```

## Recommended Folder Cleanup Before Production

Before creating a production repository or production branch, decide what belongs in production.

### Keep in Production

```text
webapp-restart/
supabase/migrations/
docs/
README.md
```

### Usually Keep, But Review

```text
scripts/
supabase/seeds/verify_*.sql
```

These are useful for operations and verification.

### Keep Out of Production or Archive Separately

```text
webapp/
supabase/seeds/chunks*/
large historical seed chunks not needed by runtime
temporary logs
```

The `webapp/` folder appears to be an older implementation. It should not be deployed as the production app if `webapp-restart/` is the accepted active app.

## Proposed Repository Layout Going Forward

If using one repo:

```text
mcmEOS/
  README.md
  docs/
  scripts/
  supabase/
    migrations/
    seeds/
  webapp-restart/
    index.html
    server.js
    package.json
    vercel.json
    ui/
    assets/
```

If using separate repos:

```text
mcmEOS-dev/
  full working tree, including experiments and migration helpers

mcmEOS-prod/
  production-ready subset only
```

## Environment Separation

Code separation is not enough. The databases must also be separated.

### Dev Environment

| Item | Recommendation |
| --- | --- |
| Database | Separate Supabase dev project |
| Data | Sanitized or copied test data |
| Vercel | Dev/preview project |
| Secrets | Dev `DATABASE_URL`, dev `SESSION_SECRET` |
| Users | Test users and limited sample admins |

### Production Environment

| Item | Recommendation |
| --- | --- |
| Database | Production Supabase project |
| Data | Live operational data |
| Vercel | Production project |
| Secrets | Production `DATABASE_URL`, strong `SESSION_SECRET` |
| Users | Real users only |

## Migration Policy

### Development

1. Create migration in `supabase/migrations/`.
2. Apply to dev database.
3. Test the affected app pages.
4. Add or update seed/verification SQL if needed.
5. Document any manual data changes.

### Production

1. Back up production database.
2. Review migration SQL.
3. Confirm rollback path or mitigation.
4. Apply migration during a low-risk window.
5. Deploy production code.
6. Run smoke tests.
7. Monitor logs and user reports.

## Deployment Checklist

Before promoting to production:

- `node --check webapp-restart/server.js`
- `node --check webapp-restart/ui/app.js`
- Start local app and verify `/`, `/ui/app.js`, `/ui/app.css`.
- Test login with a non-admin user.
- Test login with an admin user.
- Verify app switcher permissions.
- Test one create/edit workflow in changed domains.
- Test affected Leadership reports.
- Confirm Supabase migrations are applied to target environment.
- Confirm Vercel environment variables are correct.
- Confirm no `.env`, logs, or local-only files are included.

## Suggested Immediate Plan

1. Keep current repository as the development repository for now.
2. Create a `dev` branch from current working code.
3. Create a clean `main` branch once current app behavior is accepted.
4. Point Vercel dev project to `dev`.
5. Point Vercel production project to `main`.
6. Create a separate Supabase dev project before testing risky changes.
7. Archive or remove `webapp/` from production deployment scope.

## If You Still Want Two Repositories

The safest sequence is:

1. Create `mcmEOS-dev` and push the full current repository.
2. Create `mcmEOS-prod`.
3. Copy only approved production files using Git history, not manual file copy.
4. Configure Vercel production to use `mcmEOS-prod/webapp-restart`.
5. Lock production repository write access.
6. Promote from dev to prod through reviewed pull requests or controlled Git merges.

## What Not To Do

Do not:

- Manually copy random changed files into production.
- Test new migrations directly on production first.
- Use the same `DATABASE_URL` for dev and production.
- Keep production secrets in `.env` files.
- Deploy both `webapp/` and `webapp-restart/` as active apps.
- Let Leadership report cache hide calculation fixes during testing.


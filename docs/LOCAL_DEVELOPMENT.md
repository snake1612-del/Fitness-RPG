# Local development

LOCAL: Docker Desktop + plain PostgreSQL 17 + self-hosted Better Auth + Next.js.
Auth persistence is `better_auth.*`; Training is `public.*`. There is no Auth FK,
identity mapping or Supabase runtime dependency. HOSTED uses Neon PostgreSQL 17 +
Better Auth + Vercel and has passed live Pilot acceptance. LOCAL data, credentials
and tooling remain separate from HOSTED; local wrappers never target Neon.

## First machine setup

1. Install/start Docker Desktop with Linux containers (WSL2 on Windows).
2. Install Node.js 22.13+ (22.x), 24.x or 26+ and pnpm 11.25.0.
3. Run `pnpm install --frozen-lockfile`. Docker Compose v2+ is required.
4. Run `pnpm local:start`. The first run pulls the official PostgreSQL image,
   starts this project's single service, waits for health, generates local config
   and applies/verifies canonical Drizzle migrations 0000–0008.
5. Run `pnpm dev:local`; open the printed localhost origin (default port 3000).
6. Bootstrap a fresh LOCAL-only Better Auth account with the supported endpoint
   `POST /api/auth/sign-up/email`, JSON `name`, `email`, `password`, and exact
   application `Origin` header. Use a private local client/tool; credentials must
   stay out of command history, source, URLs and logs. No product signup screen
   is added. HTTP signup is disabled outside explicit LOCAL_DEV.
7. Sign in through the existing UI and create Training data.

## Topology and persistence

`compose.local.yaml` declares exactly one `postgres` service:

- Official `postgres:17.11-trixie`, pinned to a manifest SHA-256 digest.
- Project `fitness-rpg-postgres-local`; container `fitness-rpg-postgres-local-db`.
- Database/user `fitness_rpg`; host binding **127.0.0.1:55432**, container port 5432.
- Named volume `fitness-rpg-postgres-local-data` at `/var/lib/postgresql/data`.
- `pg_isready` healthcheck; `restart: unless-stopped`.

No admin UI, API gateway, pooler or other service is required. Next.js runs on the
host and sees an ordinary PostgreSQL URL. Normal stop retains the named volume;
start reuses it. No reset or `down -v` workflow is provided.

The securely generated DB password lives in gitignored `.local/postgres.env`.
The M1 managed `.env.local` marker is retained. Its existing Better Auth secret is
reused when switching the database substrate and on every start/dev/restart.
Missing/invalid saved secrets are rejected rather than silently rotated. Both
files are LOCAL-only and never printed; keep them during normal restart.
Unmanaged `.env.local` is never overwritten. It contains only DATABASE_URL,
MIGRATION_DATABASE_URL, LOCAL_DEV, BETTER_AUTH_URL and BETTER_AUTH_SECRET.

The fresh plain database has no old Supabase/Better Auth user or session rows.
An old browser cookie may therefore stop validating despite the unchanged secret.
Bootstrap a new local account. This is expected; existing Training ownership is
not translated or reassigned.

Old Supabase Local volumes/data are retained as historical rollback/debug residue.
The M2 transition did not export/import, reset or delete them. Their old ports
differ from 55432, so the current workflow does not need to stop them. Supabase
CLI/config/packages were removed; untracked old CLI cache is ignored. The old
hosted Supabase Pilot is separately paused and retained as rollback/archive data.
No local command operates on that hosted resource.

## Daily commands

```sh
pnpm local:start   # Start PG17; preserve env/secret; apply and verify migrations
pnpm local:status  # Validate service, actual loopback binding and live DB identity
pnpm local:migrate # Only this exact LOCAL target; canonical Drizzle history
pnpm dev:local     # Require healthy DB; Next bound to 127.0.0.1
pnpm local:stop    # Stop only this project's PostgreSQL; volume/data retained
```

Use the printed **localhost** browser origin for Auth. Select an alternate Next
port in PowerShell when needed:

```powershell
$env:LOCAL_DEV_PORT = "3001"
pnpm dev:local
```

BETTER_AUTH_URL follows the selected port; PostgreSQL stays on 55432. Stop Next.js
with Ctrl+C before stopping the database. `pnpm dev` can read generated config,
but `dev:local` additionally validates targets and sanitizes inherited env.

## Safety and migration ownership

Local wrappers reject production NODE_ENV, hosted/LAN database URLs, wrong
database/user/port, query/TLS overrides and non-local Docker transports. Windows
local named pipes and Unix local sockets are accepted; TCP/SSH/remote pipes are
rejected. Inherited Docker context/host, Compose, PostgreSQL and hosted
Auth/database/Pilot/Vercel env overrides are stripped. The selected Docker
context's endpoint is still checked before any daemon operation.

Before connecting, tooling validates the exact Compose service and inspected
container identity, health, named volume, configured and actual loopback bind.
PostgreSQL identity/version is checked over a real connection. The generated URL
always uses 127.0.0.1:55432/fitness_rpg with the project user.

`drizzle/` is the sole DDL history. Runtime never auto-migrates. Local tooling
verifies hashes/order before and after migration, and refuses mismatches. M2 adds
no migration and does not edit 0000–0008. Clean PostgreSQL has no Supabase roles;
existing conditional revokes skip absent roles without creating substitutes.

Better Auth, adapter and generation CLI remain pinned to 1.7.7. Official schema
generation owns Auth columns; canonical 0008 owns tables/indexes/FKs and browser
privilege revocations. Regeneration is a separate reviewed schema change:

```sh
pnpm exec auth generate --config scripts/auth-schema.ts --output src/server/auth/schema.ts --yes
```

Keep privilege revocations and never regenerate applied migrations.

HOSTED uses Neon pooled DATABASE_URL; trusted migrations use its direct endpoint
through MIGRATION_DATABASE_URL outside Vercel. Production credentials must not
be copied into LOCAL, Preview or Development.

Production configuration remains provider-neutral: exact HTTPS BETTER_AUTH_URL,
server-only BETTER_AUTH_SECRET, DATABASE_URL and optional DATABASE_SSL_CA.
pg retains verified TLS and a small pool. LOCAL_DEV is development-only and
permits loopback plaintext; it is rejected in production. Safe sslmode intent is
normalized before pg; other driver URL overrides are rejected.

## Verification

```sh
pnpm test
pnpm test:e2e
pnpm format:check
pnpm lint
pnpm typecheck
pnpm db:check
pnpm build
git diff --check
```

Browser fixtures use PGlite and fixture identity; they do not replace real LOCAL
acceptance. Install Chromium with `pnpm exec playwright install chromium`, or use
an installed Edge through PLAYWRIGHT_CHANNEL=msedge.

Fresh real PG17/Auth/compatibility tests require running `local:start`:

```powershell
$env:REAL_LOCAL_AUTH = "true"
pnpm exec vitest run src/server/auth/integration.test.ts src/test/plain-postgres.test.ts
Remove-Item Env:REAL_LOCAL_AUTH
```

These create random disposable databases inside the validated plain LOCAL
cluster, apply canonical 0000–0008 with hashes/order, check Auth bootstrap and
UUID ownership, correction/Previous Performance, and real independent-connection
advisory/row locks. They drop only their disposable databases; normal data is
never reset. Ordinary unit tests retain role fixtures to test legacy privilege
revocation, while real PG17 tests prove absent-role compatibility.

Check Docker Desktop's Linux engine and port 55432 if startup fails. Wrapper logs
hide CLI/driver errors that might contain credentials. Investigate a migration
history mismatch; do not edit frozen migrations or reset normal data to bypass it.

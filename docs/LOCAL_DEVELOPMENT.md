# Local development

M1 LOCAL uses Docker Desktop + Supabase Local PostgreSQL + Next.js on Windows.
Application authentication is self-hosted Better Auth, in `better_auth.*`.
Supabase `auth.*` remains untouched infrastructure and is not application authority.
M2 later replaces the substrate with Docker PostgreSQL 17; the namespace stays unchanged.
Hosted Neon/Vercel setup is a separate step; M1 does not deploy or modify the Pilot.
Never use hosted `DATABASE_URL` or `MIGRATION_DATABASE_URL` in local commands.

## First machine setup

1. Install Docker Desktop with its WSL2 Linux-container backend; finish any required
   Windows restart and start Docker Desktop.
2. Clone the repository. Install Node.js 22.13+ (22.x), 24.x or 26+ and pnpm 11.25.0.
3. Run `pnpm install --frozen-lockfile`. Supabase CLI **2.78.1** is a pinned dev
   dependency; its official binary install is allowed in `pnpm-workspace.yaml`.
4. Run `pnpm local:start`. The first run downloads Docker images. This creates only
   the `fitness-rpg-local` stack and dedicated Docker network, generates the
   gitignored `.env.local`, then applies and verifies canonical Drizzle migrations.
   An existing unmanaged `.env.local` is never overwritten: move it aside first.
5. Run `pnpm dev:local`; open the printed localhost origin (default port 3000).
6. Provision a fresh LOCAL-only account using the supported Better Auth endpoint
   `POST /api/auth/sign-up/email`, with JSON `name`, `email`, `password` and
   the exact application `Origin` header. Use a private local client/tool; never
   place credentials in command history, URLs, source files or logs. There is no
   product signup screen. The signup endpoint is disabled outside LOCAL_DEV.
7. Sign in through the existing application login UI, then create Training data.
   Supabase Studio users are not Better Auth users; old Supabase sessions do not carry over.
   Existing Training data remains stored under its original UUID; no identity translation occurs.

The gitignored generated `.env.local` contains loopback `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, `LOCAL_DEV=true`, `BETTER_AUTH_URL` and
`BETTER_AUTH_SECRET`. The secret is securely generated once and reused across
start/dev/stop/start, including alternate ports. Do not delete this file during
normal restart; losing the secret invalidates existing cookies. Commands discard
inherited hosted Better Auth/Supabase/DB credentials and never print secret values.

## Daily commands

```sh
pnpm local:start   # Start local services; env + reviewed Drizzle migrations
pnpm dev:local     # Next.js hot reload on the Windows host, bound to 127.0.0.1
pnpm local:status  # Safe local status, credentials hidden
pnpm local:migrate # Apply pending canonical drizzle/ migrations locally
pnpm local:stop    # Stop only Fitness RPG Local; data retained
```

Use `localhost` for the app browser origin: Next.js dev constructs Auth request
URLs with this host, and the app keeps its same-origin credential protection.
Next.js listens on `127.0.0.1`. If port 3000 is occupied, select another port
explicitly in PowerShell, then open the localhost URL printed by the wrapper:

```powershell
$env:LOCAL_DEV_PORT = "3001"
pnpm dev:local
```

Stop Next.js with Ctrl+C before stopping Supabase. `pnpm dev` also works after
`local:start`, but `dev:local` validates targets and replaces inherited hosted env
values before launching. No reset command is provided.

Endpoints: API/Auth `127.0.0.1:55321`, PostgreSQL `127.0.0.1:55322`,
Studio `127.0.0.1:55323`, mail viewer `127.0.0.1:55324`.
Next.js is not containerized. Local PostgreSQL connects directly; the local pooler
is disabled. Optional Realtime/Storage/Edge/Analytics services are disabled.
The network requests Docker's `host_binding_ipv4=127.0.0.1` default, but Docker
Desktop on Windows can still publish Supabase ports on all host interfaces.
Check Docker's published ports; use the stack on a trusted development machine
with inbound access restricted by the host firewall. Next.js binds to loopback.

## Schema and isolation

`drizzle/` is the sole migration history. Supabase SQL migrations and seeds are
disabled; no SQL is copied into `supabase/migrations`. Local migration tooling uses
the existing Drizzle migrator/history table, verifies hashes + order before and
after migration, and refuses a mismatched history. Do not edit applied migrations.

Local wrappers never call `link`, `login`, `db push`, remote migration, deployment,
or reset. They discard inherited Supabase/database/pilot/Vercel configuration,
require local Docker transport, and validate the CLI-reported DB/Auth endpoints
against this project's exact loopback ports before connecting. They do not read
the external hosted secrets file. Local data lives in project-specific Docker
volumes; stopping does not remove it or stop another local project's containers.

`LOCAL_DEV=true` is accepted only with `NODE_ENV=development` and loopback DB +
HTTP application Auth origin. It explicitly disables DB TLS for local PostgreSQL. Without
this opt-in TLS validates certificates, including in development. Production accepts provider-neutral PostgreSQL URLs (including Neon pooled URLs)
and rejects the local override;
URL SSL parameters cannot override the driver's TLS settings. Do not place the
local flag in hosted configuration. Use `dev:local`, not a production local server.

## Verification / troubleshooting

```sh
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
pnpm lint
pnpm typecheck
pnpm db:check
git diff --check
```

For browser tests install Chromium once with `pnpm exec playwright install chromium`,
or select an installed Edge via `PLAYWRIGHT_CHANNEL=msedge`. These tests use PGlite
and fixture Auth; they do not replace Docker-backed local acceptance.

If a local command fails, check Docker Desktop's Linux engine and this project's
containers. Ports 55320–55329 must be free. Do not bypass health checks. If
migration hashes mismatch, stop and investigate instead of editing migration
history or resetting data. Studio Auth users belong to Supabase only; application accounts live in better_auth.

## Better Auth migration ownership

Better Auth, adapter and CLI are pinned to 1.7.7. Official CLI generation with
`schemaName: "better_auth"` and `generateId: "uuid"` produced
`src/server/auth/schema.ts`; Drizzle generated canonical
`0008_better_auth.sql`. Its final privilege statements revoke inherited browser
grants without modifying Supabase auth objects. Only repository migrations apply
DDL; runtime never auto-migrates. Training tables have no FK to Auth or app_user map.

Production needs BETTER_AUTH_SECRET (secure, at least 32 characters),
BETTER_AUTH_URL (exact HTTPS origin), DATABASE_URL and optionally DATABASE_SSL_CA.
pg uses verified TLS with rejectUnauthorized=true. The parser accepts and strips
sslmode=require/verify-full intent before handing the URL to pg, preventing URL
options from replacing verified TLS. Other query overrides are rejected.
For Neon, use its pooled host and retain database/user/password. Additional
CLI-only parameters (such as connect_timeout/channel_binding) are not runtime
configuration; use the documented pool settings.

AuthIdentityProvider validates the Better Auth database session and exposes only
the UUID. Login/logout thin routes preserve same-origin guards and no-store
responses; canonical Better Auth endpoints retain explicit CSRF/origin checks.
Cookie cache is disabled; production cookies are Secure, HttpOnly, SameSite=Lax.

Fresh real-PostgreSQL verification (requires running Supabase LOCAL):

`REAL_LOCAL_AUTH=true pnpm exec vitest run src/server/auth/integration.test.ts`

On PowerShell set `$env:REAL_LOCAL_AUTH = "true"` first. The test creates a
random disposable database inside this LOCAL cluster, applies 0000–0008 and
checks hashes/order, bootstraps Better Auth and finishes a workout, then drops
only that database. Normal LOCAL data/volumes are never reset.

Re-generate the version-pinned Auth schema only with

pnpm exec auth generate --config scripts/auth-schema.ts --output src/server/auth/schema.ts --yes

Then review Drizzle SQL before applying. Keep namespace privilege revocations; never regenerate applied migrations.

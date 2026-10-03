# Local development

LOCAL uses Docker Desktop + Supabase Local + Next.js on Windows. HOSTED is the
existing Fitness RPG Pilot + Vercel. No separate production environment is created.
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
5. Open local Studio at <http://127.0.0.1:55323>. In Authentication → Users create
   a local email/password user, with email confirmed. Choose local-only credentials;
   do not reuse a hosted account. The app has no registration UI or Auth bypass.
6. Run `pnpm dev:local`; open <http://localhost:3000> and sign in with that local user.
7. Create Exercises/Program/Templates, log a workout and check History/corrections.

All application env values come from `supabase status -o json` in memory; commands
do not print keys or passwords. The generated `.env.local` contains only local
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`,
`MIGRATION_DATABASE_URL` and explicit `LOCAL_DEV=true`. Keep it uncommitted.

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
HTTP Auth endpoints. It explicitly disables DB TLS for local PostgreSQL. Without
this opt-in TLS validates certificates, including in development. Production keeps
its Supabase transaction-pooler/port-6543 requirement and rejects the local override;
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
history or resetting data. Studio manages the local Auth account only.

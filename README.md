# Fitness RPG

Fitness RPG is a mobile-first web application for gym resistance training.

The product is designed as a serious workout tracker first, with lightweight RPG-style progression layered on top.

## Product goal

The core product loop is:

```text
Program
→ Workout
→ Log Sets
→ Finish Workout
→ History
→ Progress
→ XP
→ Character
→ Next Workout
```

The MVP focuses on gym resistance training and tracks performed Sets using load where applicable, reps and optional RIR.

## Current status

The MVP v0.1 product, Training, Gamification and Architecture semantics have completed documentation freeze.

Implementation is now entering a controlled sequence of small reviewable slices.

The repository should not be interpreted as containing a complete or usable Fitness RPG product until the relevant implementation slices have actually been completed.

## Chosen stack

- Next.js App Router
- React
- TypeScript
- Drizzle ORM
- PostgreSQL
- Supabase PostgreSQL
- Supabase Auth
- Vercel

Architecture style:

```text
Next.js modular monolith
```

## Documentation

Canonical project specifications:

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable project decisions
- [`docs/TRAINING.md`](docs/TRAINING.md) — Training Model v0.1
- [`docs/GAMIFICATION.md`](docs/GAMIFICATION.md) — Gamification Model v0.1
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Architecture & Data Model v0.1

When implementation behavior conflicts with these documents, the conflict should be resolved explicitly rather than silently introducing a new product or architecture decision.

## Development phase

Current phase:

```text
Documentation Freeze v0.1
→ Controlled MVP Implementation
```

Implementation should proceed through small vertical slices rather than attempting the full workout loop in one PR.

Setup and deployment instructions will be added only when they correspond to repository functionality that actually exists.

## Foundation development setup

Slice 1 provides a minimal application, server-side identity boundary and database readiness check.

Use Node.js 22.13+ (22.x), 24.x or 26+ and pnpm 11.25.0. Validation was performed with Node.js 24.19.0.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Copy `.env.example` to `.env.local` and supply your project's `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` and `DATABASE_URL` before checking external services.
These variables are server-side configuration. Do not use a Supabase secret or
service-role key in place of the publishable key.

In production, `DATABASE_URL` must point to a Supabase transaction-mode pooler
on port 6543. The application uses one connection per warm instance and enforces
TLS certificate validation. Leave SSL query parameters out of the URL so they
cannot override the pool's TLS configuration. node-postgres queries are unnamed;
no persistent prepared statements are required.
Both shared and dedicated transaction poolers are supported. If the server
certificate requires a project root, set `DATABASE_SSL_CA` to the PEM certificate
downloaded from Supabase Database settings (literal `\n` escapes are accepted).

Foundation endpoints:

- `GET /api/health`: application liveness, independent of external credentials.
- `GET /api/ready`: database readiness; returns a safe 503 when unavailable.
- `GET /api/foundation/me`: verifies cookie-based Supabase identity, then checks
  database readiness through the application boundary and Drizzle. Returns 401
  without an authenticated session and a safe 503 for configuration failures.

The identity endpoint can refresh cookies in its Route Handler. No login UI or
authenticated Server Component flow is implemented yet.

Drizzle schema declarations are located in `src/server/db/schema.ts`; the
configured migration output directory is `drizzle/`. There are no domain tables
or migrations in Slice 1. Migration tooling uses a separate
`MIGRATION_DATABASE_URL` for a trusted tooling connection; application runtime
never reads it. No external migration command has been executed.

Unit tests use adapters and mocks. Live Supabase Auth and PostgreSQL integration
must be verified separately with project credentials.


---

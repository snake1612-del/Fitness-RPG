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


---

# Fitness RPG — Training Model v0.1

**Status:** Frozen  
**Scope:** MVP v0.1

This document defines canonical Training semantics.

It does not define SQL schema, HTTP endpoints or UI layout.

Gamification rules are defined separately in `docs/GAMIFICATION.md`.

---

## 1. Canonical model

The conceptual Training flow is:

```text
Program
→ Workout Template
→ Workout Session
→ Session Exercise
→ Workout Set
```

The core distinction is:

```text
Template = plan
Session = historical fact
```

A Session is not a live reference to a Template.

---

## 2. Workout Program

A Program is the user's ordered cyclic training rotation.

A Program contains one or more ordered Workout Templates.

Example:

```text
A → B → C → A → B → C ...
```

MVP does not require calendar scheduling.

Only one Program is active for a user at a time.

The first Program created through the first-use flow may become active automatically.

Changing the active Program changes future workout rotation but does not mutate historical Sessions.

---

## 3. Workout rotation

Next Workout is derived from history rather than from a mutable rotation pointer.

Cancelled Sessions are ignored.

If no relevant Finished history exists for the active Program, the next workout is the first Template in that Program.

Otherwise, the next workout is the Template following the most recently Finished relevant Template.

The rotation wraps from the last Template to the first.

If the historical source Template no longer exists in the current Program ordering, rotation falls back to the first Template.

Program or Template edits therefore affect future planning only.

---

## 4. Workout Template

A Workout Template is an ordered training plan.

A Template contains ordered Exercises.

For every planned Exercise the required target information is:

- target Working Set count;
- target rep range.

Optional targets may include:

- target load;
- target RIR;
- rest target;
- notes.

Targets are planning information, not completed training facts.

The system does not create completed or planned placeholder WorkoutSet records from these targets.

---

## 5. Start Workout

Start Workout creates an `ACTIVE` Workout Session.

At Start, relevant Template state is snapshotted into the Session.

The snapshot preserves enough information to execute and later understand the workout independently from future Template changes.

This includes the planned Exercise ordering and relevant Exercise semantics and targets.

The planned Working Set quota used by Gamification is also frozen at Start.

Conceptually:

```text
P = sum of snapshotted planned Working Set targets
```

for the planned Exercises in the Session.

Later Template edits must not change `P`.

---

## 6. Workout Session

A Workout Session represents one historical workout attempt.

Session states are:

```text
ACTIVE
FINISHED
CANCELLED
```

Allowed terminal transitions:

```text
ACTIVE → FINISHED
ACTIVE → CANCELLED
```

There is no reopening transition from `FINISHED` to `ACTIVE`.

At most one Session may be `ACTIVE` for a user.

---

## 7. Partial Finished Sessions

A Finished Session does not require full completion of the source Template.

A user may:

- complete fewer planned Sets;
- skip an Exercise;
- stop before reaching later Exercises;
- add extra Sets;
- add session-only Exercises.

The Session may still be Finished.

Skipped or unreached work must not create fake completed Sets.

A partial Finished Session remains valid Training history.

Its Progress and Gamification effects are calculated from the facts it actually contains.

---

## 8. Cancelled Sessions

Cancellation means that the attempt is not accepted as a completed workout.

A Cancelled Session does not:

- advance Program rotation;
- contribute to completed-workout consistency;
- contribute to PR calculations;
- contribute to Progress performance history;
- produce XP.

Cancellation is distinct from finishing a partial Session.

---

## 9. Session-only Exercises

During an active Session, a user may add an Exercise that was not in the source Template.

That Exercise becomes part of the historical Session only.

It does not modify the Template.

For Gamification its planned quota is zero:

```text
session-only Exercise does not increase P
```

Completed Working Sets from it may still count toward `W` under the Gamification specification.

---

## 10. WorkoutSet

A WorkoutSet represents an actual entered Set.

There are no persisted planned placeholder Sets.

A Set may exist as a draft before completion.

Entering values is not equivalent to completion.

Completion is explicit.

Only an explicitly completed Set is treated as a canonical completed training fact.

Finishing the Session must not silently mark unfinished draft Sets as completed.

---

## 11. Set types

MVP supports:

```text
WORKING
WARM_UP
```

Working Sets represent the main performed training work.

Warm-up Sets are recorded training context but are excluded from Working Set completion, PR and XP semantics.

Changing a Set between Working and Warm-up changes its derived meaning.

---

## 12. Reps

A completed training Set requires reps.

Reps are actual performed repetitions, not a planned target.

---

## 13. RIR

RIR means Reps In Reserve.

It is optional.

If present:

```text
RIR ∈ {0, 1, 2, ..., 10}
```

A missing RIR is valid and must not invalidate an otherwise valid completed Set.

---

## 14. Exercise load semantics

Each Exercise uses one of three explicit load semantics.

### WEIGHTED

The Set records external load.

Examples include conventional machine, barbell and dumbbell Exercises.

Canonical performance meaning is based on the external load and reps.

### BODYWEIGHT

The basic Exercise is performed using bodyweight.

The Set records reps without an external load value.

A materially weighted variation should be represented with the appropriate weighted Exercise semantics rather than overloading basic bodyweight meaning.

### ASSISTED_BODYWEIGHT

The recorded load value represents assistance.

Example:

```text
30 kg assistance
```

means 30 kg of assistance, not 30 kg lifted.

Lower assistance represents a harder performance when other relevant conditions are equal.

---

## 15. Historical load semantics

Historical interpretation may not depend on the current Exercise definition.

The Exercise load semantic required to interpret a Session is part of its Session snapshot.

Changing future planning must not reinterpret historical performance.

---

## 16. Previous Performance

Previous Performance is exercise-specific.

For a given Exercise, it is derived from the latest earlier `FINISHED` Session that contains completed Working Sets for that same Exercise.

It does not use:

- Cancelled Sessions;
- draft Sets;
- Warm-up Sets as the primary previous Working performance.

If no qualifying prior execution exists, Previous Performance is absent.

Session-only executions qualify if they used the same Exercise and the Session was Finished.

---

## 17. Finished Session edits

A Finished Session may be corrected after Finish.

The Session remains `FINISHED`.

Valid corrections may change actual Training facts, including Set contents, Set type, completion or Set existence.

Any affected derived information must be recalculated.

This may include:

- Previous Performance;
- PR status;
- estimated 1RM;
- volume;
- consistency-dependent views;
- Session XP;
- same-day XP allocation;
- Total XP;
- Level.

The historical Session snapshot and immutable `P` do not change.

---

## 18. PR eligibility

Only completed `WORKING` Sets from `FINISHED` Sessions qualify for PR calculations.

The following do not qualify:

- Warm-up Sets;
- draft Sets;
- Cancelled Sessions.

Session-only Exercises are eligible if their Working Sets otherwise satisfy the rules.

---

## 19. Weighted PRs

For `WEIGHTED` Exercises MVP tracks:

### Highest load

Highest external load successfully completed in an eligible Set.

### Reps at load

Best completed repetition count for the same canonical load.

### Estimated 1RM

For eligible Sets with 1–10 reps:

```text
e1RM = weight × (1 + reps / 30)
```

using the Epley formula.

Sets above 10 reps are not used for MVP e1RM.

MVP does not define a separate generic “Best Set” PR.

MVP does not define a volume PR.

---

## 20. Bodyweight PR

For `BODYWEIGHT` Exercises the MVP PR is:

```text
maximum completed reps
```

from an eligible Working Set.

---

## 21. Assisted-bodyweight PR

For `ASSISTED_BODYWEIGHT` Exercises the MVP PR is:

```text
lowest completed assistance
```

from an eligible Working Set.

Because the value represents assistance, lower is better for this metric.

---

## 22. Progress metrics

Progress is derived from Training facts.

MVP includes the following views.

### Exercise performance history

Historical completed Working performance for the same Exercise.

### Estimated 1RM trend

For eligible weighted Exercises and eligible 1–10 rep Sets.

### Weighted Working volume

For weighted Working Sets:

```text
volume = Σ(load × reps)
```

Only canonical completed Working Sets are included.

### Workout consistency

Consistency is based on Finished Sessions over time.

Cancelled Sessions do not count as completed workouts.

The exact presentation window may be view-specific; it does not create a new Training fact.

---

## 23. Edge-case rules

### Template edited after Start

The active or historical Session remains based on its Start snapshot.

### Template deleted after a Session exists

Historical Session meaning remains intact.

### Exercise definition later changes

Historical Session Exercise semantics remain those of the snapshot.

### Fewer Sets than planned

A Finished Session is still valid.

### More Sets than planned

Extra actual Sets are allowed.

### Session-only Exercise

Allowed and historical only unless the user separately edits the Template.

### Draft Set when Session is Finished

The draft does not become completed automatically.

### Missing RIR

Allowed.

### Warm-up converted to Working

Derived Training/Gamification results may change.

### Working converted to Warm-up

Derived Training/Gamification results may change.

### Historical correction

Derived state is recalculated from the corrected canonical Session facts.

---

## 24. Training source of truth

Canonical Training facts are the historical Session snapshot and its actual Sets.

Progress and Gamification consume those facts.

Neither Progress nor Gamification may redefine what the user performed.

---

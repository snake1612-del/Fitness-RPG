# Fitness RPG — Gamification Model v0.1

**Status:** Frozen  
**Scope:** MVP v0.1

Gamification consumes Training facts.

It does not determine sports methodology.

---

## 1. XP source

MVP training XP comes only from:

```text
FINISHED Workout Sessions
```

A Cancelled Session produces:

```text
0 XP
```

---

## 2. Canonical variables

### `P` — planned Working Set quota

`P` is calculated from the Workout Session snapshot at Start Workout.

It represents the total planned Working Sets from the original planned Session structure.

`P` is immutable after Start.

Session-only Exercises do not increase `P`.

### `W` — completed Working Sets

`W` is the number of all currently completed `WORKING` Sets in the Finished Session.

Included:

- planned Working Sets that were completed;
- additional Working Sets;
- Working Sets from session-only Exercises.

Excluded:

- Warm-up Sets;
- drafts;
- incomplete Sets;
- deleted Sets.

### `C` — credited Sets

```text
C = min(W, P)
```

Therefore extra work can never create completion credit above the frozen planned quota.

---

## 3. Eligibility

A Session is XP-ineligible if:

```text
P < 2
```

or:

```text
C < 2
```

In either case:

```text
Candidate XP = 0
Session XP = 0
```

A Finished Session remains a valid Training Session even when it is XP-ineligible.

---

## 4. Candidate XP formula

For an eligible Session:

```text
raw_candidate = 100 × C / P
```

Candidate XP is the raw value rounded to the nearest multiple of 5.

Exact halfway cases round upward.

Equivalent non-negative rule:

```text
Candidate XP =
5 × floor(raw_candidate / 5 + 0.5)
```

Candidate XP is capped at:

```text
100 XP
```

per Session.

---

## 5. Examples

```text
P = 4, W = 4
C = 4
Candidate XP = 100
```

```text
P = 4, W = 3
C = 3
Candidate XP = 75
```

```text
P = 3, W = 2
C = 2
raw = 66.67
Candidate XP = 65
```

```text
P = 6, W = 5
C = 5
raw = 83.33
Candidate XP = 85
```

```text
P = 5, W = 7
C = 5
Candidate XP = 100
```

Extra Sets cannot exceed 100 Candidate XP.

---

## 6. Performance neutrality

XP is independent of athletic performance magnitude.

The following do not add XP:

- higher weight;
- more reps inside a completed Set;
- lower RIR;
- higher volume;
- longer duration;
- a PR;
- a harder Exercise;
- a particular Exercise choice.

The purpose is to avoid making Gamification define or distort Training methodology.

---

## 7. Warm-up Sets

Warm-up Sets contribute:

```text
0 XP
```

They do not count in `W`.

A `WARM_UP → WORKING` correction may therefore alter Session XP.

A `WORKING → WARM_UP` correction may also alter Session XP.

---

## 8. Session-only Exercises

Completed Working Sets from session-only Exercises count in `W`.

They do not increase `P`.

Consequently they may help a partial Session reach its frozen quota, but can never produce credit above `P`.

This is intentional for MVP.

---

## 9. PRs

PRs produce:

```text
0 additional XP
```

PR calculation belongs to Training/Progress, not reward generation.

---

## 10. Session cap

Maximum Candidate XP:

```text
100 XP / Session
```

No amount of extra work can make one Session exceed this value.

---

## 11. Stable training day

Training XP also has a daily cap:

```text
100 XP / stable training day
```

The training day is fixed when a Session is first Finished.

The historical day does not move if the user later changes timezone.

---

## 12. Multiple Sessions on one training day

Sessions are allocated XP using their immutable original Finish order.

For every Session on the same stable training day:

```text
remaining = 100 - XP already allocated earlier that day

awarded_session_xp =
min(candidate_session_xp, max(0, remaining))
```

Therefore total awarded training XP for one stable training day can never exceed 100.

Example:

```text
Session A candidate = 70
Session B candidate = 80

A awarded = 70
B awarded = 30

Day total = 100
```

---

## 13. Finished Session edits

Finished Session edits may change `W`.

Examples:

- add a completed Working Set;
- delete a completed Working Set;
- complete or uncomplete a Set;
- change Working to Warm-up;
- change Warm-up to Working.

When this occurs, the system recalculates:

```text
W
→ C
→ Candidate Session XP
→ training-day allocation
→ Total XP
→ Level
→ Character progress
```

`P` does not change.

Edits only to:

- weight;
- reps;
- RIR;

do not independently change XP as long as completion/type eligibility remains unchanged.

---

## 14. Deterministic daily recalculation

If an earlier Session on a training day changes, later Sessions on the same day are recalculated in original Finish order.

Example:

Original:

```text
A = 70
B = 30 awarded from an 80 candidate
```

If A is corrected to 50:

```text
A = 50
B = 50
```

The cap remains 100 and allocation remains deterministic.

---

## 15. Idempotency

Repeated processing of the same Session must not duplicate XP.

Examples that must be safe:

- duplicate Finish request;
- network retry;
- page reload;
- recalculation;
- repeated read.

For one canonical set of Training facts there is one canonical XP result.

---

## 16. XP rebuildability

XP is derived/recalculable state.

For MVP:

```text
Total XP = sum of currently awarded Session XP
```

Level and Character progression are then derived from Total XP.

An immutable append-only XP ledger is not required.

---

## 17. Level curve

Level 1 starts at:

```text
0 Total XP
```

XP required to move from Level `L` to the next Level is:

```text
XP_next(L) = min(100 + 25 × (L - 1), 500)
```

Examples:

```text
Level 1 → 2: 100 XP
Level 2 → 3: 125 XP
Level 3 → 4: 150 XP
...
```

The requirement eventually caps at:

```text
500 XP / Level
```

There is no maximum Level in MVP.

---

## 18. Character v0.1

Character is a visual representation of accumulated progression.

MVP Character includes:

- Character visual;
- Level;
- Total XP/progress;
- progress toward next Level;
- visual milestone changes.

Initial milestone Levels:

```text
1
3
5
10
20
```

Character does not determine Training behavior.

---

## 19. Post-MVP systems

Not part of Gamification v0.1:

- Character Stats;
- formal Achievements;
- equipment;
- inventory;
- skins;
- classes;
- talents;
- quests;
- leaderboards;
- streak XP;
- weekly XP;
- PR XP;
- performance XP.

---

## 20. Accepted MVP trade-off

The formula is intentionally completion-based.

Because `W` includes all completed Working Sets while `P` remains the original planned quota, a user may replace some skipped planned work with extra or session-only Working Sets and still increase `C`.

For example, the model does not require that every credited Set correspond to the exact originally planned Exercise.

This is an accepted MVP trade-off.

The incentive is bounded because:

```text
C ≤ P
Candidate XP ≤ 100
training-day XP ≤ 100
```

The MVP does not add per-Exercise quota matching or exercise-difficulty scoring to close this behavior because those mechanisms would add complexity and risk letting Gamification distort Training methodology.

---

---
card: define
state: DEFINE
role: root
loads: status, in DEFINE
---
Settle what done means, with the user, as one block.
1. Goals, in the user's words: the objective, the real inputs, the stakes, what is dropped. Ask the user only what is theirs; decide the rest.
2. Prevent: your step back on the goals, then the one-block: spec, architecture and rubric drafted together, whole (`{{cmd}} block --file <draft>`). Two members draft apart first (`{{cmd}} call member`, twice); merge their drafts by the merge card into that one block.
3. Split the block into `cloop/spec.md`, `cloop/architecture.md` and `cloop/rubric.md`. The rubric's format:
  - `## Goals`: `- G<n> | <the user's words> | <criterion IDs>` or `| Drop: <reason>`. Every goal maps somewhere; every criterion traces to a goal.
  - `## Criteria`: `- <ID> | CORE|NON-CORE | <one property> | evidence: <the real run or output that decides it> | pass: <a case that passes> | fail: <a case that fails> | boundary: <the closest input where a wrong result would still look right>`.
4. Judgment while splitting:
  - CORE: the objective fails without it, plus what is needed to run and judge that. Everything else needed is NON-CORE; valid but optional goes to backlog; out of scope is Drop, with the reason.
  - One property per criterion: "and" in a property usually means two criteria, one of which can be half-met.
  - If an obviously wrong output would still pass, the boundary is wrong: choose the near-miss a lazy implementation would get wrong.
  - A property only use can show (feel, flow, ease) gets `evidence: use session — <what to do>`; its judge uses the product and cites its own session record.
  - Behaviour that depends on model output: the first CORE criterion is a real-input eval set.
5. `{{cmd}} freeze`. The rubric is provisional until the first council, then frozen hard. Removing a criterion, changing a goal, or any change after the hard freeze is the user's: `freeze --user "<their words>"`.
Next: ONESHOT. FULL only: EXPLORE when the output's shape or the mechanism is unclear (`--why shape|mechanism`). After a re-define, the loop-breakers build (DUEL).

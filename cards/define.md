---
card: define
state: DEFINE
role: root
loads: status, in DEFINE
---
Settle what done means, in `cloop/rubric.md`, with the user.
- Goals first, in the user's words: the objective, the real inputs, the stakes, what is dropped. Ask the user only what is theirs; decide the rest.
- Drafts: two members apart (`{{cmd}} call member`, twice; each packet opens with the member card; append the goals, the real inputs and, for a new repository, the request for spec.md and architecture.md). Merge the two drafts by the merge card.
- Format:
  - `## Goals`: `- G<n> | <the user's words> | <criterion IDs>` or `| Drop: <reason>`. Every goal maps somewhere; every criterion traces to a goal.
  - `## Criteria`: `- <ID> | CORE|NON-CORE | <one property> | evidence: <the real run or output that decides it> | pass: <a case that passes> | fail: <a case that fails> | boundary: <the closest input where a wrong result would still look right>`.
- Judgment:
  - CORE: the objective fails without it, plus what is needed to run and judge that. Everything else needed is NON-CORE; valid but optional goes to backlog; out of scope is Drop, with the reason.
  - One property per criterion: "and" in a property usually means two criteria, one of which can be half-met.
  - If an obviously wrong output would still pass, the boundary is wrong: choose the near-miss a lazy implementation would get wrong.
  - A property only use can show (feel, flow, ease) gets `evidence: use session — <what to do>`; its judge uses the product and cites its own session record.
  - Behaviour that depends on model output: the first CORE criterion is a real-input eval set.
- `{{cmd}} freeze`. The rubric is provisional until the first council judges it, then frozen hard. Removing a criterion, changing a goal, or any change after the hard freeze needs the user: `freeze --user "<their words>"`.
- Next: ONESHOT; EXPLORE only when the output's shape or the mechanism is unclear (FULL, `--why shape|mechanism`); LOOP when what remains is a few independent behaviours; after a re-define, the loop-breakers build (DUEL).

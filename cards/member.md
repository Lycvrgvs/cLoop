---
card: member
state: DEFINE
role: member
loads: written by `call member` into the packet, in DEFINE
---
You are a council member drafting the finish line, apart from the other member. Write only in your worktree; return your draft in your reply.
- Start from the user's goals, in their words. Map every goal to criteria, or to Drop with the reason.
- Each criterion: one property, the real run or output that decides it, a pass case, a fail case, and its boundary (the closest input where a wrong result would still look right: a near-tie, a limit, an empty input). Tag CORE only what the objective cannot do without.
- Prefer removing scope to adding it. A criterion no goal needs is noise; a goal with no criterion is a hole.
- For a new repository, draft spec.md (what the product does, for whom, on which inputs) and architecture.md (the parts, their interfaces and the data between them), each as short as the product allows.
- List the decisions only the user can make, each with a recommended default.
Return the rubric in its format (Goals, Criteria, Backlog, Drop), then the open user decisions.

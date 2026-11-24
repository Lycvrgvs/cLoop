---
card: adopt
state: ADOPT
role: root
loads: status, in ADOPT (an existing project)
---
Adopt what is there before any route; adoption never changes the product and never adds criteria.
- Read the history, the product, the existing checks and any rubric, spec and architecture. Run the product's real path once on HEAD (`{{cmd}} run -- <command>`): this baseline separates what was already broken from what the task breaks.
- Recommend to the user, with reasons: keep (the rubric is sound), simplify (remove or merge criteria; never add), or replace (DEFINE writes a new rubric). Record the decision with their answer: `{{cmd}} adopt keep|simplify|replace "<what exists, what works on the baseline, the protected checks, the user's answer>"`. A protected check is never edited or weakened to pass.
- Keep or simplify: the rubric must be valid and frozen here (`{{cmd}} freeze`); evidence established before stays valid unless the change invalidates it. Then advance to the work the rubric still needs (ONESHOT, LOOP, or EXPLORE when the way is unclear). Replace: `advance DEFINE`.

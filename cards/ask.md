---
card: ask
state: ASK
rung: redefine
role: root
loads: status, in ASK (a re-define)
---
Re-define: the full step back with the user, who decides before anything is built.
1. Show the user the targets, what was tried, the evidence (or the blocker) and 2-3 options with your recommendation. Record their words: `{{cmd}} answer "<their comment>"`. If they say stop: `advance STOPPED`.
2. Two loop-breakers, apart (`{{cmd}} call dueler`, twice), take the full step back with the user's comment and each proposes a re-plan from the step at fault. Merge them by the merge card: `{{cmd}} stepback replan DEFINE|EXPLORE "<the re-plan: the step at fault, what changes, what is removed, why it closes the failure>"`.
3. Show the user the re-plan; record their approval: `{{cmd}} approve "<their words>"`. Then advance to the re-plan's state; after DEFINE, the loop-breakers build (DUEL).

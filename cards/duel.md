---
card: duel
state: DUEL
rung: full
role: root
loads: status, in DUEL (rung full)
---
The duel: two loop-breakers break what your next-shots could not close.
1. `{{cmd}} call dueler`, twice (each from BEST in its own worktree; each packet opens with the dueler, step-back and one-block cards). Append a self-contained packet: the goal, the rubric, the failing criteria, the vetoes, BEST and its diff, every real-run result, finding and dropped attempt, and your own reading labelled an unverified hypothesis. They never see each other's work.
2. Run each result yourself: `{{cmd}} run --cwd <its worktree> -- <command>`.
3. Merge by the merge card into the product, run the real path on HEAD, commit, then one council on every criterion: `call judge` twice, `judge merge <idA> <idB>`, `reproduce` every NOT_MET.
When every criterion is already established, a duel has nothing to fix: the engine refuses it and names the release gate.

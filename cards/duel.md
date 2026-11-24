---
card: duel
state: DUEL
rung: full
role: root
loads: status, in DUEL (rung full)
---
Break what your small loops could not close.
1. Two loop-breakers, apart: `{{cmd}} call dueler`, twice (each from BEST in its own worktree; each packet opens with the dueler and step-back cards). Append a self-contained packet: the goal, the targets' criteria, the vetoes, BEST and its diff, every real-run result, finding and dropped attempt, and your own reading labelled an unverified hypothesis.
2. Run each result yourself: `{{cmd}} run --cwd <its worktree> -- <command>`.
3. Merge by the merge card into the product, run the real path on HEAD, commit, then one council judges the merge: `call judge` twice, `judge merge <idA> <idB>`, `reproduce` every NOT_MET.

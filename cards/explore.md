---
card: explore
state: EXPLORE
role: root
loads: status, in EXPLORE (FULL only)
---
Choose how to build, by evidence, when the way is unclear.
1. Prevent: your small step back on the whole: what makes the way unclear, the options worth trying. Each explorer's one-shot is its own block.
2. 2-4 explorers (`{{cmd}} call explorer`, once each; each packet opens with the explorer card), each assigned an option that differs in mechanism, not in detail. Run every option yourself on real input (`{{cmd}} run --cwd <its worktree> -- <command>`).
3. Council: both judges review every option blind, under aliases (A, B, C…), never names or authors; append the aliases with their worktrees and the rubric. `{{cmd}} judge explore <idA> <idB> --options <aliases>`: the engine marks the eligible options (every CORE criterion MET, none NOT_MET; if none is, all are) and prints the ranks as information.
4. Choose by the merge card: `{{cmd}} winner <alias>`, or `winner <a>,<b>` for an amalgam, which the council judges again (`judge merge`). Settle the winner's NOT_METs (`reproduce`). Integrate it and run it on real input on HEAD. The merged result is the one-shot: its council's outcome leads to the next-shot. The options not chosen become vetoes.

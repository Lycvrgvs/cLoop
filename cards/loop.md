---
card: loop
state: LOOP
rung: small
role: root
loads: status, in LOOP (rung small)
---
Small loop: build or correct the targeted behaviours on BEST. The same loop builds what the one-shot left and corrects what a council found.
1. PREVENT: your small step back, naming the targets (`--targets`).
2. Seen to fail: `{{cmd}} run --before --cwd <a worktree of BEST> -- <the target's test>`. It must fail on BEST, because the behaviour is missing or wrong; `--judgment` when the evidence is the criterion's real output, not an exit code.
3. BUILD the smallest coherent change at the origin (yourself, or the builders: dynamic and mechanical cards). RUN the real path on HEAD (`{{cmd}} run -- <command>`) and commit.
4. JUDGE: `{{cmd}} call judge` twice, append the targets' rubric lines and the run evidence, `{{cmd}} judge loop <idA> <idB>`, settle every NOT_MET with `reproduce`. The engine gives the outcome and the rung.

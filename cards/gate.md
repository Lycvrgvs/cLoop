---
card: gate
state: GATE
role: root
loads: status, in GATE
---
Certify the stage on one commit.
- Core gate: scope every CORE criterion. Release gate: scope everything; first remove what does not trace to a goal, a real input or an observed failure (verification included), and commit.
- `{{cmd}} run --e2e -- <the product end to end, on its normal path and speed>` on that commit: what its user would run, not a shortcut. At the release gate also `{{cmd}} run --suite -- <the full suite>`.
- Then `call judge` twice, `judge gate <idA> <idB>`, `reproduce` every NOT_MET. Only a reproduced violation of a criterion in scope blocks. Any later commit, docs included, repeats the runs and the council.
- PASS: core gate → the NON-CORE stage (ONESHOT or LOOP); release gate → ACCEPT. Otherwise the failing criteria follow the ladder.

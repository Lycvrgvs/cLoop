---
card: gate
state: GATE
role: root
loads: status, in GATE
---
The release gate: the one gate. The council judges one end-to-end real run of every criterion against the whole rubric.
- On the commit the next-shot passed: `{{cmd}} run --e2e -- <the product end to end, on its normal path and speed>` (what its user would run, not a shortcut) and `{{cmd}} run --suite -- <the full suite>`.
- Then `call judge` twice, `judge gate <idA> <idB>`, `reproduce` every NOT_MET. Only a reproduced violation blocks. Any later commit, docs included, repeats the runs and the council.
- PASS → ACCEPT. Otherwise the failing criteria go back to a next-shot on the current rung.

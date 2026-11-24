---
card: oneshot
state: ONESHOT
role: root
loads: status, in ONESHOT
---
Generate the stage in one file, then judge it.
1. PREVENT: your small step back: what the stage's criteria demand, the real inputs, the representation you handle best.
2. Build all the stage's new logic as one self-contained file (or give it to the builders: dynamic and mechanical cards), run it on real input, integrate it into the product and reproduce its outputs on the same inputs (`{{cmd}} run -- <command>`). Commit: judges review HEAD.
3. Council: `{{cmd}} call judge` twice; append the scope's rubric lines and the run evidence; `{{cmd}} judge oneshot <idA> <idB>`; settle every NOT_MET with `reproduce`.
4. After the council: PASS → GATE. Otherwise judge the one-shot itself: good (a sound base; what is left is a few behaviours) → LOOP; bad (a wrong base) → ASK, a re-define with the user. A REGRESSION follows the ladder.

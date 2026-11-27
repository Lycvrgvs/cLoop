---
card: ask
state: ASK
rung: redefine
role: root
loads: status, in ASK (a re-define)
---
The re-define: the user decides, twice. Its prevent is the re-plan: the loop-breakers' full step backs, merged, then its one-block, the new definition whole, before the user's yes. Once approved, it is also the prevent of the state it leads to. Each message says which decision it asks for. Any clear yes or no is their answer; never dictate a phrase for them to type. An unclear reply gets one plain follow-up question. At either ask the user may stop the task: record their words (`{{cmd}} answer "<their words>"`), then `advance STOPPED`.
1. Their comment. In plain words: what was tried, what keeps failing and why it matters to them, the current behaviour from a real run (or the blocker), 2-3 options and your recommendation. Say that their reply feeds a new plan they will see before anything is built. Record it: `{{cmd}} answer "<their words>"`.
2. Two loop-breakers, apart (`{{cmd}} call dueler`, twice, with their comment in each packet), each take the full step back and write a re-plan as their one-block. Merge them by the merge card: `{{cmd}} stepback replan DEFINE|EXPLORE "<the re-plan: the step at fault, what changes, what is removed, why it closes the failure>"`, then the new definition whole: `{{cmd}} block "<…>"` (or `--file`).
3. Their decision on the plan. Show the merged re-plan and its one-block in plain words. Mark what differs from their comment and anything it newly commits to; when nothing material differs, say so. Say that a yes starts the build.
- Yes: `{{cmd}} approve "<their words>"`, then advance to the re-plan's state; after DEFINE, the loop-breakers build (DUEL).
- No, with a new comment: `{{cmd}} answer "<their words>"` starts the re-plan again from step 2.

# Engineering note-to-check feasibility results

The frozen three-snapshot task completed on 1 November 2026 with six live calls, no retries and no provider failures. Both ordinary Meta and the reviewed adapter passed all three intended-case semantic and numerical checks. Ordinary Meta was faster. No unique AI advantage or scientific novelty is established.

| Approach                       | Correct task snapshots | Accepted/raw semantic matches | Calls | Median extraction/preparation/check |
| ------------------------------ | ---------------------: | ----------------------------: | ----: | ----------------------------------: |
| Ordinary Meta + same compiler  |                    3/3 |                   3/3 and 3/3 |     3 |                             4.402 s |
| Reviewed source-linked adapter |                    3/3 |                   3/3 and 3/3 |     3 |                             9.157 s |

The first two snapshots produced +104/−54 g and +42/−42 g respectively, each passing independent Decimal forward checks against fixture-intended quantities/targets/stocks. The third left the new centre uncertainty missing and returned no bound request or joint result. All 25 normalized fields matched the expected semantic values. Both model approaches received the same case/note, configured model and 4,096-token single-call budget. The ordinary arm used the same direct compiler; no field-by-field re-entry penalty or fabricated quotes were imposed.

[Actual run](../examples/engineering-intake/live-comparison.json) · [Frozen protocol](ENGINEERING_INTAKE_PROTOCOL.md) · [Fixtures](../examples/engineering-intake-task-v1.json). Raw and accepted semantics are separate. Harness review/independence flags are scripted synthetic choices, not human review measurements.

## Actual app-entry comparison

The current manual path took 34 completion actions for initial setup from an existing shared brief, then 5 for the updated observation. The third missing-bound snapshot took 2 actions and correctly remained blocked. Shared eight-field brief, optional case label, note authorship, screenshots/inspection and QA downloads are excluded. A dropdown selection counts as one completed control interaction. Valid common geometry/stocks were retained rather than cleared to inflate the baseline. Manual's unused empty recipe retained its default mass-percent metadata; headless fixtures use grams. No recipe quantity or numerical model uses that setting.

The initial 34-event log is retained. A REPL closure prevented later events from reaching the new per-stage arrays; those 5/2 action sequences were reconstructed from the actual executed browser calls, with no invented timestamps. [Actual actions and disclosure](../examples/engineering-intake/manual-actions.json), [raw log](../examples/engineering-intake/manual-raw-action-log.json), [initial/revised downloads](../examples/engineering-intake/). This is a solo scripted control-count test, not a human speed or effort study.

The compact UI completed the same initial task in **7 completion actions versus 34 manually**. It read the target from the existing brief and all fresh measurements/locations/bounds from the supplied note. The revised observation took 5 actions in both paths; the missing-bound note path took 5 versus 2 manual actions. The gain is initial entry convenience, not a universal reduction. No corrections or invented values were observed in these UI runs. Applying the incomplete note cleared the old centre uncertainty and disabled the joint check/assistant; its response had check:null and no joint result.

[Actual UI actions](../examples/engineering-intake/ui-actions.json), initial/revised/missing downloads and a fresh Meta joint tool run are retained in the same directory. Product/material were not selected again; numeric target and spatial fields were applied atomically. All note values were explicitly synthetic. These are scripted control counts; no note-authoring time, human review burden or human speed was measured. Ordinary Meta's equally easy headless compiler was correct and faster; this UI task does not establish advantage over ordinary chat's total workflow.

## Limits and decision

These are three visible developer-authored synthetic snapshots, not held-out generalization inputs, a representative note corpus, user study or physical experiment. Both arms got correct unknowns and values; the reviewed path's additional literal checks did not produce an accuracy advantage here. Source excerpts establish occurrence and conversions, not interpretation.

A/B location slots are arbitrary: the frozen scorer compares source-order slots and command lists. A physically correct permutation could be penalized. Neither output swapped locations, so no observed score depends on this; any future physical adjudication must be labelled post hoc. The raw-semantic normalizer also lacks an AttributeError catch for a non-string number_text; structured output prevented this issue here. Preserve an incomplete attempt if it occurs, not a silent retry. Production UI/server integration after the run is separate from the frozen adapter hashes.

The supported product improvement is reduced initial field entry into a shared, checked engineering case, as observed in this supplied-note UI task. It is not a claim that AI calculates better, that the source-linked helper is faster, or that ReMatter deserves an award. More ambitious claims require stronger results.

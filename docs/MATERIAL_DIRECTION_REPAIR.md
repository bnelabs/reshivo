# Material-direction repair — historical2November checkpoint

The owner approved the Sophia cloud voice and rejected the left/right assembled-weight story. This is a correction to the product's job, not acceptance of a different small calculator as the prize entry. The private goal remains active.

## Current flow

Describe recycled input and desired product → compare material/preparation/process/design changes → choose one → plan its comparison → record matching readings → ask for the next change. The synthetic balance example is removed from the main menu; assembly checks are optional. A selected route states the change, target and next check before its full explanation. Contextual answers are visible before new alternatives, and automatically generated questions have concise labels rather than displaying internal JSON.

The trial's selected change, exact original target text and proposed checks reach the single measurement form. An explicit check-copy action transfers only property and proposed method; numerical limits and units need user entry. No target is parsed or invented. Trial and case changes revoke result/confirmation but retain the draft for review. Contextual questions retain the chosen trial. New routes with reused IDs cannot silently inherit a different trial.

## Relevant measured example

Cecon's source MDPE/PCRPE specimens remain separate from My mix. At a chosen minimum yield stress of 25 MPa, 0% and 20% source levels have all ten recorded readings above the threshold; 20% is the highest tested recycled-containing level with that result. The screen is a material-development criterion, not a measured planter requirement. It does not predict the owner's resin, contaminated input or product. At a minimum of 26 MPa, only the virgin control has every reading inside, and the interface explicitly says this study supplies no matching recycled-containing level.

An optional source-only ingredient calculation uses the existing composition-balancing API: 1 kg separate raw PCRPE + 4 kg raw virgin MDPE = 5 kg at the studied 20 mass % proportion. It is a simulation of ingredient amounts, not scale-up equivalence or prediction of the new batch's yield stress. It does not reprocess an already moulded blend or copy anything into My mix. Editing mass or source conditions clears the old composition result. Small positive masses display in scientific notation rather than rounding to zero.

Both source and user-reading APIs now accept an explicit null maximum to mean no upper limit. The minimum remains required. User-reading numbers remain exact decimal strings; null does not insert a numerical ceiling. Unknown reading groups stay unknown.

## Verified behavior

Environment: local http://127.0.0.1:8799/, in-app browser. Prior preview processes were absent at this checkpoint; a fresh owned server was started. No owner case was overwritten. Desktop screenshot width 1280; mobile device emulation 390×844 was restored after checking.

| Check | Result |
| --- | --- |
| Page identity / nonblank / framework overlay | Correct ReMatter page and functioning controls; no error overlay |
| Browser console | No warning/error entries in checked flows |
| Layout | Fixed an initial source grid crushing the result in the narrow workspace; source exploration now focuses full width. Mobile client/scroll widths both 390 |
| Source target comparison | Minimum-only 25 MPa → highest recorded matching level 20%; minimum26 → virgin control only, no recipe suggestion |
| Ingredient arithmetic | 1+4=5 kg at20%; 1e-8+4e-8=5e-8 kg retains nonzero display; edit clears result |
| Trial handoff | Live selected trial remains visible in measurement entry; property/method copy works without supplying readings or target values |
| Entered reading comparison | Explicitly synthetic26/22MPa at20/40mass%, minimum25/no maximum →1/1 and0/1; grouping unknown retained |
| Follow-up retention | Actual completed Meta answer retained original chosen route/trial; response explicitly says synthetic values cannot select real resin proportions |
| Stale pending help | Start comparison help, edit a reading → comparison/confirmation clear, request stops and visible notice names old comparison; no unrelated discovery request is cancelled |
| Numerical checks |325 Python tests passed, including null-upper-bound precision and HTTP tests |
| Frontend / source checks |Production build, four frontend check groups, research-source hashes/cells and diff check passed |

Actual request/measurement records: [material follow-up](../examples/material-decision-20261102/live-next-material-move.json), [synthetic entered comparison](../examples/material-decision-20261102/synthetic-trial-comparison.json). The material discovery and selected trial took about38.7s and18.5s; the synthetic comparison follow-up took34.5s. These are integration diagnostics, not a user study or latency guarantee. The retained trial follow-up predates the later concise-question and stale-request UI repair; the final build's pending cancellation was separately exercised. A fresh [source-informed request](../examples/material-decision-20261102/live-source-informed-advice.json) completed in35.8s in the revised interface with a concise question label and directly visible answer. It supplied no dose or property prediction for the unknown grades. That captured answer still mentions assembled weights because its prompt explicitly requested avoiding that detour; the unnecessary reference was removed from subsequent prompts.

Local screenshots and original downloads are under outputs/material-decision-20261102. They include the full source decision, source ingredient calculation, synthetic result, mobile trial and stale-request notice. Outputs remain private and are not part of a public release.

## Remaining work and verdict

At this historical checkpoint the replacement video was unfinished. The subsequent locally narrated material-action cut and new trial workflow are recorded in [the current handoff](MATERIAL_TRIAL_HANDOFF.md) and production record (not included in this export). The old CAPTCHA is no longer needed.

The source comparison and ingredient arithmetic are straightforward. They do not demonstrate unique AI intelligence. Real Meta proposals, a connected trial loop and correct comparisons do not establish a validated formulation, finished-product consistency, real-world impact or a general advantage over a spreadsheet or ordinary chat. A distinctive observable benefit and a coherent final recording remain unproved. Do not mark the prize-contender goal complete or publish/submit anything from these checks.

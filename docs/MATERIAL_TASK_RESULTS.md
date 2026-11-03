# Full material-task diagnostic — v1 results

**The frozen diagnostic does not demonstrate an advantage for ReMatter.** Capable ordinary Meta with the same actual calculator/data outputs completed all four reviewed checkpoints. The production workflow completed two, was partial on one, and returned no usable contextual advice on one. All material identities, process labels and readings are synthetic; no material or product was physically tested.

| Arm | Usable model responses | Reviewed checkpoint outcomes | Sum of recorded request-stage time |
| --- | ---: | --- | ---: |
| Ordinary Meta + same tool outputs | 5 of 5 | 4 pass | 178.173 s |
| Production workflow | 4 of 5 | 2 pass, 1 partial, 1 uncompleted | 264.500 s |

These are five planned calls per arm: discovery, selected-route trial, then three contextual reviews. Both arms used the configured `muse-spark-1.3`, high reasoning for advice, medium for trial, and the same 8,192-token limit. Arm order alternated at each substage. There were no retries or post-result changes to the frozen task, prompts or harness. Times include each model call and local wrapper work; they are not human workflow times or a statistically meaningful latency result.

## What the task showed

| Checkpoint | Ordinary arm | Workflow arm |
| --- | --- | --- |
| A: choose and develop a controlled proportion trial | Pass: concrete comparison, fixed context, target retained, conditional facility work | Pass: same required behavior; target quotes passed production validation |
| B: matching synthetic readings and a new composition trial | Pass: uses the supplied 35 percent candidate and 0.44 kg addition without claiming strength | Uncompleted: client rejected a provider length-truncated response after 62.738 s. The correct deterministic calculation remained available, but contextual advice did not complete. |
| C: input known only as 43–47 percent | Pass: explicitly requires verifying the actual portion's fraction before selecting its dose | Partial: correctly recognizes no fixed dose, but proposes endpoint planning without clearly requiring characterization of the actual fraction before choosing an addition |
| D: new stock U has unknown PCRPE fraction | Pass: no dose; requests U's fraction, does not inherit stock A's zero | Pass: same; also identifies the possible fixed-identity conflict introduced by stock U |

Both arms received exactly the same actual comparison and composition-calculation results. The preferred 35 percent point was a scripted operator choice based on the user's preference among the entered matching levels, not a model discovery. Independent Decimal checks confirm 0.44 kg for a 1.4 kg portion at 46 percent diluted by zero-PCRPE stock to 35 percent. The endpoints 43 and 47 percent require 0.32 and 0.48 kg respectively, proving no one fixed dose reaches the exact point across that range. Stock U's missing fraction blocks numerical addition. Correct supplied arithmetic does not count as AI superiority.

## Quotes that determine the review

Both trial plans retained the original material-screen target and separated it from unfinished sleeve requirements. The ordinary plan compared the three proposed levels “under fixed resin identities, preparation, P1 and M1.” The workflow trial said “These are target labels only; issue no gram additions now.” Both structured target checks passed.

At B the ordinary answer correctly said: “This is composition arithmetic only and does not predict strength, density or consistency, and the new 35% mix inherits no prior readings.” The workflow instead returned `MetaValidationError: Meta's response was cut short. Try a shorter brief or question.` The frozen transport raises that error when the provider reports `finish_reason: length`. The actual request/error are retained; the transport exposes no rejected response body or usage metadata to the harness. No stored answer or fabricated success replaced it.

At C ordinary Meta required: “Only after its exact PCRPE-A % is verified for that specific portion, weigh the exact PE stock A addition to reach exactly 35.0%”. The workflow's lead action was to “plan two separate PE stock A additions — one for each end — to target exactly 35%.” Its alternative said to revisit the reference portion by “splitting or re-weighing at a suitable facility if tighter input definition becomes possible.” Endpoint calculations can illustrate sensitivity, but do not identify the actual fraction of this uncertain portion. Splitting or reweighing the total mixed portion alone does not establish its PCRPE fraction. The whole response, including routes and questions, was reviewed; a correct infeasibility flag alone was not counted as a completed useful action.

At D both arms withheld a numerical addition. The workflow explicitly asked for “the measured PCRPE-A mass fraction of PE stock U, with its basis and uncertainty.” It also flagged that U might change the fixed material identity. That useful observation was not added as a new scoring criterion after seeing it.

## Limits and implications

This is a non-blinded developer review of one visible, developer-authored task with four dependent checkpoints. It does not measure actual browser persistence, user review, human time, ordinary-chat entry burden, general reliability or unseen generalization. Each arm retained its own successful earlier history; after the workflow's B failure it had no B advice in the C/D context, while the current case and tool facts remained equally available. The raw artifacts retain those differences.

The 25 MPa criterion is a chosen material screen, not a derived finished-sleeve requirement. The task neither qualifies sleeve fit, creep or weathering nor supplies data for the owner's metal-dust mix or acoustic sheet. It also does not establish a practical assay for recycled provenance in an unknown PE mixture. Hypothetical fractions supplied as software inputs are not material characterization.

Ordinary Meta reported 40,654 total tokens across its five usable responses. Workflow reported 42,315 across four usable responses; the truncated request's usage is unavailable, so those totals cannot compare complete billed cost. The workflow's generated guidance also restricted some steps to computer-only even though weighing capability was stated. The ordinary prose was verbose and exposed an internal validation field at D. These are usability observations, not newly added pass/fail criteria.

The observed length failure is consistent with the follow-up path requesting another large set of material and engineering alternatives for a narrow question about an existing calculation. That is a repair candidate, not a proven cause or a reason to erase this result. A compact contextual response and clearer fraction-characterization guidance must be a separate implementation and separately recorded regression. The original goal's material-task advantage gate remains unproved, and prize-worthiness is not established.

[Frozen protocol](MATERIAL_TASK_PROTOCOL.md) · [Fixture](../examples/material-task-v1.json) · [Hash lock](../examples/material-task-v1-lock.json) · [Complete actual run](../examples/material-task-v1-live.json) · [Quote review and summary](../examples/material-task-v1-review.json) · [Harness](../scripts/benchmark_material_task.py).

All frozen invoked-source hashes matched at run completion. Production code corresponds to private implementation `8cddc74`; the recorded checkout HEAD was the subsequent documentation-only `98568f0`. The protocol, fixture and harness were frozen as working-tree files before the calls. Nothing was published or submitted.

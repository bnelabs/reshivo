# Adaptation comparison protocol

Protocol version: `engineering-v1`, registered 1 November 2026 before this harness's first live benchmark call. The nine inputs and scoring rules below are fixed before the comparison. Generated records belong in ignored `outputs/`; the repository remains private. A later protocol change needs a new version and a fresh complete run, retaining the earlier failures.

This comparison concerns a synthetic bounded mass model. It does not establish physical suitability, material qualification, recycled-batch consistency, model training, unseen-case generalization or a prize advantage. These deliberately visible diagnostic fixtures are not a held-out test set. No result from a different input or an older API call is a result for this protocol.

## Compared arms and information

1. `plain`: the configured Meta model produces structured JSON without callable calculations. It receives exactly the runner's `_initial_context`: shared brief and recipe details, numeric plan bounds, density minimum/maximum/count and feedback when present. All fixtures contain exactly two distinct density observations, so the extrema preserve both numeric values. Reading identifiers and grouping metadata remain in the local canonical record and actual tool results; the plain output identifies volumes by supplied density value. Plain also receives the equations and uncertainty conventions below. It can inspect and revise its own answer, without grading or calculator feedback, until it says its answer is final or reaches the common limit.
2. `tools`: a deterministic policy uses the existing adaptation and mass-feedback calculations. It prefers a common fixed volume when feasible, otherwise per-observation volume, otherwise a checked minimum-capacity proposal when capacity alone resolves every failing observation, otherwise a request for changed constraints. Supplied assembly feedback takes precedence over the density plan. This is the strong elementary baseline.
3. `workflow`: the actual `assist_with_adaptation` runner chooses and executes its allowlisted computations, then presents a supported decision. Its result must identify an executed successful basis calculation from an earlier model turn. Its actual trace is retained. A failed or incomplete presentation is not a completed engineering result.

All arms operate on the same canonical case and allowed changes, and both model arms initially receive identical numeric information. The deterministic tools operate on the complete local canonical record. Plain also receives explicit model equations so missing arithmetic instructions do not handicap it. Different system prompts and the workflow's later executed tool results are intrinsic to the arm. No arm receives reference answers or scoring feedback. Brief text does not assert a feasible result or the expected action. This equivalence depends on the two-reading fixtures; a future multi-reading benchmark must expand the shared model context before claiming matched information.

Both model arms use the same locally configured `MetaClient` model and `low` reasoning effort, at most four calls, 4,096 completion tokens per call (16,384 maximum across the arm), and a 210-second wall deadline. The HTTP timeout is capped by the remaining wall budget. Either arm may finish early. Actual attempts, successful responses, usage, elapsed time and requested token limits are recorded; identical ceilings do not imply identical consumption. Input-token use differs as actual tools add context and is reported, not described as matched. Tools use no model calls. There are no automatic provider retries. Arm order rotates deterministically by case to reduce a fixed ordering effect. Requests and responses run sequentially.

## Fixed synthetic inputs

Every case has target 0.98–1.02 kg, external-volume processed-mix densities, no volume error and, except as stated, zero tare and zero density error. Recipe names and amounts are only synthetic case identity; density is supplied independently, never calculated from ingredients. Observations have explicit identifiers and unknown specimen/batch grouping. Every feedback observation is labelled simulated.

| ID | Inputs that differ | Required decision |
| --- | --- | --- |
| `fixed_feasible` | Densities 2, 2.02 g/cm³; capacity 1,000 cm³; baseline 500 cm³ | `keep_fixed`; a single volume must satisfy both observations |
| `adjustable_volume` | Densities 2, 4; capacity 750; baseline 250 | `adjust_volume`; separate volumes must satisfy both observations |
| `capacity_repair` | Densities 2, 4; capacity 300; baseline 250 | `increase_capacity`; minimum usable capacity 490 cm³ and a rechecked feasible plan |
| `wide_density_error` | Densities 2, 4; capacity 750; baseline 250; density error ±0.2 g/cm³ | `request_changes`; more capacity alone cannot resolve the uncertainty bounds |
| `overweight_tare` | Densities 2, 4; capacity 750; baseline 250; tare 1.1 ±0.01 kg | `request_changes`; larger capacity cannot remove tare mass |
| `feedback_add` | Base adjustable-volume case; assembly mass 0.95 ±0.005 kg; add/remove limits 0.1 kg each; correction error ±0.005 kg | `add_mass`; feasible command interval 0.04–0.06 kg, midpoint +0.05 kg |
| `feedback_remove` | Same, assembly mass 1.05 ±0.005 kg | `remove_mass`; feasible signed command interval −0.06 to −0.04 kg, midpoint −0.05 kg |
| `feedback_limited` | Same as add, but maximum addition 0.01 kg | `request_changes`; the allowed correction cannot reach the target |
| `feedback_keep` | Same, assembly mass 1 ±0.005 kg | `keep_mass`; zero correction incurs no correction error |

## Model and independent grading

For a nonzero nominal fill volume V, evaluate every corner of tare ± tare error, density ± density error and V ± volume error. Mass in kg is `tare + density_g_cm3 * actual_volume_cm3 / 1000`. Both mass limits and actual volume `[0, capacity]` must hold. Zero fill contains tare only. Feedback evaluates every observation-error and correction-error corner; a signed positive correction adds mass, a negative correction removes it. Actual correction must remain within `[−max_remove, max_add]`; no-operation incurs zero correction error. The feedback model checks mass only.

The grader does not call the production solver to obtain expected answers. It evaluates forward corners and uses monotone bisection to obtain feasible intervals and minimum capacity independently. Absolute numeric comparison tolerance is `1e-9`. A feasible volume or correction is accepted throughout its permitted interval: a midpoint is a reproducible reference, not a unique physical optimum. The capacity question specifically asks for the minimum, so 490 cm³ must be reproduced within tolerance. Extra unsupported fields, nonfinite numbers, booleans in numeric fields and missing or duplicate density coverage fail structural or numeric checks.

`action_correct`, `numeric_correct` and their conjunction `engineering_correct` are separate. `completed` means a structurally usable final decision; it does not imply correctness. Provider availability is reported separately: configuration, request failure, unusable response, successful response and local budget exhaustion do not become engineering losses in an availability-conditioned rate. End-to-end completion/correctness still includes every attempted case and arm, so failures remain visible. The stored status and error category retain incomplete runs. Report both denominators; do not omit failures or describe a blocked baseline as a numerical defeat.

Workflow scoring extracts numeric commands from its referenced actual tool trace, independently checks them, and records the answer as unverified model prose. No semantic verification of arbitrary prose is claimed. Plain uses JSON fields `action`, `fixed_volume_cm3`, `volumes_cm3`, `proposed_capacity_cm3`, signed `adjustment_kg`, `answer`, and `final`; unused numeric fields are null and unused volume lists empty. Each volume entry contains `density_g_cm3` and `volume_cm3`. The deterministic arm returns the same decision shape and retains executed results. Tools and workflow must both actually recheck a proposed capacity.

User interactions, physical steps and operator effort are not measured here. Do not infer fewer user steps from a function-call count. Tool calls, model calls, latency and numeric correctness are observations of this harness only. The deterministic optimizer already solves these elementary problems; equal numerical performance is not an optimization advantage for Meta. A claimed advantage requires observed evidence beyond this protocol, or a clearly bounded measured difference this protocol actually records.

## Execution and interpretation

Run `python scripts/benchmark_engineering.py --offline` for all nine deterministic cases with no network. The default is also tools only. Use `--mode all` explicitly for the full comparison. `--cases fixed_feasible,capacity_repair` selects a diagnostic subset; reports label any subset and never treat it as the completed nine-case benchmark. `--output` may choose an ignored `outputs/` artifact; otherwise a timestamped path is generated there. Live records include the protocol, script and case-definition SHA-256 hashes, configured model, budgets, exact canonical requests, independent references, actual results and per-arm measurements. No credentials are printed or saved.

The CLI emits one concise progress line per finished arm and atomically checkpoints its artifact after every arm. An interrupted checkpoint has `execution_complete=false` and cannot count as a complete matched run. Protocol, harness and the runtime engineering, adaptation and Meta transport source hashes are captured before execution. A resumed or corrected run uses a new artifact; retain the earlier actual records.

The earlier unknown-material prompt's provider content-filter rejection remains a separate observed availability result. This protocol is a legitimate new benign synthetic numerical task, not a rewording to bypass that rejection. A rejection on these cases is recorded and is not retried with altered wording. There is no fallback to a different provider or fabricated response.

Publish all nine outcomes internally before interpreting aggregate results. A successful API call is integration evidence; a complete correct matched comparison is bounded engineering evidence. If tools already match or beat the workflow and no measured workflow advantage appears, say that plainly and leave the advantage gate open.

## Separate follow-on: blind handoff review

This is a preregistered optional follow-on, not part of the numerical score and not an evaluation that has already happened. Complete the fixed numerical comparison first. Do not revise its inputs, outputs or rubric after inspecting an arm's prose. A numerical pass does not establish a good handoff.

Prepare one handoff per completed case/arm with the case context, structured proposed action and numbers, and the arm's final explanation. Include the deterministic calculation's own `recommendation`/`next_options` (or feedback `next_options` and scope) in its handoff, rather than presenting an artificially empty baseline. For a capacity repair include the original and rechecked recommendations and numeric proposal. For incomplete runs, show an explicit incomplete marker; never manufacture a final answer. Strip arm/provider/model names, request IDs, timing, tool-call identifiers and internal function names, while preserving all substantive content and uncertainty. Assign shuffled neutral labels using a saved random seed and retain the hidden mapping separately. No reviewer receives the mapping or numeric aggregate results before submitting scores. If style reveals an arm, record that blinding limitation.

Score the following six criteria independently as 0 (missing or contradicted) or 1 (explicit and correct). Use the canonical inputs and independent numeric reference as the answer key. Mark missing handoffs as missing, report their count, and retain an end-to-end denominator across all attempted handoffs. Do not silently condition away failed completions.

| Criterion | Passing evidence in the handoff |
| --- | --- |
| Concrete next action | Says exactly what to keep/change or which constraint needs a supported change; numeric commands match the structured proposal and correct reference |
| Why that action | Connects the action to this case's actual fixed-volume, capacity, uncertainty, tare or observed-mass result rather than generic material advice |
| Preserved case | Keeps the entered target, recipe and process; does not silently change tare, density or measurement bounds or invent material measurements |
| Useful next check | Requests a fresh complete-assembly mass check for any proposed physical change; feedback also preserves the separate occupied-volume check; infeasible cases identify the missing supported change before claiming feasibility |
| Proposal status | Makes a capacity or correction a proposed action, not an applied change or completed physical test; does not claim verified performance or future-batch consistency |
| Scope and uncertainty | Clearly limits the claim to synthetic mass/capacity reasoning; a mass-only feedback result does not establish volume, retention, strength or durability |

Record each criterion, the supporting or contradicting text, reviewer identity/type and review time. Preserve independent first scores and any disagreement before an adjudicated score. A single reviewer is an exploratory assessment; report that limitation and do not describe it as a user study. Automated blind review, if later used, needs its exact prompt/model/configuration and is not physical or human validation. No reduction in user work, user steps or task time can be inferred from these semantic scores. Any such claim requires a separate observed task comparison. Until actual blind scores and limitations are recorded, claim no semantic or handoff advantage.

# Combined comparison of entered checks and costs

`compare_project_decisions(request)` in `reshivo.decision_comparison` joins independently recalculated trial checks and manufacturing-cost calculations. It makes no provider calls. This is a software decision about recorded inputs, not physical qualification, a predicted future outcome or an optimized recipe.

## Input and bindings

Supply exactly `{case_id, configurations, checks, records, assessment_kind, cost_records}`. The first five fields have the contract of [`TRIAL_RECORDS.md`](TRIAL_RECORDS.md); `cost_records` is a list of [`MANUFACTURING_COST.md`](MANUFACTURING_COST.md) records. `assessment_kind` must be `synthetic` or `user_reported`. Cost entries are user-provided numerical assumptions; neither source label independently verifies them.

All trial context is validated and its assessment computed inside the function. Cost inputs are independently validated against that exact case, the latest captured configuration revision and all captured material IDs, names, amounts and units. Foreign cases, stale revisions, changed ingredients under the same revision, duplicate cost entries, unsupported fields or forged precomputed outputs raise `ProductInputError`. Old configuration versions and their readings remain historical; they never fill a current check. Synthetic readings cannot fill a user-reported check, or vice versa. Group IDs are retained within original records; no group is inferred as a batch.

## Selection

For each current setup, the response returns its original captured identity, all required and optional property check states and records, whether its entered required readings are in range, and its freshly calculated cost. Ranking requires:

1. At least two complete, current cost records, one for every current setup, with the same case, currency, product and function, included/excluded cost categories, declared scope, usable-output definition and actual/planned mode.
2. Every required check for every current setup has a defined target and at least one matching, reviewed record. An unreviewed record blocks selection even when another reading for that check is outside the target. Optional checks stay visible but do not block required checks.
3. Each setup considered for selection has every required entered reading inside its own target. A cheaper setup with a required reading outside its target cannot win.
4. The selected metric (`per_usable_unit`, `per_usable_kg`, or `per_usable_m2`) has a positive, explicitly entered usable-output denominator for **every** current setup. An unknown or zero denominator never becomes a zero-cost item.

The lowest exact rational cost is selected only among setups that satisfy their entered required checks. Exact ties return all tied IDs. The separate cost-only winner is not exposed by this operation, because it could be outside a required target. Missing or incomparable costs, missing/unconfirmed readings, undefined targets or no required checks produce no selection. If all assessed setups miss a required target, no setup is selected. No weighting trades one physical requirement against another.

## Output

`status` is `ready` when at least one metric has a selection; otherwise it is `needs_more_information`. `configurations` contains each current setup and its independent `checks`, full grouped records and cost result. `decisions` maps each of the three unit-cost metrics to null or `{configuration_ids, tie, cost, exact_cost}`. `cost_comparison` contains comparability and reasons, not a cost-only winner. `reasons` explains shared blockers; `ignored_records` preserves stale/other-kind record identifiers and reasons.

`performance_verified`, `physical_product_tested`, `future_consistency_predicted` and `causal_effect_established` are always false. Labels in a UI must say this compares the entered setups and readings, with the entered cost scope. A current result does not establish that the physical product consistently meets targets, that a quantity can be made, or why co-varying setups differ.

When advisor help or follow-up includes both project context and saved cost records, the service independently computes this combined comparison after normal request validation. The generated request receives a compact `decision_assessment`, including current setups, per-check states, blockers and eligible cost decisions. It does not receive a cost-only winner that might fail a required property. Historical or other-kind readings remain outside the model prompt. The response retains the full generated comparison for UI binding; the model's language remains a proposal and can still make mistakes. Requests without both contexts retain the earlier contract.

Run the focused checks with `python -m unittest discover -s tests -p test_decision_comparison.py -v`. These cover a cheaper failing setup, missing and unreviewed records, source separation, stale versions, optional failures, exact ties, missing output, scope mismatch, recipe binding and grouping. HTTP, visual presentation and live model behavior need separate verification.

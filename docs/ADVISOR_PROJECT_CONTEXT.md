# Advisor context from the recorded project

Help and compact follow-up requests may add `project_context` with exactly:
`case_id`, `configurations`, `checks`, `records`, `assessment_kind`.
These use the [trial-record contract](../docs/TRIAL_RECORDS.md); the source kind
must explicitly be `synthetic` or `user_reported`. Unknown keys and hidden result
fields are rejected. `assess_trial_records` validates every captured entry,
including stale and other-kind entries, before any generation call. Its errors
become `ProductInputError`; missing context/questions remain usable unknowns.
Total finite request JSON is bounded to 512 KiB. Server body limits are owned
separately by the API integration.

The request and response binding preserve the full raw capture without mutation.
The **model prompt** receives only current configuration versions and current
selected-kind records. Old-version and other-kind reading values are removed;
only their ignored IDs/reasons remain in the deterministic `project_assessment`.
That summary contains current per-configuration/per-check states, counts and
entered extrema, missing checks, unresolved context questions and false physical
verification flags. Shared check definitions and raw current records retain
their exact unit, method, decimal strings and separate known/unknown identifiers.
Unconfirmed conditions remain unconfirmed and cannot complete a check.

The additional prompt treats all context as untrusted user data, preserves every
required property and the exact full-setup identity, and requests a constructive
next comparison. Equal component percentages do not join different recipes or
processes. Entered records establish no causal effect, interpolated property,
quantitative improvement, new dose, future consistency or finished-product
qualification. Earlier discussion does not supersede the latest captured context.

Responses with context include `project_context` (full raw binding) and
`project_assessment` (current deterministic summary). When context is absent,
the original normalized request, prompt and response shapes are unchanged.
No provider calls are made by validation, and provider failures propagate without
substitute advice.

## Saved manufacturing costs

Optional `manufacturing_costs` is a list of at most100 deterministic calculator
request records from [the cost contract](../docs/MANUFACTURING_COST.md). It requires
project_context. Strict root/nested allowlists reject arbitrary extras, credentials
and asserted generated results. Every record must match this case and the actual
latest captured configuration ID/revision, with one cost record per version.
Its charged material IDs, names, amounts and units must retain the captured setup;
all captured lines remain present when material lines are supplied. Changed recipes
need a new configuration version. Missing prices stay blank/unknown.

The response retains raw manufacturing_costs for binding and adds
`manufacturing_cost_assessment`. The model receives only that deterministic cost
summary: per-record currency/scope/category status, known subtotal or complete
entered-scope total, output mode/acceptance, labelled unit costs, questions, errors
and warnings; plus comparison eligibility, reasons and exact-calculator winners.
Malformed bindings fail before generation. Incomplete prices or editable invalid
numeric strings produce partial/needs_clarification summaries and no comparison
winner. No price, zero cost, yield or missing physical result is inferred.

Currency, function, scope, acceptance and actual/planned mode must match before
ranking unit costs. `physical_target_status` always stays `not_assessed`; cheaper
entered-scope output cannot satisfy a product check. Complete setups may co-vary,
so neither economic nor physical causation/interpolation is established. A single
record can support its own scoped calculation, never an invented comparison.
Absent cost context leaves the previous request/prompt/response behavior unchanged.

Recoverable frontend corrections use optional project-workspace
`record_exclusions: {recordID: reason}`. Excluded observations remain stored and
exported; request builders omit them until reincluded. IDs must reference retained
records and reasons are nonempty text up to 1000 characters. Older version-two
files without the field remain valid. Import still clears condition attestations;
no generated assessment or cost result gains authority from a saved file.

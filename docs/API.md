# Local API contract

Default server: `http://127.0.0.1:8797`. The built frontend is served from `web/dist`; development frontend uses port 5178 with `/api` proxying to port 8797. JSON request/response bodies. Errors use `{ "error": { "code": "...", "message": "..." } }`. No credentials in responses or saved results.

## Workshop API

The main workshop accepts a variable-input brief, desired product/use case and physical targets, then returns conditional engineering proposals. Missing measurements can inform routes and the next check; the model must not invent property values or verified performance. All live help is user initiated.

### GET /api/advisor/status

Returns `{ "configured": true, "model": "..." }`. `configured` reports whether server-side credentials are present. It does not prove a live request has succeeded. No key is returned.

### POST /api/advisor/help

Request: `{ "brief": {...}, "question": "...", "history": [...] }`.

`brief` contains exactly these eight string fields, each at most 3000 characters:

| Field | Meaning |
| --- | --- |
| `input` | Available material, amounts and form; required. |
| `variation` | What changes across inputs or batches; may be blank. |
| `contamination` | Named contamination and amount when known; may be blank. |
| `product` | Desired product; required. |
| `use_case` | Where and how the product will be used; required. |
| `targets` | Physical properties and target ranges; required. |
| `process` | Available equipment and process constraints; may be blank. |
| `available_changes` | Changes or additions the user can make; may be blank. |

`question` is a nonempty current request, at most 3000 characters. The initial workshop action supplies a request for practical routes. `history` contains at most six earlier messages, each exactly `{ "role": "user" | "assistant", "content": "..." }`; content is limited to 6000 characters. The frontend sends a bounded recent summary, not a persistent server-side chat. Editing the brief clears its old plan and discussion.

Both help and trial requests may include `calculation_context`, the shared case details. It contains exactly `label` (text, at most 120 characters), `components` (1–20 entries), `amount_unit` (`g`, `mass_percent` or `volume_percent`), `amount_basis` (text, at most 300), `mass_target_min_kg` and `mass_target_max_kg` (text, at most 80 each). Every component contains `id` (unique positive integer), `name` (text, at most 120), `role` (`main`, `binder`, `other`) and `amount` (text, at most 80). Blanks are allowed because a brief can be incomplete. The advisor preserves these strings rather than inferring a complete composition or measurements. Supplied context is normalized and echoed in the result. Conflicts with the prose target must be identified rather than silently overriding a limit; trial check targets still quote the original brief.

A successful response contains:

- `result_kind: engineering_proposals`, `live`, `provider`, `model`, usage/timing and request metadata.
- `answer`, two or three `material_routes`, and two or three `engineering_routes`.
- Each route has `id`, `title`, `change`, `why`, `steps`, `tradeoffs` and `check`.
- `next_steps`, up to three essential `questions`, and `sources` selected from the server's curated allowlist, each with a title, URL and scope.
- `physical_product_tested: false` and `performance_verified: false`.

The brief and history are context for a live Meta request. Only supplied source IDs are accepted in the response; background references do not establish that a route works for the user's mix. No unrestricted literature search, density-mixing rule, source-property transfer or fictitious fallback plan is provided.

Malformed input returns 400. Missing configuration returns 503. Provider failure or invalid structured response returns 502. The current brief stays available in the interface; an error is not turned into a generated plan.

### POST /api/advisor/trial

Explicitly develops one selected route. Request contains exactly `{ "brief": {...}, "route": {...} }`. The brief uses the same eight fields and limits as `/help`. The route contains exactly `id`, `title`, `change`, `why`, `steps`, `tradeoffs` and `check`, as returned by `/help`; its ID starts with `material:` or `engineering:`. These are case context, not measured facts or instructions overriding the planning rules.

Response contains `result_kind: trial_proposal`, live/provider/model/request metadata, `route_id`, normalized `brief`, the full `selected_route` and server-echoed original `targets`. The generated fields are:

- `title`, `objective`, `comparison`, `change`.
- `keep_fixed` and `materials` lists.
- `steps`: ordered `{ "action": "...", "record": "..." }` pairs.
- `checks`: `{ "property": "...", "target": "...", "method": "...", "if_outside": "..." }` entries.
- Up to three `questions` and allowlisted scoped `sources`.
- `physical_product_tested: false` and `performance_verified: false`.

The plan develops the supplied route rather than returning new alternatives. Each check's `target` must be a verbatim contiguous excerpt of the original target text or exactly `Not set`; changed or invented target thresholds return `meta_invalid_response`. It proposes a focused comparison and useful adjustments after an observation. Missing amounts and test methods remain explicit; it must not invent doses, process temperatures, physical values or passed results. An accessible comparison cannot establish a property that still needs a matching product test. Error codes follow `/help`. The interface retains the route on failure/cancellation, clears the trial on a changed brief or route, and exports it with the selected route and discovery plan.

### POST /api/advisor/balance-mix

Request contains exactly `component`, `input_mass_kg`, `input_min_percent`, `input_max_percent`, `addition_name`, `addition_percent`, `target_min_percent` and `target_max_percent`. Name the component and added stock; each name is limited to 120 characters. Input mass must be positive, finite and at most 1000000 kg. All percentages are finite mass percentages from 0 to 100; input and target minima must not exceed their maxima. The target is a **user-chosen trial composition**, not a physical-property target.

For input mass `M`, entered component fraction `f` and addition fraction `c`, an added mass `w` gives `(M*f + w*c) / (M + w)`. The tool finds one non-negative added-mass interval that fits the trial range for every `f` between the entered input endpoints. Fractions use one mass basis and are supplied by the user; no binder amount is inferred from strength, density or another property.

Response: `result_kind: composition_calculation`, entered fields, `feasible`, `addition_min_kg`, `addition_max_kg`, `example_addition_kg`, `exact_addition_kg`, `resulting_min_percent`, `resulting_max_percent`, `action`, `next_options`, `assumptions` and `physical_performance_verified: false`.

When feasible, a null `addition_max_kg` means the composition check has no finite upper addition bound. If the input already fits the trial range, `example_addition_kg` is zero. When infeasible, all derived addition amounts and resulting percentages are null; constructive options suggest measuring the portion, blending characterized stocks or reviewing the trial range. Entered values are retained. `feasible` describes composition arithmetic only, not compatibility or product performance.

For a feasible result, `exact_addition_kg` contains `min`, `max` and `example` as reduced `{numerator, denominator}` integer strings; `max` is null when unbounded. For an infeasible result the whole object is null. These bounds and feasibility use rational arithmetic over the canonical decimal spellings of the validated, JSON-decoded numerical values. They do not recover extra precision lost when a JSON number was decoded or represent physical measurement precision. The existing numeric result fields remain approximate floats for compatibility.

The calculation assumes representative fractions and no losses, reactions, moisture change or incomplete mixing. It is deterministic, makes no model call and uses no density. Invalid requests, including unsupported numerical ranges, return 400.

### POST /api/advisor/mass-trim

Request: `{ "current_mass_kg": ..., "target_min_kg": ..., "target_max_kg": ... }`. Use the **weighed complete assembly**, including its enclosure and fittings. Masses must be finite, non-negative and at most 1000000 kg; the maximum target must be positive and no smaller than the minimum.

Returns `result_kind: calculation`, entered masses, `status` (`add`, `remove`, `inside`), `action`, `adjustment_min_kg`, `adjustment_max_kg`, `adjustment_to_midpoint_kg` and assumptions. An assembly already in the target has zero correction. Invalid requests return 400.

This route is deterministic and makes no model call. It uses no density. The correction assumes only mass is added or removed; reweigh after adjustment. Scale uncertainty, retention, strength and durability are outside the calculation.

## Bounded input adaptation

### POST /api/adaptation/plan

Request contains exactly `case` (the processed `MixCase` used by My mix), `data_kind` (`user_measurements`, `synthetic`, `source_replay`), `observations` (the existing individual `MixReading` format), `tare_mass_kg`, `tare_uncertainty_kg`, `target_min_kg`, `target_max_kg`, `max_fill_volume_cm3`, `baseline_fill_volume_cm3`, `density_uncertainty_g_cm3` and `volume_tolerance_cm3`. Source replay additionally requires `source: {title, url, license, scope}`. The caller supplies that metadata; this numerical operation does not fetch or verify the source. Density and calculation volume must both use external volume, including the measured specimen's pores.

Numbers are finite, non-negative and at most 1000000; capacity, maximum target and density must be positive, with a lower supported bound of 1e-9. Target bounds must be ordered, tare uncertainty cannot extend below zero, baseline nominal volume cannot exceed capacity and density intervals must stay above zero. Group labels retain their existing meaning; observations are not automatically independent specimens or batches.

The model is `assembled mass = tare + processed-mix density × external fill volume / 1000`. It compares the baseline volume, the intersection of fixed-volume intervals across entered observations and separate adjustable intervals for each observation. Tare, density and volume error are explicit deterministic bounds, not inferred confidence intervals. A zero-fill command has no filling-volume error. Capacity constrains occupied external fill volume, including its declared error.

Response: `result_kind: simulation`, model name, case and plan fingerprints, normalized original request, provenance, fixed-volume result, per-observation baseline/adjustable results, counts, recommendation, constructive next options, assumptions and false physical-test/future-batch flags. An infeasible interval has null derived values; it is not replaced with an invented volume. If tare alone fits, the result states that zero fill does not meet a separate recycled-material reuse objective. This route makes no model call.

### POST /api/adaptation/feedback

Request: `{plan, plan_fingerprint, observation: {id, kind, mass_kg, uncertainty_kg}, max_add_mass_kg, max_remove_mass_kg, adjustment_uncertainty_kg}`. `plan` is the complete original normalized plan request; its fingerprint must match. Observation `kind` is explicitly `user_reported` or `simulated`. Changed case, target or density observations require a new plan. Addition/removal limits describe available adjustable mass; removal cannot exceed the lower observed assembly-mass bound.

The returned simulation contains a feasible signed correction interval and chosen midpoint, or null corrections with useful next choices. Positive means add and negative means remove. The calculation reserves actual adjustment capacity for adjustment uncertainty. No correction is needed when the observed mass interval already fits; a no-operation result incurs no adjustment error. It explicitly reports `mass_only: true` and that occupied volume is not checked from mass. Reweigh after an actual adjustment; retention, durability and future performance remain outside the result. Invalid requests return 400. The standard local Host, Origin, size and concurrency guards apply to both adaptation routes.

### POST /api/adaptation/assist

Request: `{brief, calculation_context, question, plan, feedback}`. `brief` and `calculation_context` are the canonical shared case; `plan` is the complete request above. `feedback` is null or `{observation, max_add_mass_kg, max_remove_mass_kg, adjustment_uncertainty_kg}`. Recipe components, amounts, units, process, case label, amount basis and numeric mass limits must agree before any remote call. A mismatch returns 400. The nonempty question is at most 3,000 characters.

For a weighed assembly, `plan` may instead be null when complete identified `feedback` and the shared numeric mass limits are supplied. This mode does not require recipe amounts, density, a processed-mix volume basis or a research dataset. `check_mass_feedback` executes the direct mass-only model below. Volume tools return `need_density_plan` without inventing inputs or adding a fake calculation trace.

This explicit generation action uses the configured server-side Meta client. The allowlist is `compare_current_design`, `check_capacity_repair`, `check_mass_feedback` and `present_recommendation`. Computation arguments are empty: the model cannot replace the user's numbers. Capacity repair requires a prior comparison and capacity-only failures, and rechecks a proposed larger capacity without applying it. Missing assembly feedback returns a focused request rather than an invented observation. Calls are bounded to four model turns, six actual computations, 4,096 completion tokens per turn and 210 seconds between operations, with transport timeouts and bounded summaries.

Response: `result_kind: tool_backed_proposal`, `status` (`completed`, `limit_reached` or `provider_error`), live/provider/model metadata, actual `tool_trace` including inputs/results, turns/usage/request IDs/time and original bound requests. Bounded `model_trace` retains actual messages, sent tool summaries and exact rejection reasons; oversized records have explicit truncation metadata. Tool summaries identify their own `execution_call_id` separately from a capacity proposal's earlier `source_call_id`. A completed response includes the actual model `answer` (`answer_verified: false`, `answer_kind: model_proposal`), supported `decision` and a separate deterministic `verified_summary`. The decision must reference the latest actual computation inspected in a previous turn. Free text alone cannot complete a run. A supported action is not semantic verification of arbitrary model prose. No physical-performance or batch-consistency claim follows.

An initial provider/configuration/response failure returns the existing typed 502/503 error. A later failure returns a partial run with its actual trace, `answer: null` and no completed decision. There is no fallback or fabricated successful trace. Standard Host, Origin, body-size and concurrency guards apply. The UI can stop waiting; this does not cancel an already running server operation.

### POST /api/adaptation/observed-mass

Request: `{brief, calculation_context, feedback, request_fingerprint?}`. Feedback uses the same explicit observation, uncertainty and add/remove bounds as above. Numeric target limits come only from the shared calculation details. Incomplete recipe details remain permitted because this calculation uses the observed complete-assembly mass, not composition or density.

Response contains the same bounded mass-feedback math, `input_mode: observed_mass_only`, shared context, feedback request and target limits. `plan_fingerprint` and `density_data_kind` are null. The `request_fingerprint` binds all normalized shared context, target and observation data; supplying a stale fingerprint returns 400. The result does not check occupied volume, retention, durability or future batches. No model call is made by this endpoint.

### POST /api/advisor/read-observation

Request: `{brief, calculation_context, note}` with a nonempty note of at most 6,000 characters. One bounded Meta generation returns seven nullable records: observation reference, provenance, complete-assembly mass, weighing uncertainty, maximum add/remove mass and adjustment uncertainty. Every retained field has an exact quote from the note. A quantity needs one adjacent numeric literal and its explicit g/kg unit; code checks the literal/unit and converts to kg. Unknowns stay null/blank. No recipe, density or new target is extracted.

Response: `result_kind: observation_draft`, `review_required: true`, raw quoted `fields`, normalized `assembly_observation`, deterministic `missing_fields`/`questions`, unchanged shared context and original note, actual Meta metadata, `interpretation_verified: false`. Quote checks do not prove correct semantic assignment. The user must review and explicitly apply the draft; applying replaces the prior observation, including its previously known fields that are now missing. It does not calculate or establish a physical test. Invalid extraction/provider/configuration responses use the existing typed error mapping, with no fallback draft. Standard request guards apply.

## Developer calculation endpoints

The original support-member endpoints remain available for developer checks. They are not the workshop's main product flow.

### GET /api/bootstrap

```json
{
  "schema_version": 1,
  "materials": [],
  "config": { "description": "...", "requirements": {}, "search": {} },
  "limits": [],
  "source": { "url": "https://zenodo.org/records/19370161", "license": "CC-BY-4.0" },
  "meta": { "configured": false, "model": "muse-spark-1.3" }
}
```

Material objects use `Material.to_dict()`: `id`, measured modulus/yield, reported specimen SD, specimen count, source URL/license, explicit null density/formulation mapping and missing fields. Never relabel a condition as a verified recipe.

### POST /api/experiments

Request: `{ "material_id": "04441PP-REG(1)-1E1", "scenario": "lower_sensitivity", "requirements": {...}, "search": {...} }`. All requirement/search fields use `examples/support-member.json`; omitted objects use those defaults. Material ID may be `all`.

Response:

```json
{
  "id": "uuid",
  "created_at": "UTC timestamp",
  "requirements": {},
  "scenario": "lower_sensitivity",
  "results": [],
  "exports": [
    {
      "material_id": "...",
      "family": "i",
      "section": { "shape": "i", "width_mm": 30, "height_mm": 29.5, "flange_mm": 3, "web_mm": 2 },
      "evaluation": {},
      "outline": [],
      "stl_url": "/api/experiments/uuid/artifacts/file.stl",
      "design_url": "/api/experiments/uuid/artifacts/file.json"
    }
  ],
  "report_url": "/api/experiments/uuid/artifacts/report.md",
  "results_url": "/api/experiments/uuid/artifacts/results.json",
  "limits": [],
  "meta_model_used": false
}
```

`results` entries are existing `search()` output: material scenario, rectangle/I families, evaluation counts and best section/evaluation or null when infeasible. `exports` includes only feasible, verified geometry. `evaluation` uses volume_mm3, tip_deflection_mm, root_bending_stress_MPa, failed_screens, etc. Every mesh uses XY section and +Z span, in millimetres.

### GET /api/experiments/:id

Return the saved experiment response. Artifact GET routes serve only allowlisted files for a valid saved run. Never expose arbitrary filesystem paths or directory listings.

### POST /api/evaluate

Request: `{ "material_id": "...", "scenario": "lower_sensitivity", "requirements": {...}, "section": {...} }`. Response: material scenario, section, outline and evaluation. No new physical validation is implied.

### POST /api/proposals

Request: `{ "material_id": "...", "scenario": "lower_sensitivity", "requirements": {...}, "max_candidates": 4 }`. One actual Meta generation request followed by local numerical evaluation. Missing credentials return 503 with an actionable message; no fallback provider or synthetic candidates.

Response: `meta.propose_and_evaluate()` output, including provider/model, `live`, usage, candidate sections with their evaluated constraints, and limits. This initial candidate loop is separate from an exhaustive-grid experiment; label the latter a numerical reference, not a matched-budget AI comparison.

### GET /api/health

Health, source availability and nonsecret Meta configuration status. The server binds to loopback by default, validates Host/Origin for API requests and restricts JSON request sizes.

## Optional calculation tools

These optional tools retain narrow numerical contracts. Only `mass` has a My mix property calculation; the separate published target check describes source specimens. The workshop can still propose qualitative engineering routes when a numerical prediction is unavailable.

### POST /api/products/compare-readings

Compare user-entered readings at distinct settings against an inclusive numeric target; this is a descriptive comparison, not a property prediction. It uses no stored studies. The request contains exactly `brief`, `calculation_context`, `property_name`, `property_unit`, `input_name`, `input_unit`, `target_min`, `target_max`, `method`, `conditions_confirmed`, `data_kind`, and `settings`. The shared brief and calculation context use the same shapes as the advisor; the shared material description and process must be nonempty. `conditions_confirmed` must be `true`: the user confirms that the stated base material, product, process, property and method apply across the settings except for the named input. That confirmation is not independently verified.

`data_kind` is `synthetic` or `user_reported`. Enter 2–20 settings with unique `id` and distinct numeric `level`; each setting contains 1–20 readings. Each reading requires `value`, `group_label` and `group_kind`; choose `unknown`, `repeat`, `specimen`, `run` or `batch` as the user-stated kind and enter `Unknown` if no label is known. Optional independent `reading_id`, `specimen_id`, `run_id`, `batch_id` and `repeat_of` fields are nonempty strings up to 160 characters or `null` for unknown. They preserve supplied identifiers without validating references, constructing a hierarchy, assessing independence or inferring batch counts. The legacy kind and label remain descriptive and are preserved as supplied.

All numerical inputs—`target_min`, `target_max`, each setting `level` and each reading `value`—must be **decimal strings**, such as `"0.100000000000000005"` or `"1e-400"`. JSON numeric values are rejected so generic JSON float parsing cannot silently change a reading before comparison. Decimal grammar permits an optional sign, decimal point and scientific exponent; text is limited to 160 characters, exponent magnitude to 10000, and adjusted magnitude to 10000. Nonfinite values, separators, hexadecimal and unsupported text are rejected. Comparisons and duplicate-level detection use exact decimals; extrema are ordered numerically, not lexicographically. The response returns numerical values as the original trimmed decimal strings, including min/max values chosen from the entered readings. A single stated unit applies to every property reading and another stated unit to every input level; no conversion is performed.

The response returns the shared case and input metadata, the entered readings with `inside_target`, and per-setting `observed_min`, `observed_max`, `reading_count`, `in_target_count` and `all_readings_in_target`. `matching_setting_ids` identifies only settings whose entered readings all lie inside the target. These are reading counts, not inferred counts of independent specimens or batches. The entered target is not automatically converted or checked against other target text in the case. No averages, source pooling, interpolation, causal inference, measurement uncertainty, physical qualification, extrapolation or future-batch consistency are calculated. A new case or altered test conditions require a new request and matching measurements. The standard 64 KiB request limit applies.

### POST /api/products/my-mix

Simulate mass from user-entered density readings of one stated processed mix. This route does not depend on the published catalogue and does not combine constituent densities.

Request fields:

| Field | Meaning |
| --- | --- |
| `product_name`, `property` | User's product name; `property` must be `mass`. |
| `case.label` | User's name for this measured case. |
| `case.components` | Named components with `role` (`main`, `binder`, `other`), positive `amount` and `unit` (`g`, `mass_percent`, `volume_percent`). Use one unit throughout the case; percentage recipes total 100. |
| `case.amount_basis` | Stated quantity basis, such as dry or as-received. |
| `case.process`, `case.density_method` | Process used for the measured mix and its density measurement method. |
| `case.density_volume_basis`, `case.calculation_volume_basis` | Matching known definitions: `external_volume`, `solid_volume` or `other`. `unknown` does not support a calculation; `other` needs `volume_basis_details`. No conversion between volume definitions is inferred. |
| `case.volume_basis_details` | Clarification of the volume definition. External specimen volume includes internal pores; a matching solid-volume calculation must use the user's stated solid volume. |
| `readings` | Individual readings with unique `id`, positive `value_g_cm3`, `reading_kind` (`unknown`, `specimen`, `repeat`), optional `batch_id`, `run_id`, `specimen_id` and `repeat_of`. |
| `volume_cm3`, `target_min_kg`, `target_max_kg` | Positive finite entered volume and ordered mass target. |

A specimen reading requires a specimen ID. A repeat points to an earlier nonrepeat reading with the same explicitly stated grouping. Blank group IDs stay unknown. Group identifiers retain their hierarchy; a specimen label reused in another batch is not the same specimen.

The response includes the normalized case and `case_fingerprint`, one `reading_scenarios` mass per input reading, the reading-weighted mean-density mass, observed mass extrema, target count, and descriptive groups under `grouping`. Batch counts and ranges use only explicit user-identified batch IDs; repeated tests never create batches. Unknown-batch reading and repeat counts remain visible. All results carry `result_kind: simulation`, `input_kind: my_mix`, `physical_product_tested: false`, and `batch_consistency_established: false`.

Invalid fields, unsupported properties, incompatible or unknown volume definitions, invalid recipes and invalid readings return 400. Inputs are used for the local response and downloadable JSON, not written to a material database. A recipe, amount, process or measurement-definition change requires a new case and readings; the interface clears previous readings and results.

### Published polyethylene example

`GET /api/products/catalog` returns 17 source-linked recycled-PE density conditions and seven source-group summaries. Raw source measurements and their scope remain separate from predictions. These are published samples, not measurements of the user's waste.

`POST /api/products/counterweight` accepts `condition_id`, `product_name`, `volume_cm3`, `target_min_kg` and `target_max_kg`. The response is labelled `simulation` and includes the selected source condition, five individually scaled source densities, the mean-density mass, observed-source mass range, target count and a conditional volume interval. The interval assumes exact volume and the selected source densities. It is not a batch prediction or finished-product tolerance.

Unknown material IDs, invalid numeric values and unsupported extra fields return 400. Changed or missing checked source inputs return 503. No arbitrary density, acoustic property or contamination effect may be supplied through this endpoint.

### Tested input levels

`GET /api/products/target-series` returns the Cecon source, tensile-yield-stress property and four separate PE-host series. Each series references source conditions at 0/20/40/60/80/100 wt% PCRPE. The shared pure-PCRPE condition is stored once, with ten actual source values.

`POST /api/products/target-check` accepts exactly `series_id`, `target_min_MPa` and `target_max_MPa`. For example, `CECON21-YIELD-MDPE` with 25 and 28 compares that series' ten specimens per level against 25–28 MPa.

The response has `result_kind: source_measurements`, `comparison_scope: recorded_specimens_only`, source/property/series metadata, and six `levels`. Each level includes its condition ID, recycled content, `n`, source minimum/maximum/mean, `values_in_target`, `all_values_in_target` and the ten original observations with source cells and context. `matching_tested_levels_wt_percent` lists only tested levels whose ten recorded values are all inside the target. This is no material interpolation or product forecast. The response carries `interpolation_used`, `physical_product_tested` and `batch_consistency_established` as false.

Targets must be finite, non-negative, at most 1000000 MPa and ordered. Untested-level overrides, other materials/properties and extra fields return 400. Changed or missing pinned source files return 503. The checker uses its own manifest; neither the Râpă comparison package nor My mix supplies fallback values.


## Mass and one-axis balance

`POST /api/adaptation/balance` accepts exactly `{brief, calculation_context, feedback, balance}` and an optional `request_fingerprint`. `feedback` is the existing complete-assembly mass observation and total add/remove/error bounds. No density plan or recipe is required. `calculation_context.balance` carries `{coordinate_basis, target_min_mm, target_max_mm}` as shared strings alongside the existing numeric mass target strings. The coordinate text identifies a common axis and datum.

`balance` records numeric `cg_x_mm`, `cg_uncertainty_mm`, `command_resolution_kg`, `independent_adjustments: true`, exactly two `positions` and a `baseline`. Each position has `id`, `x_mm`, `position_uncertainty_mm`, `max_add_kg`, `max_remove_kg`. Its coordinate means the actual added/removed portion's mass centre, not an inferred hole centre. The shared adjustment-error bound applies independently at each active location only after explicit acknowledgement. `baseline` names a `position_id` and signed `command_kg`; the interface sends zero for an omitted optional comparison.

The normalized shared wrapper and fingerprint bind the case, targets, observation and geometry. The response is `result_kind: simulation`, model `two_position_mass_moment_v1`, request, baseline flags/ranges, feasible/status, actual checked commands, result ranges, selection, scope and `layout_svg`. Finite uncertainty corners check both targets and local/total stock limits. The planner first preserves no adjustment or an already-fitting entered baseline; otherwise it checks a midpoint/vertex candidate at the entered increment. It makes no global optimum claim. `precision_limited` means a bounded nearby-grid search found no checked command despite continuous feasibility, not proof that every grid point fails.

`POST /api/adaptation/assist` also accepts optional `balance` with the same configuration and complete shared mass feedback. Meta can call `check_mass_and_balance`; `adjust_balance`/`keep_balance` must reference the latest actual joint check. A mass-only result is rejected as completion for both targets. Model prose stays unverified and separate. All routes retain loopback Host/Origin, body-size, work-slot and stale-fingerprint guards. Neither route establishes material response, enclosure strength, tipping safety or future batches.


## Reviewed engineering-note intake

`POST /api/advisor/read-engineering-note` accepts exactly `{brief, calculation_context, note}`. The note is at most 6,000 characters. One bounded Meta call drafts 25 nullable fields with exact note/brief-target excerpts, signed spatial units and kg/mm normalization. It never changes the case or calculates. The response retains `source_fields`, checked `fields`/`values`, current/proposed target resolution, conflicts, focused missing questions, both fingerprints and actual provider metadata. Existing numeric targets stay canonical; unclear/absent values stay null.

`POST /api/adaptation/apply-engineering-note` accepts exactly the same three request fields plus `source_fields`, `request_fingerprint`, `draft_fingerprint`, Boolean `review_confirmed`, Boolean `independent_adjustments`, and `target_choice` (`current`/`proposed`). The source-linked draft is reconstructed/rechecked against the current case and both fingerprints. No unquoted baseline compiler is exposed via HTTP.

With both confirmations true, fresh `reviewed_values` and target resolution are returned. A complete valid draft includes `ready:true`, one bound request and the actual `check` from the existing joint planner. An incomplete draft returns `ready:false`, known/null values, missing questions and `check:null`, without a bound request or calculation. The UI applies targets/observation/spatial fields atomically, preserving invalid current target text and replacing unstated new observations with blanks. Without both confirmations, reviewed_values is null and nothing is calculated. Apply makes no model request and mutates no server state.

Typed configuration/provider errors and the existing Host/Origin/body/concurrency guards remain. Edited notes/cases/source fields or fingerprints reject as400; unsupported extra body fields also reject. Literal/excerpt checks establish occurrence and conversion, not correct interpretation or product qualification. [Detailed contract](ENGINEERING_INTAKE_CONTRACT.md) · [actual comparison and limits](ENGINEERING_INTAKE_RESULTS.md).

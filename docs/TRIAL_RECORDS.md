# Versioned trial configurations and independent property checks

```python
from rematter.trial_records import assess_trial_records
result = assess_trial_records(request)
```

This stateless, standard-library-only function describes **entered readings** for exact full configurations and one explicit evidence kind. It does not interpolate physical properties, infer a causal effect from co-varying configurations, prepare quantities, verify finished products or predict future batches. No provider calls occur.

## Request contract

```json
{
  "case_id": "case-1",
  "assessment_kind": "synthetic",
  "configurations": [
    {
      "id": "AB", "revision": 1, "name": "20 A / 80 B",
      "materials": [
        {"id": "A", "name": "stock A", "amount": "20", "unit": "mass_percent"},
        {"id": "B", "name": "stock B", "amount": "80", "unit": "mass_percent"}
      ],
      "process": "Recorded process P1 and preparation",
      "geometry": "Recorded specimen/installation G1",
      "notes": "Synthetic software example only"
    },
    {
      "id": "ABC", "revision": 1, "name": "20 A / 30 B / 50 C",
      "materials": [
        {"id": "A", "name": "stock A", "amount": "20", "unit": "mass_percent"},
        {"id": "B", "name": "stock B", "amount": "30", "unit": "mass_percent"},
        {"id": "C", "name": "stock C", "amount": "50", "unit": "mass_percent"}
      ],
      "process": "Recorded process P1 and preparation",
      "geometry": "Recorded specimen/installation G1"
    }
  ],
  "checks": [
    {"id": "recovery", "name": "Recovery screen", "unit": "%", "method": "REC-1", "minimum": "80", "maximum": null, "required": true},
    {"id": "blocking", "name": "Installed insertion screen", "unit": "dB", "method": "INS-1", "minimum": "10", "maximum": null, "required": true}
  ],
  "records": [
    {
      "id": "AB-recovery", "case_id": "case-1",
      "configuration_id": "AB", "configuration_revision": 1,
      "check_id": "recovery", "unit": "%", "method": "REC-1",
      "data_kind": "synthetic", "conditions_confirmed": true,
      "readings": [{"value": "85", "reading_id": "R1", "specimen_id": "S1", "run_id": null, "batch_id": null}]
    }
  ]
}
```

Configuration identity is `(id, revision)`, never a component percentage or numeric scalar. Two configurations can contain the same 20% A while differing in B, C, process or geometry. Records cannot cross between them. Revisions are nonnegative integers (not booleans); the maximum captured revision for an ID is current regardless of input order. The caller must retain old versions immutably and create a new revision when relevant configuration context changes. This stateless function cannot detect a caller overwriting a previously saved version.

Each check has independent arbitrary name, unit, method, optional minimum/maximum and a required boolean. Min-only, max-only and inclusive two-sided limits are supported. No MPa or product type is hardcoded. Both limits absent/blank means `target_not_set`; reversed or invalid limits are errors. Check IDs must retain their meaning: a changed property, unit or method needs a new ID rather than relabelling old readings. Unit and method comparisons are exact; conversions, aliases and substantive changes are not guessed.

Readings and targets use finite decimal **strings** of at most 160 characters. Ordinary decimal and bounded scientific notation are accepted; decimal exponents/magnitude are bounded to ±1000. Comparisons and extrema use exact `Decimal` values without averaging or context rounding. Negative physical-property values are permitted where the user's check calls for them. Booleans, JSON numbers, NaN, Infinity and free-text readings are rejected. Numeric output strings preserve exact values; raw entered reading strings are also retained.

Material amount is captured context: blank/null, or short nonnumeric unknown text, remains unknown. Exact nonnegative numeric strings plus a nonempty unit make `amount_known` true. No remainder, filler fraction, component amount or quantity basis is invented. `component_amounts_complete` reports only whether every captured component has an explicit numeric amount and unit; it does **not** establish that the whole formulation, basis or process is complete. `formulation_completeness` stays `not_assessed`, `can_prepare_quantities` and `quantity_preparation_supported` stay false. This module is not a formulation/quantity validator. Missing context produces focused questions and can remain captured while entered readings are described under the user's explicit condition attestation.

Every record identifies the case, exact configuration revision, check, unit, method and `data_kind` (`synthetic` or `user_reported`). `conditions_confirmed` must be a real boolean. True explicitly attests that the record matches that configuration's material, preparation/process, geometry/installation and the check's test conditions. It is not inferred from a similar recipe or target. False records remain visible for review and cannot complete a check.

Optional `reading_id`, `specimen_id`, `run_id`, `batch_id` and `repeat_of` remain separate. Unknown identifiers remain null and are not inferred. Reading IDs must be unique within one record; `repeat_of` references a reading in that same record, cannot form a cycle, and cannot contradict both readings' known specimen IDs. Repeated readings do not create specimens, independent runs or batches. Record IDs and check IDs are unique; material IDs are unique within a configuration. Records from foreign cases or unknown configuration/check references are rejected without pooling.

Limits: 100 captured configuration versions, 50 checks, 1000 records, 50 materials per configuration, 1000 readings per record and 10000 readings in one assessment. IDs, names, units and numeric/context amount strings are bounded to 160 characters; process, geometry, method and notes to 2000. Excessive or malformed containers return structured errors.

## Response and states

`status` is `valid` or `needs_clarification`. The response contains current `configurations`, all captured `configuration_versions`, `ignored_records`, structured `errors` and missing-input `questions`. A historical version remains in `configuration_versions`; its records are ignored for the current version. Records of another data kind are ignored rather than filling a missing selected-kind check. Invalid records are identified and never pooled. All records are validated, even if their evidence kind or revision is not selected.

Each current configuration includes ID/revision/current_revision, original component/process/geometry context, independent `checks`, a `state` and `blocking_states`. Any validation error makes configuration aggregate states `needs_review` until the request is corrected; valid per-check summaries remain inspectable. Without errors:

- `all_entered_checks_in_range`: at least one required check exists, every required check has a target and at least one nonempty matching, condition-confirmed record of the selected evidence kind/current exact version, every entered applicable reading meets its inclusive limits, and no applicable record remains unconfirmed/empty.
- `out_of_range`: a required check has a confirmed entered reading outside its limits. This takes priority over other unresolved required-check states; `blocking_states` and individual checks preserve the remaining issues.
- `needs_review`: a required check has unconfirmed conditions or an empty record.
- `target_not_set`: a required check has no minimum or maximum.
- `missing_records`: a required check has no matching current confirmed evidence of the selected kind.
- `no_required_checks`: no checks, or only optional checks, are configured. It cannot vacuously pass.

Each property has its own state, target, source kind, `record_count`, `reading_count`, minimum/maximum entered values and original nested record/identifier metadata. Counts/extrema include only matching current selected-kind condition-confirmed nonempty valid records. `entered_record_count`, `unconfirmed_record_count` and `needs_review` expose additional applicable records requiring review. There are no inferred specimen/batch counts, averages, standard deviations, statistical independence or future-consistency claims. An optional check's failure remains visible but does not block an otherwise complete set of required checks.

`performance_verified` and `physical_product_tested` are always false at both result and configuration level. Even user-reported readings do not establish independent verification, product qualification or consistency. The all-entered state describes only supplied records and targets; it is not a material recommendation or permission to change the user's product targets.

## Verification

Focused standard-library tests exercise same-percentage different full mixtures, two properties with opposite outcomes, complete required sets, missing and stale evidence, source separation, upper-only/two-sided/zero limits and tiny precision differences, no averaging, unit/method conflict, condition attestation, identifier/repeat semantics, unknown recipe context, reference/duplicate/type validation and bounded inputs.

```sh
python3 -m unittest discover -s tests -p test_trial_records.py -v
```

No service, browser or provider integration is implied by these pure-function tests.

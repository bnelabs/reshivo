# Engineering-note adapter contract

This contract describes the headless adapter for the existing shared product/material/process case. The adapter itself has no screen, automatic state update or calculation side effect. It is now used by the reviewed-note UI and two service routes documented in API.md. Its purpose is to replace separate field entry while preserving missing information and explicit review. It does not establish unique AI value, a new physical model or a material result. Actual live/UI results are in ENGINEERING_INTAKE_RESULTS.md.

## Read and review

`read_engineering_note(request, *, client=None, root=ROOT)` accepts exactly:

```text
{brief, calculation_context, note}
```

The existing validators normalize the shared case. The nonempty note is at most 6,000 characters. The function makes one Meta generation request with the exposed `SYSTEM_PROMPT`, `engineering_schema()`, one result and a 4,096 completion-token budget. Configuration/provider/model-output failures remain visible; there is no fabricated fallback or retry. No calculation runs.

The schema requires exactly these 25 nullable fields, in exported `FIELD_ORDER`:

- Observation reference/provenance, complete-assembly mass, weighing uncertainty, total addition/removal limits and per-active-adjustment uncertainty.
- Mass target minimum/maximum, one-axis balance target minimum/maximum and coordinate basis.
- Assembly centre coordinate and its uncertainty.
- For each of two trim locations: reference, actual trim mass-centre coordinate, position uncertainty, addition limit and independently removable trim limit.
- Command increment.

`observation_id`, `coordinate_basis`, `position_a_id` and `position_b_id` records use `{source, quote, text}`. `observation_kind` uses `{source, quote, kind}` with `simulated` or `user_reported`. Quantity records use `{source, quote, number_text, unit}`. All records may be null.

`source` is `note` or `brief.targets`. Only targets/coordinate basis may use `brief.targets`; observation and current trim/configuration records must use the note. Each quote is an exact contiguous excerpt of at most 700 characters from that source. Text is verbatim. Observation provenance uses the existing conservative checks, with a narrow engineering-adapter exception for statements such as `not a physical test` or `not physically tested`: those scope limits do not negate an explicit synthetic cue. Actual provenance negation, conditional/question language or ambiguous provenance still fails. A quote cannot hide a negation/conditional elsewhere in its sentence. The original seven-field reader and its earlier frozen comparison remain unchanged.

Mass units are g/kg; spatial units are mm/cm/m, including ordinary written spellings in the quoted source. Unit conversion uses Decimal arithmetic, then finite canonical kg/mm numbers. Spatial coordinates can be signed. The normalized absolute limit is 10,000 in the canonical unit. Non-coordinate quantities are nonnegative; final model-specific positivity/stock constraints are checked only during preparation.

Targets may use a clear interval with a shared suffix unit, such as `980–1020 g`, `-2 to 2 mm` or `between -2 and 2 mm`. The minimum record must select its first endpoint and the maximum its second. Mixed explicit endpoint units are permitted. A scalar quote cannot be clipped out of an interval to manufacture a single measured value. Measurement/stock fields require their own adjacent number/unit. The initial adapter deliberately does not handle `950±5 g` shorthand; `mass 950 g; uncertainty ±5 g` is supported. It does not invent zeros, convert hole centres into trim mass centres, assume symmetry or assign coordinates from left/right labels.

The returned `engineering_draft` includes:

- `source_fields`: unmodified model field records; `fields`: the checked records plus each quantity's `normalized_value`; `values`: all 25 normalized scalar/text/null values.
- `target_resolution`, `conflicts`, `invalid_current_fields`, `missing_fields` and focused `questions`.
- Full normalized request, `request_fingerprint` and `draft_fingerprint`.
- Provider/model, actual `live`, usage, request ID and elapsed milliseconds.
- `review_required: true`, `ready: false`, `interpretation_verified: false`, `physical_product_tested: false`.

`normalize_engineering_fields(request, model_data)` exposes the same source/shape/unit checks for offline evaluation without making a provider call. `engineering_schema()` and `SYSTEM_PROMPT` are public so a comparison harness can inspect the actual production contract. Literal checks prove occurrence, endpoint selection and unit conversion, not correct semantic interpretation.

## Prepare one bound request

```python
prepare_engineering_draft(
    request, draft,
    review_confirmed=False,
    independent_adjustments=False,
    target_choice="current",
)
```

Preparation revalidates the full request fingerprint and original `source_fields`, then compares retained normalized fields/values and target resolution against recomputed values. Changed notes/cases, modified normalized values or malformed drafts raise `ProductInputError`. A client cannot bypass this path merely by adding different `values` to the source-bound draft. Fingerprints detect mismatch; they are not authentication signatures or proof that a model interpreted the note correctly.

Existing numeric targets and coordinate basis remain canonical. Explicitly different proposed values are retained as conflicts. `target_choice="current"` preserves existing values; `"proposed"` explicitly selects provided proposals. Missing canonical targets/basis can be supplied by reviewed proposals from their permitted sources. Invalid nonempty current target text is reported and blocks preparation rather than silently becoming a missing value. No mutation of the supplied case occurs. Product/material/process and recipe remain exactly the current shared case.

All observation and trim/configuration fields must be freshly supplied in this spike; old centre readings, stock bounds, geometry and uncertainty are never inherited. Missing values produce `ready: false`, `missing_fields` and questions, with **no `bound_request`**. Review must be exactly `True`, and independent-adjustment acknowledgement must separately be exactly `True`; prose mentioning independence cannot supply the acknowledgement. The model has no baseline or acknowledgement field.

Once complete and confirmed, the adapter constructs one atomic wrapper for existing `validate_bound_balance`. The optional baseline is no adjustment at the first named location. Final model validation failures return `ready: false` and `validation_errors`, without a bound payload. A valid result includes `ready: true` and the normalized `bound_request`. The caller may then run the existing planner or tool agent; the adapter itself does not calculate, apply a change or mark physical performance established.

## Equally convenient plain baseline

`prepare_engineering_values(request, values, *, review_confirmed=False, independent_adjustments=False, target_choice="current")` accepts exactly the same 25 nullable normalized values and uses the same target resolution, review gates and final compiler. It deliberately performs no source-quote check and labels its output `source_path: unverified_normalized_values`, with `interpretation_verified: false`. This is a headless comparison entry point, not a proposed HTTP shortcut for production note drafts. It avoids inventing source quotes or forcing the ordinary-Meta baseline to re-enter every field manually.

Both compilers use the same case, targets, bounds and existing calculation authority. The reviewed path is `source_path: quoted_engineering_note`; that label does not claim semantic correctness or a physical measurement. No new backend route or UI path exposes the unquoted compiler.

## Verified here; still unproved

Offline tests cover 25-field conversion, signed/mixed spatial units, suffix-unit target intervals, current/missing/conflicting targets, absent uncertainty, no inherited values, malformed quotes/units, clipped ranges, conservative provenance, stale/mutated drafts, independent review gates, final stock/geometry rejection, metadata and provider failures. A prepared synthetic request reaches the existing joint planner and returns the expected +104/−54 g commands.

Actual live extraction, successful completion from natural notes, fewer observed input actions and comparison with equally informed simpler alternatives are **not** established by those tests. The adapter should not reach the UI until the planned live/end-to-end spike is completed and reported honestly. No UI re-entry reduction, human speed, physical performance, batch prediction, originality or award result is claimed here.

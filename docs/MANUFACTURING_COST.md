# Manufacturing-cost calculation contract

`rematter.manufacturing_cost` is a standard-library-only, deterministic calculator:

```python
calculate_manufacturing_cost(request: dict) -> dict
compare_manufacturing_costs(requests: list[dict]) -> dict
```

It calculates the cost of the **entered manufacturing scope**. It does not supply market prices, exchange rates, equipment availability, physical properties, density-derived counts, product acceptance or manufacturing guarantees. No model/provider call occurs. This module is not itself an API or UI integration.

## Progressive use

Reuse the selected case and configuration. Ask only the unanswered questions needed for the next result: (1) charged material amounts/prices/currency/basis, (2) optional known process costs and their inclusions, (3) usable output and its definition. Unknown entries can remain unknown. Do not require a second material setup or a complete cost form before giving material advice. `questions` contains field-specific missing-input prompts for a progressive UI.

## Request

All numeric quantities, rates and money are finite **decimal strings**, including explicit `"0"`. Blank/omitted values are unknown; binary floats, exponents, negative amounts and credit accounting are unsupported. Metadata revisions may be integers or strings. Identifiers and basis labels should be stable, nonempty strings.

```json
{
  "case_id": "mat-case",
  "configuration_id": "A",
  "configuration_revision": "1",
  "current_configuration_revision": "1",
  "currency": "CU",
  "product_basis": "floor mat",
  "functional_basis": "same-size mat; shop appearance screen",
  "scope_basis": "charged materials, energy, direct labor and batch charge",
  "mass_basis": "dry",
  "materials": [
    {"id": "flake", "name": "flake", "quantity": "30", "quantity_unit": "kg", "unit_price": ".40", "price_unit": "kg"},
    {"id": "elastomer", "name": "elastomer", "quantity": "10", "quantity_unit": "kg", "unit_price": "1.20", "price_unit": "kg"},
    {"id": "binder", "name": "binder", "quantity": "2", "quantity_unit": "kg", "unit_price": "2.50", "price_unit": "kg"}
  ],
  "process": {
    "energy": {"status": "known", "kwh": "18", "rate": ".15"},
    "labor": {"status": "known", "person_hours": "1.5", "rate": "12"},
    "other": {"status": "known", "charges": [{"id": "batch", "name": "batch manufacturing charge", "amount": "4"}]}
  },
  "output": {
    "mode": "actual",
    "acceptance_basis": "user shop appearance/size screen only",
    "usable_count": "16", "gross_count": "20", "usable_mass_kg": "32"
  }
}
```

CU is an illustrative currency unit in the tests, not a market quote. A record has one explicitly entered currency; optional per-line `currency` must match. No currency conversion is inferred.

Materials use charged quantity and a matching price denominator (`kg`, `g`, `t`, `lb` or `oz`). Exact mass conversion uses 1 lb = 0.45359237 kg and 1 oz = 1/16 lb; quantities and price denominators convert independently without relabelling the stored units. `quantity_basis` and `price_basis` may override shared `mass_basis`; both must be explicit and equal (for example `dry` or `as_received`). No moisture/density conversion is supplied. Optional IDs detect duplicate charged lines. Unknown materials or contaminants never receive guessed quantities or prices.

Alternatively, every material can use `quantity_unit: "mass_percent"`, with quantities summing exactly to 100 and an explicit `batch_mass: {"quantity": "42", "unit": "kg", "basis": "dry"}` on the matching basis. Batch mass also accepts g, t, lb or oz. Missing batch size remains partial. Incomplete recipes are not normalized, and charged masses cannot be mixed with mass percentages in the same record. This version does not calculate a weighted material-only price from a recipe without batch size. `volume_percent` remains captured but unpriced: it returns a missing-input question for an independently entered charged mass. Replace that cost line's quantity/unit with the user's independently supplied mass without changing the saved configuration recipe; density does not supply a conversion. Partial process-cost subtotals may remain available.

`material_status` defaults to `known` when material lines exist and otherwise `unknown`. Each process category has `status: "known"`, `"unknown"` or `"excluded"`; omitted process categories are unknown. Explicit exclusions are visible limited scope, not zero-cost measurements. Excluded/unknown categories cannot simultaneously contain cost entries.

Known energy is entered batch kWh × currency/kWh. Known labor is person-hours × currency/person-hour; it is not elapsed machine time. Known other cost is the sum of named nonoverlapping batch charges; an explicitly empty `charges: []` is a known zero. Per-category/per-charge currency can only repeat the record currency. A charge can declare `includes: ["energy", "labor"]` (or `"materials"`), but the included categories must be explicitly excluded as separate entries; unresolved inclusion/double charging blocks aggregation. Comparisons conservatively require matching category status representations, even when an inclusive quote and separate breakdown might describe equivalent scope.

Overhead, tooling, packaging, transport, depreciation and other allocations enter only as explicit named batch charges. No full-factory-cost/profitability claim follows. Negative feedstock/gate-fee, salvage, revenue and rework-credit accounting need a separate model. Rejects are already included in charged inputs and receive no guessed credit or duplicate material charge. Unrecognized extra fields such as density, target part mass or a possible scrap credit do not affect costs.

## Output denominators

`output.mode: "actual"` accepts directly entered `usable_count`, `usable_mass_kg` and/or `usable_area_m2`. Counts are whole nonnegative integers; mass and area are nonnegative. Area is entered usable output, never inferred from sheet dimensions. Optional matching `gross_count`, `gross_mass_kg` or `gross_area_m2` allow descriptive acceptance fractions on that same output boundary. Usable cannot exceed gross on that same basis. Input-to-output mass recovery is deliberately not inferred: additional water, conditioning or other boundaries may differ.

`output.mode: "planned"` instead requires `accepted_fraction` between zero and one and one or more `gross_count`, `gross_mass_kg`, `gross_area_m2` values. Usable equivalents are gross output × fraction, once. Fractional expected units remain labelled planning equivalents. Direct usable values and planned acceptance fractions cannot be mixed. An actual usable count is never divided by yield again.

`acceptance_basis` states what the user's term usable means. It must exist before unit costs are issued. Even a complete cost record does not establish friction, compression recovery, acoustic blocking/absorption, density, binding integrity or any other physical target. `physical_target_status` is always `not_assessed`.

Unknown output permits batch cost only. Zero usable output retains batch cost with undefined unit cost. Target counterweight mass and constituent density cannot become a finished-insert count. A changed configuration retains historical numbers under their original revision; it does not make them measurements of the new mix.

## Response

- `status`: `complete` means complete cost **within the explicitly entered scope**, even if output is unknown; `partial` means a known subtotal/missing cost inputs; `needs_clarification` means a conflicting/invalid input. Metadata/output questions can remain with a complete batch-cost result.
- `costs`: category known subtotals, `known_subtotal`, and `entered_scope_total`. A category can itself be partial. `entered_scope_total` exists only when all included categories are complete. Conflicting cost inputs block aggregate subtotals/totals; valid individual line figures remain visible. Output errors block unit costs while preserving valid batch figures.
- `unit_costs`: `per_usable_unit`, `per_usable_kg`, `per_usable_m2`, or null. `unit_costs_scope` identifies whether these divide a complete entered-scope total or only a known subtotal. Show this label beside every partial unit metric.
- `exact_values`: authoritative numerator/denominator strings for each available numeric response field. Display strings use up to 40 significant decimal digits; comparisons use exact fractions, not rounded strings.
- `output`: entered/derived usable denominators, mode, acceptance definition and any descriptive gross-output acceptance fractions. These are not independent specimens, production guarantees or future yield predictions.
- `is_current`: true only when explicit configuration/current revisions match; false for a historical revision, null when unknown.
- `questions`, `errors`, `warnings`: structured missing inputs, conflicting fields and scope/planning limitations. All-blank inputs do not invent a zero cost.

## Comparison

`compare_manufacturing_costs` returns individual `results`, `comparable`, `reasons`, and `winners` for each supported unit metric. It requires distinct configuration IDs, complete/conflict-free current records, the same case, currency, product basis, functional-output basis, declared cost scope, included/excluded categories, usable acceptance definition and actual/planned mode. Declared inclusions must match for each process category. When other costs are entered, their named charge categories and declared inclusions must also match; charge amounts may differ. Names are compared after case and whitespace normalization, so users still need to describe equivalent charges consistently. Each metric also needs a positive explicit usable denominator in every record. Missing metadata or denominators produces no winner. Exact ties preserve every tied configuration ID.

Different complete configurations may co-vary material proportions, energy, labor and output. A cost comparison does not identify which change caused a result, interpolate properties or qualify a product. A cheaper untested configuration stays untested. Different-size sheets need an explicitly common functional-output basis before a winner; products cannot be compared merely because both have a per-piece cost. Configuration revision/current-revision identity is caller-supplied and must be kept in sync by the application.

## Verified examples and limitations

The request above has material cost 29.00 CU and batch cost 53.70 CU; 16 declared usable mats yield 3.35625 CU/mat and 1.678125 CU/kg. Alternative B changes charged quantities to 34/6/2 kg, energy to 22 kWh, labor to 1.25 person-hours, and usable output to 14 mats/28 kg. B has cheaper material (25.80) and batch cost (48.10), yet costs 481/140 = 3.435714... CU/mat, 89/1120 CU more than A. These are synthetic user inputs, not material performance or market evidence.

Tests cover the full floor-mat comparison, exact unit conversion/percent recipe, partial/zero/unknown states, output/yield conflicts, sound-sheet explicit area, counterweight kg without density/count, duplicate/inclusive charges, currency/basis mismatches, unsupported credits, comparable scope and revision guards, and exact versus display-rounded ties. Run only this module's focused checks with:

```sh
python3 -m unittest discover -s tests -p test_manufacturing_cost.py -v
```

The value over a calculator is retaining configuration, scope, units, output definitions, missing questions and separate property evidence through a trial workflow. Arithmetic alone is ordinary spreadsheet work. This module establishes no AI advantage, human time saving, complete accounting coverage or real manufacturing feasibility.

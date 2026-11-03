# Mix result precision review — 3 November 2026

**Implemented after the findings below.** The solver now derives feasibility and bounds from exact fractions of the decoded numeric inputs and supplies exact bounds alongside its approximate numeric fields. The main and older mix screens use those bounds to present a concise amount within the calculated range, or distinguish an exact fraction from its approximate decimal. The amounts remain composition simulations, not measurements or product-performance predictions. The examples below document the earlier behavior and the reasons for the change.

## Observed display

One observed result displayed **0.1999976000048–0.2000012000012 kg**. As decimal representations of those displayed endpoints, **0.2 kg** is inside that interval: its margins are 0.0000023999952 kg above the displayed lower endpoint and 0.0000012000012 kg below the displayed upper endpoint. This is a clearer candidate than the full endpoint strings. This check alone does not establish that 0.2 kg lies within the solver's exact mathematical interval: the API currently converts its internal decimal results to binary floats before returning them.

For the same displayed interval, 0.200002 kg is outside its upper endpoint. Rounding both limits to a fixed number of places can collapse a range, widen it to include infeasible values, or turn a small positive amount into zero. In US units, the exact conversion is **1 lb = 0.45359237 kg**; 0.440925 lb equals 0.20000021574225 kg and lies between the displayed endpoint decimals. A rounded pound value must still be checked against the original bounds, not assumed valid because it is close.

## Exact-singleton counterexample

An offline call to `balance_mix` used 1 kg at exactly 50% of the tracked component, added stock at 0%, and an exact 30% target. The mathematical solution is **2/3 kg**. The current API returns minimum, maximum and example as `0.6666666666666666` kg. That finite decimal is strictly below 2/3; substituting it into the exact mass balance gives a percentage strictly above 30%. There is no finite decimal that equals 2/3, so a display-only rounding rule cannot honestly present a finite decimal as guaranteed inside this singleton. The existing “approximately” wording is appropriate for an approximation; it is not a guarantee that a displayed decimal exactly satisfies the target.

## Requirements used for the change

- Preserve the original entered quantities and the solver's full calculation; rounding is a presentation choice, not a change to the stored input or result.
- Base any assertion that a displayed number lies inside the interval on exact decimal/rational inputs and bounds, or on explicit conservative bounds provided by the solver. The present nearest-float endpoint values alone are insufficient for that proof.
- For a nonempty interval, find a concise decimal candidate in the selected units and verify its exact converted mass against both original bounds. An inward-rounded range is a subset of the true feasible range and must be labeled accordingly; never widen it while presenting it as entirely feasible.
- Handle zero, a positive minimum, unbounded maximum and intervals narrower than the chosen display precision separately. If no short representable decimal lies inside, increase precision or say that no concise in-range amount is available; do not invent a point. For a nonterminating exact singleton, retain the exact fraction or describe a decimal only as an approximation.
- Never display a positive quantity as zero. Use sufficient significant digits, scientific notation or an appropriate smaller unit when needed. Treat unit conversion with exact defined factors and avoid introducing a new rounding error.
- If showing a resulting composition for a displayed candidate, calculate it for that candidate. Do not pair a newly selected candidate with percentages calculated for another amount; the current display omits those percentages.
- Retain the full calculated result in an expandable detail if useful, and test ranges crossing zero, narrow and singleton intervals, unbounded maxima, tiny positive values, metric/US conversions and boundary floats. Preserve the distinction between a composition calculation and a measured product property.

These software checks do not establish the accuracy of a physical mix.

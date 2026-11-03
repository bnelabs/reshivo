# Product reset — private working review

The video is on hold. The current female narration is not accepted as final; use a natural male narrator when video work resumes. Nothing is approved for publication or submission.

## Latest workflow work

An entered material amount no longer silently changes meaning when its unit changes: the user chooses whether to use an exact mass conversion, keep the entered number, re-enter it, or cancel. Conversions across mass and percentage are not inferred. The cost workspace still uses explicit kg and m² labels in US mode.

In Adjust a mix, a saved setup can supply a whole-recipe composition after the user maps the ingredient and confirms the basis. An exactly representable fraction becomes a trial point; otherwise the app can offer a confirmed enclosing range while retaining the exact source ratio. Its source setup and version remain attached to the saved draft and discussion; existing target entries are not overwritten. Feed-only fractions remain manual. Product readings remain in Checks, and this handoff does not decide whether the recipe meets a property target. Isolated browser checks exercised unit changes and a synthetic recipe Save/Open; no live model or physical test was used.

The [frozen decision journey](DECISION_JOURNEY_RESULTS_20261103.md) still contains important failed advice and an incomplete baseline. This workflow work does not replace those results or establish an advantage over ordinary chat.

## What the audit confirmed

Fresh browser captures are in `outputs/ui-audit-20261103/`. The old application was inspected before replacing its entry flow. The floor-mat request and real model response are preserved in `floor-mat-live.json`.

1. `01-empty-start.png`: the header, status and progress consume most of the first screen. The user must already know how to fill four engineering brief fields before receiving help.
2. `02-simple-prompt-blocked.png`: “I have recycled tyre crumb and want to make a floor mat. Can you help?” cannot be sent. This confirms that the old experience cannot clarify an incomplete ordinary prompt.
3. `04-floor-mat-options.png`: a real model call offers material preparation and a conditional binder plan. It does not force a strength calculation. However, long target text is copied into action text, and important questions are less prominent than the options.
4. `05-single-property-comparison.png`: the comparison stores one property, one method and numeric levels of one changing input. Source inspection confirms that several complete recipes, several properties and changed process/geometry cannot be retained as one decision table. Selecting another check replaces the current comparison context.

MPa is an example and demo bias, not a hardcoded engine requirement. Product names and units are generic. Replacing that label alone would not fix the workflow. No external user study or accessibility certification was performed.

## Delivery direction

Start with a short idea and ask focused questions. Review the product, materials, use and priorities before using them. Keep unknowns explicit while still offering conditional next actions. Separate proposed material/process/design changes from numerical comparisons.

Retain complete named trial configurations with material amounts, process and geometry. A changed recipe/process is a new revision. Keep separate checks and observations for each requirement. Join readings by configuration and revision, never by a shared percentage alone. Show missing checks alongside results rather than replacing them with one headline number.

Manufacturing economics are optional. Reuse the selected configuration; ask for prices, processing scope and usable output only when needed. Compare cost per usable output only on matching product/function/scope definitions. The arithmetic is ordinary accounting; the potential benefit is keeping that accounting attached to the correct trial and its outstanding physical checks. There is no demonstrated time-saving or AI-performance advantage yet.

Offer explicit saved inference connections. The selected model supplies language/planning help; deterministic code performs entered-data checks and arithmetic. Model capabilities depend on the actual model. No provider failover or third-party call occurs merely by opening settings. Meta remains the existing default connection.

Every result remains a proposal, entered observation, or simulation. Neither a collection of readings nor a complete cost estimate establishes future manufacturing consistency. Published studies remain separate from the user's materials. Missing density, acoustic behavior and contamination effects remain missing.

## Acceptance checks

- A simple floor-mat or sound-sheet prompt can start a clarifying conversation without a numeric target.
- Reviewed project facts carry into every tool without choosing the material again.
- Two complete configurations may share one ingredient percentage while differing elsewhere; each keeps its own records.
- Several required properties stay visible; one passing property cannot hide another missing one.
- Editing a configuration cannot silently reuse its old readings or costs as current.
- Manufacturing cost distinguishes unknown, excluded and entered costs, and does not call a cheaper untested recipe qualified.
- Saved files preserve context and grouping without API keys; loaded inputs are validated and results recalculated.
- Browser checks cover ordinary use, errors, small screens and provider settings. Adapter tests are distinct from live provider verification.

This is an implementation direction, not a prize claim. A stronger award case still needs a credible observable user advantage over a simple chat plus spreadsheet baseline.

## Private implementation checkpoint

### Follow-up: keep the first answer and work with a changing mix

The reviewed intake reply, first step and open questions now remain visible when the project opens and are retained as a planning note in the project file. If the project details were edited after the reply, the app says the suggestion predates those edits. An AI-suggested check can be reviewed and given a user-chosen name before opening a separate, unsaved check draft; the app does not fill in a method, unit, limits or readings.

The primary workspace now has an **Adjust mix** view. It reuses a material name from a saved setup and calculates a possible addition using a portion mass, stated mass-fraction range, named added stock with its stated fraction and a user-chosen trial composition. For a synthetic one-kilogram example, changing the stated tracked fraction from 24% to 26% changes the estimated addition of a zero-fraction stock from 0.2 kg to 0.3 kg for the same 20% trial composition. This is ordinary composition arithmetic under the stated mixing assumptions, not a measurement, a material recommendation or a prediction of mat grip or durability. Save/Open retains the entered inputs with their project snapshot, exact setup version and material, but does not save the calculation result or create a new trial. If project details change, the app displays the earlier and current details and requires the user to review the inputs before recalculating. Decimal entries that would be silently changed by number conversion are rejected, and displayed outputs are approximate. The added stock is subject to the same bounded text-based local-planning check; this is not general material identification or a safety guarantee.

One later [live Meta follow-up](../examples/mix-discussion-live-20261103.json) on the synthetic 26% case identified the calculation's assumptions, called for a basis for the stated fraction and asked for separate product checks. A [second follow-up after the concise-language change](../examples/mix-discussion-concise-20261103.json) still repeated a generic caveat and suggested making the mix before available equipment was established. These are individual examples, not a comparative evaluation or a reliability rate; the model's wording still needs improvement. A synthetic browser pass covered the retained reply, check-name handoff, long input descriptions, changed composition, unit display, recognized unknown-metal added stock, saved input restoration, review after changed project details and a no-addition case. A 390-pixel viewport check found no page-wide horizontal overflow. The pass did not test a physical mix, saved legacy-workspace reopening, a broad set of languages, or end-to-end use by independent people. The earlier matched evaluation and its limitations remain unchanged.

The interface copy was subsequently shortened at the owner's request: one small footer message replaces repeated generic caution paragraphs, while source labels and actionable input or calculation details remain. The provider prompts now request direct, concise wording. A [single follow-up after this wording change](../examples/mix-discussion-final-copy-20261103.json) still included one generic caveat despite the prompt; generated copy can therefore remain repetitive. This one example is not a reliability benchmark. A prepared question about a mix result is bound to its project, setup and entered values; if they change, the question stays available but must be refreshed or cleared before sending.

The primary entry is now prompt → reviewed project → Options / Trials / Checks / Costs. Earlier tools remain behind the menu with separate file formats. The new project file retains complete versions, independent checks, grouped readings, recoverable record exclusions, cost drafts and historical model proposals. Imported reading conditions reset for review. A different product starts a separate case after downloading the earlier project; editing its context clears test confirmations and the cost comparison/acceptance definitions.

Verification on 3 November: all **467 Python tests**, **eight frontend check groups**, retained-source verification and production build passed. The later wording adjustment passed its 24 focused advisor regressions and another production build. Live browser checks covered simple-prompt clarification, reviewed facts carrying forward, two setups with two opposite property outcomes, manufacturing costs from the same recipes, safe object/null cost comparisons, provider dialog and Escape, Save/Open of readings and historical notes, and draft separation between simulation and user-reported data. The phone-breakpoint page had no horizontal body overflow; this is a layout check, not a full accessibility audit.

Actual Meta checks are preserved in ignored `outputs/product-reset-review-20261103/`. A sound-sheet prompt triggered questions about blocking, echo or impact noise, installation and use; it did not invent acoustic measurements. A full contextual answer correctly used both properties and costs but padded required route cards with administrative tasks. Focused questions now use the compact endpoint, while alternatives remain an explicit action. The first compact reply still used jargon and incorrectly called an unspecified process changed. After a prompt correction, the next live reply correctly described process control as unknown, preserved the separate failures and the 3.35625 versus about 3.436 CU/item arithmetic, and proposed a conditional next comparison without a dose. That call took about 20.7 seconds. These are inspected examples, not a reliability score or a workflow-benefit benchmark.

Costs are calculations from user entries, not fetched market prices or full factory accounting. Recipes accept explicit kg/g/t/lb/oz and mass percentages; recorded units remain fixed. Cost output denominators are explicitly shown kg/m²/items and current price entry is per kg. There is no automatic arbitrary-property, geometry or currency conversion. Provider adapters and masked settings are tested offline; only Meta has been used live in this reset. No physical material trial or finished-product consistency result exists.

Next gate: freeze realistic end-to-end tasks for a floor mat, an acoustic product and a different chosen product; compare completion, context handling and unsupported claims against a capable plain-model baseline with the same information. Do not promote the new UI or passing software checks into a prize claim. Video and public release remain on hold.

# Weighing-note workflow check

Version `intake-v1`, defined 1 November 2026 before its first live note-reader call. This is a scripted solo usability and extraction check, not a user study, physical experiment or frontier-science benchmark. The previous numerical comparison stays unchanged and showed no numerical advantage.

The job is to put a supplied weighing note into the current case, calculate a bounded mass correction, and retain an inspectable record. The existing product/material/process and numeric target are common setup. Neither path needs a recipe or density for this mass-only job.

## Fixed tasks

All cases use a synthetic contained-ballast scenario and the existing 0.98–1.02 kg mass target. No physical assembly or weighing exists.

1. **Complete note:** `Simulated observation ref trial-1: complete assembly mass 950 g, weighing uncertainty 5 g. I can add at most 100 g and remove at most 100 g. Adjustment uncertainty is 5 g.` Expected normalized fields: reference trial-1, simulated, mass 0.95 kg, weighing error 0.005 kg, add/remove limits 0.1 kg each, adjustment error 0.005 kg. The model permits a +0.05 kg midpoint command and a 0.99–1.01 kg resulting mass interval. Meta must actually read this note; no stored response substitutes for a call.
2. **Missing bound:** the same note with the final adjustment-uncertainty sentence omitted, reference trial-2. That bound must stay blank, the bounded check must remain unavailable, and the interface must ask for it. Applying this draft must clear a previous observation's adjustment error. No inferred zero, inherited value or automatic physical claim is accepted.
3. **Changed case:** obtain a draft, then change the target or selected product before applying it. The old draft must disappear and cannot populate the new case. Existing compatible material measurements may remain; an old assembly observation must not transfer to a different product.

Literal/source checks prove only that a numeric expression occurs in the note and its unit was converted by code. They do not prove that the model assigned the right meaning. Review each field manually against these expected values before applying it. Record invalid extraction and provider failure rather than changing the wording to manufacture success.

## Comparison and counting

For the complete note, first use the strong manual path in the same main Engineering tool: enter reference, provenance and the five quantities once, then run its bounded calculation. Next clear that observation and use the supplied note, Read note, review, Apply and the same bounded calculation. Both paths use the same numerical endpoint and target; both retain an editable manual path.

Record actual field edits/selects, disclosure openings and action clicks, plus corrections. Pasting one supplied note is one text edit; it does not measure the effort to author a note. Applying a review card is one action, not proof that reviewing is cognitively free. Count only interactions actually performed, and distinguish common setup and QA inspection actions from completion actions. Report provider-reported elapsed time separately. Automation round-trip time is not human task time. Do not infer general productivity from a lower scripted control count.

The ordinary-Meta arm of the earlier numerical benchmark is not a note-intake result. A comparison against ordinary Meta or a deterministic note parser would be a separate matched experiment, with its own inputs and rules registered before execution. Until that exists, the most this check can support is reduced observed entry within this app versus its manual form path. It cannot establish that Meta uniquely provides the benefit, dominates ordinary chat, or makes the project award-worthy.

Save the actual note draft and full calculation/assistant downloads, include failures, and record desktop/mobile rendering, stale-state behaviour and missing-field behaviour. Mark completion and any remaining gates in REVAMP_PLAN.md only after the corresponding work was performed.

## Actual scripted check — 1 November 2026

All three specified tasks were exercised in the running app. The [actual records](../examples/weighing-note/) retain the unedited provider responses, quoted values, manual/note action logs, calculation results and stale-state observations.

| Path for complete note | Completion actions actually performed | Corrected fields | Result |
| --- | --- | --- | --- |
| Manual | 9: open manual details, edit six text/number fields, select provenance, run check | 0 | +50 g; chosen-command mass simulation 0.99–1.01 kg |
| Read and review note | 4: paste supplied note, read, apply reviewed details, run same check | 0 | Same result |

The first actual note-reading call took 4.224 seconds of provider-reported elapsed time and correctly returned all seven expected fields. These actions populate the same shared observation and invoke the same deterministic endpoint. The note replaces seven separate field edits/selects with a text entry and review/application workflow. Review effort was not timed as human work. Common case setup, observation reset, QA inspections and artifact-download actions are excluded from the completion-action count and retained in the record description. The raw automation wall clocks also contain QA/round-trip delays, so they do not support a speed claim.

The missing-bound call took 4.196 seconds and returned adjustment uncertainty as null with the expected question. Applying it cleared the preceding 0.005 kg value; the bounded calculation and tool-backed assistant became unavailable until a bound was supplied. The changed-case task obtained another actual draft, then changed the mass target: Apply disappeared while the old compatible observation remained. Changing the product cleared that observation.

A final live mass-only Meta run completed in two turns, 3.894 seconds, with one executed calculation. Its bound request contains `plan: null`, blank recipe details and no density; the checked action is +0.05 kg for trial-1. [Actual trace](../examples/weighing-note/meta-mass-check.json). The separate [manual calculation download](../examples/weighing-note/mass-check.json) retains the same case, identified observation and bounds. These are synthetic software checks, with no physical assembly or weighing.

Desktop and a 390 × 844 mobile viewport were checked using the in-app browser. Mobile client/document widths both measured 390 px, no page overflow appeared, and captured warnings/errors were empty. Applied-note downloads retain the original note, raw units, converted values, exact quotes and actual model metadata. Manual observation or case changes hide an old applied record. A separate layout check confirmed that shared mass limits appear before collapsed recipe details. Temporary viewport settings were reset.

**Supported conclusion:** fewer completion actions were observed for one supplied note in this app. This does not establish faster human work, general extraction accuracy, unique Meta value, superiority to ordinary chat or a deterministic note parser, physical performance, or award readiness. Those comparisons remain open. The nine-case numerical tie remains part of the project record.

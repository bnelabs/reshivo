# Keep working on one material case

The material workflow now retains one case across options, its selected trial, entered readings, proposed quantities and narrow Meta questions. The working screen uses a compact case sidebar and a dedicated quantity view. A new contextual-review response answers the current question without regenerating the alternatives or replacing the trial.

## Local workspace files

Save workspace downloads an explicit local JSON file. Open workspace validates the whole file before replacing active work; replacing an entered case asks for confirmation. There is no automatic cloud save. Invalid or unsupported files leave the active work intact.

The file retains the case, display units, selected route, plan, trial, recent discussion, compact follow-up and literal measurement/quantity drafts. Saved model content is visibly marked as saved. Reopening makes no model request and restores no current comparison, calculated dose or applicability confirmation. The user reviews and reconfirms readings before preparing a recorded-setting trial again. A reopened saved composition target is manual until then.

Identifiers for readings, specimens, runs, batches and repeats remain separate. Numeric text is not coerced, rounded or regrouped. API-to-case binding tolerates the same outer whitespace trimmed by the server while preserving the original saved text. A materially different process, component, amount, target or inner text still fails that binding.

## Final browser checks

Actual Save/Open retained the synthetic two-stock plant-pot-cover case, its real generated Meta records, exact draft values and unknown reading grouping. It cleared confirmations and numerical results. Network observation after opening contained only a status GET; no help, trial or follow-up generation ran automatically. Invalid JSON and unsupported versions had already been checked without replacing the active case.

The final route checks found and repaired three related issues: stale advice after changing route, a hidden plan after leaving the quantity view, and route equality depending on object-key order. The same route now remains visibly selected and retains its existing advice/trial. Another route clears the old advice and trial. View trial plan opens the retained plan without a new request.

The unit round trip displayed one kilogram as 2.204623 pounds while the saved canonical quantity remained the literal `1`; returning to metric restored `1`. The recipe amounts remained `250` and `750`. This is display conversion, not new material information. At 390 × 844, document client/scroll widths were both 375 pixels; the main quantity inputs and calculate action were 44 pixels high. Physical-device keyboards were not tested.

[Recorded hypothetical workspace](../examples/material-workspace/recorded-demo-workspace.json) · [Browser-check record](../examples/material-workspace/browser-checks.json).

The full Python suite passed 336 tests, the six frontend check groups passed, the final TypeScript/Vite build passed and the focused workspace check passed again after the binding repair. These checks do not qualify a physical material, show user time savings or overturn the negative [matched material-task result](MATERIAL_TASK_RESULTS.md). Everything remains private.

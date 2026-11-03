# Note-intake comparison protocol

Version `note-intake-v1`, defined 1 November 2026 before any live calls from this harness. The ten visible synthetic fixtures and independent expected semantic fields are fixed in `scripts/benchmark_note_intake.py`. They cover a clear note, obsolete/current readings, component versus assembly mass, mixed units, unknown errors, limited trim, planned versus current weighing, explicit zeros, unknown assembly mass and unknown addition capacity. These are diagnostic examples, not held-out generalization inputs or a human study.

## Compared approaches

- **Parser:** a working label/unit regex parser supports common synonyms, g/kg conversion, explicit current-reading preference, component/obsolete/planned exclusion, provenance cues, zero values and ambiguous/missing fields. It reads no provider configuration and does not use fixture IDs or expected answers. Its code is frozen with the protocol, rather than deliberately left empty or weakened.
- **Plain Meta:** one structured extraction call receives exactly the same case and note. The prompt defines the seven fields, unit conversion, unknowns, provenance and current/assembly distinctions. It returns normalized quantities directly, without a quote requirement. Its output remains unverified.
- **Reviewed helper:** the app's actual `read_observation_note` function makes one call and applies its existing literal/unit/quote checks. It returns a draft for review, never a physical measurement or automatically applied action.

Both model approaches use the same locally configured model, low reasoning and at most 4,096 completion tokens. Each gets one call per fixture, no retries, altered-wording attempts or score feedback. Model order alternates by fixture; parser runs first. The exact prompts, schemas, raw responses, model identifiers, usage, latency and typed failures are retained. No authorization headers are recorded. Private credentials are redacted before writing records.

The production quote checks make accepted-completion criteria stricter than plain extraction. Report **normalized semantic correctness before validation** as well as accepted draft correctness; do not credit a quote rejection as proof that the model understood the note. No approach gets an expected answer as input. Source excerpts establish literal occurrence, not correct semantic assignment.

## Scoring and recording

Score all seven fields against the hand-entered reference: identifier, provenance, complete-assembly mass, weighing uncertainty, maximum addition, maximum removal and adjustment uncertainty. Missing values must remain null. Numeric absolute tolerance is 1e-9 kg. Report exact cases, per-field matches, missing expected values, incorrectly filled unknowns, wrong numeric/identity values, failures and actual software/provider time. Provider availability and raw semantic correctness are separate from accepted completion. No human entry/review time or reduction in control actions is measured by this harness.

All attempts stay in the denominator. Record and checkpoint each arm; an interrupted run is incomplete. Do not overwrite an existing final or partial artifact. Freeze the protocol/implementation/case hashes with `--freeze-protocol` before using `--mode all`; a mismatch must stop execution. Changes after seeing live results require a new version and new run, preserving failures. Never silently tune the baseline or prompts to manufacture an advantage.

Default and `--offline` execution run only the parser. Explicit live command:

```sh
.venv/bin/python scripts/benchmark_note_intake.py --freeze-protocol
.venv/bin/python scripts/benchmark_note_intake.py --mode all --output outputs/note-intake-v1-live.json
```

If plain Meta or the parser matches or beats the reviewed helper, say so. A successful comparison can narrow the product claim; it cannot establish physical performance, scientific novelty, general user-effort savings, unique Meta value or prize readiness by itself.

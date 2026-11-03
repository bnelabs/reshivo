# Note-intake comparison results

**The deterministic parser matched the reviewed helper on these ten notes and was much faster. This comparison does not establish a unique Meta advantage.**

The complete `note-intake-v1` run took place on 1 November 2026, 07:15:27–07:16:49 UTC. The [protocol](NOTE_COMPARISON_PROTOCOL.md) and ten visible synthetic fixtures were frozen before its twenty live model calls. Both model arms used `muse-spark-1.3`, low reasoning, one call per fixture and a 4,096-token completion limit. There were no retries or provider failures. The [actual record](../examples/note-intake-comparison-20261101.json) retains every attempt, prompts, schemas, raw replies, normalized fields, scores and timing; no authorization headers are retained.

| Approach | Exact cases | Correct fields | Incorrectly filled unknowns | Model calls | Median execution | Total execution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Label/unit parser | 10/10 | 70/70 | 0 | 0 | 0.478 ms | 4.649 ms |
| Plain Meta extraction | 9/10 | 68/70 | 0 | 10 | 2,732 ms | 35,806 ms |
| Reviewed app helper | 10/10 | 70/70 | 0 | 10 | 4,621 ms | 45,469 ms |

The plain arm's only mismatch was `fill_only_unknown_assembly`: it omitted the observation identifier and provenance. It correctly left complete-assembly mass and weighing uncertainty unknown and retained the stated adjustment limits. It did **not** invent a mass or make an unsafe numerical substitution. Raw semantic correctness before the reviewed helper's quote/structure checks was also 10/10; the plain arm's raw semantic score was 9/10. No quote rejection produced this difference.

The seven scored fields are identifier, provenance, assembly mass, weighing uncertainty, maximum addition, maximum removal and adjustment uncertainty. The working parser includes label synonyms, g/kg conversion, current/obsolete/planned distinctions, component-versus-assembly handling and explicit unknowns. It does not receive fixture IDs or expected answers. Nevertheless, its code and all three approaches were evaluated on visible developer-authored examples, with only one model sample per note. These results cannot establish performance on unseen writing, contaminants, materials or physical products.

## What changes in the product claim

The earlier [scripted app task](OBSERVATION_INTAKE_EVALUATION.md) observed four completion actions through note review versus nine manual actions for one supplied note. This remains an in-app control-count result; it is not a human timing study, does not include note authorship and does not measure review effort. The new comparison measured extraction, not end-to-end human completion, and shows that a simpler parser can supply the same fields on this set. Neither the control count nor the 10/10 score supports a claim of unique AI efficiency or safety superiority.

Together with the [nine-case numerical tie](BENCHMARK_RESULTS.md), these results weaken a prize argument based on arithmetic or note extraction. The potentially useful product is a shared, reviewable route from a changing input and product target to an applicable calculation and practical next action. Its general user benefit, physical outcome and award-worthiness remain unproved. Do not tune more visible notes merely to manufacture an advantage.

## Reproduction and integrity

Run from the repository root with fresh output paths; live execution uses the local server-side configuration and incurs actual calls:

```sh
.venv/bin/python scripts/benchmark_note_intake.py --offline --output outputs/note-intake-v1-parser-recheck.json
.venv/bin/python scripts/benchmark_note_intake.py --freeze-protocol --protocol-lock outputs/note-intake-v1-recheck-lock.json
.venv/bin/python scripts/benchmark_note_intake.py --mode all --protocol-lock outputs/note-intake-v1-recheck-lock.json --output outputs/note-intake-v1-live-recheck.json
```

The harness refuses to overwrite final/partial records or protocol locks, and refuses a live run if the lock differs from the current designated files. Preserve new failures and changed outputs. Provider timing and stochastic responses need not reproduce exactly.

The retained record's SHA-256 is `962f769c7bfeb5811e97e117f641e493a577f640df890e5c8a36587f6dbf5391`. Its embedded manifest records fixture SHA-256 `4785fd43ba057cdda8294d556217781d072816a5fecc32b56ef0f43f91405e20` and the full hashes of the protocol, harness, production note reader and Meta transport. All four designated files matched those hashes when this report was written. The manifest does not freeze every transitive dependency, environment detail or provider deployment; it is not a bit-for-bit environment snapshot. Later balance-workflow changes do not turn this note comparison into a balance benchmark.

The record was copied byte-for-byte from the completed local run and checked for the configured private credential before retention. It contains synthetic notes only, with `physical_product_tested: false`. Source excerpts establish occurrence and unit conversion, not correct interpretation; user review remains necessary.

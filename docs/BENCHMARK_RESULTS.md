# Matched mass-workflow comparison

Run completed 1 November 2026 local time, using `muse-spark-1.3`. The [protocol](ADAPTATION_EVALUATION.md) and nine synthetic cases were fixed before the run. The [complete actual record](../examples/engineering-comparison-20261101.json) includes requests, independent numerical references, responses, executed tools, decisions, usage, timing and implementation hashes. It is a recorded benchmark, never a substitute for a fresh app request.

| Approach | Completed | Numerically correct | Model calls | Calculation calls | Median time per case | Total time |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary Meta, given the equations | 9/9 | 9/9 | 9 | 0 | 3.775 s | 35.505 s |
| Deterministic tools | 9/9 | 9/9 | 0 | 10 | 0.001 s | 0.017 s |
| Meta with executed tools | 9/9 | 9/9 | 20 | 10 | 5.048 s | 52.567 s |

Both model approaches received responses on every attempted case. There were no provider rejections in this run. Ordinary Meta used 18,637 reported tokens; the tool-backed workflow used 54,989. These are actual single-run totals, not cost estimates or latency guarantees. Timing includes local wall time and is rounded to milliseconds.

The cases cover a common fixed volume, individually adjustable volume, capacity repair, excessive density uncertainty, overweight tare, and four assembly-feedback outcomes. Grading checks actual commands against independent forward corners and bisection, rather than asking a model to grade itself. It does not verify arbitrary explanation text.

## What the result means

**No numerical advantage was demonstrated.** All three approaches solved these deliberately visible, elementary diagnostic cases. The deterministic tools were fastest. Meta's interpretation and conversational interface may still be useful, but neither reduced user work nor superior handoffs were measured here. These results do not justify an AI optimization, frontier-science, real-world impact or award-worthiness claim.

The tool-backed workflow did establish a real integration: Meta selects calculations, the server executes them against the shared case, and the proposed action must match the latest inspected result. That is a useful implementation property, not evidence that Meta beats the simpler alternatives.

Before this benchmark, the first browser diagnostic calculated the correct capacity repair but presented an obsolete failure as its basis. The next diagnostic correctly refused a stale basis but exhausted its turn limit. Both records were retained locally. Requiring the latest inspected computation and explicitly returning its execution ID resolved that observed failure; the subsequent real browser run completed in three turns with a checked 490 cm³ proposal. This does not guarantee future semantic correctness.

Every input here is synthetic. No material was processed, no product was tested, no production-batch variation was measured, and no user study was conducted. The fixtures are not a held-out generalization test. Only mass and capacity under the declared model were evaluated.

## Next acceptance gate

The current forms still ask users to assemble too much of the calculation request themselves. The next comparison should test an actual user job: take a plain-language case and measurement note, confirm only the extracted details, run the applicable calculation and revise from a new observation. Use a strong form-based baseline and ordinary Meta with the same information. Record actual interactions, corrections, completion, time and unsupported assumptions. Do not infer usability gains from model-call counts or replace this neutral result with selected successes.

Run the numerical comparison again with:

```sh
.venv/bin/python scripts/benchmark_engineering.py --mode all --output outputs/engineering-matched-new-run.json
```

The default and `--offline` modes run only the deterministic arm without a provider call.

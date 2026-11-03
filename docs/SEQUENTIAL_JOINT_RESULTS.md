# Sequential mass-and-balance diagnostic — results

The complete frozen v1 run returned **6/6 correct stage decisions and 3/3 correct two-observation cases for both arms**. This does **not** demonstrate an accuracy advantage for ReMatter over the strong ordinary-Meta-plus-calculator baseline. The configured model was `muse-spark-1.3`; all inputs were synthetic and no material or product was tested.

| Arm | Correct stages | Correct two-stage cases | Actual model calls | Sum of recorded stage times |
| --- | ---: | ---: | ---: | ---: |
| Ordinary Meta with calculator result supplied | 6/6 | 3/3 | 6 | 31.439 s |
| Production tool-backed workflow plus missing-input gate | 6/6 | 3/3 | 10 | 31.631 s |

Every attempted stage completed. All 11 live decisions returned usable responses: the ordinary arm made six model calls and the workflow made ten model turns across five live decisions. The workflow's missing-centre-uncertainty stage was blocked locally with zero model calls. Those sums include the ordinary model's 11.301-second missing-bound response while the locally reproduced workflow gate recorded zero; they are not human task times or a general latency comparison. Both arms received the same canonical case and current observation. The baseline received the existing calculator's result before the model request; this is a strong comparator, not a test against unassisted chat.

| Synthetic case | Stage 1 | Stage 2 | Result |
| --- | --- | --- | --- |
| Hold, then missing bound | Keep unchanged: both target ranges fit. | New observation lacks centre uncertainty; ask for the bound and issue no command. | Both passed both stages. The workflow's gate was reproduced headlessly, not exercised in a browser for this experiment. |
| Trim, then update | The entered 0.95 kg, +10 mm observation produced +104 g / −54 g. | The 1.00 kg, +5 mm observation produced +42 g / −42 g. | Both passed both stages and their commands passed independent corner checks. |
| Reversed trim, then overweight | Reversed allowed locations produced −54 g / +104 g. | Minimum possible mass minus the total removable mass still exceeds the maximum target. | Both passed both stages; no command was issued for the infeasible observation. |

The grade verifies structured action, increment, stock bounds, and independent Decimal uncertainty corners; it does not independently grade all explanatory prose. One workflow explanation said the final observation was “over by ~0.175–0.225 kg” without specifying which target boundary each endpoint used: the exceedance above the **maximum** target is 0.175–0.185 kg. The infeasibility decision remains supported by the separate lower-mass/maximum-removal proof. This is an example of why the model's wording is not a checked result.

The harness supplies canonical shared context at each stage and does not exercise actual browser persistence, user review, note authoring, interaction effort or elapsed time for a person. The fixtures and earlier example values are visible, developer-authored cases; three sequences are far too few to establish general reliability. The comparison measures the decision on each stated observation, not how the material input itself changed or how a formulation will perform.

[Frozen protocol](SEQUENTIAL_JOINT_PROTOCOL.md) · [Fixtures](../examples/sequential-joint-v1.json) · [Hash lock](../examples/sequential-joint-v1-lock.json) · [Complete retained live run](../examples/sequential-joint-v1-live.json) · [Harness](../scripts/benchmark_sequential_joint.py). Each captured model turn, request, returned structured data, timing and tool trace is retained; credential values are excluded. The result remains private with the repository.

The frozen production sources, including the pre-run `BalancePlanner.tsx`, match private commit `59c6bc6`. The interface was subsequently changed to name a missing balance uncertainty; a fresh run must freeze the new versions separately. This recorded run is not retroactively attributed to the changed interface.

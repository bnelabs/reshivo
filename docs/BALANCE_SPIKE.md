# Two-position mass and balance feasibility check

Started 1 November 2026, before adding an interface. This is a bounded extension of the user's job: a recycled ballast assembly may need both a mass range and a balance-point range. A mass-only correction can meet one while missing the other. The output should specify an adjustment amount **and its location**, with a drawable placement plan.

The model needs a reported or explicitly synthetic complete-assembly mass and one-axis centre of mass, their stated bounds, and the known mass-centre coordinates and available addition/removal limits at two independent adjustment locations. A hole's geometric centre is not automatically the mass centre of a trim unit. Missing spatial measurements stay missing. No constituent densities, material response, contamination effect or source-study values enter the model.

Classical mass/moment balance supplies the calculation: `M = M0 + a + b`, `M*x = M0*x0 + a*xA + b*xB`. This is established mechanics, not a novel algorithm or frontier-science claim. [NASA's centre-of-gravity explanation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/aircraft-center-of-gravity/) and [earlier ballast-placement optimization](https://backend.orbit.dtu.dk/ws/files/54505528/An_accurate_model_for_seaworthy_container_vessel_stowage_planning_with_ballast_tanks.pdf) establish direct prior art. The potentially useful product result is a checked, case-bound placement/adjustment plan within the recycling workflow.

## Fixed first check

Synthetic complete assembly: 0.95 kg ±0.005 kg, centre x=10 mm ±0.5 mm. Targets: 0.98–1.02 kg and x=−2…2 mm. Adjustment mass centres: −60 and +60 mm, explicit zero position error. Each allows up to 0.15 kg addition or 0.08 kg removal, with ±0.001 kg adjustment error. Coordinates share one stated datum. Separate trim stocks are declared; no loose material is processed.

Compare a +0.05 kg command at the left location with a coupled two-location candidate. The first should pass mass and fail balance. A midpoint candidate near +0.104166667 kg left / −0.054166667 kg right should pass both under every stated uncertainty corner. Use an explicitly entered 0.001 kg command increment, round the candidate and recheck the rounded command itself. Independently recompute all corners and record failure cases before any interface work. A failed bounded nearby-grid search is not proof that every command at that increment is infeasible.

Acceptance: actual forward verification of the example, a no-operation case, insufficient adjustment capacity, missing/invalid measurements and a precision-limited case. A returned rounded command must itself pass, rather than relying on an unrepresentable exact solution. Report simulations and infeasibility honestly. Do not claim tipping safety, friction, structural suitability, containment, durability or future-batch consistency. This compares engineering policies; it does not establish Meta superiority over the numerical solver.


## Delivered implementation and actual loop

The implementation now binds the model to the existing shared case, mass observation and optional shared balance target. Manual and Meta-assisted routes use the same inputs. A comparison action is optional; blank means no adjustment. The planner preserves no adjustment or an entered single-location baseline when that already passes both targets; it does not force two operations. Exact gram commands and location coordinates are retained in cards/SVG, while rounded range labels are approximate.

Actual first browser check: +104/−54 g, mass 0.993–1.007 kg, centre −0.625628…0.664179 mm. A new explicitly synthetic 1 kg / x=5±0.5 mm observation changed the action to +42/−42 g, mass 0.993–1.007 kg, centre −0.685930…0.604478 mm. Both use the same targets and trim definitions; these are two software observations, not a physical before/after experiment. Changing observation identity/mass cleared its old centre reading and result before a new centre could be entered.

Two preliminary fresh Meta runs completed in two turns each (3.736 and 4.221 seconds); two more fresh requests in the recorded demo (not included in this export) and their full actual traces are retained in [examples/mass-balance](../examples/mass-balance/). Each executed the joint tool; no old response was presented as a fresh call. Desktop/mobile QA and independent Decimal corner checks cover the returned commands, invalid/missing bounds, stock limits, no-op, stale binding, precision limits and exact displayed command precision. This extends the useful product output; it does not establish a unique Meta advantage.

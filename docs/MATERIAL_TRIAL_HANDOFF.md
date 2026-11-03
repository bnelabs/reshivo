# From a recorded setting to the next mix trial — 3 November 2026

ReMatter now connects a matching entered composition to quantities for a proposed new trial. The product, material, process and named components come from the shared case. The user explicitly identifies which component the changed mass percentage describes. The original case and readings stay unchanged.

The proposed trial keeps one exact recorded percentage, its property, method, target, reading values and separate grouping identifiers. It does not interpolate, widen a point into a range, import source readings or predict the new mix's physical properties. The addition stock must have a user-stated name and known component fraction. Unknown stock composition stays unknown.

## Verified material action

The browser diagnostic is explicitly synthetic: a hypothetical PE material-development case, a chosen minimum yield-stress screen of 25 MPa, and one invented software-check reading at each of 20 and 40 mass percent PCRPE (26 and 22 MPa respectively). These are not source measurements or material tests. The 20 percent setting is a candidate for planning this diagnostic's next trial, not a validated recipe.

For a one-kilogram starting portion and addition stock with zero PCRPE:

| Entered starting PCRPE fraction | Exact trial composition | Calculated stock addition |
| --- | --- | --- |
| 25 mass percent | 20 mass percent | 0.25 kg |
| 24 mass percent | 20 mass percent | 0.20 kg |
| 26 mass percent | 20 mass percent | 0.30 kg |
| A range of 24–26 mass percent | 20 mass percent | No single fixed addition covers the range |

The last case offers a constructive next action: characterize each portion more precisely and calculate its dose, or make and test another composition. It does not recommend discarding material or widening an unsupported property-backed point. Starting-portion values entered in this calculator can describe a different hypothetical portion from the nominal shared recipe; the original recipe remains attached as reference, and the calculation records its own actual inputs.

The browser-exported [24 percent record](../examples/material-demo/composition-trial-start-24.json) and [26 percent record](../examples/material-demo/composition-trial-start-26.json) were independently checked. Both retain the original nominal 250/750 gram case and synthetic property reading, unknown grouping, the chosen 20 percent point and new-trial status. No density is used.

## Contextual Meta review

An explicit button sends a previewable proposed-trial summary with the current case and recent discussion. It includes the reference property/method and exact point, starting portion, characterized stock and actual composition-calculator result. The model reviews practical next preparation, process and product-property checks; it does not supply the arithmetic or establish finished performance.

An initial real review completed in 49.5 seconds. It distinguished the nominal 250/750 gram reference from the separate 26 percent calculation, retained the original targets, treated the 26 MPa reference as synthetic and kept processing/testing conditional on a suitable facility. It still repeated too much context and mentioned an irrelevant absent mass target. The answer instructions were subsequently shortened to lead with the next action and skip unrelated optional targets. This does not establish that all future responses will follow those instructions.

Two subsequent reviews failed at about the former 50-second transport bound. The endpoint remained reachable. Detailed high-reasoning requests now have an 80-second bound; ordinary requests retain 50 seconds. Timeouts are reported separately from connection failures, with no generated substitute. The subsequent real review completed in 42.039 seconds. It led with recording exact grades and preparation, preserved the chosen tensile screen, and used three short paragraphs without mentioning irrelevant absent mass limits. This single success does not establish a reliability or latency guarantee.

Direct review requests and ordinary follow-ups descended from that review are tied to the calculation context. Edits stop their pending requests and mark previous advice as old. The actual browser sequence also started an ordinary chat follow-up after a successful review, changed the starting fraction while it was pending, and verified that the request stopped, the old dose cleared and earlier advice was marked old. A generic follow-up cannot clear that warning; a fresh current comparison/trial summary is required. A separate new route exploration starts without the old calculation conversation.

## Verification and limits

Environment: local `http://127.0.0.1:8799/`, in-app browser, desktop 1280 by 720. The Browser plugin was unavailable; the supported computer-use browser interface performed the interactions. Temporary viewport emulation was restored and the 1280-pixel width confirmed.

| Check | Outcome |
| --- | --- |
| Page identity, meaningful content, no framework overlay | Passed |
| Shared context | Known one-kilogram starting amount and 25 percent nominal fraction reused without another product/material setup |
| Exact setting | Both trial limits fixed at 20 percent; the request uses that same point |
| Lossy conversion | `20.000000000000000005` kept in the comparison, blocked from this numeric composition calculator |
| Unit basis | Volume-percent comparison remains available; mass-quantity preparation blocked with a useful explanation |
| Stale data | Reading edits and withdrawn component mapping clear the old proposal and dose |
| Units | One kilogram displays as approximately 2.204623 pounds; returning to metric retains exactly one kilogram. The 0.30 kg addition displays approximate pounds alongside its stored kilogram value. Measured property units and percentages do not change. |
| Downloads | Original case, exact point, synthetic status, unknown grouping and actual addition retained |
| Browser console | No warnings/errors in the checked calculation flows; the two failed live requests are retained separately and are not counted as successful reviews |
| Narrow viewport | DOM widths showed no horizontal overflow at 390 pixels. The screenshot pipeline returned inconsistent crops/scaling, so this new handoff has no accepted mobile visual check. |

The full Python suite has 326 passing tests, including distinct timeout/connection failure behavior. All five frontend check groups, the production build, research source hashes/cells and diff check pass. These checks establish software behavior within their scope, not material response, future consistency or general AI superiority.

Local before/after screenshots, failure records, actual Meta review and dose verification are under `outputs/action-handoff-20261103/`; these private working artifacts are omitted from the source-only export. The representative dose view is also in the tracked video poster and review cut.

Final actual request/response: [Meta composition review](../examples/material-demo/live-composition-review.json). The earlier verbose response and failed requests remain in the local production folder.

## Demo and judging verdict

The 113.92-second private review cut (not included in this export) includes the actual app/source sequence and the changing-dose scenarios. The new scenes hold real app screenshots with clearly identified editorial quantity labels. The source study stays separate from My case, and all own-case property readings and composition scenarios stay synthetic. The video preserves original recorded Meta interactions rather than presenting replay as fresh calls. Ming narration, caption matching, decode, loudness and encoded-frame inspection pass; listening review is still pending.

The direction now answers a relevant “what should I add for the next trial?” question. It remains a credible prototype rather than a demonstrated prize winner. Fraction balancing and reading filters are elementary; a connected interface and model-generated trial plan do not establish frontier novelty or an advantage over capable chat plus a calculator. Earlier tied or faster-baseline results remain valid. The material-task advantage gate stays open; no award or product-performance claim follows from this work. Everything remains private, and publication/submission belong to the owner.

# Additional PP study measurements

These files extend the **source-data collection**, not the app's product predictions. All six added archives match the MD5 checksums in the retained Zenodo record. SHA-256 values are recorded for every archive and every member. Existing core inputs and their hashes are unchanged.

Source: Ng et al., *Evaluating the recyclability and restabilization of laboratory plastics consumables: impact of autoclaving and mechanical recycling on polypropylene*.

- Dataset: https://zenodo.org/records/19370161 (version 2).
- Paper: https://doi.org/10.1039/D6SU00069J.
- Dataset license: CC BY 4.0, as stated in the source record.
- Download URLs and declared checksums: `source_manifest.json`.
- Material, process, method, test conditions, repetition design, units and supported question: `catalog.json`.
- Source-quality exceptions: `quality_findings.json`.

Each CSV row contains a `dataset_id` linked to `catalog.json`, the source member and an exact cell or line location where applicable. The common source/material/process/license fields apply by that explicit key. Original numeric test codes remain unmapped to named additive recipes. Values are copied from numeric source files; no plot has been digitized. GPC dispersity/PDI is classified as a source-reported calculated quantity (Mw/Mn), while Mn/Mw are source-reported GPC estimates. Color coordinates and indices are classified as instrument outputs. These output fields never increase the number of specimens or repeated measurements. Newly computed descriptive means and sample SDs are separately labelled and do not replace source cached summaries.

## Inventory

| Set | Extracted data | Supported question | Limits |
|---|---|---|---|
| MVR | 36 literal condition codes; 72 runs; 1,740 within-run readings; available-reading run means and same-code two-run summaries | Compare measured melt flow at 230 °C and 2.16 kg load for the recorded source conditions | No mould-filling prediction, density, acoustic property or batch-consistency range. Ten runs have fewer than the stated 25 numeric cells. |
| Melt rheology | 54 source traces; 2,106 frequency points; 28 literal codes, including a probable naming typo | Compare viscosity and oscillatory response of the melt at 200 °C under the recorded test setup | Melt tan(delta) is not room-temperature solid damping. Frequency points are not separate samples. |
| DSC | Four heating/cooling curves; 8,400 points; PP_REG and PP_VIRnak base states | Inspect the measured heat-flow curves and thermal transitions of those base materials | No automatically extracted melting peak, contamination percentage, service-temperature rating, lifetime or acoustics. These base-state IDs are not the eight tensile-condition codes. |
| OIT | 12 workbook codes; 59 numeric endpoint measurements; original 64 trace files retained inside the archive | Compare oxidation onset under the 210 °C laboratory protocol | No product lifetime forecast. One group has four values, not five. Workbook IDs omit extrusion suffixes; no forced tensile join. |
| GPC | Three base material states, two measurements each; 18 Mn/Mw/dispersity values | Compare molecular-weight measurements of those three states | Does not describe all extrusion conditions, density, damping or contamination response. Raw unheaded distribution columns remain uninterpreted. |
| Color | 18 test codes; 54 specimen IDs with values; 153 reading sets; 765 property values | Compare CIELAB coordinates, gloss G and yellowness of the source injection-moulded test pieces | Actual readings per condition are 6–9, not always nine. No finished-sheet color tolerance, RGB rendering, weathering or batch consistency. Illuminant, observer and gloss angle were not established. |

The source PP REG is the study's post-consumer laboratory PP regranulate. PP VIRak and PP VIRnak are virgin controls. No result is copied to another plastic, newly invented blend, or named contaminant concentration. The article's general repeated-extrusion method is recorded in the catalog; matching a number to a specific code does not establish applicability to an arbitrary processing line.

## Source summary issues

1. **OIT error cells** use a range that omits the first endpoint and includes the mean, e.g. `STDEV(B3:B7)`. This is not the SD of the five original endpoints. The original cached value and formula are preserved alongside an explicitly derived SD of actual endpoint values.
2. **GPC error cells** similarly use the second reading and the mean, e.g. `STDEV(D2:E2)`, instead of both original readings.
3. **MVR source summary cells** combine selected within-run readings rather than just calculating SD of the two run means. New run means and same-code two-run summaries describe their actual available values; they are not a silent correction of the publication.
4. **Color counts and selected ranges** differ in a few places. Four conditions have fewer than nine numeric readings. For `04441PP-VIRak(1)-1E1`, source summary formulas select seven of nine visible readings; the exclusion reason is not stated. Both source and all-visible-reading summaries are retained.
5. **Rheology naming** has both `04441PP-VIRak(1)-3E5` and `04441PP-VIRak1)-3E5`. The probable missing parenthesis is recorded as a possible association only; identifiers are not silently merged.

These issues restrict statistical interpretation. They do not turn repeated measurements into independent waste batches.

## Reproduce

From the project root:

```sh
python3 scripts/extract_pp_study.py
```

The extractor uses only the Python standard library. It preserves cached archives, downloads missing archives only from the source record, verifies each declared MD5, records SHA-256 member hashes and rebuilds the derivative CSVs/catalog. Proprietary Origin projects remain preserved source files; they are not executed. The original GPC DOCX contains images and is retained inside its archive, not treated as an extracted numeric table.

## Cases still unsupported by this study

Counterweight mass needs measured density of the processed material and volume. Counterweight mass variation additionally needs relevant repeated material/process measurements and dimensional variation. No density was found in the inspected source sets. Sound blocking/absorption requires matching acoustic measurements. No contamination dose-response, independent-batch distribution, long-term creep or fatigue data were established here.

# Named polymer contamination — source measurements

Source: Dawoud and Taha (2024), [Effects of Contamination with Selected Polymers on the Mechanical Properties of Post-Industrial Recycled Polypropylene](https://doi.org/10.3390/polym16162301), CC BY 4.0. The archived full-text XML has a locked SHA-256 hash in `sources.json`.

The source compounds post-industrial PP with named ABS, PC, PET, PLA or PS at 3, 5, 7 and 10 wt%, followed by pelletising and injection moulding. Pure reference materials and blend-specific PP controls remain separate. These are not the PP stream from the original ReMatter study.

## Retained numbers

- 79 exact Table 6 cells: 27 melting temperatures, 27 melting enthalpies and 25 reported glass-transition temperatures. DSC uses a second heating, 20 K/min, nitrogen at 60 mL/min, and approximately 10 mg samples. The number of DSC specimens is not reported.
- Four exact tensile mean/SD pairs from Section 3.2: strength of PP with 3 or 10 wt% PET, and elongation at break of PP with 10 wt% PC and its corresponding PP control. The method states at least 12 tensile specimens per material; the exact count and independent batch count are not given.

Every retained measurement has its original row/code or prose locator, property, unit, material, contaminant amount, processing context, count status and allowed use in `measurements.json` and `measurements.csv`.

## Questions these numbers support

- What DSC response was measured for the named mixture under this process and test method?
- What tensile result was reported at either of the retained PET amounts or for the retained PC comparison?

These are source comparisons. There is no interpolation, generic contamination penalty, density, acoustic response, prediction for another PP stream, or finished-product consistency calculation.

## Exclusions and cautions

- Plot-only tensile and flow values are not digitized. The four prose mean/SD pairs do not represent the whole mechanical experiment.
- Reference crystal enthalpies and source-calculated crystallinity are not relabelled as direct measurements.
- Table 1 and Table 2 use different units when describing screw speed. Their labels are preserved, not silently reconciled.
- Blank DSC cells stay absent; the reported zero glass-transition value stays zero.
- Pure-PC processing has a stated temperature exception, but no complete replacement zone profile. Its record carries that gap.
- Pure-reference injection settings are described as similar to the blend settings, with explicit mould-temperature exceptions. Exact identity of all settings is not assumed.
- Prose tensile values have assigned cross-reference labels based on the named polymer, amount and comparison context; they are not presented as verbatim source test codes.
- PP control rows at the same processing temperature appear in more than one blend comparison; they must not be pooled as independent experiments.

Rebuild with `.venv/bin/python scripts/extract_contamination.py`. The script verifies the original XML hash before extracting the cells and prose values.

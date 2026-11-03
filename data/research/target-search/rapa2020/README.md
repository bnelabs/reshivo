# Râpă 2020 — tensile means at tested filler levels

Source: Râpă et al. (2020), [Effect of Styrene-Diene Block Copolymers and Glass Bubbles on the Post-Consumer Recycled Polypropylene Properties](https://doi.org/10.3390/ma13030543), Materials 13(3), 543. The article is **CC BY 4.0**, explicitly stated in its XML permissions and linked to the license. The official [Europe PMC full-text XML](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7040787/fullTextXML) is retained under `originals/`; its locked SHA-256 is `c5e4a32199ffe8fed2d8b258649c5e7f585e5bf8c04269771a052f186b6db642`.

Only six **reported mean and standard-deviation pairs for tensile strength at break** are retained. Each mean describes five tensile specimens per blend; the individual specimen readings and independent production run/batch counts are unavailable. This is a source-mean comparison at tested levels, not a sample-range or finished-product target check.

| Matrix family | Added S22 glass bubbles, vol.% | Reported tensile mean ± SD, MPa |
| --- | ---: | ---: |
| rPP/SBS | No added GB reference | 21.99 ± 1.75 |
| rPP/SBS | 5 | 21.36 ± 1.24 |
| rPP/SBS | 20 | 20.45 ± 1.23 |
| rPP/SIS | No added GB reference | 22.39 ± 1.45 |
| rPP/SIS | 5 | 23.51 ± 1.34 |
| rPP/SIS | 20 | 24.22 ± 1.63 |

The post-consumer rPP came from collected injection-moulded boxes. SBS and SIS are distinct synthesized matrix modifiers and stay in separate series. The source describes all six formulations mixed at 180 °C for 10 minutes at 50 rpm and compression moulded into sheets at 185 °C: four-minute preheat, two-minute pressing at 125 atm and 45-minute cooling. Mechanical specimens were cut from pressed sheets. The tensile test used ISO 527, a 90 mm gage length, 6.6 mm width, 4 mm thickness and reported pull-off speed of 50 mm/min. The stated test environment was 23 °C and approximately 50% humidity.

Numbers retain the original sample labels and exact locations: Table 6, tensile-strength column; Table 1 composition rows; Table 2 **Sheet** column; §2.4 processing; and **§2.5.6 Mechanical Characterization** for tensile method and five-sample count. Table 1 uses **wt% for rPP/elastomer and vol.% for GB**. Those exact source strings are preserved without conversion or a reconstructed mass recipe. A source dash denotes each no-added-GB reference; the structured numeric zero is explicitly marked as that interpretation, not as a numeric source cell.

An entered target can be compared with a source-reported mean at one of these tested levels. SD is shown separately and cannot be treated as an observed min/max, tolerance, confidence interval or future-batch range. There is no interpolation, pooling between SBS/SIS, transfer to another waste stream, density or mass calculation, acoustic prediction, or finished-product consistency claim. Other Table 6 properties remain outside this package. In particular, the density method mentions three replicates but does not resolve whether they are different specimens or repeated determinations; these density values are excluded from the stricter target-check set.

Rebuild with `python3 scripts/extract_rapa_tensile.py`. Verify without writing with `python3 scripts/extract_rapa_tensile.py --check`. The standard-library parser checks source hash, DOI, title, license, headers, all six mean/SD cells, all six composition rows, common sheet-process cells and the property-specific five-specimen statement. `build(root: Path) -> dict` exposes the same extraction for the project audit. The local `manifest.json` records source, observation and README file hashes.

# Controlled source levels — yield stress

Source: Cecon et al. (2021), [Dataset of the properties of polyethylene (PE) blends of different densities mixed with post-consumer recycled polyethylene (PCRPE)](https://doi.org/10.1016/j.dib.2021.107452), **CC BY 4.0**.

`cecon2021_yield_stress.json` contains **210 literal yield-stress cells**, in MPa, from the original `mmc1.xlsx` supplement. No mean, interpolation or new material is added by this extraction.

- Four host series: LDPE, LLDPE, MDPE and HDPE. Within each series, the reported PCRPE content changes through 0, 20, 40, 60, 80 and 100 wt%; the virgin host supplies the remainder at 0–80 wt% PCRPE.
- Twenty-one unique conditions: four virgin controls, sixteen blends and one shared 100% PCRPE condition. The shared endpoint is stored once and referenced by all four series.
- Ten individually tested ASTM Type I dogbone specimens per condition, stated in article sections 1 and 2.5. Source specimen IDs and independent production-run/batch counts are not supplied. Table-row order is retained without inventing specimen IDs.
- Common reported preparation: manual resin blending and Battenfeld HM90/350 injection moulding at a 185–195 °C profile. Tensile testing uses an AGS-J with a 5 kN load cell, MWG-5kNA grips and 500 mm/min crosshead speed. The article states ambient 22 °C unless otherwise noted.

The workbook's `Data` sheet identifies the property at `AQ1`, input at `AQ2:AQ3`, hosts at `AR2:AU2`, and MPa units at `AR3:AU3`. For each host, the 0/20/40/60/80 wt% levels use ten-row blocks `4:13`, `14:23`, `24:33`, `34:43` and `44:53`. The 100% PCRPE readings occupy `AR54:AR63` only. Every retained value records its exact cell, corresponding input-level cell, original numeric string and source context.

These data can answer whether reported yield-stress readings at a tested source level fall inside a target. They do not describe the user's waste, a metal-dust/binder mix, density, acoustics, future batches or finished-product consistency. Commercial grade identifiers and complete recycled-stream contaminant composition remain unknown. The density and mechanical sections have different row-block sizes; matching row numbers across them is not a specimen link.

Rebuild offline with `python3 scripts/extract_cecon_yield.py`. The parser checks locked SHA-256 hashes for the original workbook and article XML, workbook ZIP integrity, source sheet and headers, literal numeric cells, units, content levels, counts and the shared endpoint. It requires only the Python standard library.

`calculation_inputs.json` separately pins the extracted JSON and both original files for the published target-check endpoint. Runtime loading checks that exact file set and hashes, then validates the retained property, units, host series, tested levels, observation identities and ten-specimen grain. Changed or missing files stop the source comparison with a source-unavailable response.

The target comparison checks each recorded yield-stress value against an inclusive minimum/maximum. A matching tested level means all ten source values are inside the target. Per-condition means and extrema are descriptive calculations only. No intermediate content level or new material is generated, and the check supplies no reading to My mix. The research audit additionally compares all 210 extracted values and their input-level cells directly with the original workbook.

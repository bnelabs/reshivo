# Density inventory — 30 October 2026

These are source measurements and descriptive calculations. No counterweights were made or tested, and no finished-product consistency is established.

| Source | Retained data | What can be calculated or displayed | Limits |
|---|---|---|---|
| Cecon et al. 2021, DOI 10.1016/j.dib.2021.107452, CC BY 4.0 | 105 individual density readings across 21 conditions, five readings per condition. Seventeen conditions contain recycled PE (85 readings); four are virgin controls. | Source density comparison and a hypothetical mass calculation, `mass_g = density_g_cm3 × chosen_volume_cm3`, using one matched material/process condition. The five source readings can be scaled separately to show the observed-sample scenario. | Within-condition variation only. No independent batch count or complete PCRPE composition. Transfer from specimen fragments to another product assumes the same processed density and does not cover voids or volume error. |
| Hinczica et al. 2026, DOI 10.1002/app.70501, CC BY 4.0 verified in publisher-deposited Crossref metadata | Four published aggregate statistics for density over ten supplied PP batches: minimum 0.996, maximum 1.101, mean 1.031 g/cm³ and CV 2.8%. Five cut samples were measured per batch. | Display this source cohort's reported density summary. Its endpoints may illustrate a source-specific hypothetical mass scenario. | **Source-only in the application catalogue.** No individual readings or exact per-batch densities were extracted. Aggregation from readings versus batch means is not reconstructible. This is not a prediction of future batches or contamination effects. |

## Source measurements that are ready

`measurements.json` and `measurements.csv` retain the exact source-cell locations, measured values, material composition label, process, measurement method, sample count, repetition level, units, licence and supported question. `density_condition_summaries.csv` contains means, sample SDs and observed minima/maxima calculated only within each corresponding five-reading Cecon condition. Those summaries are explicitly derived values.

Cecon mixes commercial PCRPE with LDPE, LLDPE, MDPE and HDPE at the recorded 0, 20, 40, 60 and 80 wt% PCRPE levels. A single set of five readings at 100% PCRPE is stored once. The workbook leaves the other three host columns empty at that level; they are not additional replicates. The recycled stream's commercial grade and complete contaminant composition were not specified. Missing contaminant information means unknown, not zero contamination.

The source process is manual resin blending followed by injection moulding of ASTM Type I dogbones on a Battenfeld HM90/350 at a reported 185–195 °C profile. Density was measured on cut fragments using immersion weighing in ethanol at 22 °C. Five density measurements per condition are reported, but assignment of fragments to individual dogbones and independent production batches is not reported.

For example, the source's pure-PCRPE condition has five density values at `Data!B29:B33`: 0.9631, 0.9678, 0.9631, 0.9647 and 0.9626 g/cm³. Their descriptive mean is 0.96426 g/cm³. A **simulated** uniform volume of 1000 cm³ would therefore have a mean-density mass of 964.26 g; scaling those five source densities gives 962.6–967.8 g. Those are calculated scenarios, not measured counterweight masses or future-batch limits.

## File checks and recovery of the supplement

The preceding audit's `cecon2021_supp.zip` was a valid archive containing the actual 22,583-byte `mmc1.xlsx`, despite the earlier access verdict marking that workbook as unavailable. The source article XML was retrieved again from the official Europe PMC full-text endpoint. Its published attachment MD5, `7b503c8f124a57d328a616fef2734227`, exactly matches the extracted workbook. Both ZIP CRC checks pass. SHA-256 hashes of all retained original files are in `sources.json`.

The workbook and original supplementary package are preserved under `originals/`. The parser `extract_density.py` checks the source identity, attachment checksum, table headers, positive finite values, 21 condition groups and five readings per group before regenerating the structured files. It requires only the Python standard library.

Hinczica Table 5 and its methods were checked in the publisher's full-text web extraction. `originals/hinczica2026_publisher_web_extract.json` is a capture of that structured web response, **not raw publisher HTML or raw measurement data**. The local transcription records exact table columns and process/method sections. Direct HTML, PDF and XML downloads returned HTTP 403. The original publisher-deposited Crossref response confirms the version-of-record CC BY 4.0 licence. No source figure was digitized and no missing batch values were invented.

## Excluded and pending sources

The source-level reasons and URLs are in `sources.json`.

- Hinczica's ordered density specification is excluded from measured observations. Its measured Table 5 values are kept separately.
- Wagner 2025 contains a useful part-weight study with five parts per condition, but its density table is supplier information. Exact mass data were not obtained; no values were guessed from figures.
- Gall 2021's supplier density table is excluded. The paper describes measured specimen densities, but exact plot values were not extracted in this pass; proprietary recycling histories also limit transfer.
- Rodríguez-Liébana 2022 has relevant processed recyclates, but its CC BY-NC-ND terms and incomplete controlled-contamination description require separate review. It is not part of the eligible set here.
- The MDPI 2023 polymer-fraction page returned HTTP 429; unseen table values were not retained.
- Generic supplier density sheets do not establish measured variation under a matching process.

## Cases still unsupported

An arbitrary user's feedstock, a different manufacturing route, minor contamination of unspecified identity or amount, or a new blend between the recorded mixture levels remains unsupported. A new mixture must not be generated by averaging the retained source conditions. The observed source ranges do not establish future-batch reliability, full-product mass tolerance, acoustic performance, mechanical qualification or environmental savings.

The app now includes a conditional mass simulation using one selected Cecon PE/PCRPE condition. This is a worked example of published specimens, not a measurement of the user's waste. Metal-dust/binder mixes remain unsupported without density readings of the actual processed mix, and no finished-product consistency is established.

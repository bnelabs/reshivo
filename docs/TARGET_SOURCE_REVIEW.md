# Measured input levels — source review, 30 October 2026

The new check compares a user's target with measurements at recorded input levels in one source series. It does not predict an untested level, another material or the consistency of a finished product. The shortlist was reported before adding the check to the app.

## Sources ready for a target comparison

| Source | Material and changed input | Retained property and original numbers | Common process and count | Use now |
| --- | --- | --- | --- | --- |
| [Cecon et al. 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8517156/), DOI 10.1016/j.dib.2021.107452; CC BY 4.0 | Choose one virgin PE host: LDPE, LLDPE, MDPE or HDPE. The study's commercial PCRPE content is 0/20/40/60/80/100 wt%. Hosts remain separate. | **Tensile yield stress, MPa:** 210 individual values, 21 conditions. Supplement `mmc1.xlsx`, sheet `Data`, property header AQ1, input column AQ, host columns AR/AS/AT/AU. Ten-row blocks 4–13, 14–23, 24–33, 34–43, 44–53; shared pure-PCRPE endpoint AR54:AR63. | Manual resin blending; Battenfeld HM90/350 injection moulding, reported 185–195 °C profile. Section 2.5: ten individually tested ASTM Type I dogbones per blend, 500 mm/min crosshead speed. Independent run/batch counts unknown. | **Selected for the app.** Compare all ten recorded values at each tested level against a target. The shared 100% endpoint is stored once. |
| [Râpă et al. 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7040787/), DOI 10.3390/ma13030543; CC BY 4.0 | Post-consumer PP from collected injection-moulded boxes. Separate SBS and SIS polymer-matrix families; S22 glass bubbles at no-added-filler/5/20 vol%. The elastomer is stated as 10 wt% of the polymeric matrix. Preserve Table 1's mixed-unit, rounded composition entries without conversion. | **Tensile strength at break, MPa:** six source-reported mean/SD pairs, Table 6 rows rPP/SBS, rPP/SBS/GB 5/20, rPP/SIS, rPP/SIS/GB 5/20. SBS means 21.99/21.36/20.45; SD 1.75/1.24/1.23. SIS means 22.39/23.51/24.22; SD 1.45/1.34/1.63. | Section 2.4 and Table 2: Brabender mixing 180 °C, 10 min, 50 rpm; sheets compression moulded at 185 °C, 125 atm, preheat 4 min, press 2 min, cooling 45 min. Section 2.5.6: five tensile specimens per blend, ISO 527, 50 mm/min, 23 °C and about 50% RH. Batch count unknown. | Ready for a **reported-mean comparison only**, separately within SBS or SIS. Not enabled in the app. SD does not supply individual extrema or an all-specimen target result. |

The existing Cecon density case remains a worked mass simulation of the published PE specimens. Its five density measurements have weaker repeat classification than the ten explicitly tested tensile dogbones. Neither source describes the user's metal-dust/binder mix. Commercial grade and complete original contamination details remain unknown where the source does not provide them.

## Not used for this check

These decisions apply to the requested controlled-input target check, not to the scientific value of the papers. Rejected property values are not bundled as new calculation inputs.

| Source | Reason |
| --- | --- |
| [Ciobanu 2023 — recycled PET and metal powders](https://pmc.ncbi.nlm.nih.gov/articles/PMC10420901/), CC BY 4.0 | Fixed-heating-profile filler pairs exist, but the final fabrication route is not clearly identified after a failed hot-press attempt. Other controls also change heating profile. Do not assume the recommended extrusion/injection route was the one used. |
| [Zegardło 2018 — recycled-glass polymer concrete](https://pmc.ncbi.nlm.nih.gov/articles/PMC6073152/), CC BY 4.0 | The complete recipe is supplied for only one end condition; fixed binder amount across replacement levels is not verified. Strength series are figure-only. |
| [Recycled Aggregate Integration 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11355950/), CC BY 4.0 | Recipe levels and strength counts are given, but production/curing conditions are incomplete. Density count/method is missing; strength counts cannot replace it. |
| [Bulut and Ertürk 2025 — waste iron powder](https://doi.org/10.17776/csj.1642092), CC BY-NC 4.0 | Repetition allocation and the whole-composite percentage denominator are unresolved. No processed-mix density is provided. |
| [Badini 2023 — PP from a composting plant](https://doi.org/10.3390/recycling8040062), CC BY 4.0 in publisher-deposited metadata | **Pending independent table verification.** A primary-index capture suggests a useful tensile series, but direct publisher retrieval failed and an institutional PDF response did not match the requested article. No numeric measurements from it are retained here. Density-specific count is also missing. |
| [Vaidya 2023](https://doi.org/10.3390/jcs7030099) | The minimum-count statement is not unambiguously specific to each retained property and direction. Recipe/fibre-fraction labels also need reconciliation. |
| [Siltumens 2025 acoustic dataset](https://doi.org/10.3390/data10120199) | Different textile types and a complex mixture are compared, rather than a stepped input within one named material. |
| Existing Caniato foam / Alves sheet sources | Caniato lacks numeric thickness and complete installation details. Alves changes structure, hot pressing and thickness together; it is not a single changed input under one process. |
| Existing Dawoud/Taha contamination study | Full mechanical dose series are mostly figure-only. DSC specimen count is unknown; the isolated tensile prose pairs do not reconstruct the complete series. |
| Existing Hinczica / Biboud / original PP study | Respectively: aggregate supplied-batch statistics without controlled input levels; one compacted recipe rather than a stepped input; and unresolved test-code-to-formulation mapping. |

Supplier datasheets, unreported figures and unverified numbers were excluded. No new metal-rich dust/binder source passed all the requested checks in this search.

## Selected check

For a source MDPE/PCRPE series and a tensile-yield-stress target of **25–28 MPa**, the numbers inside the target at 0/20/40/60/80/100 wt% PCRPE are **1/10, 10/10, 0/10, 0/10, 0/10, 0/10**. The ten values at the tested 20 wt% level span **25.7195–27.0553 MPa**. This is a description of those recorded dogbones, not a new recipe recommendation or a future-product prediction.

Exact source cells, composition levels, material/process descriptions, count classifications, licences and file checks are in `data/research/target-checks/` and `data/research/target-search/rapa2020/`. The latter remains a source-comparison package and is absent from the app's calculation inputs.

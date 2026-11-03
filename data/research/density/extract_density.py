"""Extract source-cell density readings and retain their measurement context."""
from collections import defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
from statistics import mean, stdev
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SOURCE_ID = "cecon2021"
WORKBOOK = ROOT / "originals/cecon2021_mmc1.xlsx"
EXPECTED_MD5 = "7b503c8f124a57d328a616fef2734227"


def workbook_cells():
    raw = WORKBOOK.read_bytes()
    if hashlib.md5(raw).hexdigest() != EXPECTED_MD5:
        raise ValueError("Workbook does not match the supplement checksum in the source XML")
    article = (ROOT / "originals/cecon2021_article_fresh.xml").read_text()
    if EXPECTED_MD5 not in article or "PMC8517156" not in article:
        raise ValueError("Article identity or supplement checksum not present")
    with ZipFile(WORKBOOK) as archive:
        if archive.testzip() is not None:
            raise ValueError("Workbook CRC check failed")
        strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
        cells = {}
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        for cell in sheet.findall(".//s:c", NS):
            value = cell.find("s:v", NS)
            if value is not None:
                cells[cell.get("r")] = strings[int(value.text)] if cell.get("t") == "s" else value.text
    if [cells.get(f"{col}2") for col in "ABCDE"] != ["PCRPE", "LDPE", "LLDPE", "MDPE", "HDPE"]:
        raise ValueError("Unexpected density-table headers")
    if cells.get("A1") != "Density" or cells.get("B3") != "g.cm-3":
        raise ValueError("Unexpected density table or units")
    return cells


def write_csv(path, rows):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    cells = workbook_cells()
    observations, groups = [], defaultdict(list)
    hosts = {"B": "LDPE", "C": "LLDPE", "D": "MDPE", "E": "HDPE"}
    for row in range(4, 34):
        pcr_pct = int(float(cells[f"A{row}"]))
        if pcr_pct not in [0, 20, 40, 60, 80, 100]:
            raise ValueError("Unexpected recycled-content level")
        for col, host in hosts.items():
            cell = f"{col}{row}"
            if cell not in cells:
                continue
            density = float(cells[cell])
            if not math.isfinite(density) or density <= 0:
                raise ValueError("Invalid density")
            condition = "CECON21-PCRPE100" if pcr_pct == 100 else f"CECON21-{host}-PCR{pcr_pct}"
            groups[condition].append(density)
            observations.append({
                "measurement_id": f"{SOURCE_ID}-Data-{cell}",
                "source_id": SOURCE_ID,
                "source_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8517156/",
                "license": "CC-BY-4.0",
                "condition_id": condition,
                "property": "density",
                "value": density,
                "unit": "g/cm3",
                "raw_xml_value": cells[cell],
                "virgin_host": "" if pcr_pct == 100 else host,
                "pcrpe_wt_percent": pcr_pct,
                "recycled_material": "Commercial post-consumer recycled polyethylene used in this study; commercial grade and complete composition not specified",
                "process_id": "cecon2021-injection-185-195C",
                "process": "Manually blended resin; injection moulded Type I dogbones, Battenfeld HM90/350, profile 185-195 C",
                "method": "Immersion weighing in ethanol; Mettler Toledo ME-33360 kit with Denver M-120 balance",
                "test_temperature_C": 22,
                "n_density_measurements_per_condition": 5,
                "n_density_samples_per_batch": "",
                "n_independent_batches": "",
                "repetition_level": "Density measurements on fragments cut from specimens of one prepared condition; fragment-to-dogbone allocation and independent batch count not reported",
                "replicate_index": len(groups[condition]),
                "source_file": "originals/cecon2021_mmc1.xlsx",
                "source_locator": f"Data!{cell}; composition Data!A{row}; method article Sections 2.1-2.2",
                "value_origin": "direct_numeric_cell",
                "support_level": "source_measurement_and_conditional_mass_simulation_input",
                "product_question": "What hypothetical mass corresponds to a chosen uniform volume at this exact source material/process density?",
            })
    if len(groups) != 21 or len(observations) != 105 or any(len(values) != 5 for values in groups.values()):
        raise ValueError("Unexpected density replicate coverage")
    summaries = []
    for condition, values in groups.items():
        rows = [row for row in observations if row["condition_id"] == condition]
        summaries.append({
            "condition_id": condition,
            "source_id": SOURCE_ID,
            "unit": "g/cm3",
            "pcrpe_wt_percent": rows[0]["pcrpe_wt_percent"],
            "n_density_measurements": len(values),
            "mean": mean(values),
            "sample_standard_deviation": stdev(values),
            "observed_minimum": min(values),
            "observed_maximum": max(values),
            "source_cells": ";".join(row["source_locator"].split(";")[0] for row in rows),
            "value_origin": "derived_descriptive_statistics_within_one_matched_condition",
            "interpretation": "Observed within-condition specimen/readout variation; not a batch range or probability bound",
        })
    hinczica = json.loads((ROOT / "hinczica2026_transcription.json").read_text())
    crossref = json.loads((ROOT / "originals/hinczica2026_crossref.json").read_text())["message"]
    if not any(entry.get("content-version") == "vor" and entry.get("URL", "").rstrip("/") == "http://creativecommons.org/licenses/by/4.0" for entry in crossref.get("license", [])):
        raise ValueError("Hinczica license has not been verified")
    for index, row in enumerate(hinczica["observations"], 1):
        observations.append({
            "measurement_id": f"hinczica2026-density-summary-{index}",
            "source_id": "hinczica2026",
            "source_url": hinczica["url"],
            "license": hinczica["license"],
            "condition_id": "HINCZICA26-B1-B10",
            "property": row["property"],
            "value": row["value"],
            "unit": row["unit"],
            "raw_xml_value": "",
            "virgin_host": "",
            "pcrpe_wt_percent": "",
            "recycled_material": hinczica["material"],
            "process_id": "hinczica2026-injection-table3",
            "process": "Same injection-moulding settings across batches; nozzle 230 C, mould 40 C; detailed parameters in hinczica2026_transcription.json",
            "method": hinczica["method"]["measurement"],
            "test_temperature_C": "",
            "n_density_measurements_per_condition": "",
            "n_density_samples_per_batch": 5,
            "n_independent_batches": 10,
            "repetition_level": "Published descriptive density summary over ten independent supplied batches; five cut samples measured per batch; underlying individual values not retained",
            "replicate_index": "",
            "source_file": "hinczica2026_transcription.json",
            "source_locator": row["source_locator"],
            "value_origin": "source_reported_aggregate_manually_transcribed",
            "support_level": "source_summary_and_observed_density_scenario_only",
            "product_question": "What hypothetical mass scenario follows from this source cohort's reported density summary, without predicting future batches?",
            "statistic": row["statistic"],
        })
    for observation in observations:
        observation.setdefault("statistic", "individual_reading")
    result = {
        "schema_version": 1,
        "label": "Source measurements and explicitly identified derived summaries; no finished-product performance claim",
        "observations": observations,
        "within_condition_summaries": summaries,
    }
    (ROOT / "measurements.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    write_csv(ROOT / "measurements.csv", observations)
    write_csv(ROOT / "density_condition_summaries.csv", summaries)
    files = []
    for path in sorted((ROOT / "originals").iterdir()):
        if path.is_file():
            raw = path.read_bytes()
            files.append({"path": str(path.relative_to(ROOT)), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    sources = {
        "checked_on": "2026-10-30",
        "sources": [
            {
                "source_id": SOURCE_ID,
                "title": "Dataset of the properties of polyethylene (PE) blends of different densities mixed with post-consumer recycled polyethylene (PCRPE)",
                "doi": "10.1016/j.dib.2021.107452",
                "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8517156/",
                "article_xml_url": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8517156/fullTextXML",
                "supplement_package_url": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8517156/supplementaryFiles",
                "supplement_url": "https://pmc.ncbi.nlm.nih.gov/articles/instance/8517156/bin/mmc1.xlsx",
                "license": "CC-BY-4.0",
                "license_locator": "Article permissions element and PMC copyright section",
                "supplement_published_md5": EXPECTED_MD5,
                "supplement_published_size": 22583,
                "supplement_local_md5_matches": True,
                "retrieval_note": "Imported existing supplementary package from the preceding local audit; the extracted workbook matches the exact published attachment MD5 in a newly retrieved official article XML. Direct PMC attachment currently serves a challenge page, and a new supplement-package request timed out.",
                "sampling": "Five density measurements for each of twenty host/PCRPE conditions and one pure-PCRPE condition. No independent batch-count information.",
                "scope": "Exact study material and injection-moulding route only. No generic contamination effect, arbitrary mix recipe, universal polyethylene density or future batch bounds.",
                "density_definition": "Immersion density of cut injection-moulded specimen fragments; loose granulate bulk density is not measured by this procedure.",
                "missing": ["commercial grade identifiers", "complete PCRPE composition", "individual fragment-to-dogbone allocation", "independent batches", "density uncertainty budget", "target counterweight void content and density"],
            },
            {
                "source_id": "hinczica2026",
                "title": hinczica["title"],
                "doi": hinczica["doi"],
                "url": hinczica["url"],
                "license": hinczica["license"],
                "license_locator": hinczica["license_verification"],
                "retained_data": "Four published aggregate density statistics, Table 5; method and process context in local transcription. No digitization or invented individual readings.",
                "n_batches": 10,
                "n_density_samples_per_batch": 5,
                "scope": "Observed source cohort only. Unknown input provenance and unpaired composition prevent a contamination-response model or future-batch prediction.",
                "retrieval_note": "Publisher full text read through web extraction; direct HTML/PDF/XML downloads returned HTTP403. The local transcription is labelled as such. Publisher-deposited Crossref license metadata is retained as an original JSON response.",
            },
        ],
        "files": files,
        "access_attempts": [
            {"url": "https://pmc.ncbi.nlm.nih.gov/articles/instance/8517156/bin/mmc1.xlsx", "result": "HTTP200 containing an HTML challenge, not a workbook", "retained_response": "access_attempts/cecon-mmc1-challenge.html", "sha256": hashlib.sha256((ROOT / "access_attempts/cecon-mmc1-challenge.html").read_bytes()).hexdigest()},
            {"url": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8517156/supplementaryFiles", "result": "New request timed out; a prior valid package is retained and its workbook matches the freshly retrieved article's declared attachment checksum."},
            {"url": "https://onlinelibrary.wiley.com/doi/full/10.1002/app.70501", "result": "Structured web extraction succeeded; direct HTML request returned403. Direct PDF and full-XML requests returned403."},
        ],
        "exclusions": [
            {"source": "Hinczica2026 Table 1", "reason": "Ordered density specification 0.97 +/- 0.03 g/cm3 is not a measured variation range. Only measured Table 5 statistics retained."},
            {"source": "Wagner2025 DOI10.1155/adv/7570978", "url": "https://onlinelibrary.wiley.com/doi/10.1155/adv/7570978", "reason": "Table 1 density figures are supplier specifications. Finished-part weight figures have five parts per condition, but raw numerical mass tables were not obtained; direct file download returned403. No graph values were guessed."},
            {"source": "Gall2021 DOI10.3390/polym13101574", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8156794/", "reason": "Supplier density data in Table 2 are not measured observations. Measured densities appear in plots; no exact numerical table retained. Recycling histories are proprietary; contaminant-dose response not supported."},
            {"source": "Rodriguez-Liebana2022 DOI10.1016/j.jece.2022.108332", "url": "https://doi.org/10.1016/j.jece.2022.108332", "reason": "Open paper reports processed-recyclate densities but has CC-BY-NC-ND4 license and mixed-stream impurities incompletely resolved for a controlled contamination model. Not needed for the first eligible set; no numerical values imported."},
            {"source": "Polymers2023 DOI10.3390/polym15071690", "url": "https://www.mdpi.com/2073-4360/15/7/1690", "reason": "Primary page returned429 during this pass; no unseen density table values retained."},
            {"source": "Supplier generic/typical recycled-PP density sheets", "reason": "Nominal supplier values without matched process/sampling do not supply the requested measured density variation."},
        ],
    }
    (ROOT / "sources.json").write_text(json.dumps(sources, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"direct_density_readings": 105, "matched_conditions": 21, "conditions_with_recycled_content": 17, "source_reported_batch_summary_values": 4, "independent_batch_cohort": 10, "derived_condition_summaries": 21}))


if __name__ == "__main__":
    main()

"""Extract exact, scoped measurements from the archived contamination study."""
import csv
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/research/contamination"
RAW = OUT / "raw/PMC11360251.xml"
SHA256 = "1a11b9c9bbb08c024d721d0642d39ac13306edf3d0c96ca2c91e0b8b0377f541"
SOURCE_ID = "dawoud-taha-2024"
SOURCE_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC11360251/"
XML_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11360251/fullTextXML"


def text(element):
    return "".join(element.itertext()).strip()


def extract():
    raw = RAW.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise ValueError("Contamination study source checksum changed")
    article = ET.fromstring(raw)
    tables = {table.get("id"): table for table in article.findall(".//table-wrap")}
    rows = []
    processes = {}
    table1 = tables["polymers-16-02301-t001"]
    compounding_rows = [[text(cell) for cell in tr] for tr in table1.findall(".//tr")]
    for index, polymer in enumerate(["ABS", "PS", "PET", "PLA", "PC"]):
        profile = {}
        for cells in compounding_rows:
            if cells and cells[0] == "Temperature [°C]":
                cells = cells[1:]
            if cells and (cells[0].startswith("Zone ") or cells[0] == "Die zone"):
                profile[cells[0]] = float(cells[index + 1])
        processes[polymer] = {
            "material_origin": "Post-industrial plastic flakes; PLA is thermoforming yoghurt-cup cut-outs",
            "sequence": "Drying; twin-screw compounding; water cooling; pelletising; drying; injection moulding",
            "supplement_initial_drying": {
                "ABS": {"temperature_C": 80, "duration_h": 2},
                "PS": {"temperature_C": 80, "duration_h": 2},
                "PET": {"temperature_C": 130, "duration_h": 5},
                "PC": {"temperature_C": 120, "duration_h": 5},
                "PLA": {"temperature_C": 50, "minimum_duration_h": 12},
            }[polymer],
            "parent_PP_initial_drying": None,
            "pre_injection_blend_drying": {"temperature_C": 80, "duration_h": 2},
            "compounding_temperature_C": profile,
            "compounding_screw_rpm": 147,
            "compounding_throughput_kg_h": 10,
            "injection_zone_temperature_C": [195, 205, 210],
            "injection_nozzle_temperature_C": 220,
            "injection_mould_temperature_C": 40,
            "pure_material_mould_exceptions_C": {"PLA": 30, "PC": 85, "PET": 85},
            "pure_PC_compounding_exception_C": 295,
            "setup_locator": "Sections 2.1–2.2; Tables 1–2",
        }

    dsc_method = {
        "method": "DSC, second heating after first heating and cooling",
        "temperature_rate_K_min": 20,
        "atmosphere": "Nitrogen",
        "purge_mL_min": 60,
        "sample_mass_mg": "10 ± 0.1",
        "intermediate_isotherm_min": 2,
        "locator": "Section 2.3, Differential Scanning Calorimetry; Table 3",
    }
    table6 = tables["polymers-16-02301-t006"]
    for row_index, tr in enumerate(table6.findall(".//tr")[1:], 1):
        cells = [text(cell) for cell in tr]
        if len(cells) != 6:
            raise ValueError(f"Unexpected Table 6 row: {cells}")
        code = cells[0]
        match = re.match(r"PP-(ABS|PC|PET|PLA|PS)(\d{2})", code)
        if match:
            polymer, amount = match.groups()
            material = f"Post-industrial PP with {int(amount)} wt% {polymer}"
            material_info = {"parent_polymer": "PP", "contaminant": polymer if int(amount) else None,
                             "contaminant_wt_percent": int(amount), "code": code}
        else:
            polymer = code.removesuffix("_PURE")
            if polymer not in processes:
                raise ValueError(f"Unknown pure-polymer code: {code}")
            material = f"Pure post-industrial {polymer} reference"
            material_info = {"parent_polymer": polymer, "contaminant": None,
                             "contaminant_wt_percent": 0, "code": code}
        process = json.loads(json.dumps(processes[polymer]))
        if not match:
            process["injection_mould_temperature_C"] = process["pure_material_mould_exceptions_C"].get(polymer, 40)
            process["reference_processing_qualification"] = "The source describes pure-reference injection settings as similar to Table 2, with explicit mould exceptions. Other exact settings are not independently confirmed."
            if polymer == "PC":
                process["compounding_temperature_C"] = None
                process["compounding_note"] = "Pure PC was processed at increased temperature 295 degC; a full replacement zone profile is not specified"
        for column, property_name, unit in [(1, "glass_transition_temperature", "degC"),
                                            (2, "melting_peak_temperature", "degC"),
                                            (3, "melting_enthalpy", "J/g")]:
            value_text = cells[column]
            if not value_text:
                continue
            value = float(value_text.replace("−", "-"))
            rows.append({
                "id": f"{SOURCE_ID}:table6:{row_index}:{column}",
                "source_id": SOURCE_ID, "source_url": SOURCE_URL,
                "license": "CC-BY-4.0", "source_file": str(RAW.relative_to(ROOT)),
                "source_sha256": SHA256,
                "source_locator": f"Table 6, data row {row_index}, column {column + 1}, code {code}",
                "material": material, "material_details": material_info,
                "process": process, "test_conditions": dsc_method,
                "property": property_name, "value": value, "unit": unit,
                "sample_count": None, "repetition_level": "not_reported_for_DSC",
                "origin": "source_measurement", "extraction": "exact_XML_table_cell",
                "supports": "Compare the reported DSC response of this exact processed material",
                "does_not_support": ["Mass or density", "Acoustic performance", "Service temperature",
                                     "Batch variation", "Predictions for unmeasured contamination amounts"],
            })

    section = next(sec for sec in article.findall(".//sec")
                   if sec.find("title") is not None and text(sec.find("title")).startswith("3.2."))
    section_text = text(section)
    patterns = [
        ("PP-PET03", "PET", 3, "ultimate_tensile_strength", "MPa", r"M = (24\.51), SD = (0\.09)"),
        ("PP-PET10", "PET", 10, "ultimate_tensile_strength", "MPa", r"M = (24\.66), and SD = (0\.17)"),
        ("PP-PC10", "PC", 10, "elongation_at_break", "%", r"M = (54\.18), SD = (8\.83)"),
        ("PP-PC00", "PC", 0, "elongation_at_break", "%", r"M = (107\.17), SD = (53\.70)"),
    ]
    for code, contaminant, amount, property_name, unit, pattern in patterns:
        matched = re.search(pattern, section_text)
        if not matched:
            raise ValueError(f"Exact prose measurement not found: {code}")
        value, sd = map(float, matched.groups())
        rows.append({
            "id": f"{SOURCE_ID}:section3.2:{code}:{property_name}",
            "source_id": SOURCE_ID, "source_url": SOURCE_URL, "license": "CC-BY-4.0",
            "source_file": str(RAW.relative_to(ROOT)), "source_sha256": SHA256,
            "source_locator": f"Section 3.2, exact prose M/SD pair: {matched.group(0)}",
            "material": f"Post-industrial PP with {amount} wt% {contaminant}",
            "material_details": {"parent_polymer": "PP", "contaminant": contaminant if amount else None,
                                 "contaminant_wt_percent": amount, "source_test_code": None,
                                 "cross_reference_label": code,
                                 "label_origin": "Assigned from polymer/concentration/context; the prose does not print a test code"},
            "process": processes[contaminant],
            "test_conditions": {"method": "DIN EN ISO 527-2, type 1A, no weld line",
                                "specimen_width_mm": 10, "specimen_thickness_mm": 4,
                                "preload_N": 20, "initial_crosshead_mm_min": 1,
                                "subsequent_crosshead_mm_min": 50, "locator": "Section 2.3"},
            "property": property_name, "value": value, "reported_sd": sd, "unit": unit,
            "sample_count": None, "sample_count_minimum": 12,
            "repetition_level": "At least 12 tensile specimens per material; no independent batch count",
            "origin": "source_measurement", "extraction": "exact_XML_prose",
            "supports": "Compare reported tensile results at these exact contamination amounts and process",
            "does_not_support": ["Density or mass", "Acoustic performance", "Independent batch variation",
                                 "An interpolated contamination-effect model", "The original repository PP study"],
        })
    identifiers = [row["id"] for row in rows]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError("Duplicate measurement IDs")
    source = {
        "source_id": SOURCE_ID,
        "title": text(article.find(".//article-title")),
        "authors": ["Michael Dawoud", "Iman Taha"],
        "doi": "10.3390/polym16162301", "url": SOURCE_URL,
        "license": "CC-BY-4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "download_url": XML_URL, "retrieved_date": "2026-10-30",
        "files": [{"path": str(RAW.relative_to(ROOT)), "sha256": SHA256, "bytes": len(raw)}],
        "applicability": "Exact processed post-industrial plastics, named contaminant and tested amount only",
        "exclusions": [
            "The publisher URL returned HTTP 429; the open full-text XML archive supplies the same DOI.",
            "Figure-only tensile/MVR values are not digitized or invented.",
            "Table 6 reference crystal enthalpies and calculated crystallinity are not extracted as direct measurements.",
            "No density, acoustic response or independent batch variation is supplied by this retained set.",
            "Table 1 labels a screw speed in rpm, while Table 2 labels it mm/s. Those labels are not silently reconciled.",
        ],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sources.json").write_text(json.dumps([source], indent=2) + "\n")
    (OUT / "measurements.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
    columns = ["id", "source_id", "source_url", "license", "source_file", "source_sha256",
               "source_locator", "material", "material_details", "process", "test_conditions",
               "property", "value", "reported_sd", "unit", "sample_count", "sample_count_minimum",
               "repetition_level", "origin", "extraction", "supports", "does_not_support"]
    with (OUT / "measurements.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                             for key, value in row.items()})
    print(f"Extracted {len(rows)} scoped measurements from the contamination study")


if __name__ == "__main__":
    extract()

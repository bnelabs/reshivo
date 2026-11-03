"""Extract six source-reported tensile mean/SD pairs without reconstructing samples."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
BASE = Path("data/research/target-search/rapa2020")
SOURCE_SHA256 = "c5e4a32199ffe8fed2d8b258649c5e7f585e5bf8c04269771a052f186b6db642"
DOI = "10.3390/ma13030543"
SOURCE_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC7040787/"
LICENSE_URL = "http://creativecommons.org/licenses/by/4.0/"
TABLE1 = "materials-13-00543-t001"
TABLE2 = "materials-13-00543-t002"
TABLE6 = "materials-13-00543-t006"
MATERIAL_SECTION = "sec2dot2-materials-13-00543"
FILLER_SECTION = "sec2dot3-materials-13-00543"
PROCESS_SECTION = "sec2dot4-materials-13-00543"
METHOD_SECTION = "sec2dot5dot6-materials-13-00543"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def content(element):
    require(element is not None, "A required source element is missing")
    return "".join(element.itertext()).strip()


def compact(element):
    return re.sub(r"\s+", "", content(element))


def table(tree, identity):
    result = tree.find(f".//table-wrap[@id='{identity}']")
    require(result is not None, f"Missing table {identity}")
    return result


def table_rows(element):
    result = {}
    for index, row in enumerate(element.findall(".//tbody/tr"), start=1):
        cells = [content(cell) for cell in row]
        require(cells and cells[0] not in result, "Duplicate or missing table row label")
        result[cells[0]] = (index, cells)
    return result


def build(root: Path = ROOT) -> dict:
    """Read locked primary XML and return the reproducible six-observation package."""
    path = Path(root) / BASE / "originals/rapa2020.xml"
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == SOURCE_SHA256, "Rapa primary XML hash changed")
    tree = ET.fromstring(raw)
    doi = tree.find(".//article-id[@pub-id-type='doi']")
    require(content(doi) == DOI, "Unexpected article DOI")
    title_element = tree.find(".//article-title")
    require(title_element is not None and title_element.text is not None, "Missing article title")
    title = title_element.text.strip()
    require(title == "Effect of Styrene-Diene Block Copolymers and Glass Bubbles on the Post-Consumer Recycled Polypropylene Properties", "Unexpected article title")
    license_links = tree.findall(".//permissions/license//ext-link")
    require(any(link.get("{http://www.w3.org/1999/xlink}href") == LICENSE_URL for link in license_links), "CC BY 4.0 license link is missing")

    composition = table(tree, TABLE1)
    composition_headers = composition.findall(".//thead/tr/th")
    require([compact(cell) for cell in composition_headers] == ["Sample", "rPP[wt%]", "ThermoplasticElastomer[wt%]", "GB[vol.%]"], "Composition table headers changed")
    compositions = table_rows(composition)
    require(len(compositions) == 7, "Unexpected number of composition rows")

    processing = table(tree, TABLE2)
    subheaders = processing.findall(".//thead/tr")[1]
    require([content(cell) for cell in subheaders] == ["Film", "Sheet"], "Sheet/film column order changed")
    process_rows = table_rows(processing)
    expected_process = {
        "Preheating time": ["min", "2", "4"],
        "Pressing time": ["min", "2", "2"],
        "Pressing temperature": ["°C", "185", "185"],
        "Pressure": ["atm", "150", "125"],
        "Cooling time": ["min", "45", "45"],
    }
    require(set(process_rows) == set(expected_process), "Processing table row labels changed")
    for label, expected in expected_process.items():
        require(process_rows[label][1][1:] == expected, f"Processing cells changed: {label}")

    process_section = tree.find(f".//sec[@id='{PROCESS_SECTION}']")
    process_text = content(process_section)
    for marker in ("180 °C", "10 min", "50 rpm", "10 wt%", "5 vol.%", "20 vol.%", "obtained from pressed sheets"):
        require(marker in process_text, f"Processing detail missing: {marker}")
    material_text = content(tree.find(f".//sec[@id='{MATERIAL_SECTION}']"))
    require("Romanian collector" in material_text and "post-user boxes" in material_text, "Recycled-material origin changed")
    filler_text = content(tree.find(f".//sec[@id='{FILLER_SECTION}']"))
    require("S22" in filler_text and "3M" in filler_text, "Named glass-bubble identity changed")

    method_section = tree.find(f".//sec[@id='{METHOD_SECTION}']")
    paragraphs = [content(p) for p in method_section.findall("p")]
    tensile_paragraphs = [p for p in paragraphs if p.startswith("Tensile properties")]
    require(len(tensile_paragraphs) == 1, "Tensile method paragraph is not unique")
    tensile_method = tensile_paragraphs[0]
    for marker in ("Instron 8802", "gage length 90 mm", "width 6.6 mm", "thickness 4 mm", "50 mm/min", "Five samples were measured for each blend", "average and standard deviation", "ISO 527"):
        require(marker in tensile_method, f"Tensile method/count detail missing: {marker}")
    require(any("23 °C and ~50% humidity" in p for p in paragraphs), "Test-environment statement changed")

    measurements = table(tree, TABLE6)
    headers = measurements.findall(".//thead/tr/th")
    require(len(headers) == 8 and compact(headers[0]) == "Sample" and compact(headers[2]) == "TensileStrengthatBreak(MPa)", "Tensile table column identity changed")
    measured_rows = table_rows(measurements)
    require(set(measured_rows) == set(compositions), "Composition and measurement row labels do not match")

    source = {
        "id": "rapa2020", "title": title, "doi": DOI, "url": SOURCE_URL,
        "license": "CC BY 4.0", "license_url": LICENSE_URL,
        "license_location": "front/article-meta/permissions/license",
        "retrieved_date": "2026-10-30",
        "download_url": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7040787/fullTextXML",
        "original_path": str(BASE / "originals/rapa2020.xml"), "original_sha256": SOURCE_SHA256,
    }
    process = {
        "mixing_equipment": "Brabender Plastograph", "mixing_temperature_C": 180,
        "mixing_time_min": 10, "rotor_speed_rpm": 50,
        "forming": "Compression-moulded sheets; mechanical specimens cut from those sheets",
        "sheet_preheating_min": 4, "sheet_pressing_min": 2,
        "sheet_pressing_temperature_C": 185, "sheet_pressure_atm": 125,
        "sheet_cooling_min": 45,
        "source_locations": [PROCESS_SECTION, TABLE2 + ", Sheet column"],
    }
    method = {
        "property": "Tensile strength at break", "standard": "ISO 527",
        "equipment": "Instron 8802", "gage_length_mm": 90,
        "width_mm": 6.6, "thickness_mm": 4, "reported_pull_off_speed_mm_min": 50,
        "test_temperature_C": 23, "relative_humidity_percent_approx": 50,
        "source_location": METHOD_SECTION + ", tensile-properties paragraph and final environment statement",
    }
    limits = [
        "Only source-reported means and standard deviations are retained; the five individual specimen values and observed min/max are unavailable.",
        "Standard deviation is not an observed range, a confidence interval, a tolerance or a future-batch prediction.",
        "SBS and SIS are separate matrix families. Do not pool them or interpolate between tested glass-bubble levels.",
        "Source composition columns mix wt% for the polymer components and vol.% for glass bubbles. These labels are preserved; no amount-basis conversion is inferred.",
        "The two zero-added-filler references use a source dash in the GB column. Numeric zero is a reference-level interpretation, not an extracted numeric cell.",
        "The source does not establish independent production batches or a result for the user's recycled input or finished product.",
        "No density, mass, acoustic property, porosity effect or finished-product consistency is calculated from these tensile results.",
    ]
    observations = []
    expected = {
        "rPP/SBS": ("SBS", 0, ["90", "10", "-"], "21.99 ± 1.75"),
        "rPP/SBS/GB 5": ("SBS", 5, ["89.1", "9.9", "5"], "21.36 ± 1.24"),
        "rPP/SBS/GB 20": ("SBS", 20, ["86.7", "9.6", "20"], "20.45 ± 1.23"),
        "rPP/SIS": ("SIS", 0, ["90", "10", "-"], "22.39 ± 1.45"),
        "rPP/SIS/GB 5": ("SIS", 5, ["89.1", "9.9", "5"], "23.51 ± 1.34"),
        "rPP/SIS/GB 20": ("SIS", 20, ["86.7", "9.6", "20"], "24.22 ± 1.63"),
    }
    for label, (family, level, expected_composition, expected_cell) in expected.items():
        composition_row, composition_cells = compositions[label]
        measurement_row, measurement_cells = measured_rows[label]
        require(composition_cells[1:] == expected_composition, f"Composition cells changed: {label}")
        require(measurement_cells[2] == expected_cell, f"Tensile mean/SD cell changed: {label}")
        pair = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)\s+±\s+([0-9]+(?:\.[0-9]+)?)", measurement_cells[2])
        require(pair is not None, f"Unsupported mean/SD cell: {label}")
        mean, sd = (float(value) for value in pair.groups())
        observations.append({
            "id": f"rapa2020-rpp-{family.lower()}-gb-{level}-tensile-strength",
            "source_id": source["id"], "source_doi": DOI, "source_url": SOURCE_URL,
            "license": source["license"], "license_url": LICENSE_URL,
            "series_id": f"rapa2020-rpp-{family.lower()}-glass-bubbles",
            "original_condition_label": label,
            "material": {
                "recycled_input": "Post-consumer rPP collected from post-user injection-moulded boxes by a Romanian collector",
                "matrix_modifier": family,
                "matrix_modifier_description": "Synthesized styrene-butadiene block copolymer" if family == "SBS" else "Synthesized styrene-isoprene block copolymer",
                "filler": "3M Glass Bubbles S22, soda lime borosilicate glass",
                "source_locations": [MATERIAL_SECTION, FILLER_SECTION, PROCESS_SECTION],
            },
            "varied_input": {
                "name": "Glass Bubbles S22 addition", "level": level, "unit": "vol.%",
                "source_value": composition_cells[3],
                "level_origin": "no-added-GB reference inferred from dash and formulation label" if level == 0 else "numeric Table 1 cell",
            },
            "composition_source_values": dict(zip([content(cell) for cell in composition_headers[1:]], composition_cells[1:])),
            "process": process, "test_method": method,
            "property": "tensile_strength_at_break", "property_label": "Tensile Strength at Break",
            "unit": "MPa", "reported_mean": mean, "reported_sd": sd,
            "value_origin": "reported_mean_and_sd", "source_cell_text": measurement_cells[2],
            "sample_count": 5, "sample_count_kind": "tensile specimens (source calls them samples) per blend",
            "individual_readings_available": False, "independent_run_count": None,
            "independent_batch_count": None,
            "source_locations": {
                "measurement": {"table_id": TABLE6, "table_label": "Table 6", "row_label": label, "body_row_number": measurement_row, "column_label": "Tensile Strength at Break (MPa)", "column_number": 3},
                "composition": {"table_id": TABLE1, "table_label": "Table 1", "row_label": label, "body_row_number": composition_row, "column_labels": [content(cell) for cell in composition_headers[1:]]},
                "process": [PROCESS_SECTION, TABLE2 + ", Sheet column"],
                "sample_count": METHOD_SECTION + ", tensile-properties paragraph",
            },
            "product_question": "At this tested glass-bubble level within this source matrix family, is the reported mean tensile strength at break inside a stated target? Individual-specimen or finished-product compliance cannot be checked.",
            "limits": limits,
        })
    require(len(observations) == 6, "Expected six tensile mean/SD pairs")
    return {"schema_version": 1, "label": "source_measurements", "source": source,
            "observations": observations, "limits": limits}


def manifest(root: Path) -> dict:
    folder = Path(root) / BASE
    files = []
    for name in ("originals/rapa2020.xml", "observations.json", "README.md"):
        raw = (folder / name).read_bytes()
        files.append({"path": str(BASE / name), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    return {"schema_version": 1, "files": files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare with saved observations and file hashes without writing")
    args = parser.parse_args()
    result = build(ROOT)
    destination = ROOT / BASE / "observations.json"
    checks = ROOT / BASE / "manifest.json"
    if args.check:
        require(json.loads(destination.read_text()) == result, "Saved Rapa observations differ from primary XML extraction")
        require(json.loads(checks.read_text()) == manifest(ROOT), "Rapa package file hashes differ")
        print("Rapa: six exact tensile mean/SD cells, six composition rows, sheet processing, n=5 specimens and CC BY 4.0 verified; no files written")
    else:
        destination.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
        checks.write_text(json.dumps(manifest(ROOT), indent=2) + "\n")
        print("Wrote six source-reported tensile mean/SD pairs and package file checks")


if __name__ == "__main__":
    main()

"""Extract the reported Cecon yield-stress readings without combining conditions."""
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = "data/research/density/originals/cecon2021_mmc1.xlsx"
ARTICLE = "data/research/density/originals/cecon2021_article_fresh.xml"
SOURCE_HASHES = {
    WORKBOOK: "e1d0ba4c3f572e8c0300720fb1ba4e93a5d46cc143151abd43562cec43d4f932",
    ARTICLE: "396dcaf76887b971d96570dca67fdfc3f895b6c422c5a1b26cf98b67cebda5c6",
}
OUTPUT = "data/research/target-checks/cecon2021_yield_stress.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SOURCE_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8517156/"
LICENSE = "CC-BY-4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
PROCESS = (
    "Virgin PE and commercially sourced post-consumer recycled PE were manually blended "
    "at the stated weight fractions and injection moulded as ASTM Type I dogbones on a "
    "Battenfeld HM90/350 90-ton horizontal machine, using the reported 185–195 °C profile."
)
METHOD = (
    "Source section 2.5: tensile testing of ten individually loaded ASTM Type I dogbones "
    "per blend on an Autograph AGS-J with a 5 kN load cell and MWG-5kNA wedge grips, "
    "at 500 mm/min crosshead speed. The source states ambient 22 °C unless otherwise noted."
)
LIMITS = [
    "These are the source's processed PE blends, not measurements of the user's waste.",
    "Commercial grade identifiers and the complete recycled-stream contaminant composition are not reported.",
    "Independent production-run and batch counts are not reported; ten dogbone specimens are not ten batches.",
    "Specimen identifiers are not supplied; observation order is the source table-row order only.",
    "The common 100% PCRPE condition is stored once and referenced by every host series.",
    "A target comparison applies only to reported yield-stress readings at tested content levels.",
    "No interpolation, new material, density, acoustic property, future-batch range or finished-product consistency is inferred.",
]


def _checked(path):
    body = (ROOT / path).read_bytes()
    if hashlib.sha256(body).hexdigest() != SOURCE_HASHES[path]:
        raise ValueError(f"Source file did not match its recorded hash: {path}")
    return body


def _workbook_cells():
    _checked(WORKBOOK)
    with ZipFile(ROOT / WORKBOOK) as book:
        if book.testzip() is not None:
            raise ValueError("The source workbook failed its ZIP integrity check")
        sheets = ET.fromstring(book.read("xl/workbook.xml")).findall("m:sheets/m:sheet", NS)
        if len(sheets) != 1 or sheets[0].get("name") != "Data":
            raise ValueError("The source workbook sheet identity changed")
        shared = ET.fromstring(book.read("xl/sharedStrings.xml"))
        strings = ["".join(part.itertext()) for part in shared.findall("m:si", NS)]
        tree = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
        cells = {}
        for cell in tree.findall(".//m:c", NS):
            value = cell.find("m:v", NS)
            if value is None:
                continue
            raw = value.text
            cells[cell.get("r")] = {
                "text": strings[int(raw)] if cell.get("t") == "s" else raw,
                "type": cell.get("t"),
                "formula": cell.find("m:f", NS) is not None,
            }
        return cells


def _numeric(cells, address):
    cell = cells.get(address)
    if cell is None or cell["type"] not in (None, "n") or cell["formula"]:
        raise ValueError(f"Expected a literal numeric source cell at Data!{address}")
    raw = cell["text"]
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError(f"Source cell is not finite at Data!{address}")
    return value, raw


def extract():
    article_body = _checked(ARTICLE)
    article = ET.fromstring(article_body)
    license_node = article.find(".//license")
    if license_node is None or LICENSE_URL not in "".join(license_node.itertext()):
        raise ValueError("The source article license did not match CC BY 4.0")
    preparation = article.find(".//sec[@id='sec0003']")
    testing = article.find(".//sec[@id='sec0007']")
    preparation_text = " ".join("".join(preparation.itertext()).split()) if preparation is not None else ""
    testing_text = " ".join("".join(testing.itertext()).split()) if testing is not None else ""
    if not all(term in preparation_text for term in ("185", "195", "HM90/350", "0, 20, 40, 60, 80, and 100%")):
        raise ValueError("The reported common processing route could not be verified")
    if not all(term in testing_text for term in ("Ten specimens", "Type I dog bones", "500 mm/min", "AGS-J")):
        raise ValueError("The reported specimen count and tensile method could not be verified")
    cells = _workbook_cells()
    headers = {"AQ1": "Yield Stress", "AQ2": "PCRPE", "AQ3": "wt%"}
    columns = {"LDPE": "AR", "LLDPE": "AS", "MDPE": "AT", "HDPE": "AU"}
    for host, column in columns.items():
        headers[column + "2"] = host
        headers[column + "3"] = "MPa"
    if any(cells.get(address, {}).get("text") != expected for address, expected in headers.items()):
        raise ValueError("The source yield-stress section headers or units changed")

    conditions = []
    series = []

    def condition(host, fraction, column, first_row):
        identity = f"CECON21-{host}-PCR{fraction}" if host else "CECON21-PCRPE100"
        material = (
            f"{fraction} wt% commercially sourced post-consumer recycled PE + {100-fraction} wt% virgin {host}"
            if host else "100 wt% commercially sourced post-consumer recycled PE"
        )
        observations = []
        for index, row in enumerate(range(first_row, first_row + 10), 1):
            level, _ = _numeric(cells, f"AQ{row}")
            if level != fraction:
                raise ValueError(f"Content level mismatch at Data!AQ{row}")
            value, raw = _numeric(cells, f"{column}{row}")
            if value <= 0:
                raise ValueError(f"Yield stress must be positive at Data!{column}{row}")
            observations.append({
                "measurement_id": f"{identity}-YIELD-{index}",
                "condition_id": identity,
                "source_id": "cecon2021",
                "source_url": SOURCE_URL,
                "source_doi": "10.1016/j.dib.2021.107452",
                "license": LICENSE,
                "license_url": LICENSE_URL,
                "material": material,
                "virgin_host": host,
                "pcrpe_wt_percent": fraction,
                "process": PROCESS,
                "process_source_location": "Article section 2.1, Specimen preparation",
                "test_method": METHOD,
                "method_source_location": "Article section 2.5, Electromechanical testing",
                "test_temperature_C": 22,
                "sample_count": 10,
                "sample_count_scope": "per blend for the tensile test",
                "repetition_unit": "individually tested ASTM Type I dogbone specimen",
                "independent_run_count": None,
                "independent_batch_count": None,
                "specimen_identifier": None,
                "specimen_index": index,
                "specimen_index_meaning": "source table-row order; not an original specimen identifier",
                "property": "yield_stress",
                "unit": "MPa",
                "value": value,
                "data_kind": "source_measurement",
                "raw_numeric_string": raw,
                "source_workbook": WORKBOOK,
                "source_sheet": "Data",
                "source_row": row,
                "source_cell": f"Data!{column}{row}",
                "input_level_cell": f"Data!AQ{row}",
                "property_header_cell": "Data!AQ1",
                "host_header_cell": f"Data!{column}2" if host else None,
                "unit_header_cell": f"Data!{column}3",
                "supported_question": "Does this reported yield-stress reading fall inside the entered target for this source condition?",
            })
        return {
            "id": identity,
            "material": material,
            "virgin_host": host,
            "pcrpe_wt_percent": fraction,
            "sample_count": 10,
            "repetition_unit": "individually tested ASTM Type I dogbone specimen",
            "independent_batch_count": None,
            "source_cell_range": f"Data!{column}{first_row}:{column}{first_row + 9}",
            "input_level_cell_range": f"Data!AQ{first_row}:AQ{first_row + 9}",
            "observations": observations,
        }

    for host, column in columns.items():
        ids = []
        for offset, fraction in enumerate((0, 20, 40, 60, 80)):
            item = condition(host, fraction, column, 4 + offset * 10)
            conditions.append(item)
            ids.append(item["id"])
        series.append({
            "id": f"CECON21-YIELD-{host}",
            "virgin_host": host,
            "input_name": "Post-consumer recycled polyethylene content",
            "input_unit": "wt%",
            "input_levels": [0, 20, 40, 60, 80, 100],
            "condition_ids": ids + ["CECON21-PCRPE100"],
            "constant_source_context": f"One source study and common reported process; virgin {host} supplies the remainder at 0–80 wt% PCRPE.",
            "shared_endpoint_note": "The 100% PCRPE endpoint has no virgin host and is the same stored condition in all four series.",
        })
    conditions.append(condition(None, 100, "AR", 54))
    for column in ("AS", "AT", "AU"):
        if any(f"{column}{row}" in cells for row in range(54, 64)):
            raise ValueError("Expected the shared 100% PCRPE endpoint only once")
    observations = [row for item in conditions for row in item["observations"]]
    if len(conditions) != 21 or len(observations) != 210 or len({row["measurement_id"] for row in observations}) != 210:
        raise ValueError("Unexpected number of yield-stress conditions or observations")
    return {
        "schema_version": 1,
        "label": "source_measurements",
        "source": {
            "id": "cecon2021",
            "title": "Dataset of the properties of polyethylene (PE) blends of different densities mixed with post-consumer recycled polyethylene (PCRPE)",
            "url": SOURCE_URL,
            "doi": "10.1016/j.dib.2021.107452",
            "license": LICENSE,
            "license_url": LICENSE_URL,
            "license_source_location": "Article permissions/license element",
            "files": [{"path": path, "sha256": value} for path, value in SOURCE_HASHES.items()],
            "process": PROCESS,
            "test_method": METHOD,
            "sample_count_source_location": "Article section 1, Data Description; section 2.5, Electromechanical testing",
        },
        "property": {"name": "yield_stress", "label": "Yield stress", "unit": "MPa"},
        "series": series,
        "conditions": conditions,
        "condition_count": 21,
        "observation_count": 210,
        "limitations": LIMITS,
    }


def main():
    output = ROOT / OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(extract(), ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    print("Extracted 210 exact source yield-stress cells across 21 conditions; ten tested dogbones per condition.")
    print("The shared 100% PCRPE endpoint is stored once. No independent production batches are inferred.")


if __name__ == "__main__":
    main()

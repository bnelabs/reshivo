"""Check source integrity, extraction locations and measurement identities offline."""
from collections import Counter, defaultdict
import csv
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "data/research"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def load(path):
    return json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def check_file(path, expected):
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, path


def xlsx_cells(blob):
    with ZipFile(BytesIO(blob)) as book:
        tree = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
        return {cell.get("r"): cell.find("m:v", NS).text for cell in tree.findall(".//m:c", NS)
                if cell.find("m:v", NS) is not None}


def main():
    pp = BASE / "pp-study"
    manifest = load(pp / "source_manifest.json")
    check_file(ROOT / manifest["metadata_path"], manifest["metadata_sha256"])
    books = {}
    for entry in manifest["files"]:
        path = ROOT / entry["path"]
        body = path.read_bytes()
        check_file(path, entry["sha256"])
        assert "md5:" + hashlib.md5(body).hexdigest() == entry["declared_checksum"], path
        with ZipFile(BytesIO(body)) as archive:
            assert archive.testzip() is None, path
            for member in entry["members"]:
                content = archive.read(member["name"])
                assert hashlib.sha256(content).hexdigest() == member["sha256"], member["name"]
                if member["name"].endswith(".xlsx"):
                    books[member["name"]] = xlsx_cells(content)
    catalog = load(pp / "catalog.json")
    pp_rows = 0
    for entry in catalog["exports"]:
        path = ROOT / entry["path"]
        check_file(path, entry["sha256"])
        with path.open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        assert len(rows) == entry["rows"], path
        assert all(row["dataset_id"] in catalog["datasets"] for row in rows), path
        pp_rows += len(rows)
    cell_checks = 0
    for name, key in [("mvr_readings", "mvr_cm3_per_10min"), ("oit_readings", "oit_min"),
                      ("gpc_readings", "value"), ("color_readings", "value")]:
        with (pp / "extracted" / (name + ".csv")).open(newline="") as stream:
            for row in csv.DictReader(stream):
                ref = row["source_location"].split("!")[-1]
                assert float(row[key]) == float(books[row["source_member"]][ref]), (name, ref)
                cell_checks += 1

    density = BASE / "density"
    for entry in load(density / "sources.json")["files"]:
        check_file(density / entry["path"], entry["sha256"])
    workbook = (density / "originals/cecon2021_mmc1.xlsx").read_bytes()
    published_md5 = re.search(r"suppdata-md5 ([0-9a-f]{32})", (density / "originals/cecon2021_article_fresh.xml").read_text()).group(1)
    assert hashlib.md5(workbook).hexdigest() == published_md5
    cells = xlsx_cells(workbook)
    rows = [row for row in load(density / "measurements.json")["observations"] if row["source_id"] == "cecon2021"]
    groups = defaultdict(list)
    for row in rows:
        cell = row["source_locator"].split(";")[0].split("!")[-1]
        assert float(cells[cell]) == row["value"], cell
        assert row["unit"] == "g/cm3" and row["value"] > 0
        groups[row["condition_id"]].append(row)
    assert len(rows) == 105 and len(groups) == 21 and all(len(group) == 5 for group in groups.values())
    assert sum(group[0]["pcrpe_wt_percent"] > 0 for group in groups.values()) == 17

    target = BASE / "target-checks"
    target_data = load(target / "cecon2021_yield_stress.json")
    target_manifest = load(target / "calculation_inputs.json")
    for entry in target_manifest["files"]:
        check_file(ROOT / entry["path"], entry["sha256"])
    assert target_data["property"] == {"name": "yield_stress", "label": "Yield stress", "unit": "MPa"}
    assert target_data["condition_count"] == 21 and target_data["observation_count"] == 210
    target_rows = [row for condition in target_data["conditions"] for row in condition["observations"]]
    assert len(target_rows) == 210 and len({row["measurement_id"] for row in target_rows}) == 210
    assert len(target_data["conditions"]) == 21 and all(len(condition["observations"]) == 10 for condition in target_data["conditions"])
    assert sum(condition["pcrpe_wt_percent"] == 100 for condition in target_data["conditions"]) == 1
    for row in target_rows:
        cell = row["source_cell"].split("!")[-1]
        input_cell = row["input_level_cell"].split("!")[-1]
        assert cells[cell] == row["raw_numeric_string"] and float(cells[cell]) == row["value"], cell
        assert float(cells[input_cell]) == row["pcrpe_wt_percent"], input_cell
        assert row["property"] == "yield_stress" and row["unit"] == "MPa" and row["sample_count"] == 10
        assert row["repetition_unit"] == "individually tested ASTM Type I dogbone specimen"
        assert row["independent_batch_count"] is None and row["independent_run_count"] is None
    target_article = ET.parse(density / "originals/cecon2021_article_fresh.xml").getroot()
    target_method = " ".join("".join(target_article.find(".//sec[@id='sec0007']").itertext()).split())
    assert "Ten specimens" in target_method and "Type I dog bones" in target_method and "500 mm/min" in target_method

    # Source-only release omits the private acoustic collection.

    contamination = BASE / "contamination"
    sources = load(contamination / "sources.json")
    for entry in sources[0]["files"]:
        check_file(ROOT / entry["path"], entry["sha256"])
    article = ET.parse(contamination / "raw/PMC11360251.xml").getroot()
    table = article.find(".//table-wrap[@id='polymers-16-02301-t006']")
    table_rows = table.findall(".//tr")
    observations = load(contamination / "measurements.json")
    assert len(observations) == 83 and len({row["id"] for row in observations}) == 83
    for row in observations:
        assert row["source_id"] == sources[0]["source_id"] and row["license"] == "CC-BY-4.0"
        assert row["sample_count"] is None
        if ":table6:" in row["id"]:
            r, c = map(int, row["id"].split(":")[-2:])
            value = "".join(list(table_rows[r])[c].itertext()).strip().replace("−", "-")
            assert float(value) == row["value"], row["id"]
        else:
            assert row["sample_count_minimum"] == 12
            assert row["source_locator"].split(": ", 1)[1] in "".join(article.itertext())

    subprocess.run([sys.executable, str(ROOT / "scripts/extract_rapa_tensile.py"), "--check"],
                   check=True, cwd=ROOT, capture_output=True, text=True)

    calculation_manifest = load(BASE / "calculation_inputs.json")
    for entry in calculation_manifest["files"]:
        check_file(ROOT / entry["path"], entry["sha256"])
    file_manifest = BASE / "manifest.json"
    if file_manifest.exists():
        for entry in load(file_manifest)["files"]:
            check_file(ROOT / entry["path"], entry["sha256"])
    print(f"PP: 6 archive checks, member hashes, 13 export hashes, {pp_rows} rows and {cell_checks} exact source-cell checks")
    print("Density: 105 exact cell checks; 21 conditions x 5 readings; 17 recycled conditions; published workbook MD5 matches")
    print("Target check: 210 exact yield-stress cells; 21 conditions x 10 dogbone specimens; one shared 100% PCRPE endpoint; no batch count inferred")
    print("Rapa source comparison: 6 exact tensile mean/SD cells and compositions; 5 specimens per condition; no individual ranges reconstructed")
    print("Acoustics: intentionally omitted from this source-only release")
    print("Contamination: 79 exact table cells and 4 prose mean/SD pairs; unknown exact sample counts stay unknown")
    print("Calculation input hashes match. Source comparisons and observed-source scenarios do not establish finished-product consistency.")


if __name__ == "__main__":
    main()

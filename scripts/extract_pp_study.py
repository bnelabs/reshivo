"""Extract the additional PP study measurements without changing core inputs.

Standard-library only. Downloaded archives are checked against the retained
Zenodo record. Source cells and derived summaries remain separate.
"""
from collections import Counter, defaultdict
import csv
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import re
import shutil
import statistics
import urllib.request
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/research/pp-study'
RAW = BASE / 'raw'
OUT = BASE / 'extracted'
RECORD = 'https://zenodo.org/records/19370161'
PAPER = 'https://doi.org/10.1039/D6SU00069J'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n')


def table(name, rows):
    assert rows, name
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with (OUT/name).open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return {'path': str((OUT/name).relative_to(ROOT)), 'rows': len(rows), 'sha256': sha((OUT/name).read_bytes())}


def cells(blob):
    with ZipFile(BytesIO(blob)) as z:
        strings = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        result = {}
        for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row', NS):
            output = {}
            for cell in row:
                value = cell.find('m:v', NS)
                if value is None or value.text is None:
                    continue
                text = strings[int(value.text)] if cell.get('t') == 's' else value.text
                formula = cell.find('m:f', NS)
                output[re.sub(r'\d', '', cell.get('r'))] = {'value': text, 'formula': formula.text if formula is not None else None, 'location': 'Tabelle1!' + cell.get('r')}
            result[int(row.get('r'))] = output
        return result


def col(index):
    value = ''
    while index:
        index, rem = divmod(index-1, 26)
        value = chr(65+rem) + value
    return value


def number(cell):
    if cell is None:
        return None
    try:
        result = float(cell['value'])
    except ValueError:
        return None
    return result if math.isfinite(result) else None


def load_archive(name, manifest):
    entry = next(f for f in manifest['files'] if f['key'] == name)
    destination = RAW/name
    if not destination.exists():
        previous = Path('/local/user/Downloads/Meta-Hackathon-Alternatives-2026-10-29/material-data-audit/reprocessing')/name
        if previous.exists():
            shutil.copy2(previous, destination)
        else:
            with urllib.request.urlopen(entry['links']['self'], timeout=60) as response:
                destination.write_bytes(response.read())
    data = destination.read_bytes()
    assert 'md5:' + hashlib.md5(data).hexdigest() == entry['checksum'], name
    return ZipFile(BytesIO(data)), {'name': name, 'path': str(destination.relative_to(ROOT)), 'url': entry['links']['self'], 'declared_checksum': entry['checksum'], 'md5_verified': True, 'sha256': sha(data), 'bytes': len(data)}


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads((ROOT/'data/raw/zenodo-19370161.json').read_text())
    manifest, archives = [], {}
    for name in ['MVR.zip', 'Rheology.zip', 'DSC.zip', 'OIT.zip', 'GPC.zip', 'Colorimetry.zip']:
        archive, record = load_archive(name, meta)
        record['members'] = [{'name': n, 'bytes': len(archive.read(n)), 'sha256': sha(archive.read(n))} for n in archive.namelist() if not n.endswith('/')]
        manifest.append(record)
        archives[name] = archive
    dump(BASE/'source_manifest.json', {'record_url': RECORD, 'paper_url': PAPER, 'license': 'CC-BY-4.0', 'metadata_path': 'data/raw/zenodo-19370161.json', 'metadata_sha256': sha((ROOT/'data/raw/zenodo-19370161.json').read_bytes()), 'files': manifest})
    exports, summary, issues = [], {}, []

    # MVR: each run and each within-run reading retain their own identity.
    member = 'MVR/MVR.xlsx'
    sheet = cells(archives['MVR.zip'].read(member))
    readings, runs, cached = [], [], []
    for row_number, row in sheet.items():
        raw_code = row.get('G', {}).get('value', '')
        code = raw_code.strip()
        if not code.startswith('04441PP-'):
            continue
        values = []
        for j in range(16, 41):
            cell = row.get(col(j)); value = number(cell)
            if value is not None:
                readings.append({'dataset_id': 'pp_mvr', 'test_code': code, 'run_row': row_number, 'reading_index': j-15, 'mvr_cm3_per_10min': value, 'source_member': member, 'source_location': cell['location']})
                values.append(value)
        if values:
            runs.append({'dataset_id': 'pp_mvr', 'test_code': code, 'source_test_code_verbatim': raw_code, 'run_row': row_number, 'temperature_1_C': number(row.get('H')), 'temperature_2_C': number(row.get('I')), 'load_kg': number(row.get('K')), 'source_recorded_reading_count': number(row.get('L')), 'actual_numeric_readings': len(values), 'readings_status': 'complete_25' if len(values)==25 else 'fewer_than_25_numeric_cells_reason_not_stated', 'run_mean_cm3_per_10min': statistics.mean(values), 'run_sample_sd_cm3_per_10min': statistics.stdev(values) if len(values)>1 else None, 'origin': 'derived_from_same_run_readings', 'source_member': member, 'source_location': f'Tabelle1!P{row_number}:AN{row_number}'})
        for name in ['AO', 'AP']:
            cell = row.get(name)
            if number(cell) is not None:
                cached.append({'dataset_id': 'pp_mvr', 'test_code': code, 'source_member': member, 'source_location': cell['location'], 'source_label': 'Mean' if name=='AO' else 'Error', 'cached_value': number(cell), 'unit': 'cm3/10min', 'source_formula': cell['formula'], 'use_status': 'source_summary_only_formula_not_two_run_mean_sd'})
    grouped = defaultdict(list)
    for run in runs:
        grouped[run['test_code']].append(run['run_mean_cm3_per_10min'])
    conditions = [{'dataset_id': 'pp_mvr', 'test_code': code, 'actual_run_count': len(values), 'mean_of_run_means_cm3_per_10min': statistics.mean(values), 'sample_sd_of_run_means_cm3_per_10min': statistics.stdev(values) if len(values)>1 else None, 'independent_batch_count': None, 'origin': 'derived_same_code_run_means'} for code,values in sorted(grouped.items())]
    exports += [table('mvr_readings.csv',readings),table('mvr_runs.csv',runs),table('mvr_conditions.csv',conditions),table('mvr_source_summaries.csv',cached)]
    summary['mvr'] = {'conditions':len(grouped),'runs':len(runs),'readings':len(readings),'actual_runs_per_condition':dict(Counter(map(len,grouped.values()))),'actual_readings_per_run':dict(Counter(x['actual_numeric_readings'] for x in runs))}
    issues.append({'dataset_id':'pp_mvr','severity':'high','finding':'Cached Mean/Error formulas combine selected within-run readings, rather than simply calculating the mean/SD of two run means. They are retained separately; derived run means and their SD are explicit new calculations.'})

    issues.append({'dataset_id':'pp_mvr','severity':'medium','finding':'Ten source runs contain fewer than 25 numeric cells in the recorded reading columns (11 to 24). The reason for blank cells is not stated; derived means describe available numeric cells only, not a repaired complete run.'})

    # Rheology exports are melt measurements; tan(delta) is not solid damping.
    points, traces = [], []
    columns = ['frequency_Hz','angular_frequency_rad_s','storage_modulus_kPa','loss_modulus_kPa','complex_viscosity_mPa_s','phase_angle_degree','tan_delta','shear_stress_Pa','shear_strain']
    for member in sorted(archives['Rheology.zip'].namelist()):
        if not member.endswith('.txt'):
            continue
        code, repeat = Path(member).stem.rsplit('_',1)
        lines = archives['Rheology.zip'].read(member).decode('cp1252').splitlines()
        count=0
        for line_number,line in enumerate(lines[1:],2):
            parts=line.split()
            if len(parts)<10:
                continue
            values=[float(x.replace(',','.')) for x in parts[1:10]]
            assert all(math.isfinite(v) for v in values)
            points.append({'dataset_id':'pp_melt_rheology','test_code':code,'repeat_id':repeat,'source_member':member,'source_line':line_number,'instrument_point_id':parts[0],**dict(zip(columns,values))})
            count+=1
        traces.append({'test_code':code,'repeat_id':repeat,'source_member':member,'numeric_points':count})
    exports.append(table('rheology_points.csv',points))
    summary['rheology']={'trace_files':len(traces),'test_codes':len({x['test_code'] for x in traces}),'points':len(points)}

    issues.append({'dataset_id':'pp_melt_rheology','severity':'medium','finding':'Two literal source identifiers differ by a missing opening parenthesis: 04441PP-VIRak(1)-3E5 and 04441PP-VIRak1)-3E5. Each has one trace. This probable naming typo is preserved, not silently merged; 28 literal codes represent 54 trace files.'})

    # DSC is exported as recorded heat-flow curves, without inventing peak values.
    points=[]
    for member in sorted(archives['DSC.zip'].namelist()):
        if not member.endswith('.txt'):
            continue
        stem=Path(member).stem; code,direction=stem.rsplit('_',1)
        for line_number,line in enumerate(archives['DSC.zip'].read(member).decode('cp1252').splitlines()[2:],3):
            parts=line.split()
            if len(parts)!=5 or not parts[0].isdigit():
                continue
            vals=[float(x.replace(',','.')) for x in parts]
            assert len(vals)==5 and all(math.isfinite(v) for v in vals)
            points.append({'dataset_id':'pp_dsc','source_test_code':code,'direction':direction,'source_member':member,'source_line':line_number,'point_index':int(vals[0]),'time_s':vals[1],'heat_flow_W_g':vals[2],'sample_temperature_C':vals[3],'reference_temperature_C':vals[4]})
    exports.append(table('dsc_points.csv',points))
    summary['dsc']={'curve_files':len({x['source_member'] for x in points}),'base_material_states':len({x['source_test_code'] for x in points}),'points':len(points)}

    # OIT source workbook identifiers omit E5; no automatic tensile-code join.
    member='OIT/OIT_calculation.xlsx'; sheet=cells(archives['OIT.zip'].read(member))
    observations,stats=[] ,[]
    for column,cell in sheet[1].items():
        if not cell['value'].startswith('04441PP-'):
            continue
        code=cell['value']; values=[]
        for r in range(2,7):
            c=sheet.get(r,{}).get(column);value=number(c)
            if value is not None:
                observations.append({'dataset_id':'pp_oit','source_test_code':code,'reading_id':r-1,'oit_min':value,'source_member':member,'source_location':c['location']})
                values.append(value)
        stats.append({'dataset_id':'pp_oit','source_test_code':code,'actual_numeric_readings':len(values),'reported_method_readings':5,'derived_mean_min':statistics.mean(values),'derived_sample_sd_min':statistics.stdev(values),'source_cached_mean_min':number(sheet[7].get(column)),'source_mean_formula':sheet[7][column]['formula'],'source_cached_error_min':number(sheet[8].get(column)),'source_error_formula':sheet[8][column]['formula'],'source_member':member,'source_location':f'Tabelle1!{column}2:{column}8','independent_batch_count':None})
    exports += [table('oit_readings.csv',observations),table('oit_summaries.csv',stats)]
    summary['oit']={'workbook_test_codes':len(stats),'numeric_readings':len(observations),'raw_trace_files':len([x for x in archives['OIT.zip'].namelist() if x.endswith('.txt')])}
    issues += [{'dataset_id':'pp_oit','severity':'high','finding':'The source error formulas omit the first replicate and include the source mean row, e.g. STDEV(B3:B7). Source errors are preserved, not treated as correct repeatability SD. New sample SD is explicitly computed from actual replicate readings.'}, {'dataset_id':'pp_oit','severity':'medium','finding':'04441PP-VIRak(1)-0 has four numeric values and one dash, despite the article method stating five measurements. Use actual n=4 for this workbook group.'}, {'dataset_id':'pp_oit','severity':'medium','finding':'Workbook identifiers omit the E5 extrusion suffix present in matching raw-trace names. Original IDs are retained; no forced join to tensile conditions.'}]

    # GPC: two measurements of each base state, not eight reprocessing conditions.
    member='GPC/GPC_data.xlsx';sheet=cells(archives['GPC.zip'].read(member))
    observations,stats=[],[]
    for r,row in sheet.items():
        if r==1 or 'A' not in row:continue
        code=row['B']['value'];lab=row['A']['value']
        for prop,c1,c2,cm,ce,unit in [('Mn','C','D','E','F','g/mol'),('Mw','G','H','I','J','g/mol'),('dispersity','K','L','M','N','1')]:
            values=[number(row[c1]),number(row[c2])]
            for repeat,c in enumerate([c1,c2],1):
                observations.append({'dataset_id':'pp_gpc','source_test_code':code,'laboratory_sample_id':lab,'repeat_id':repeat,'property':prop,'value':number(row[c]),'unit':unit,'origin':'source_reported_calculation' if prop=='dispersity' else 'source_reported_gpc_estimate','quantity_definition':'Mw/Mn' if prop=='dispersity' else 'molecular-weight average reported by GPC','source_member':member,'source_location':row[c]['location']})
            stats.append({'dataset_id':'pp_gpc','source_test_code':code,'laboratory_sample_id':lab,'property':prop,'unit':unit,'property_origin':'source_reported_calculation' if prop=='dispersity' else 'source_reported_gpc_estimate','quantity_definition':'Mw/Mn' if prop=='dispersity' else 'molecular-weight average reported by GPC','derived_statistics_origin':'calculated_from_the_same_two_source_measurements','source_statistics_origin':'source_reported_spreadsheet_calculation','actual_numeric_readings':2,'derived_mean':statistics.mean(values),'derived_sample_sd':statistics.stdev(values),'source_cached_mean':number(row[cm]),'source_cached_error':number(row[ce]),'source_error_formula':row[ce]['formula'],'source_member':member,'source_location':f'Tabelle1!{c1}{r}:{ce}{r}','independent_batch_count':None})
    exports += [table('gpc_readings.csv',observations),table('gpc_summaries.csv',stats)]
    summary['gpc']={'base_material_states':len({x['source_test_code'] for x in observations}),'repeat_measurements_per_state':2,'property_values':len(observations)}
    issues.append({'dataset_id':'pp_gpc','severity':'high','finding':'Source error formulas use the second measurement and mean, e.g. STDEV(D2:E2), not the two original measurements. Preserve source errors separately; use labelled derived SD of both actual readings for descriptive repeatability.'})

    # Color: carry specimen ID across its repeated readings, never across summary rows.
    member='Colorimetry/Colorimeter.xlsx';sheet=cells(archives['Colorimetry.zip'].read(member))
    observations,cached=[],[];state={};summary_codes={};property_names=['L_star','a_star','b_star','gloss_G','yellowness_index']
    for r,row in sheet.items():
        for start in [1,8,15,22]:
            label=row.get(col(start),{}).get('value','')
            if label=='Compound':
                state.pop(start,None);summary_codes.pop(start,None);continue
            if label.startswith('04441PP-'):
                state[start]=[label,0]
            elif label in ['Mean','Error']:
                current=state.pop(start,None)
                if current:
                    summary_codes[start]=current[0].rsplit('_',1)[0]
                if start in summary_codes:
                    code=summary_codes[start]
                    for offset,prop in enumerate(property_names,1):
                        c=row.get(col(start+offset))
                        if number(c) is not None:
                            cached.append({'dataset_id':'pp_color','test_code':code,'property':prop,'source_statistic':label,'origin':'source_reported_spreadsheet_calculation','cached_value':number(c),'source_formula':c['formula'],'source_member':member,'source_location':c['location']})
                continue
            if start not in state:continue
            numeric=[number(row.get(col(start+j))) for j in range(1,6)]
            if not any(v is not None for v in numeric):continue
            state[start][1]+=1;specimen,repeat=state[start]
            for j,(prop,value) in enumerate(zip(property_names,numeric),1):
                if value is not None:
                    observations.append({'dataset_id':'pp_color','test_code':specimen.rsplit('_',1)[0],'source_specimen_id':specimen,'within_specimen_reading':repeat,'property':prop,'value':value,'origin':'source_reported_instrument_coordinate_or_index','unit':'not_stated' if prop=='gloss_G' else '1','source_member':member,'source_location':row[col(start+j)]['location']})
    grouped=defaultdict(list)
    for o in observations:grouped[(o['test_code'],o['property'])].append(o)
    stats=[]
    for (code,prop),records in sorted(grouped.items()):
        values=[x['value'] for x in records]
        stats.append({'dataset_id':'pp_color','test_code':code,'property':prop,'property_origin':'source_reported_instrument_coordinate_or_index','derived_statistics_origin':'calculated_from_same_condition_source_readings','actual_numeric_readings':len(values),'actual_specimens_with_values':len({x['source_specimen_id'] for x in records}),'reported_design_specimens':3,'reported_design_readings':9,'derived_mean':statistics.mean(values),'derived_sample_sd':statistics.stdev(values) if len(values)>1 else None,'independent_batch_count':None})
    exports += [table('color_readings.csv',observations),table('color_summaries.csv',stats),table('color_source_summaries.csv',cached)]
    summary['color']={'test_codes':len({x['test_code'] for x in observations}),'specimens_with_values':len({x['source_specimen_id'] for x in observations}),'reading_sets':len({(x['source_specimen_id'],x['within_specimen_reading']) for x in observations}),'property_values':len(observations),'actual_readings_per_condition_property':dict(Counter(x['actual_numeric_readings'] for x in stats))}
    issues.append({'dataset_id':'pp_color','severity':'medium','finding':'Some labelled specimen slots have no numeric readings. Actual counts are retained separately from the article method of three specimens and nine readings. Gloss geometry and illuminant/observer are not stated in inspected method, so absolute display-color conversion is unsupported.'})

    issues.append({'dataset_id':'pp_color','severity':'medium','finding':'For 04441PP-VIRak(1)-1E1 the source mean/error formulas select seven of nine visible readings (e.g. AVERAGE(B15:B16,B18:B22)); the exclusion reason is not stated. Source cached summaries and newly derived all-visible-reading summaries are separate.'})

    datasets = {
        'pp_mvr': {'measurement':'melt volume rate','source_archive':'MVR.zip','method':'DIN EN ISO 1133-1; article section 2.4.3 and workbook header','conditions':{'temperature_C':230,'load_kg':2.16,'die_length_mm':8,'die_diameter_mm':2.095},'reported_repetition':{'runs_per_condition':2,'readings_per_run':25,'independent_batches':None},'question':'Compare recorded melt-flow behavior for the same coded material/process conditions; no mould-filling or finished-part guarantee.','units':{'mvr':'cm3/10min'}},
        'pp_melt_rheology': {'measurement':'oscillatory melt shear frequency sweep','source_archive':'Rheology.zip','method':'plate–plate rheometry; article section 2.4.6','conditions':{'temperature_C':200,'atmosphere':'nitrogen','plate_diameter_mm':35,'gap_mm':0.75,'disc_compression_moulding_temperature_C':170,'disc_compression_moulding_time_min':10,'pre_melt_time_min':3,'frequency_range_Hz':[1,100]},'reported_repetition':{'measurements_per_condition':2,'independent_batches':None},'question':'Compare melt complex viscosity and viscoelastic response at 200 C. These are not room-temperature solid damping or sound-insulation measurements.'},
        'pp_dsc': {'measurement':'heat-flow versus temperature curves','source_archive':'DSC.zip','method':'DSC second-heating/cooling protocol; article section 2.4.1','conditions':{'atmosphere':'nitrogen','flow_mL_min':50,'nominal_sample_mass_mg':5,'heating_cooling_rate_K_min':10,'temperature_range_C':[-50,300]},'reported_repetition':{'specimens':None,'independent_batches':None},'question':'Inspect recorded thermal transitions of two base PP states. No service-temperature, flame, insulation or lifetime rating.'},
        'pp_oit': {'measurement':'oxidation induction time','source_archive':'OIT.zip','method':'thermal pretreatment under nitrogen, then air at 210 C; article section 2.4.2; source workbook calculation','conditions':{'test_temperature_C':210,'atmosphere_after_switch':'air'},'reported_repetition':{'measurements_per_condition':5,'independent_batches':None},'question':'Compare oxidation onset under this accelerated laboratory protocol. No actual product lifetime or outdoor-aging forecast.','units':{'oit':'min'}},
        'pp_gpc': {'measurement':'number-average molecular weight, weight-average molecular weight and source-calculated dispersity','property_origins':{'Mn':'source-reported GPC molecular-weight estimate','Mw':'source-reported GPC molecular-weight estimate','dispersity':'source-reported calculated quantity, Mw/Mn'},'count_rule':'Two repeated GPC measurements per base state; three output fields do not represent six specimens.','source_archive':'GPC.zip','method':'GPC; article Table 2 defines units and repeated measurements. Detailed chromatography calibration/solvent settings not established in inspected text.','conditions':{'chromatography_settings':None},'reported_repetition':{'measurements_per_base_state':2,'independent_batches':None},'question':'Compare the three measured base PP states. No direct conversion to mass density, solid damping, strength or contamination level.'},
        'pp_color': {'measurement':'source-reported instrument outputs: CIELAB coordinates, gloss G and yellowness index','output_origin':'source-reported instrument coordinate/index output; numerical coordinates and indices are not independent test specimens','count_rule':'Repeated readings are counted by specimen ID and within-specimen reading, not by the five output fields. No C/h outputs have been extracted.','source_archive':'Colorimetry.zip','method':'BYK spectro-guide on injection-moulded tensile specimens; article section 2.4.7','conditions':{'specimen_form':'injection-moulded tensile specimens','illuminant':None,'observer':None,'gloss_geometry_degree':None},'reported_repetition':{'specimens_per_condition':3,'readings_per_specimen':3,'total_readings_per_condition':9,'independent_batches':None},'question':'Compare source appearance measurements of the same moulded form and test setup; no actual sheet color tolerance or weathering guarantee.'},
    }
    common={'source_url':RECORD,'paper_url':PAPER,'license':'CC-BY-4.0','label':'source measurements and explicitly classified source-reported calculations/instrument outputs; newly derived descriptive summaries are separately labelled; no product prediction','material':'PP REG is the study post-consumer laboratory PP regranulate; PP VIRak/VIRnak are virgin controls; original source names preserved','process':'Article section 2.5: repeated twin-screw extrusion, maximum 230 C, 300 rpm, 4 kg/h. Original code-to-named-additive mapping has not been verified and is not applied. GPC/DSC base-state IDs do not identify the eight tensile conditions.','sample_count_rule':'Use actual numeric readings and specimen IDs in each export; these are not independent waste batches. Frequency/temperature points in one trace are not independent samples.','use_status':'source comparison and source-linked descriptive calculations only','unsupported':['mass density','counterweight mass','solid-state damping','acoustic transmission or absorption','batch-to-batch consistency','contamination response','service life','new blend recipes']}
    dump(BASE/'catalog.json',{'schema_version':1,'common_metadata':common,'datasets':datasets,'summary':summary,'exports':exports})
    dump(BASE/'quality_findings.json',issues)
    print(json.dumps(summary,indent=2))
    print('Exports:',len(exports),'All archive MD5 checks pass; original source codes retained.')


if __name__ == '__main__':
    main()

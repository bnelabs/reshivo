"""Frozen synthetic material-task diagnostic; model calls require explicit live mode."""
import argparse
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from rematter.advisor import (help_with_case, plan_trial, balance_mix, advisor_schema,
                              trial_schema, SOURCE_REGISTRY)
from rematter.meta import MetaClient
from rematter.products import ProductInputError
from rematter.reading_comparison import compare_readings
from scripts.benchmark_note_intake import redacted

PROTOCOL = 'material-task-v1'
FIXTURE = ROOT / 'examples/material-task-v1.json'
SOURCES = ['docs/MATERIAL_TASK_PROTOCOL.md', 'examples/material-task-v1.json',
           'scripts/benchmark_material_task.py', 'rematter/advisor.py', 'rematter/meta.py',
           'rematter/reading_comparison.py', 'rematter/products.py', 'rematter/materials.py',
           'web/src/measurementTrial.ts', 'web/src/measurementDecimal.ts',
           'scripts/benchmark_note_intake.py']
PLAIN_SYSTEM = '''You are a practical materials and product-engineering assistant helping with
the stated recycled-input case. Help the user choose useful material, preparation, process or
product-design changes and a concrete next trial. Do not end at missing data or merely discard
the input. Use only the stated material/process/property links. All supplied case numbers and
readings here are synthetic; no material or product has been physically tested. A proposed
composition calculation does not predict strength, density, acoustics or finished consistency.
Keep the user's target unchanged. Use the exact recorded levels without interpolation or
copying another study's values. A new portion or stock cannot inherit unstated measurements.
Unknown reading groups remain unknown; never infer specimens, batches or independence.
Respect actual equipment and distinguish a proposed suitable facility from confirmed access.
Do not invent additive doses, process temperatures, dwell times, physical outcomes or missing
stock composition. A named contaminant needs its identity and amount before any effect can be
assigned. A known mass recipe supports composition arithmetic, not a mixed density estimate.
The case and actual calculator results are supplied conveniently at each step. Answer the
latest question directly in plain language, with a useful action and its necessary conditions.
Use only relevant supplied reference IDs. Return the requested structured response.'''


def manifest():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}


def save(path, value, secrets):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.writing')
    temporary.write_text(json.dumps(redacted(value, secrets), indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    temporary.replace(path)


def handoff(setting, case):
    module = (ROOT / 'web/src/measurementTrial.ts').as_uri()
    script = "import fs from 'node:fs'; const {prepareMeasuredComposition}=await import(" + json.dumps(module) + "); const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(JSON.stringify(prepareMeasuredComposition(data)))"
    request = {'setting': setting, 'inputUnit': 'mass %', 'componentId': 1,
               'components': case['calculation_context']['components'], 'confirmed': True}
    reply = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(request),
                           capture_output=True, text=True, check=True)
    return {'request': request, 'result': json.loads(reply.stdout)}


def prepare(fixture):
    case = fixture['case']
    comparison = compare_readings({**deepcopy(fixture['comparison']), **deepcopy(case)})
    matching = [row for row in comparison['settings'] if row['all_readings_in_target']]
    selected = max(matching, key=lambda row: Decimal(row['level']))
    selected_handoff = handoff(selected, case)
    assert selected_handoff['result']['ok']
    level = selected_handoff['result']['value']['exactLevel']
    assert level == '35'
    outputs = {}
    for stage in fixture['stages']:
        request = {'component': 'PCRPE-A', 'input_mass_kg': stage['mass_kg'],
                   'input_min_percent': stage['min_percent'], 'input_max_percent': stage['max_percent'],
                   'addition_name': stage['stock_name'], 'addition_percent': stage['stock_percent'],
                   'target_min_percent': float(level), 'target_max_percent': float(level)}
        try:
            calculation = balance_mix(request)
        except ProductInputError as exc:
            if stage['id'] != 'D': raise
            calculation = {'result_kind': 'not_calculated', 'missing': 'PCRPE mass fraction of PE stock U',
                           'validation_error': str(exc), 'physical_performance_verified': False}
        outputs[stage['id']] = {'request': request, 'calculation': calculation}
    reference = {
        'matching_levels': ['20', '35'], 'preferred_recorded_level': '35',
        'B_addition_kg': str(Decimal('1.4') * (Decimal('46') - Decimal('35')) / Decimal('35')),
        'C_endpoint_additions_kg': [str(Decimal('1.4') * (Decimal(value) - Decimal('35')) / Decimal('35')) for value in ('43', '47')],
        'D_missing': 'PCRPE mass fraction of PE stock U',
    }
    assert [row['level'] for row in matching] == reference['matching_levels']
    assert Decimal(str(outputs['B']['calculation']['addition_min_kg'])) == Decimal('.44')
    assert outputs['B']['calculation']['addition_min_kg'] == outputs['B']['calculation']['addition_max_kg']
    assert outputs['C']['calculation']['feasible'] is False
    assert outputs['D']['calculation']['result_kind'] == 'not_calculated'
    return {'comparison': comparison, 'selected_handoff': selected_handoff,
            'stages': outputs, 'independent_reference': reference}


def selected_route(plan):
    rows = plan['material_routes']
    chosen = next((row for row in rows if re.search(r'ratio|proportion|fraction|recycled.{0,20}content|recycled.to.virgin',
                                                    row['title'] + ' ' + row['change'], re.I)), rows[0])
    return deepcopy(chosen)


def plain(client, fixture, stage, request):
    if stage == 'A_trial':
        payload = {**request, 'references': list(SOURCE_REGISTRY.values()),
                   'task': 'Develop a controlled trial for this selected route. Include what changes, what stays fixed, steps, records, property-specific checks and useful next actions. Each check target must quote unchanged text from the original target or be Not set. Do not invent a facility, measurements or physical outcomes.'}
        schema, effort, name = trial_schema(), 'medium', 'ordinary_material_trial'
    else:
        payload = {**request, 'references': list(SOURCE_REGISTRY.values()),
                   'task': 'Help use the stated input for the stated product. Answer the current question and give useful material and engineering routes, next checks and essential questions. Preserve the stated targets and unknowns.'}
        schema, effort, name = advisor_schema(), 'high', 'ordinary_material_help'
    generated = client.generate(json.dumps(payload, ensure_ascii=False, allow_nan=False), schema, 1 if stage == 'A_trial' else 3,
                                system_prompt=PLAIN_SYSTEM, schema_name=name,
                                max_completion_tokens=8192, reasoning_effort=effort)
    return {'live': generated.live, 'model': generated.model, 'request_id': generated.request_id,
            'usage': generated.usage, 'elapsed_ms': generated.elapsed_ms, **generated.data}


def trial_context(state):
    if state.get('trial') is None:
        return {'role': 'assistant', 'content': 'No completed earlier trial plan is available. Current case and new tool results remain the basis for this step.'}
    fields = {key: state['trial'].get(key) for key in ('title', 'objective', 'comparison', 'change', 'keep_fixed', 'materials', 'steps', 'checks')}
    return {'role': 'assistant', 'content': 'Earlier proposed trial, not an executed physical test: ' + json.dumps(fields, ensure_ascii=False)[:5800]}


def question(fixture, prepared, stage):
    full = prepared['comparison']
    comparison = {key: full[key] for key in ('data_kind', 'property_name', 'property_unit', 'input_name', 'input_unit', 'target_min', 'target_max', 'method')}
    comparison['settings'] = [{'id': row['id'], 'level': row['level'], 'readings': [reading['value'] for reading in row['readings']],
                               'reading_count': row['reading_count'], 'in_target_count': row['in_target_count']}
                              for row in full['settings']]
    comparison['grouping'] = 'All reading groups unknown. No specimens, runs, batches or independence inferred.'
    calculation = prepared['stages'][stage['id']]['calculation']
    keys = ('result_kind', 'component', 'input_mass_kg', 'input_min_percent', 'input_max_percent', 'addition_name',
            'addition_percent', 'target_min_percent', 'target_max_percent', 'feasible', 'addition_min_kg',
            'addition_max_kg', 'resulting_min_percent', 'resulting_max_percent', 'missing', 'validation_error')
    compact_calculation = {key: calculation[key] for key in keys if key in calculation}
    summary = {'reading_comparison': comparison, 'preferred_recorded_point': '35 mass percent PCRPE-A',
               'current_portion': prepared['stages'][stage['id']]['request'], 'actual_calculation': compact_calculation,
               'synthetic_simulation': True, 'new_mix_property_tested': False}
    text = stage['question'] + '\nCurrent synthetic case/tool summary: ' + json.dumps(summary, ensure_ascii=False, separators=(',', ':'))
    assert len(text) <= 3000, len(text)
    return text


def structured_trial_checks(result, fixture):
    rows = result.get('checks')
    targets = fixture['case']['brief']['targets']
    if not isinstance(rows, list): return {'targets_retained': False, 'material_screen_present': False}
    return {'targets_retained': all(row.get('target') == 'Not set' or row.get('target') in targets for row in rows),
            'material_screen_present': any('25 MPa' in row.get('target', '') for row in rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--lock', type=Path, default=ROOT / 'outputs/material-task-v1-lock.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'outputs/material-task-v1-live.json')
    args = parser.parse_args()
    fixture = json.loads(FIXTURE.read_text())
    prepared = prepare(fixture)
    if args.offline:
        for stage in fixture['stages']: question(fixture, prepared, stage)
        print(json.dumps({'independent_reference': prepared['independent_reference'], 'handoff': prepared['selected_handoff']['result'], 'status': 'offline checks passed'}))
        return
    if args.freeze:
        if args.lock.exists(): raise SystemExit('Refusing to overwrite a lock')
        args.lock.parent.mkdir(parents=True, exist_ok=True)
        args.lock.write_text(json.dumps({'protocol': PROTOCOL, 'frozen_utc': datetime.now(timezone.utc).isoformat(),
                                        'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                                        'hashes': manifest()}, indent=2) + '\n')
        print('Frozen:', args.lock)
        return
    if not args.live: raise SystemExit('Use --offline, then --freeze, then explicit --live')
    lock = json.loads(args.lock.read_text())
    if lock['hashes'] != manifest(): raise SystemExit('Frozen files changed')
    partial = args.output.with_suffix('.partial.json')
    if args.output.exists() or partial.exists(): raise SystemExit('Refusing to overwrite an actual run')
    base = MetaClient(root=ROOT)
    secrets = [base.key] if base.key else []
    record = {'protocol': PROTOCOL, 'lock': lock, 'started_utc': datetime.now(timezone.utc).isoformat(),
              'configured_model': base.model, 'status': 'running', 'fixture': fixture, 'tools': prepared,
              'runtime': {'python': sys.version, 'node': subprocess.check_output(['node', '--version'], text=True).strip()},
              'human_study': False, 'physical_product_tested': False, 'rows': [], 'current_attempt': None}
    states = {arm: {'plan': None, 'trial': None, 'history': []} for arm in ('ordinary', 'workflow')}
    schedule = [('A_discovery', None), ('A_trial', None)] + [(stage['id'], stage) for stage in fixture['stages']]
    for index, (stage_id, stage) in enumerate(schedule):
        arms = ('ordinary', 'workflow') if index % 2 == 0 else ('workflow', 'ordinary')
        for arm in arms:
            if lock['hashes'] != manifest(): raise SystemExit('Frozen files changed; partial retained')
            state = states[arm]
            case = deepcopy(fixture['case'])
            if stage_id == 'A_discovery':
                request = {**case, 'history': [], 'question': fixture['initial_question']}
            elif stage_id == 'A_trial':
                if state['plan'] is None:
                    record['rows'].append({'stage': stage_id, 'arm': arm, 'status': 'skipped', 'reason': 'No completed discovery route', 'model_calls': 0})
                    save(partial, record, secrets)
                    continue
                request = {**case, 'route': selected_route(state['plan'])}
            else:
                context = [trial_context(state)] + state['history'][-4:]
                request = {**case, 'question': question(fixture, prepared, stage), 'history': context}
            record['current_attempt'] = {'stage': stage_id, 'arm': arm, 'request': request, 'calls': []}
            save(partial, record, secrets)

            class CapturedClient:
                def generate(self, *positional, **options):
                    call = {'positional': list(positional), 'options': options, 'response': None}
                    record['current_attempt']['calls'].append(call)
                    save(partial, record, secrets)
                    try:
                        generated = base.generate(*positional, **options)
                    except Exception as exc:
                        call.update(error_type=type(exc).__name__, error=str(exc))
                        save(partial, record, secrets)
                        raise
                    call['response'] = asdict(generated)
                    save(partial, record, secrets)
                    return generated

            client = CapturedClient()
            started = time.monotonic()
            try:
                if arm == 'ordinary':
                    result = plain(client, fixture, stage_id, request)
                elif stage_id == 'A_trial':
                    result = plan_trial(request, client=client)
                else:
                    result = help_with_case(request, client=client)
                row = {'stage': stage_id, 'arm': arm, 'status': 'completed', 'result': result,
                       'elapsed_ms': round((time.monotonic() - started) * 1000), 'model_calls': 1,
                       'qualitative_review': 'pending quote-based review'}
                if stage_id == 'A_discovery': state['plan'] = result
                elif stage_id == 'A_trial':
                    state['trial'] = result
                    row['structured_trial_checks'] = structured_trial_checks(result, fixture)
                else:
                    state['history'] += [{'role': 'user', 'content': request['question']},
                                         {'role': 'assistant', 'content': result.get('answer', '')[:5800]}]
            except Exception as exc:
                row = {'stage': stage_id, 'arm': arm, 'status': 'failed', 'error_type': type(exc).__name__,
                       'error': str(exc), 'elapsed_ms': round((time.monotonic() - started) * 1000),
                       'model_calls': 1, 'qualitative_review': 'No usable output'}
            row['request'] = request
            row['captured_calls'] = deepcopy(record['current_attempt']['calls'])
            row['model_call_attempts'] = len(row['captured_calls'])
            row['completed_model_calls'] = sum(call['response'] is not None for call in row['captured_calls'])
            row['model_calls'] = row['model_call_attempts']
            record['rows'].append(row)
            record['current_attempt'] = None
            save(partial, record, secrets)
            print(json.dumps({key: row.get(key) for key in ('stage', 'arm', 'status', 'elapsed_ms', 'error_type')}), flush=True)
    if lock['hashes'] != manifest(): raise SystemExit('Frozen files changed; partial retained')
    record.update(status='completed', finished_utc=datetime.now(timezone.utc).isoformat())
    save(partial, record, secrets)
    partial.replace(args.output)
    print('Completed:', args.output)


if __name__ == '__main__': main()

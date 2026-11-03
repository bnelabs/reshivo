"""Prepared multi-turn baseline; network calls happen only with --live and a frozen lock."""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rematter.advisor import SOURCE_REGISTRY
from rematter.providers import load_provider_profile
from rematter.provider_transport import ProviderTransport

PROTOCOL = 'docs/DECISION_JOURNEY_EVALUATION_20261103.md'
FIXTURE = 'examples/decision-journey-fixture-20261103.json'
MANIFEST = 'examples/decision-journey-freeze-20261103.sha256'
SCRIPT = 'scripts/decision_journey_baseline.py'
SYSTEM = ("You are a practical materials and product planning assistant. Answer the user's decision using only "
          "the supplied case facts and calculations. Ask for missing information, describe proposed changes as "
          "conditional, and respect the stated home equipment limits.")
SOURCES = (PROTOCOL, FIXTURE, MANIFEST, SCRIPT, 'rematter/advisor.py', 'rematter/providers.py',
           'rematter/provider_transport.py', 'rematter/meta.py')
VERSION = 'decision-journey-baseline-v1'


def digest(path):
    body = path.read_bytes()
    if path == ROOT / PROTOCOL:
        notice = b'> **Historical evaluation:** This frozen protocol describes an earlier development snapshot. References to private working status describe that time, not the current release.\n\n'
        if not body.startswith(notice):
            raise ValueError('Release historical notice is missing or changed')
        body = body[len(notice):]
    return hashlib.sha256(body).hexdigest()


def verify_frozen_inputs():
    lines = (ROOT / MANIFEST).read_text().splitlines()
    found = {}
    for line in lines:
        checksum, separator, name = line.partition('  ')
        if not separator or name in found:
            raise ValueError('The input digest manifest is malformed')
        found[name] = checksum
    if set(found) != {PROTOCOL, FIXTURE} or any(digest(ROOT / name) != value for name, value in found.items()):
        raise ValueError('The frozen protocol or fixture changed')
    value = json.loads((ROOT / FIXTURE).read_text())
    if (value.get('schema') != 'rematter-decision-journey-fixture-v1'
            or [row['number'] for row in value.get('turns', [])] != [1, 2, 3, 4]):
        raise ValueError('The fixture has an unexpected schema or turn order')
    calculate(value)
    return value


def calculate(fixture):
    """Independent Decimal worksheet; the application calculator is not invoked."""
    case = fixture['initial_case']
    prices = {name: Decimal(number) for name, number in case['costs']['material_prices_CU_per_kg'].items()}
    cost_rows = {}
    for row in case['setups']:
        if row['historical']:
            continue
        key = f"{row['setup']} version {row['version']}"
        inputs = {name: str(amount) for name, amount in row['materials_kg'].items()}
        total = sum((Decimal(amount) * prices[name] for name, amount in inputs.items()), Decimal(0))
        count = Decimal(case['costs']['usable_mats'][key])
        cost_rows[key] = {'material_amounts_kg': inputs, 'prices_CU_per_kg': {k: str(prices[k]) for k in inputs},
                          'formula': 'sum(component kg * price per kg) / assumed usable mats',
                          'materials_CU_per_batch': str(total), 'assumed_usable_mats': str(count),
                          'CU_per_usable_mat': str(total / count)}
    facts = fixture['turns'][1]['new_facts']
    m = Decimal(facts['portion_mass_kg'])
    t = Decimal(facts['exploratory_target_min_mass_percent'])
    if t != Decimal(facts['exploratory_target_max_mass_percent']):
        raise ValueError('This fixture requires a single exact target')
    stock = Decimal(facts['added_stock_paper_mass_percent'])
    if t == stock:
        raise ValueError('The baseline worksheet formula requires different target and stock fractions')
    formula = 'addition kg = portion kg * (input mass percent - target mass percent) / (target mass percent - added-stock mass percent)'
    def addition(value):
        p = Decimal(value)
        return {'portion_kg': str(m), 'input_mass_percent': str(p), 'target_mass_percent': str(t),
                'added_stock_mass_percent': str(stock), 'formula': formula,
                'addition_kg': str(m * (p - t) / (t - stock))}
    ends = [addition(facts['input_min_mass_percent']), addition(facts['input_max_mass_percent'])]
    current = addition(fixture['turns'][2]['new_facts']['same_portion_paper_mass_percent'])
    oracle = fixture['oracle']
    if (Decimal(cost_rows['A version 2']['materials_CU_per_batch']) != Decimal(oracle['initial']['A2_materials_CU_per_batch'])
            or Decimal(cost_rows['B version 1']['materials_CU_per_batch']) != Decimal(oracle['initial']['B1_materials_CU_per_batch'])
            or Decimal(cost_rows['A version 2']['CU_per_usable_mat']) != Decimal(oracle['initial']['A2_CU_per_usable_mat'])
            or Decimal(cost_rows['B version 1']['CU_per_usable_mat']) != Decimal(oracle['initial']['B1_CU_per_usable_mat'])
            or Decimal(ends[0]['addition_kg']) != Decimal(oracle['range']['known_4_8_percent_endpoint_addition_kg'])
            or Decimal(ends[1]['addition_kg']) != Decimal(oracle['range']['known_5_2_percent_endpoint_addition_kg'])
            or Decimal(current['addition_kg']) != Decimal(oracle['known_fraction']['zero_paper_stock_addition_kg'])):
        raise ValueError('Independent calculator disagrees with the preregistered oracle')
    return {'costs': cost_rows, 'range_endpoints': ends, 'known_portion': current}


def clean_commit():
    status = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True)
    if status:
        raise ValueError('Commit or otherwise resolve the worktree changes before freezing or running')
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def source_state(expected_model=None):
    return {'version': VERSION, 'git_commit': clean_commit(), 'expected_model': expected_model,
            'sha256': {name: digest(ROOT / name) for name in SOURCES},
            'registry_sha256': hashlib.sha256(json.dumps(list(SOURCE_REGISTRY.values()), ensure_ascii=False,
                                                          sort_keys=True).encode()).hexdigest()}


def private_path(path):
    root = (ROOT / 'outputs').resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    parent = candidate.parent.resolve()
    if not parent.is_relative_to(root) or candidate.is_symlink():
        raise ValueError('Put the new lock or result file under the ignored outputs directory')
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    return parent / candidate.name


def create_private(path):
    # Exclusive creation ensures that interrupted runs cannot be silently resumed or overwritten.
    fd = os.open(private_path(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(fd, 'w', encoding='utf-8')


def redact(value, secret):
    if isinstance(value, str):
        return value.replace(secret, '[redacted]') if secret else value
    if isinstance(value, list):
        return [redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {redact(key, secret): redact(item, secret) for key, item in value.items()}
    return value


def append(stream, event, secret=''):
    stream.write(json.dumps(redact(event, secret), ensure_ascii=False, allow_nan=False) + '\n')
    stream.flush()
    os.fsync(stream.fileno())


def user_message(fixture, worksheet, index, clarification=''):
    turn = fixture['turns'][index]
    if index == 0:
        value = {'public_source_descriptions': list(SOURCE_REGISTRY.values()),
                 'initial_prompt': fixture['initial_prompt'], 'initial_case': fixture['initial_case'],
                 'independent_calculator_costs': worksheet['costs'], 'question': turn['question']}
    else:
        value = {'new_facts': turn['new_facts'], 'question': turn['question']}
        if index == 1:
            value['independent_calculator_known_endpoints'] = worksheet['range_endpoints']
        if index == 2:
            value['independent_calculator_known_portion'] = worksheet['known_portion']
        if clarification:
            value['operator_clarification_quoted_from_fixture'] = clarification
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)


def available_fixture_text(fixture, through_index):
    value = {'initial_prompt': fixture['initial_prompt'], 'initial_case': fixture['initial_case'],
             'turns': fixture['turns'][:through_index + 1]}
    return json.dumps(value, ensure_ascii=False, indent=2)


def run_baseline(fixture, profile, transport, stream, *, ask=input, expected_model=None):
    if expected_model is not None and profile.model != expected_model:
        raise ValueError('The configured model does not match the model locked for this run')
    worksheet = calculate(fixture)
    messages = [{'role': 'system', 'content': SYSTEM}]
    secret = profile.api_key
    append(stream, {'event': 'start', 'at_utc': datetime.now(timezone.utc).isoformat(), 'version': VERSION,
                    'provider': profile.provider, 'model': profile.model, 'expected_model': expected_model,
                    'base_url': profile.base_url,
                    'protocol': profile.protocol, 'declared_capabilities': profile.capabilities,
                    'transport': 'ProviderTransport chat_completions; no tools, no response schema; timeout 80s; no retries',
                    'requested_reasoning_effort': 'high', 'max_completion_tokens': 8192,
                    'system_instruction': SYSTEM, 'calculator': worksheet}, secret)
    for index in range(4):
        clarification = ''
        if index:
            try:
                clarification = ask('Optional clarification: paste an exact passage from facts already supplied, or press Enter: ').strip()
            except (EOFError, KeyboardInterrupt) as error:
                append(stream, {'event': 'failed', 'turn': index + 1, 'phase': 'operator_clarification',
                                'error_type': type(error).__name__,
                                'later_turns': 'not attempted; no retry'}, secret)
                return False
            if clarification and clarification not in available_fixture_text(fixture, index):
                append(stream, {'event': 'stopped', 'turn': index + 1, 'reason': 'Clarification was not an exact passage from available fixture facts'}, secret)
                return False
        messages.append({'role': 'user', 'content': user_message(fixture, worksheet, index, clarification)})
        payload = {'model': profile.model, 'messages': messages, 'reasoning_effort': 'high', 'max_completion_tokens': 8192}
        # Record only the body, never authorization headers. In Meta chat-completions this is the actual body;
        # when reasoning capability is disabled the transport removes reasoning_effort.
        actual = dict(payload)
        if not profile.capabilities['reasoning']:
            actual.pop('reasoning_effort')
        append(stream, {'event': 'request', 'turn': index + 1, 'at_utc': datetime.now(timezone.utc).isoformat(),
                        'body': actual, 'clarification': clarification}, secret)
        start = time.monotonic()
        try:
            response = transport.request(payload, timeout=80)
            append(stream, {'event': 'response', 'turn': index + 1, 'at_utc': datetime.now(timezone.utc).isoformat(),
                            'wall_seconds': round(time.monotonic() - start, 3), 'body': response}, secret)
            if expected_model is not None and response.get('model') != expected_model:
                raise ValueError('The returned model did not match the model locked for this run')
            choices = response.get('choices', [])
            if len(choices) != 1 or choices[0].get('finish_reason') != 'stop':
                raise ValueError('The response was incomplete or did not contain exactly one completed choice')
            message = choices[0].get('message', {})
            if message.get('role') != 'assistant' or not isinstance(message.get('content'), str) or not message['content'].strip() or message.get('refusal'):
                raise ValueError('The response did not contain a usable assistant message')
            messages.append({'role': 'assistant', 'content': message['content']})
            print(f"\nTurn {index + 1} reply:\n{message['content']}\n", flush=True)
        except Exception as error:
            append(stream, {'event': 'failed', 'turn': index + 1, 'wall_seconds': round(time.monotonic() - start, 3),
                            'error_type': type(error).__name__, 'error': str(error),
                            'later_turns': 'not attempted; no retry'}, secret)
            return False
    append(stream, {'event': 'complete', 'at_utc': datetime.now(timezone.utc).isoformat()}, secret)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--offline', action='store_true')
    modes.add_argument('--freeze', action='store_true')
    modes.add_argument('--live', action='store_true')
    parser.add_argument('--lock', type=Path, help='New private lock under outputs/ for --freeze, or existing lock for --live')
    parser.add_argument('--output', type=Path, help='New private JSONL result under outputs/ for --live')
    parser.add_argument('--expected-model', help='Lock a specific model ID for this run; set with --freeze')
    args = parser.parse_args()
    if args.expected_model is not None and (not args.expected_model or len(args.expected_model) > 160 or any(c.isspace() for c in args.expected_model)):
        parser.error('--expected-model must be a nonempty model ID without whitespace')
    if args.offline and args.expected_model is not None:
        parser.error('--expected-model applies to freeze or live, not offline checks')
    fixture = verify_frozen_inputs()
    if args.offline:
        print('Frozen input digests and independent Decimal worksheet verified. No model call made.')
        return
    if args.lock is None:
        parser.error('--lock is required for freeze or live')
    if args.freeze:
        state = source_state(args.expected_model)
        with create_private(args.lock) as stream:
            append(stream, state)
        print('Private source lock created. No model call made.')
        return
    if args.output is None:
        parser.error('--output is required for live')
    lock = private_path(args.lock)
    locked_state = json.loads(lock.read_text())
    if not isinstance(locked_state, dict) or 'expected_model' not in locked_state:
        raise ValueError('The lock lacks a model setting; create a new lock for this version')
    locked_model = locked_state['expected_model']
    if locked_model is not None and (not isinstance(locked_model, str) or not locked_model or len(locked_model) > 160 or any(c.isspace() for c in locked_model)):
        raise ValueError('The model in the lock is invalid')
    if args.expected_model is not None and args.expected_model != locked_model:
        raise ValueError('The requested model does not match the frozen model setting')
    if locked_state != source_state(locked_model):
        raise ValueError('The lock does not match the clean checkout and frozen sources')
    profile = load_provider_profile(ROOT)
    if profile.provider != 'meta' or profile.protocol != 'chat_completions' or not profile.configured:
        raise ValueError('Select a configured Meta chat-completions model in the app before running')
    if locked_model is not None and profile.model != locked_model:
        raise ValueError('The configured model does not match the model locked for this run')
    with create_private(args.output) as stream:
        ok = run_baseline(fixture, profile, ProviderTransport(profile), stream, expected_model=locked_model)
    if not ok:
        raise SystemExit('Baseline stopped after a recorded failure; no retry was made.')
    print('Baseline complete. Raw request bodies and responses are retained in the private result file.')


if __name__ == '__main__':
    main()

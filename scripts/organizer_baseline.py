"""Run the frozen synthetic organizer baseline; no network without --live."""

import argparse
from datetime import datetime, timezone
from fractions import Fraction
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

PROTOCOL = 'docs/ORGANIZER_EVALUATION_20261103.md'
FIXTURE = 'examples/organizer-fixture-20261103.json'
MANIFEST = 'examples/organizer-fixture-20261103.sha256'
SCRIPT = 'scripts/organizer_baseline.py'
MODEL = 'muse-spark-1.3-contributor'
VERSION = 'organizer-baseline-v1'
SYSTEM = ('You are a practical materials and product planning assistant. Answer using the supplied case '
          'facts and independently calculated results. Ask only essential questions, identify unmeasured '
          'effects, and respect the stated equipment limits.')
SOURCES = (PROTOCOL, FIXTURE, MANIFEST, SCRIPT, 'rematter/advisor.py', 'rematter/providers.py',
           'rematter/provider_transport.py', 'rematter/meta.py')


def digest(path):
    body = path.read_bytes()
    if path == ROOT / PROTOCOL:
        notice = b'> **Historical evaluation:** This frozen protocol describes an earlier development snapshot. References to private working status describe that time, not the current release.\n\n'
        if not body.startswith(notice):
            raise ValueError('Release historical notice is missing or changed')
        body = body[len(notice):]
    return hashlib.sha256(body).hexdigest()


def worksheet(fixture):
    """Compute costs and mixture arithmetic independently using exact rationals."""
    case = fixture['case']
    prices = {key: Fraction(value) for key, value in case['costs']['prices_EUR_per_kg'].items()}
    count = Fraction(case['costs']['gross_planned_items_per_setup'])
    accepted = Fraction(case['costs']['assumed_accepted_fraction'])
    if count <= 0 or not 0 < accepted <= 1:
        raise ValueError('Invalid planning output assumptions')
    costs = {}
    for setup in case['setups']:
        total = sum((Fraction(item['amount']) * prices[item['name']] for item in setup['materials']), Fraction())
        costs[setup['name']] = {
            'material_inputs': setup['materials'], 'prices_EUR_per_kg': case['costs']['prices_EUR_per_kg'],
            'formula': 'sum(component kg × price EUR/kg) / (gross planned items × accepted fraction)',
            'total_EUR_exact': str(total), 'usable_items_assumed': str(count * accepted),
            'EUR_per_item_exact': str(total / (count * accepted)),
        }
    facts = fixture['turns'][1]['new_facts']
    m = Fraction(facts['portion_mass_kg'])
    low = Fraction(facts['input_min_mass_percent'])
    high = Fraction(facts['input_max_mass_percent'])
    stock = Fraction(facts['added_stock_cork_mass_percent'])
    target = Fraction(20)  # The reference point is independently calculated from setup B below.
    b = next(item for item in case['setups'] if item['name'] == facts['reference_setup'].split(' version ')[0])
    parts = {item['name']: Fraction(item['amount']) for item in b['materials']}
    reference = 100 * parts[facts['reference_component']] / sum(parts.values(), Fraction())
    if reference != target or target == stock:
        raise ValueError('The recorded reference is not the expected whole-recipe point')
    point_low = m * (low - reference) / (reference - stock)
    point_high = m * (high - reference) / (reference - stock)
    new = fixture['turns'][2]['new_facts']
    target_low = Fraction(new['exploratory_target_min_mass_percent'])
    target_high = Fraction(new['exploratory_target_max_mass_percent'])
    if not stock < target_low <= target_high < low <= high:
        raise ValueError('This fixture does not match the recorded independent calculator case')
    min_addition = m * (high - target_high) / (target_high - stock)
    max_addition = m * (low - target_low) / (target_low - stock)
    example = Fraction(1)
    if not min_addition <= example <= max_addition:
        raise ValueError('The independent example is outside its calculated interval')
    result_low = (m * low + example * stock) / (m + example)
    result_high = (m * high + example * stock) / (m + example)
    expected = fixture['oracle']
    if (costs['A']['total_EUR_exact'] != str(Fraction(expected['initial']['A_batch_EUR']))
            or costs['B']['total_EUR_exact'] != str(Fraction(expected['initial']['B_batch_EUR']))
            or costs['A']['EUR_per_item_exact'] != str(Fraction(expected['initial']['A_per_item_EUR']))
            or costs['B']['EUR_per_item_exact'] != str(Fraction(expected['initial']['B_per_item_EUR']))
            or point_low != Fraction(expected['exact_20_percent']['if_28_percent_kg'])
            or point_high != Fraction(expected['exact_20_percent']['if_32_percent_kg'])
            or min_addition != Fraction(expected['exploratory_18_to_22_percent']['addition_min_kg_exact'])
            or max_addition != Fraction(expected['exploratory_18_to_22_percent']['addition_max_kg_exact'])
            or result_low != Fraction(expected['exploratory_18_to_22_percent']['resulting_input_28_percent'])
            or result_high != Fraction(expected['exploratory_18_to_22_percent']['resulting_input_32_percent'])):
        raise ValueError('Independent worksheet disagrees with the preregistered oracle')
    return {
        'costs': costs,
        'reference': {'formula': '100 × cork mass / all recipe material masses',
                      'setup': facts['reference_setup'], 'cork_kg': str(parts[facts['reference_component']]),
                      'total_kg': str(sum(parts.values(), Fraction())), 'whole_recipe_percent': str(reference)},
        'exact_point_endpoints': {'formula': 'portion × (input − target) / (target − stock)',
                                  'input_28_percent_addition_kg': str(point_low),
                                  'input_32_percent_addition_kg': str(point_high)},
        'exploratory_range': {'lower_addition_kg_exact': str(min_addition), 'upper_addition_kg_exact': str(max_addition),
                              'example_addition_kg': str(example), 'example_input_28_result_percent': str(result_low),
                              'example_input_32_result_percent': str(result_high),
                              'formula': '(portion × input% + addition × stock%) / (portion + addition)'},
    }


def verify_fixture():
    entries = {}
    for line in (ROOT / MANIFEST).read_text(encoding='utf-8').splitlines():
        value, separator, name = line.partition('  ')
        if not separator or name in entries:
            raise ValueError('Malformed fixture digest manifest')
        entries[name] = value
    if set(entries) != {PROTOCOL, FIXTURE} or any(digest(ROOT / name) != value for name, value in entries.items()):
        raise ValueError('Frozen protocol or fixture digest mismatch')
    fixture = json.loads((ROOT / FIXTURE).read_text(encoding='utf-8'))
    if fixture.get('schema') != 'rematter-organizer-journey-v1' or [t['number'] for t in fixture.get('turns', [])] != [1, 2, 3, 4]:
        raise ValueError('Unexpected fixture schema or turn order')
    worksheet(fixture)
    return fixture


def source_state():
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True):
        raise ValueError('The worktree must be clean before freezing or running')
    return {'version': VERSION, 'expected_model': MODEL,
            'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'sha256': {name: digest(ROOT / name) for name in SOURCES},
            'registry_sha256': hashlib.sha256(json.dumps(list(SOURCE_REGISTRY.values()), ensure_ascii=False,
                                                          sort_keys=True).encode()).hexdigest()}


def private_path(path):
    output = (ROOT / 'outputs').resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    parent = candidate.parent.resolve()
    if not parent.is_relative_to(output) or candidate.is_symlink():
        raise ValueError('The lock and result must be under the private outputs directory')
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return parent / candidate.name


def create_private(path):
    fd = os.open(private_path(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    return os.fdopen(fd, 'w', encoding='utf-8')


def redact(value, secret):
    if isinstance(value, str):
        return value.replace(secret, '[redacted]') if secret else value
    if isinstance(value, list):
        return [redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {redact(key, secret): redact(item, secret) for key, item in value.items()}
    return value


def contains_secret(value, secret):
    if not secret:
        return False
    if isinstance(value, str):
        return secret in value
    if isinstance(value, list):
        return any(contains_secret(item, secret) for item in value)
    if isinstance(value, dict):
        return any(contains_secret(key, secret) or contains_secret(item, secret) for key, item in value.items())
    return False


def append(stream, event, secret=''):
    stream.write(json.dumps(redact(event, secret), ensure_ascii=False, allow_nan=False) + '\n')
    stream.flush()
    os.fsync(stream.fileno())


def available_facts(fixture, index):
    return json.dumps({'initial_prompt': fixture['initial_prompt'], 'case': fixture['case'],
                       'turns': fixture['turns'][:index + 1]}, ensure_ascii=False, indent=2)


def user_message(fixture, calculations, index, clarification=''):
    turn = fixture['turns'][index]
    if index == 0:
        body = {'public_source_descriptions': list(SOURCE_REGISTRY.values()), 'initial_prompt': fixture['initial_prompt'],
                'case': fixture['case'], 'independent_material_cost_calculations': calculations['costs'],
                'question': turn['question']}
    else:
        body = {'new_facts': turn['new_facts'], 'question': turn['question']}
        if index == 1:
            body['independent_reference_calculation'] = calculations['reference']
            body['independent_endpoint_calculations'] = calculations['exact_point_endpoints']
        elif index == 2:
            body['independent_range_calculation'] = calculations['exploratory_range']
        if clarification:
            body['operator_clarification_quoted_from_fixture'] = clarification
    return json.dumps(body, ensure_ascii=False, indent=2, allow_nan=False)


def run(fixture, profile, transport, stream, *, ask=input):
    if profile.provider != 'meta' or profile.model != MODEL or profile.protocol != 'chat_completions' or not profile.configured:
        raise ValueError('This run requires the configured Meta Contributor model')
    calculations = worksheet(fixture)
    secret = profile.api_key
    messages = [{'role': 'system', 'content': SYSTEM}]
    append(stream, {'event': 'start', 'at_utc': datetime.now(timezone.utc).isoformat(), 'version': VERSION,
                    'provider': profile.provider, 'expected_model': MODEL, 'model': profile.model,
                    'reasoning_effort': 'high' if profile.capabilities['reasoning'] else None,
                    'max_completion_tokens': 8192, 'timeout_seconds': 80, 'system_instruction': SYSTEM,
                    'transport': 'Meta chat completions; no tools, schema or retries',
                    'independent_calculator': calculations}, secret)
    for index, turn in enumerate(fixture['turns']):
        clarification = ''
        if index:
            try:
                clarification = ask('Optional exact fixture clarification, or press Enter: ').strip()
            except (EOFError, KeyboardInterrupt) as error:
                append(stream, {'event': 'failed', 'turn': turn['number'], 'phase': 'operator_clarification',
                                'error_type': type(error).__name__, 'later_turns': 'not attempted; no retry'}, secret)
                return False
            if clarification and clarification not in available_facts(fixture, index):
                append(stream, {'event': 'failed', 'turn': turn['number'], 'phase': 'operator_clarification',
                                'error_type': 'ClarificationNotInFixture', 'later_turns': 'not attempted; no retry'}, secret)
                return False
        messages.append({'role': 'user', 'content': user_message(fixture, calculations, index, clarification)})
        payload = {'model': MODEL, 'messages': messages, 'max_completion_tokens': 8192}
        if profile.capabilities['reasoning']:
            payload['reasoning_effort'] = 'high'
        if contains_secret(payload, secret):
            append(stream, {'event': 'failed', 'turn': turn['number'], 'phase': 'request_preparation',
                            'error_type': 'CredentialInRequest', 'later_turns': 'not attempted; no retry'}, secret)
            return False
        append(stream, {'event': 'request', 'turn': turn['number'], 'at_utc': datetime.now(timezone.utc).isoformat(),
                        'body': payload, 'clarification': clarification}, secret)
        started = time.monotonic()
        try:
            response = transport.request(payload, timeout=80)
            append(stream, {'event': 'response', 'turn': turn['number'], 'at_utc': datetime.now(timezone.utc).isoformat(),
                            'wall_seconds': round(time.monotonic() - started, 3), 'body': response}, secret)
            if contains_secret(response, secret):
                raise ValueError('The provider response contained sensitive connection data')
            if not isinstance(response, dict) or response.get('model') != MODEL:
                raise ValueError('The returned model did not match the required Contributor identifier')
            choices = response.get('choices')
            if not isinstance(choices, list) or len(choices) != 1 or choices[0].get('finish_reason') != 'stop':
                raise ValueError('The model response was incomplete')
            message = choices[0].get('message', {})
            content = message.get('content')
            if message.get('role') != 'assistant' or message.get('refusal') or not isinstance(content, str) or not content.strip():
                raise ValueError('The model did not return a usable assistant message')
            messages.append({'role': 'assistant', 'content': content})
            print(f'\nTurn {turn["number"]} reply:\n{redact(content, secret)}\n', flush=True)
        except Exception as error:
            append(stream, {'event': 'failed', 'turn': turn['number'], 'phase': 'provider_request',
                            'wall_seconds': round(time.monotonic() - started, 3), 'error_type': type(error).__name__,
                            'error': str(error), 'later_turns': 'not attempted; no retry'}, secret)
            return False
    append(stream, {'event': 'complete', 'at_utc': datetime.now(timezone.utc).isoformat()}, secret)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--offline', action='store_true')
    modes.add_argument('--freeze', action='store_true')
    modes.add_argument('--live', action='store_true')
    parser.add_argument('--lock', type=Path, help='Private source lock beneath outputs/')
    parser.add_argument('--output', type=Path, help='New private JSONL result beneath outputs/')
    args = parser.parse_args()
    fixture = verify_fixture()
    if args.offline:
        print('Frozen inputs and independent Fraction worksheet verified. No model call made.')
        return
    if args.lock is None:
        parser.error('--lock is required for --freeze or --live')
    if args.freeze:
        state = source_state()
        with create_private(args.lock) as stream:
            append(stream, state)
        print('Private source and Contributor-model lock created. No model call made.')
        return
    if args.output is None:
        parser.error('--output is required for --live')
    if json.loads(private_path(args.lock).read_text(encoding='utf-8')) != source_state():
        raise ValueError('The source lock does not match this clean checkout')
    profile = load_provider_profile(ROOT)
    if profile.provider != 'meta' or profile.protocol != 'chat_completions' or profile.model != MODEL or not profile.configured:
        raise ValueError('Select the configured Meta Contributor model before running')
    with create_private(args.output) as stream:
        ok = run(fixture, profile, ProviderTransport(profile), stream)
    if not ok:
        raise SystemExit('Baseline stopped after a recorded failure; no retry was made.')
    print('Baseline complete; the private JSONL contains requests, parsed responses and any usage.')


if __name__ == '__main__':
    main()

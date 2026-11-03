"""Explicit live regression for a compact follow-up; original results stay unchanged."""
import argparse
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from rematter.advisor import follow_up_with_case
from rematter.meta import MetaClient
from scripts.benchmark_note_intake import redacted

SOURCES = ['docs/MATERIAL_FOLLOWUP_REGRESSION.md', 'scripts/check_material_followup.py',
           'examples/material-task-v1-live.json', 'rematter/advisor.py', 'rematter/meta.py',
           'rematter/service.py', 'rematter/server.py']


def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}


def save(path, record, secret):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.writing')
    temporary.write_text(json.dumps(redacted(record, [secret]), indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--lock', type=Path, default=ROOT / 'outputs/material-followup-v2-lock.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'outputs/material-followup-v2-live.json')
    args = parser.parse_args()
    if args.freeze:
        if args.lock.exists(): raise SystemExit('Refusing to overwrite a lock')
        args.lock.write_text(json.dumps({'protocol': 'material-followup-v2',
                                        'frozen_utc': datetime.now(timezone.utc).isoformat(), 'hashes': hashes()}, indent=2) + '\n')
        print('Frozen:', args.lock)
        return
    if not args.live: raise SystemExit('Freeze first, then use explicit --live')
    lock = json.loads(args.lock.read_text())
    if lock['hashes'] != hashes(): raise SystemExit('Frozen files changed')
    partial = args.output.with_suffix('.partial.json')
    if args.output.exists() or partial.exists(): raise SystemExit('Refusing to overwrite a result')
    original = json.loads((ROOT / 'examples/material-task-v1-live.json').read_text())
    rows = [row for row in original['rows'] if row['arm'] == 'workflow' and row['stage'] in ('B', 'C', 'D')]
    base = MetaClient(root=ROOT)
    record = {'protocol': 'material-followup-v2', 'lock': lock, 'status': 'running',
              'started_utc': datetime.now(timezone.utc).isoformat(), 'configured_model': base.model,
              'rows': [], 'current_attempt': None, 'physical_product_tested': False,
              'limitation': 'Known inherited v1 snapshots; not a new full-sequence or independent benchmark'}
    for row in rows:
        if lock['hashes'] != hashes(): raise SystemExit('Frozen files changed; partial retained')
        request = deepcopy(row['request'])
        record['current_attempt'] = {'stage': row['stage'], 'request': request, 'calls': []}
        save(partial, record, base.key)

        class CapturedClient:
            def generate(self, *positional, **options):
                call = {'positional': list(positional), 'options': options, 'response': None}
                record['current_attempt']['calls'].append(call)
                save(partial, record, base.key)
                try:
                    generated = base.generate(*positional, **options)
                except Exception as exc:
                    call.update(error_type=type(exc).__name__, error=str(exc))
                    save(partial, record, base.key)
                    raise
                call['response'] = asdict(generated)
                save(partial, record, base.key)
                return generated

        started = time.monotonic()
        try:
            result = follow_up_with_case(request, client=CapturedClient())
            output = {'stage': row['stage'], 'status': 'completed', 'result': result,
                      'compact_contract': result['result_kind'] == 'engineering_followup' and
                          'material_routes' not in result and 'engineering_routes' not in result,
                      'qualitative_review': 'Pending quote-based review'}
        except Exception as exc:
            output = {'stage': row['stage'], 'status': 'failed', 'error_type': type(exc).__name__, 'error': str(exc)}
        output.update(elapsed_ms=round((time.monotonic() - started) * 1000), request=request,
                      request_equals_v1=request == row['request'], calls=record['current_attempt']['calls'])
        record['rows'].append(output)
        record['current_attempt'] = None
        save(partial, record, base.key)
        print(json.dumps({key: output.get(key) for key in ('stage', 'status', 'elapsed_ms', 'error_type')}), flush=True)
    if lock['hashes'] != hashes(): raise SystemExit('Frozen files changed; partial retained')
    record.update(status='completed', finished_utc=datetime.now(timezone.utc).isoformat())
    save(partial, record, base.key)
    partial.replace(args.output)
    print('Completed:', args.output)


if __name__ == '__main__': main()

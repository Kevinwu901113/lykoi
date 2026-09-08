#!/usr/bin/env python3
"""Kevin-run G1 collector. Output stays local/private; review before sharing."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request
from urllib.parse import urlparse
from runner import goals, HERE


def contract():
    # Execute only trusted repository contract definitions, never response text.
    source = (HERE.parent / 'PROBE-CAP-01/probe-cap.sh').read_text().split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
    names = {'TOOLS', 'tools_block', 'BASE_KINDS', 'DELEGATE_EXTRA', 'C_DELEG'}
    nodes = [n for n in ast.parse(source).body if
             (isinstance(n, ast.FunctionDef) and n.name == 'contract') or
             (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets))]
    namespace = {}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<C1 frozen contract>', 'exec'), namespace)
    return namespace['C_DELEG']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--persona', required=True, type=Path)
    parser.add_argument('--model', default='deepseek-v4-flash')
    parser.add_argument('--base', default='https://api.deepseek.com')
    parser.add_argument('--retry-failed', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if urlparse(args.base).scheme != 'https': parser.error('HTTPS endpoint required')
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=True)
    persona = args.persona.read_text()
    shared = contract()
    version = {'model': args.model, 'base': args.base, 'contract_sha256': hashlib.sha256(shared.encode()).hexdigest(),
               'persona_sha256': hashlib.sha256(persona.encode()).hexdigest(), 'goals': goals(), 'thinking': 'low'}
    config = args.output / 'config.json'
    if config.exists() and json.loads(config.read_text()) != version:
        parser.error('configuration changed; use a new output directory')
    config.write_text(json.dumps(version, ensure_ascii=False, indent=2))
    if args.dry_run:
        print('prepared 12 requests; no API call'); return
    key = os.environ.get('DEEPSEEK_API_KEY')
    if not key: parser.error('DEEPSEEK_API_KEY missing')
    for case, goal in enumerate(goals(), 1):
        for with_persona in ('on', 'off'):
            for repeat in (1, 2):
                identifier = f'G1-{case}-{with_persona}-{repeat}'
                path = args.output / (identifier + '.json')
                if path.exists():
                    old = json.loads(path.read_text())
                    if old.get('status') == 'ok' or not args.retry_failed: continue
                messages = ([{'role': 'system', 'content': persona}] if with_persona == 'on' else [])
                messages += [{'role': 'system', 'content': shared}, {'role': 'user', 'content': goal + '\n这件事请委托给外部 Agent 做，输出 delegate 信封。'}]
                body = {'model': args.model, 'stream': False, 'thinking': {'type': 'enabled'}, 'reasoning_effort': 'low',
                        'response_format': {'type': 'json_object'}, 'messages': messages}
                started = time.monotonic()
                row = {'case': case, 'persona': with_persona, 'repeat': repeat, 'status': 'failed'}
                try:
                    req = urllib.request.Request(args.base.rstrip('/') + '/chat/completions', data=json.dumps(body).encode(),
                                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
                    # Redirects must not forward the bearer credential to another host.
                    class NoRedirect(urllib.request.HTTPRedirectHandler):
                        def redirect_request(self, *unused): return None
                    with urllib.request.build_opener(NoRedirect).open(req, timeout=240) as response:
                        payload = json.load(response)
                    choice = payload['choices'][0]
                    text = choice['message'].get('content') or ''
                    row.update(response_content=text, usage=payload.get('usage'),
                               finish_reason=choice.get('finish_reason'), reasoning_chars=len(choice['message'].get('reasoning_content') or ''))
                    row['envelope'] = json.loads(text)
                    row['status'] = 'ok'
                except Exception as error:
                    row['error_type'] = type(error).__name__
                row['elapsed_seconds'] = round(time.monotonic() - started, 3)
                temporary = path.with_suffix('.tmp')
                temporary.write_text(json.dumps(row, ensure_ascii=False, indent=2))
                temporary.replace(path)
                print(identifier, row['status'], flush=True)
    files = sorted(args.output.glob('G1-*.json'))
    (args.output / 'g1.json').write_text(json.dumps([json.loads(f.read_text()) for f in files], ensure_ascii=False, indent=2))

if __name__ == '__main__': main()

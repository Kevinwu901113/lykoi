#!/usr/bin/env python3
"""Offline experiment preparation/scoring. Never invokes an agent or production service."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import statistics

HERE = Path(__file__).resolve().parent

def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def goals():
    source = (HERE.parent / 'PROBE-CAP-01/probe-cap.sh').read_text()
    python = source.split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
    tree = ast.parse(python)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'P3_GOALS' for t in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError('C1 P3_GOALS missing')

def prepare(root):
    # Refuse to overwrite a trial or mix two experiment vintages.
    root.mkdir(parents=True, exist_ok=False)
    cases = goals()
    manifest = {'version': 1, 'goals': cases, 'trials': []}
    for i, goal in enumerate(cases, 1):
        trial = root / f'G0-{i}'
        trial.mkdir()
        (trial / 'input.txt').write_text(goal, encoding='utf-8')
        manifest['trials'].append({'id': trial.name, 'case': i, 'group': 'G0', 'input_sha256': hashlib.sha256(goal.encode()).hexdigest()})
    dump(root / 'manifest.json', manifest)

def import_g1(root, path):
    manifest = json.loads((root / 'manifest.json').read_text())
    rows = json.loads(path.read_text())
    expected = {(i, persona, repeat) for i in range(1, 4) for persona in ('on', 'off') for repeat in (1, 2)}
    keys = [(r['case'], r['persona'], r['repeat']) for r in rows]
    if len(keys) != 12 or set(keys) != expected:
        raise ValueError('G1 must contain exactly 3 cases x persona on/off x 2 repeats')
    prepared = []
    for row in rows:
        decision = row['envelope']['decision']
        if decision.get('kind') != 'delegate' or not isinstance(decision.get('content'), str) or not decision['content'].strip():
            raise ValueError('G1 non-delegate/invalid envelope: retain as failed sample; do not invent G2 input')
        identifier = f"G2-{row['case']}-{row['persona']}-{row['repeat']}"
        trial = root / identifier
        if trial.exists():
            raise ValueError('trial exists; refusing to overwrite')
        prepared.append((trial, decision['content'], row))
    for trial, text, row in prepared:
        trial.mkdir()
        (trial / 'input.txt').write_text(text, encoding='utf-8')
        dump(trial / 'source.json', row)
        manifest['trials'].append({'id': trial.name, 'case': row['case'], 'group': 'G2', 'persona': row['persona'], 'repeat': row['repeat'], 'input_sha256': hashlib.sha256(text.encode()).hexdigest()})
    dump(root / 'manifest.json', manifest)

def score(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    if len(manifest['trials']) != 15:
        raise ValueError('incomplete experiment: require 3 G0 and 12 G2 trials')
    scored = []
    for trial in manifest['trials']:
        directory = root / trial['id']
        if hashlib.sha256((directory / 'input.txt').read_bytes()).hexdigest() != trial['input_sha256']:
            raise ValueError('input changed: ' + trial['id'])
        for name in ('transcript.jsonl', 'deliverable.md'):
            if not (directory / name).is_file() or not (directory / name).stat().st_size:
                raise ValueError(f'missing evidence: {trial["id"]}/{name}')
        row = json.loads((directory / 'score.json').read_text())
        values = row['criteria']
        if len(values) != 5 or any(type(v) is not int or v not in (0, 1, 2) for v in values):
            raise ValueError('five independent rubric scores required')
        if not row.get('reviewer') or len(row.get('evidence', [])) != 5:
            raise ValueError('reviewer and five evidence references required')
        if trial['group'] == 'G2' and (type(row.get('instruction_score')) is not int or not 0 <= row['instruction_score'] <= 10):
            raise ValueError('G2 instruction score required')
        scored.append({**trial, **row, 'total': sum(values)})
    baseline = {r['case']: r['total'] for r in scored if r['group'] == 'G0'}
    g2 = [r for r in scored if r['group'] == 'G2']
    def tax(rows):
        # Matched case baselines avoid changing case weights in the >=7 subset.
        return statistics.mean(baseline[r['case']] - r['total'] for r in rows) if rows else None
    return {'status': 'scored', 'tax': tax(g2), 'persona_on_tax': tax([r for r in g2 if r['persona'] == 'on']),
            'persona_off_tax': tax([r for r in g2 if r['persona'] == 'off']),
            'instruction_ge7_tax': tax([r for r in g2 if r['instruction_score'] >= 7]), 'trials': scored}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'import-g1', 'score'))
    parser.add_argument('root', type=Path)
    parser.add_argument('--g1', type=Path)
    args = parser.parse_args()
    if args.command == 'prepare': prepare(args.root)
    elif args.command == 'import-g1':
        if args.g1 is None: parser.error('--g1 required')
        import_g1(args.root, args.g1)
    else: print(json.dumps(score(args.root), ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()

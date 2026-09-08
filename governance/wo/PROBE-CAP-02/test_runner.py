import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class RunnerTest(unittest.TestCase):
    def test_incomplete_and_complete_matched_tax(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'trial'
            runner.prepare(root)
            with self.assertRaises(ValueError): runner.score(root)
            rows = [{'case': case, 'persona': persona, 'repeat': repeat,
                     'envelope': {'decision': {'kind': 'delegate', 'content': f'only instruction {case}'}}}
                    for case in (1, 2, 3) for persona in ('on', 'off') for repeat in (1, 2)]
            source = Path(tmp) / 'g1.json'
            source.write_text(json.dumps(rows))
            runner.import_g1(root, source)
            with self.assertRaises(ValueError): runner.import_g1(root, source)
            manifest = json.loads((root / 'manifest.json').read_text())
            for trial in manifest['trials']:
                directory = root / trial['id']
                (directory / 'transcript.jsonl').write_text('{"synthetic_test":true}\n')
                (directory / 'deliverable.md').write_text('synthetic test evidence')
                score = {'criteria': [2] * 5 if trial['group'] == 'G0' else [1] * 5,
                         'reviewer': 'synthetic-test', 'evidence': ['test'] * 5, 'instruction_score': 8}
                (directory / 'score.json').write_text(json.dumps(score))
            result = runner.score(root)
            self.assertEqual(result['tax'], 5)
            self.assertEqual(result['instruction_ge7_tax'], 5)
            (root / 'G0-1/input.txt').write_text('mutated')
            with self.assertRaisesRegex(ValueError, 'input changed'): runner.score(root)

    def test_invalid_sample_does_not_create_partial_g2(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'trial'
            runner.prepare(root)
            rows = [{'case': i, 'persona': p, 'repeat': r, 'envelope': {'decision': {'kind': 'reply', 'content': 'no'}}}
                    for i in (1, 2, 3) for p in ('on', 'off') for r in (1, 2)]
            source = Path(tmp) / 'g1.json'
            source.write_text(json.dumps(rows))
            with self.assertRaises(ValueError): runner.import_g1(root, source)
            self.assertEqual(list(root.glob('G2-*')), [])

if __name__ == '__main__': unittest.main()

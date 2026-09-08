import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SCRIPT = (HERE / 'probe-cap.sh').read_text()
PLANNER = SCRIPT.split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
LOOP = SCRIPT.split('while IFS= read', 1)[1].split('\necho ', 1)[0]

class PlanTest(unittest.TestCase):
    def test_final_unterminated_line_and_targeted_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            persona = root / 'fixture.toml'
            persona.write_text('synthetic fixture only')
            for key in ('', 'P4B-3-off'):
                work = root / ('all' if not key else 'only')
                work.mkdir()
                subprocess.run(['python3', '-', str(work), str(persona), key], input=PLANNER, text=True, check=True, capture_output=True)
                plan = (work / 'plan').read_text()
                self.assertFalse(plan.endswith('\n'))
                self.assertEqual(plan.splitlines()[-1], 'P4B-3-off')
                # Use the actual production shell loop with a fake run function. No curl/secrets.
                env = dict(os.environ, WORK=str(work))
                output = subprocess.check_output(['bash', '-c', 'run() { printf "%s\\n" "$1"; }; while IFS= read' + LOOP], env=env, text=True)
                self.assertEqual(output.splitlines(), plan.splitlines())
                if key: self.assertEqual(output.splitlines(), [key])

if __name__ == '__main__': unittest.main()

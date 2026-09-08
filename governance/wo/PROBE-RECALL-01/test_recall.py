import importlib.util
from pathlib import Path
import sqlite3
import unittest
spec = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('probe-recall.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class RecallTest(unittest.TestCase):
    def test_depth_and_no_answer_leak(self):
        for case in range(1, 7):
            for depth in (3, 8, 15, 30):
                turns, question, noun, number = probe.sample(case, depth)
                self.assertEqual(len(turns), 80)
                self.assertNotIn(noun, question)
                self.assertNotIn(number, question)
                self.assertEqual(sum(noun in row['content'] for row in turns), 1)
                self.assertEqual(any(noun in row['content'] for row in turns[-16:]), depth <= 8)
                self.assertIn(noun, turns[(40 - depth) * 2]['content'])
        self.assertTrue(probe.classify('青榕车坊487元', '青榕车坊', '487')['hit_candidate'])
        self.assertFalse(probe.classify('青榕车坊1487元', '青榕车坊', '487')['hit_candidate'])

    def test_readonly_statistics_actual_schema(self):
        db = sqlite3.connect(':memory:')
        db.execute('create table history(id integer primary key, ts text, event_type text, content text)')
        db.executemany('insert into history values(?,?,?,?)', [(1, '2026-09-01T00:00:00Z', 'conversation', '{"user":"甲乙","reply":"丙"}'),
                       (2, '2026-09-01T01:00:00Z', 'conversation', '{"user":"甲乙丙丁","reply":"丁"}'),
                       (3, '2026-09-01T02:00:00Z', 'conversation', 'invalid')])
        sql = Path(__file__).with_name('recall-stats.sql').read_text()
        statements = [s for s in sql.split(';') if s.strip()]
        # Strip SQL comments before splitting: comments may contain semicolons.
        sql = '\n'.join(line for line in sql.splitlines() if not line.startswith('--'))
        db.execute('pragma query_only=on')
        results = [db.execute(s).fetchall() for s in sql.split(';') if s.strip()]
        self.assertEqual(results[0], [('total', 3)])
        self.assertEqual(dict((r[0], r[1:]) for r in results[2])['user'], (3.0, 4))
        self.assertAlmostEqual(results[3][0][1], 60, places=5)
        self.assertEqual(results[4], [('invalid_json', 1)])

if __name__ == '__main__': unittest.main()

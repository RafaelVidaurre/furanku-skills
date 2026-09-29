import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from evidence_ratings import aggregate, load_reviewed, save_report


DOMAINS = [{'id': 'verification', 'name': 'Testing'}, {'id': 'documentation', 'name': 'Documentation'}]


def contribution(task='task1', score=3, scope='unchanged', status='unknown'):
    return {'original_task_id': task, 'family': task, 'project': 'project', 'model': 'example', 'effort': 'high',
            'selection': 'supplement', 'review_status': 'source_reviewed', 'source_ids': [task + ':q', task + ':a'],
            'attempts': [{'session_ref': task, 'source_sha256': 'a'*64, 'request_ids': [task + ':q']}],
            'task_outcome': {'original_goal': 'Check all cases', 'original_source_ids': [task + ':q'],
                'original_status': status, 'cause': 'unknown', 'source_ids': [task + ':a'],
                'scope_change': scope, 'scope_source_ids': [task + ':q'], 'final_scope': 'Observed deliverable',
                'final_source_ids': [task + ':q'], 'rationale': 'Source review', 'feedback_coverage': 'partial',
                'first_delivery': {'status': 'unknown', 'source_ids': []}, 'interventions': []},
            'repairs': [], 'domains': [
                {'id': 'verification', 'role': 'central', 'score': score, 'source_ids': [task + ':a'], 'rationale': 'Observed checks'},
                {'id': 'documentation', 'role': 'absent', 'score': None, 'source_ids': [], 'rationale': 'Not requested'}]}


def rate(*records, candidates=None):
    return aggregate({'version': 1, 'contributions': list(records)}, candidates or {('example', 'high')}, DOMAINS)


class EvidenceRatingsTest(unittest.TestCase):
    def test_narrowed_success_cannot_inflate_original_scope_rating_or_completion(self):
        full = contribution('full', 2, status='partial')
        narrow = contribution('narrow', 3, 'narrowed', 'partial')
        another_narrow = contribution('another-narrow', 3, 'narrowed', 'partial')
        cell = rate(full, narrow, another_narrow)['cells'][0]
        self.assertEqual(2, cell['observed_rating'])
        self.assertEqual(1, cell['rating_tasks'])
        self.assertEqual({2: 1, 3: 2}, cell['final_scope_histogram'])
        self.assertEqual([0, 0], cell['task_completion_unknown_bounds'])
        self.assertFalse(cell['routing_eligible'])

    def test_unknowns_and_missing_feedback_are_not_success_or_flawless(self):
        known = contribution('known', 3, status='met')
        missing = contribution('missing', None)
        missing['domains'][1]['role'] = 'unknown'
        result = rate(known, missing)
        cell = result['cells'][0]
        self.assertEqual([0.5, 1], cell['final_criteria_unknown_bounds'])
        self.assertEqual([0.5, 1], cell['task_completion_unknown_bounds'])
        self.assertEqual({'partial': 2}, cell['feedback_coverage'])
        self.assertEqual({'unknown': 2}, cell['first_delivery_counts'])
        self.assertEqual(0, cell['tasks_with_observed_worker_correction'])
        self.assertEqual('not_calibrated', cell['confidence'])
        self.assertEqual({'absent': 1, 'unknown': 1}, result['cells'][1]['role_counts'])

    def test_continuations_are_one_task_and_duplicate_revisions_or_anchors_refuse(self):
        record = contribution()
        record['source_ids'].append('retry:q')
        record['attempts'].append({'session_ref': 'retry', 'source_sha256': 'b'*64, 'request_ids': ['retry:q']})
        result = rate(record)
        self.assertEqual((1, 2), (result['original_tasks'], result['sessions']))
        with self.assertRaises(ValueError):
            rate(record, record)
        duplicate = copy.deepcopy(record)
        duplicate['original_task_id'] = 'renamed'
        with self.assertRaises(ValueError):
            rate(record, duplicate)

    def test_retired_and_unreviewed_are_excluded_and_empty_combos_remain_unrated(self):
        retired = contribution('retired')
        retired['model'] = 'retired'
        unreviewed = contribution('unreviewed')
        unreviewed['review_status'] = 'structurally_valid'
        result = rate(retired, unreviewed, candidates={('example', 'high'), ('new', 'max')})
        self.assertEqual(2, len(result['exclusions']))
        self.assertEqual(4, len(result['cells']))
        self.assertTrue(all(c['observed_rating'] is None for c in result['cells']))

    def test_task_burden_survives_null_quality_without_becoming_domain_error_rate(self):
        record = contribution(score=None)
        record['repairs'] = [{'cause': 'worker', 'source_ids': ['task1:a'], 'rationale': 'Wrong command corrected'}]
        record['task_outcome']['interventions'] = [{'id': 'deadline', 'kind': 'deadline_overrun',
            'cause': 'worker', 'source_ids': ['task1:a'], 'domain_ids': [], 'rationale': 'Release deadline missed', 'minutes': 25}]
        result = rate(record)
        self.assertIsNone(result['cells'][0]['observed_rating'])
        self.assertEqual(1, result['cells'][0]['tasks_with_observed_worker_correction'])
        self.assertEqual(1, result['task_burden'][0]['worker_repairs_observed'])
        self.assertEqual(1, result['task_burden'][0]['worker_interventions_observed'])

    def test_family_sensitivity_and_strata_are_visible_without_ordinal_averaging(self):
        a, b = contribution('a', 2), contribution('b', 3)
        a['selection'] = 'baseline'
        result = rate(a, b)['cells'][0]
        self.assertEqual(2, result['observed_rating'])
        self.assertEqual([3, 2], result['leave_one_family_out_ratings'])
        self.assertEqual({'baseline': 1, 'supplement': 1}, result['selection_counts'])
        self.assertEqual('examples_only', result['evidence_level'])

    def test_missing_outcomes_invented_citations_and_unproven_scope_refuse(self):
        for mutate in [lambda r: r.pop('task_outcome'),
                       lambda r: r['domains'][0].update(source_ids=['invented']),
                       lambda r: r['domains'][0].update(score=True),
                       lambda r: r['task_outcome'].update(scope_change='narrowed', scope_source_ids=[])]:
            record = contribution()
            mutate(record)
            with self.assertRaises(ValueError):
                rate(record)

    def test_duplicate_episode_and_unproven_first_delivery_refuse(self):
        record = contribution()
        event = {'id': 'correction', 'kind': 'worker_correction', 'cause': 'worker',
                 'source_ids': ['task1:a'], 'domain_ids': [], 'rationale': 'Explicit correction'}
        record['task_outcome']['interventions'] = [event, event]
        with self.assertRaises(ValueError):
            rate(record)
        record['task_outcome']['interventions'] = []
        record['task_outcome']['first_delivery']['status'] = 'met'
        with self.assertRaises(ValueError):
            rate(record)

    def test_file_provenance_detects_changed_reviews_without_touching_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            review = root / 'review.json'
            review.write_text('{"score": 3}')
            path = root / 'input.json'
            path.write_text(json.dumps({'version': 1, 'contributions': [contribution()],
                'reviewed_files': [{'path': 'review.json', 'sha256': hashlib.sha256(review.read_bytes()).hexdigest()}]}))
            document, digest = load_reviewed(path)
            self.assertEqual(3, rate(*document['contributions'])['cells'][0]['observed_rating'])
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            review.write_text('{"score": 2}')
            with self.assertRaises(ValueError):
                load_reviewed(path)
            self.assertEqual('{"score": 2}', review.read_text())

    def test_identical_report_reuses_and_interrupted_companion_recovers_without_clobber(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ratings.json'
            result = rate(contribution())
            self.assertFalse(save_report(path, result))
            before = path.stat().st_mtime_ns
            self.assertTrue(save_report(path, result))
            self.assertEqual(before, path.stat().st_mtime_ns)
            path.with_suffix('.md').unlink()
            self.assertFalse(save_report(path, result))
            self.assertEqual(before, path.stat().st_mtime_ns)
            changed = rate(contribution(score=2))
            with self.assertRaises(ValueError):
                save_report(path, changed)
            self.assertEqual(3, json.loads(path.read_text())['cells'][0]['observed_rating'])


if __name__ == '__main__':
    unittest.main()

"""Regression evidence for scorer acceptance, using controlled semantic answers.

These tests verify orchestration and gates, not Jev's semantic accuracy.
"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import jev
import retrospective_judgments as judgments
import task_retrospect as task
from test_task_retrospect import turn, answer


class JudgmentTest(unittest.TestCase):
    def evaluator(self, *, support='supports', assessable=True, rework=1, cause='model_error'):
        def evaluate(state, questions):
            defaults = {'writing': 'central', 'documentation': 'central', 'quality': '3',
                        'rework': str(rework), 'quality_support': support, 'ownership': 'direct',
                        'attempt': 'performed', 'evidence': 'artifact', 'cause': cause,
                        'citation0': 'L1', 'repair_citation0': 'L1'}
            return {key: answer('false' if key == 'assessable' and not assessable else defaults.get(key, 'true'), q['criteria'])
                    for key, q in questions.items()}
        return evaluate

    def test_success_after_model_repair_keeps_quality_and_repair_as_separate_measures(self):
        record = task.assess_task([turn(0, 'Write prose', 'A repaired final draft')],
            [{'id': 'writing', 'description': 'Write prose'}], self.evaluator())['domains'][0]
        self.assertEqual(record['eligible_score'], 3)
        self.assertEqual(record['eligible_rework'], 1)
        self.assertEqual(record['exclusions'], [])

    def test_true_source_id_without_semantic_support_cannot_supply_score(self):
        record = task.assess_task([turn(0, 'Write documentation', 'Tests passed')],
            [{'id': 'documentation', 'description': 'Technical documentation'}],
            self.evaluator(support='insufficient'))['domains'][0]
        self.assertEqual(record['estimated_score'], 3)
        self.assertIsNone(record['eligible_score'])
        self.assertIn('citation_does_not_support_domain_quality', record['exclusions'])

    def test_missing_evidence_discards_numeric_rating(self):
        record = task.assess_task([turn(0, 'Write prose', 'Done')],
            [{'id': 'writing', 'description': 'Write prose'}], self.evaluator(assessable=False))['domains'][0]
        self.assertIsNone(record['eligible_score'])
        self.assertIn('quality_unknown', record['exclusions'])

    def test_observed_repair_survives_unknown_final_quality(self):
        record = task.assess_task([turn(0, 'Write prose', 'An observed local repair')],
            [{'id': 'writing', 'description': 'Write prose'}], self.evaluator(assessable=False))['domains'][0]
        self.assertIsNone(record['eligible_score'])
        self.assertEqual(record['eligible_rework'], 1)
        self.assertEqual(record['rework_exclusions'], [])

    def test_only_supported_ordinal_is_published_not_unverified_probability_tail(self):
        base = self.evaluator()
        def evaluate(state, questions):
            result = base(state, questions)
            if 'quality' in result:
                result['quality'] = {'score': 2.25, 'probabilities': {'0': .25, '1': 0, '2': 0, '3': .75, '4': 0}, 'confidence': .5}
                result['rework'] = {'score': 1.5, 'probabilities': {'0': 0, '1': .75, '2': 0, '3': .25}, 'confidence': .5}
            return result
        record = task.assess_task([turn(0, 'Write prose', 'Final draft')],
            [{'id': 'writing', 'description': 'Write prose'}], evaluate)['domains'][0]
        self.assertEqual(record['estimated_score'], 2.25)
        self.assertEqual(record['eligible_score'], 3)
        self.assertEqual(record['eligible_rework'], 1)
        self.assertEqual(record['score_basis'], 'semantically_supported_ordinal_level')

    def test_another_actors_repair_cannot_supply_target_repair_score(self):
        turns = [turn(0, 'Write prose', 'Final draft')]
        turns[0]['events'].append({'id': 'other', 'kind': 'response', 'text': 'Fixed my own draft',
                                   'model': 'other', 'effort': 'high'})
        base = self.evaluator()
        def evaluate(state, questions):
            result = base(state, questions)
            if 'repair_citation0' in result:
                result['repair_citation0'] = answer('other', questions['repair_citation0']['criteria'])
            return result
        record = task.assess_task(turns, [{'id': 'writing', 'description': 'Write prose'}],
                                 evaluate, focus=('m', 'high'))['domains'][0]
        self.assertIsNone(record['eligible_rework'])
        self.assertIn('repair_citation_actor_unverified', record['rework_exclusions'])

    def test_near_tie_never_becomes_a_domain_label(self):
        def evaluate(state, questions):
            return {k: {'choice': 'central', 'probabilities': {'central': .48, 'absent': .47, 'supporting': .05, 'unresolved': 0},
                        'confidence': .23} for k in questions}
        labels, raw = task.classify_requests([turn(0, 'Refactor a function', 'done')],
            [{'id': 'architecture', 'description': 'System architecture'}], evaluate)
        self.assertEqual(labels['architecture']['choice'], 'unresolved')
        self.assertEqual(raw[0]['architecture']['probabilities']['central'], .48)

    def test_decisive_tail_of_long_tool_result_is_retained_and_retrievable(self):
        output = 'log line\n' * 900 + 'FINAL: 9 passed\n'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 's.jsonl'
            path.write_text('\n'.join(json.dumps(x) for x in [
                {'type': 'turn_context', 'payload': {'model': 'm', 'effort': 'high'}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': 'Verify'}},
                {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'x', 'output': output}}]))
            turns = task.read_turns(path, 'codex')
        self.assertEqual(turns[0]['events'][0]['output'], output)
        spans = [f for f in task.fragments_of({'turns': turns}) if f.get('field_path') == ['output']]
        self.assertEqual(''.join(f['content'] for f in spans), output)
        self.assertTrue(any('FINAL: 9 passed' in f['content'] for f in spans))
        self.assertEqual(spans[-1]['char_span'][1], len(output))

    def test_mixed_question_cache_round_trip_preserves_types_and_confidence(self):
        questions = judgments.quality_questions({'description': 'Write prose'})
        answers = {k: answer('3' if k == 'quality' else '0', q['criteria']) for k, q in questions.items()}
        with tempfile.TemporaryDirectory() as directory:
            evaluate = task.Evaluator(Path(directory))
            with patch.object(jev, 'evaluate_bounded', return_value={'model': jev.MODEL, 'answers': answers}) as live:
                first = evaluate('input', questions)
                self.assertEqual(first, evaluate('input', questions))
                live.assert_called_once()
                self.assertEqual(first['quality']['confidence'], 1)
                cached = json.loads(next(Path(directory).glob('*.json')).read_text())
                self.assertEqual(cached['request'], live.call_args.args[0])
                self.assertEqual(cached['request']['providerOptions']['gateway']['only'], ['typesafe-ai'])


class BenchmarkComparisonTest(unittest.TestCase):
    def test_score_outside_reference_scope_is_not_silently_accepted(self):
        from retrospective_validate import compare
        case = {'expected': {'required_domains': ['writing'], 'allowed_domains': ['writing', 'documentation'], 'scores': {'writing': [2, 4]}}}
        result = {'involvement': {'writing': {'choice': 'central'}, 'documentation': {'choice': 'supporting'}},
                  'domains': [{'domain': 'writing', 'eligible_score': 3}, {'domain': 'documentation', 'eligible_score': 3}]}
        self.assertIn('unjudged_accepted_score:documentation', compare(case, result)['failures'])
        result['domains'][0]['eligible_rework'] = 1
        self.assertIn('unjudged_accepted_rework:writing', compare(case, result)['failures'])
        case['expected']['rework'] = {'writing': [1, 1]}
        self.assertNotIn('unjudged_accepted_rework:writing', compare(case, result)['failures'])

    def test_zero_positive_requirement_and_invalid_scope_are_rejected(self):
        from retrospective_validate import validate_benchmark
        benchmark = {'status': 'frozen', 'minimum_supported_scores': 0, 'cases': [{'id': 'x'}]}
        with self.assertRaises(ValueError): validate_benchmark(benchmark, {'writing'})
        benchmark.update(minimum_supported_scores=1, cases=[{'id': 'x', 'expected': {
            'required_domains': ['writing'], 'allowed_domains': [], 'scores': {}}}])
        with self.assertRaises(ValueError): validate_benchmark(benchmark, {'writing'})

    def test_development_success_is_not_heldout_validation(self):
        from retrospective_validate import validation_status
        cases = [{'split': 'development', 'comparison': {'passed': True, 'supported_scores_accepted': 1, 'negative_score_checks': 1}}]
        self.assertEqual(validation_status(cases, True, 1), 'passed_checks_unvalidated')
        self.assertEqual(validation_status(cases, False, 1), 'passed_requested_subset')
        cases[0]['split'] = 'heldout'
        self.assertEqual(validation_status(cases, True, 1), 'passed')
        cases[0]['split'] = 'held_out'
        self.assertEqual(validation_status(cases, True, 1), 'passed')
        cases[0]['split'] = 'unknown'
        with self.assertRaises(ValueError): validation_status(cases, True, 1)

    def test_unknown_does_not_count_as_successful_positive_score_and_unexpected_domains_fail(self):
        from retrospective_validate import compare
        case = {'expected': {'required_domains': ['writing'], 'scores': {'writing': [2.5, 3.5]}}}
        result = {'involvement': {'writing': {'choice': 'central'}, 'science': {'choice': 'central'}},
                  'domains': [{'domain': 'writing', 'eligible_score': None}]}
        verdict = compare(case, result)
        self.assertFalse(verdict['passed'])
        self.assertEqual(verdict['supported_scores_accepted'], 0)
        self.assertEqual(set(verdict['failures']), {'missing_supported_score:writing', 'unexpected_domain:science'})

    def test_negative_reference_does_not_count_as_positive_score_coverage(self):
        from retrospective_validate import compare
        case = {'expected': {'required_domains': ['writing'], 'scores': {'writing': None}}}
        result = {'involvement': {'writing': {'choice': 'central'}}, 'domains': [{'domain': 'writing', 'eligible_score': None}]}
        verdict = compare(case, result)
        self.assertTrue(verdict['passed'])
        self.assertEqual(verdict['supported_scores_accepted'], 0)


class FocusedEvidenceTest(unittest.TestCase):
    def test_fragment_quality_bundle_excludes_authority_even_when_cited(self):
        fragments = task.fragments_of({'turns': [turn(0, 'Write prose', 'Actual draft')],
            'instruction_context': [{'id': 'policy', 'kind': 'developer', 'content': 'Private authority rule'}]})
        packet = task.outcome_sources({'requests': [{'id': 'request', 'text': 'Write prose'}],
            'events': fragments, 'target_actor': 'actor0'}, ['policy', 'L1'])
        self.assertNotIn('Private authority rule', json.dumps(packet))
        self.assertTrue(packet['cited_sources'])

    def test_final_check_selection_preserves_artifact_and_later_contradiction(self):
        turns = [turn(0, 'Implement a function', 'Actual implementation')]
        turns[0]['events'] += [
            {'id': 'check', 'kind': 'tool_result', 'output': 'Tests pass', 'actor': 'actor0'},
            {'id': 'later', 'kind': 'response', 'text': 'A required edge case still fails', 'actor': 'actor0'}]
        packet = task.outcome_sources({'turns': turns, 'target_actor': 'actor0'}, ['check'])
        self.assertEqual(packet['source_order'], ['L1', 'check', 'later'])
        self.assertEqual([e['id'] for e in packet['other_observed_sources']], ['L1', 'later'])

    def test_quality_retains_other_observations_without_historical_policy(self):
        turns = [turn(0, 'Write prose', 'A final draft')]
        turns[0]['instruction_context'] = [{'id': 'policy', 'kind': 'developer', 'content': 'Only modify files after approval.'}]
        turns[0]['events'].append({'id': 'noise', 'kind': 'tool_result', 'output': 'unrelated terminal output', 'model': 'm', 'effort': 'high'})
        seen = []
        base = JudgmentTest().evaluator()
        def evaluate(state, questions):
            seen.append((state, questions))
            return base(state, questions)
        task.assess_task(turns, [{'id': 'writing', 'description': 'Write prose'}], evaluate)
        facts = next(s for s, q in seen if 'cause' in q)
        quality = next(s for s, q in seen if 'quality' in q)
        self.assertIn('Only modify files after approval.', json.dumps(facts))
        self.assertNotIn('Only modify files after approval.', json.dumps(quality))
        self.assertIn('unrelated terminal output', json.dumps(quality))
        self.assertEqual([x['id'] for x in quality['cited_sources']], ['L1'])
        self.assertEqual([x['id'] for x in quality['other_observed_sources']], ['noise'])

    def test_unattempted_work_never_requests_a_quality_score(self):
        seen = []
        base = JudgmentTest().evaluator()
        def evaluate(state, questions):
            seen.append(questions)
            result = base(state, questions)
            if 'attempt' in result:
                result['attempt'] = answer('not_attempted', questions['attempt']['criteria'])
            return result
        record = task.assess_task([turn(0, 'Write prose', 'Will do')],
            [{'id': 'writing', 'description': 'Write prose'}], evaluate)['domains'][0]
        self.assertIsNone(record['estimated_score'])
        self.assertFalse(any('quality' in questions for questions in seen))

    def test_multiple_domains_batch_independent_fact_questions(self):
        seen = []
        def evaluate(state, questions):
            seen.append(questions)
            result = {}
            for key, q in questions.items():
                field = key.split('__')[-1]
                choice = {'attempt': 'not_attempted', 'ownership': 'unknown', 'cause': 'external',
                          'evidence': 'missing'}.get(field, 'none' if 'citation' in field else 'central')
                result[key] = answer(choice, q['criteria'])
            return result
        task.assess_task([turn(0, 'Write code and docs', 'Not started')],
            [{'id': 'implementation', 'description': 'Write code'}, {'id': 'documentation', 'description': 'Write technical instructions'}], evaluate)
        batches = [q for q in seen if 'implementation__attempt' in q]
        self.assertEqual(len(batches), 1)
        self.assertIn('documentation__attempt', batches[0])
        self.assertEqual(len(seen), 2)  # One classification call and one fact batch.


class InvolvementTest(unittest.TestCase):
    def test_uncertain_importance_does_not_erase_certain_involvement(self):
        raw = {'choice': 'central', 'probabilities': {'central': .48, 'supporting': .47, 'absent': .04, 'unresolved': .01}, 'confidence': .2}
        label = judgments.domain_involvement(raw)
        self.assertEqual(label['choice'], 'involved')
        self.assertEqual(label['probabilities'], raw['probabilities'])
        self.assertAlmostEqual(label['involvement_probability'], .95)

"""Mechanical source linkage and required-context retention; no semantic claims."""
import json
import unittest
from unittest.mock import patch

import task_context as context
import task_retrospect as task
from test_task_retrospect import turn, answer, choose, fixture_batches


def read(call_id, command, body, source='source'):
    return [{'id': 'call-' + call_id, 'kind': 'tool_call', 'call_id': call_id, 'name': 'Bash',
             'input': {'command': command}, 'model': 'm', 'effort': 'high'},
            {'id': source, 'kind': 'tool_result', 'call_id': call_id, 'output': body,
             'model': 'm', 'effort': 'high'}]


class ContextTest(unittest.TestCase):
    def test_exact_read_sources_preserve_mixed_body_and_order_without_writes_or_siblings(self):
        turns = [turn(0, 'Read Bead demo-ab1 and `/tmp/my task.md` as the assignment.', 'done')]
        body = 'If both runs fail, report the comparison.\n' + 'Policy or mixed context\n' * 200
        turns[0]['events'] += read('1', 'bd show demo-ab1; cat worker-policy.md', body, 'first')
        turns[0]['events'] += read('2', 'bd close demo-ab1', 'claim')
        turns[0]['events'] += read('3', 'bd show demo-ab1.2', 'different task')
        turns[0]['events'] += read('4', 'cat "/tmp/my task.md"', 'acceptance criteria', 'second')
        result = context.collect(turns)
        self.assertEqual([s['source_id'] for s in result['sources']], ['first', 'second'])
        self.assertEqual(result['sources'][0]['body'], body)
        self.assertEqual(result['sources'][1]['references'], ['/tmp/my task.md'])
        self.assertEqual(result['unmatched_references'], [])

    def test_later_request_cannot_relabel_prior_read_and_native_read_tools_work(self):
        turns = [turn(0, 'Write prose', 'ok'), turn(1, 'Read work.md as the task contract', 'ok')]
        turns[0]['events'] += read('1', 'cat work.md', 'old requirements')
        turns[1]['events'] += [
            {'id': 'call', 'kind': 'tool_call', 'name': 'Read', 'call_id': '2', 'input': {'file_path': 'work.md'}},
            {'id': 'new', 'kind': 'tool_result', 'call_id': '2', 'output': 'new requirements'}]
        self.assertEqual([r['source_id'] for r in context.collect(turns)['sources']], ['new'])

    def test_codex_script_read_matches_command_not_working_directory(self):
        event = {'name': 'functions.exec', 'input': 'const r = await tools.exec_command({"cmd":"bd show demo-ab1", "workdir":"/tmp/demo-cd2"});'}
        self.assertEqual(context.read_targets(event), ['demo-ab1'])
        self.assertFalse(context.exact_reference('demo-cd2', ' '.join(context.read_targets(event))))

    def test_required_context_reaches_classification_quality_and_support(self):
        turns = [turn(0, 'Read work.md as the task contract and write the requested prose', 'A complete poem')]
        turns[0]['events'] += read('1', 'cat work.md', 'Write a poem about the moon.')
        states = []
        @fixture_batches
        def evaluate(state, questions):
            states.append((state, questions))
            return {k: answer(choose(k, q['criteria']), q['criteria']) for k, q in questions.items()}
        task.assess_task(turns, [{'id': 'writing', 'description': 'Write prose'}], evaluate)
        self.assertTrue(any('Write a poem about the moon.' in json.dumps(s) for s, q in states if 'writing' in q))
        for key in ('quality', 'quality_support'):
            packets = [s for s, q in states if key in q]
            self.assertTrue(packets)
            self.assertEqual(packets[0]['referenced_task_context']['sources'][0]['body'], 'Write a poem about the moon.')

    def test_required_context_cannot_be_dropped_to_make_outcome_fit(self):
        turns = [turn(0, 'Read work.md as the task contract and write the requested prose', 'draft')]
        turns[0]['events'] += read('1', 'cat work.md', 'Required clause. ' * 3000)
        @fixture_batches
        def evaluate(state, questions):
            self.assertTrue(task.fits(state, questions))
            return {k: answer(choose(k, q['criteria']), q['criteria']) for k, q in questions.items()}
        result = task.assess_task(turns, [{'id': 'writing', 'description': 'Write prose'}], evaluate)
        self.assertEqual(result['domains'][0]['exclusions'], ['task_context_exceeds_judge_input'])
        self.assertIsNone(result['domains'][0]['eligible_score'])

    def test_quoted_examples_search_patterns_and_incidental_paths_are_not_contract_reads(self):
        for command in ("printf 'example; cat work.md'", "printf ';' cat work.md", 'grep work.md unrelated.log',
                        'echo cat work.md', 'sed -i s/old/new/ work.md', "cat 'work.md'.bak",
                        "cat work'.md'", "cat <<'EOF'\nexample; cat work.md\nEOF", 'cat "$(echo work.md)"'):
            self.assertEqual(context.shell_reads(command), [], command)
        self.assertEqual(context.references('claim/read route claude/model/high; output /tmp/results.json'), [])
        self.assertEqual(context.references('Read `cat work.md` for the task contract.'), ['work.md'])
        self.assertEqual(context.references('Task contract: "/tmp/my task.md"'), ['/tmp/my task.md'])
        self.assertEqual(context.shell_reads('head -n 50 work.md; sed -n \'1,200p\' other.md'), ['work.md', 'other.md'])

    def test_only_explicit_contract_is_pinned_not_large_input_artifacts(self):
        turns = [turn(0, 'Task contract: work.md. Read input /tmp/data.json and save /tmp/results.json.', 'done')]
        turns[0]['events'] += read('1', 'cat work.md', 'Required comparison', 'contract')
        turns[0]['events'] += read('2', 'cat /tmp/data.json', 'input' * 10000, 'input')
        self.assertEqual([s['source_id'] for s in context.collect(turns)['sources']], ['contract'])


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Run a frozen, privately stored task benchmark through the production scorer.

Cases contain source-audited turns, model/effort focus, and expectations. This
measures evaluator behavior, not model capabilities. No routing writes occur.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import os
import tempfile
import math

import jev
import retrospect
import retrospective_judgments as judgments
import task_retrospect as task


def compare(case, result):
    labels = result['involvement']
    involved = {k for k, v in labels.items() if v['choice'] in ('central', 'supporting', 'involved')}
    expected = case['expected']
    required = set(expected['required_domains'])
    allowed = set(expected.get('allowed_domains', required))
    failures = []
    failures += ['missed_domain:' + d for d in sorted(required - involved)]
    failures += ['unexpected_domain:' + d for d in sorted(involved - allowed)]
    records = {d['domain']: d for d in result['domains']}
    failures += ['unjudged_accepted_score:' + d for d, r in records.items()
                 if r.get('eligible_score') is not None and d not in expected.get('scores', {})]
    failures += ['unjudged_accepted_rework:' + d for d, r in records.items()
                 if r.get('eligible_rework') is not None and d not in expected.get('rework', {})]
    for domain, interval in expected.get('rework', {}).items():
        value = records.get(domain, {}).get('eligible_rework')
        if interval is None:
            if value is not None: failures.append('unsupported_rework:' + domain)
        elif value is None:
            failures.append('missing_supported_rework:' + domain)
        elif not interval[0] <= value <= interval[1]:
            failures.append('rework_outside_reference:' + domain)
    score_checks, accepted = 0, 0
    for domain, interval in expected.get('scores', {}).items():
        score_checks += 1
        value = records.get(domain, {}).get('eligible_score')
        if interval is None:
            if value is not None:
                failures.append('unsupported_score:' + domain)
        elif value is None:
            failures.append('missing_supported_score:' + domain)
        elif not interval[0] <= value <= interval[1]:
            failures.append('score_outside_reference:' + domain)
        else:
            accepted += 1
    return {'passed': not failures, 'failures': failures, 'score_checks': score_checks,
            'negative_score_checks': sum(v is None for v in expected.get('scores', {}).values()),
            'supported_scores_accepted': accepted, 'required_domains_found': len(required & involved),
            'required_domains': len(required), 'unexpected_domains': len(involved - allowed),
            'unresolved_domains': sum(v['choice'] == 'unresolved' for v in labels.values())}


def normalize_split(value):
    if value in ('heldout', 'held_out'):
        return 'heldout'
    if value in ('development', 'development_after_first_observation', 'development_after_review'):
        return value
    raise ValueError('Split must be heldout (held_out alias) or a documented development split.')


def validate_benchmark(benchmark, identifiers):
    cases = benchmark.get('cases')
    if benchmark.get('status') != 'frozen' or not isinstance(cases, list) or not cases:
        raise ValueError('Cases must be source-audited and frozen before evaluation.')
    minimum = benchmark.get('minimum_supported_scores', 1)
    if type(minimum) is not int or minimum < 1:
        raise ValueError('minimum_supported_scores must be a positive integer.')
    if len({c['id'] for c in cases}) != len(cases):
        raise ValueError('Case IDs must be unique.')
    for case in cases:
        expected = case['expected']
        required = set(expected['required_domains'])
        allowed = set(expected.get('allowed_domains', required))
        scores = expected.get('scores', {})
        rework = expected.get('rework', {})
        if not required <= allowed <= identifiers or not (set(scores) | set(rework)) <= allowed:
            raise ValueError('Required, allowed and scored domains must have consistent known scope.')
        for interval, maximum in [(v, 4) for v in scores.values()] + [(v, 3) for v in rework.values()]:
            if interval is not None and not (isinstance(interval, list) and len(interval) == 2
                and all(type(v) in (int, float) and math.isfinite(v) for v in interval)
                and 0 <= interval[0] <= interval[1] <= maximum):
                raise ValueError('A reference must be null or an ordered finite interval within its scale.')
        if not case.get('turns') or not case.get('provenance') or not case.get('split'):
            raise ValueError('Every case needs source turns, provenance and split.')
        normalize_split(case['split'])


def validation_status(cases, complete, minimum):
    accepted = sum(c['comparison']['supported_scores_accepted'] for c in cases)
    if accepted < minimum or not all(c['comparison']['passed'] for c in cases):
        return 'failed'
    if not complete:
        return 'passed_requested_subset'
    heldout = [c for c in cases if normalize_split(c['split']) == 'heldout']
    # Frozen development references cannot establish generalization. Require both
    # accepted positive outcomes and explicitly checked unknowns on unseen cases.
    positive = sum(c['comparison']['supported_scores_accepted'] for c in heldout)
    negative = sum(c['comparison'].get('negative_score_checks', 0) for c in heldout)
    return 'passed' if positive >= minimum and negative > 0 else 'passed_checks_unvalidated'


def snapshot(path, value):
    """Publish a complete private result without overwriting another run's temp."""
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, indent=2)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--allow-no-zdr', action='store_true')
    parser.add_argument('--case', action='append', default=[], help='Run selected case IDs; a subset never establishes full benchmark completion')
    parser.add_argument('--rate-limit-wait', type=float, default=120)
    args = parser.parse_args()
    private = retrospect.PRIVATE_ROOT.resolve()
    for path in (args.cases, args.output):
        if path.is_symlink() or not path.resolve().is_relative_to(private):
            parser.error('Cases and output must be regular paths in the private retrospective directory.')
    if not 0 <= args.rate_limit_wait <= 300:
        parser.error('--rate-limit-wait must be between 0 and 300 seconds')
    raw = args.cases.read_bytes()
    benchmark = json.loads(raw)
    taxonomy = json.loads(retrospect.DOMAINS.read_text())
    domains = taxonomy['domains']
    identifiers = {d['id'] for d in domains}
    try:
        validate_benchmark(benchmark, identifiers)
    except (ValueError, KeyError, TypeError) as error:
        parser.error('Invalid benchmark: ' + str(error))
    requested = set(args.case)
    if requested - {c['id'] for c in benchmark['cases']}:
        parser.error('Unknown case ID')
    selected = [c for c in benchmark['cases'] if not requested or c['id'] in requested]
    evaluate = task.Evaluator(args.output.parent / 'cache', not args.allow_no_zdr, args.rate_limit_wait)
    result = {'benchmark_sha256': hashlib.sha256(raw).hexdigest(), 'pipeline_version': task.VERSION,
              'code_sha256': {Path(m.__file__).name: hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest() for m in (task, judgments, jev)},
              'taxonomy': taxonomy, 'cases': [], 'status': 'running', 'complete_benchmark': len(selected) == len(benchmark['cases'])}
    exit_code = 0
    for case in selected:
        try:
            observed = task.assess_task(task.redact(case['turns']), domains, evaluate,
                                       tuple(case['focus']) if case.get('focus') else None,
                                       task.redact(case.get('context', [])))
            comparison = compare(case, observed)
            result['cases'].append({'id': case['id'], 'split': normalize_split(case['split']), 'comparison': comparison,
                                    'result': observed})
            print(json.dumps({'case': case['id'], **comparison}), flush=True)
        except (jev.Error, ValueError) as error:
            result['status'] = 'blocked'
            result['error'] = str(error)
            result['pending_case'] = case['id']
            exit_code = 2
            break
        finally:
            snapshot(args.output, result)
    if not exit_code:
        result['supported_scores_accepted'] = sum(c['comparison']['supported_scores_accepted'] for c in result['cases'])
        result['positive_coverage_passed'] = result['supported_scores_accepted'] >= benchmark.get('minimum_supported_scores', 1)
        result['status'] = validation_status(result['cases'], result['complete_benchmark'], benchmark.get('minimum_supported_scores', 1))
        exit_code = 0 if result['status'] in ('passed', 'passed_requested_subset') else 1
    result['calls'] = evaluate.calls
    result['cache_hits'] = evaluate.hits
    snapshot(args.output, result)
    print(json.dumps({k: v for k, v in result.items() if k not in ('cases', 'taxonomy')}), flush=True)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())

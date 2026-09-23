"""Machine-wide selector setup and Jev decisions checked by the local router."""
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import tempfile

import jev
from jev_context import prepare_case
import router


def settings_path():
    return Path.home() / '.furanku-skills/model-routing/selector.json'


def read_settings():
    path = settings_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        raise jev.Error('Cannot read selector settings; run router.py setup --selector agent|jev.') from None
    if not isinstance(data, dict) or data.get('version') != 1 or data.get('selector') not in ('agent', 'jev'):
        raise jev.Error('Invalid selector settings; run router.py setup --selector agent|jev.')
    return data


def status():
    settings = read_settings()
    if settings is None:
        return {'status': 'setup-required', 'setup': 'router.py setup'}
    result = {'status': 'ready', **settings, 'path': str(settings_path())}
    if settings['selector'] == 'jev':
        try:
            _, source = jev.load_key()
            result['credential_source'] = source
            result['authentication'] = 'last-setup-verified; current credential not tested'
        except jev.Error as exc:
            result.update(status='key-required', error=str(exc))
    return result


def setup(choice=None):
    if choice is None:
        if not sys.stdin.isatty():
            raise jev.Error('Ask the user whether to use Jev, then run setup --selector jev or setup --selector agent.')
        print('Use Jev to choose models? Jev sends task facts, routing preferences and candidate evidence through Vercel AI Gateway. It needs your Gateway key. [y/n]', file=sys.stderr)
        answer = input().strip().lower()
        if answer not in ('y', 'yes', 'n', 'no'):
            raise jev.Error('Answer yes or no; settings were not changed.')
        choice = 'jev' if answer in ('y', 'yes') else 'agent'
    if choice == 'jev':
        try:
            jev.load_key()
        except jev.Error:
            if not sys.stdin.isatty():
                raise
            jev.setup()
        # Verification uses synthetic data only; a failed toggle preserves the old choice.
        jev.evaluate_bounded({
            'model': jev.MODEL, 'state': 'Credential verification: the word is ready.',
            'questions': {'ready': {'type': 'choice', 'instructions': 'Which word appears in the state?',
                                   'criteria': {'ready': 'The word ready', 'missing': 'No word ready'}}},
        })
    data = {'version': 1, 'selector': choice}
    path = settings_path()
    if path.is_symlink() or path.parent.is_symlink():
        raise jev.Error('Selector settings must be a regular file and directory.')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            json.dump(data, stream)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return {'status': 'ready', **data, 'path': str(path),
            'authentication': 'verified' if choice == 'jev' else 'not-required'}


def load_task(path):
    if not path:
        raise jev.Error('Jev routing requires --task-file with task facts; see references/jev.md.')
    try:
        raw = Path(path).read_bytes()
        if len(raw) > 64000:
            raise jev.Error('Task context exceeds 64 KB; summarize the relevant facts.')
        data = json.loads(raw)
    except (OSError, ValueError):
        raise jev.Error('Cannot read task JSON.') from None
    fields = {'outcome', 'acceptance_criteria', 'repository_facts', 'authority', 'failure_impact',
              'unknowns', 'prior_attempts', 'deliverable', 'dependencies', 'constraints'}
    if not isinstance(data, dict) or set(data) - fields:
        raise jev.Error('Task JSON must contain only documented task fields; do not supply raw session/config data.')
    if not isinstance(data.get('outcome'), str) or not data['outcome'].strip():
        raise jev.Error('Task JSON requires a nonempty outcome.')
    for key, value in data.items():
        if not isinstance(value, str) and not (isinstance(value, list) and all(isinstance(v, str) for v in value)):
            raise jev.Error('Task fields must be text or lists of text.')
    return data


def route(compiled, args, runtime):
    settings = read_settings()
    if settings is None:
        raise jev.Error('One-time setup required: ask whether the user wants Jev, then run router.py setup --selector agent|jev.')
    if args.exact_route:
        return router.check(compiled, args, runtime)
    if settings['selector'] == 'agent':
        return router.check(compiled, args, runtime)
    if args.candidate or args.reason or args.route_basis or args.use_quota_fallback or getattr(args, 'explicit_basis', None):
        raise jev.Error('Jev chooses ordinary candidates; use check --candidate --explicit-basis for a principal-requested explicit candidate, or omit candidate/reason/route-basis/fallback flags.')
    launchers = router.parse_allowed_launchers(args.launchable_via)
    if not launchers:
        raise jev.Error('Jev routing requires --launchable-via from the consumer.')
    case = {'task': load_task(args.task_file), 'require_features': args.require_feature,
            'minimum_context': args.minimum_context, 'max_effort_basis': args.max_effort_basis,
            'allowed_models': args.allow_model, 'allowed_efforts': args.allow_effort}
    try:
        payload, mapping, excluded = prepare_case(compiled, runtime, case, launchers)
    except jev.Error as exc:
        if "No eligible candidates" in str(exc) and any(
            candidate.get("explicit", False)
            and candidate["launch"]["agent"] in launchers
            and (not args.allow_model or candidate["launch"]["model"] in args.allow_model)
            and (not args.allow_effort or candidate["launch"]["effort"] in args.allow_effort)
            for candidate in compiled["candidates"].values()
        ):
            raise jev.Error("Only explicit candidates match; use check --candidate --explicit-basis with the principal's model and effort request.") from exc
        raise
    if args.require_zdr:
        payload['providerOptions']['gateway']['zeroDataRetention'] = True
    result = jev.evaluate_bounded(payload)
    answer = result['answers']['route']
    alias = answer['choice']
    evidence = {'name': 'jev', 'model': jev.MODEL, 'choice_probability': answer['probabilities'][alias],
                'confidence': answer['confidence'], 'elapsed_seconds': result['elapsed_seconds'],
                'usage': result['usage'], 'cost_usd': result['cost_usd']}
    if alias == 'abstain':
        return {'status': 'refused', 'reasons': ['Jev abstained: clarify task facts or candidate adequacy before rerouting.'], 'selector': evidence}
    candidate_id = mapping[alias]
    # Reload both configuration and runtime; the selected offer cannot change during evaluation.
    fresh = router.compile_brief(args.repo)
    if fresh['candidates'].get(candidate_id) != compiled['candidates'][candidate_id] or fresh['preferences'] != compiled['preferences'] or read_settings() != settings:
        return {'status': 'refused', 'reasons': ['Routing configuration changed during evaluation; rerun route.'], 'selector': evidence}
    checked = deepcopy(args)
    checked.candidate = candidate_id
    checked.reason = 'Jev selected this offer from eligible candidates using task facts, preferences, capability evidence and quota.'
    decision = router.check(fresh, checked, router.load_runtime(args, fresh['candidates']))
    decision['selector'] = evidence
    return decision

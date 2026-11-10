"""Interpret an orchestrator observation; never launch, poll, sleep, or send messages.

The orchestrator owns attempts and questions. This module returns the next
permitted action from that evidence, current routing gates, and user policy.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import policy
import router


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Expected an ISO-8601 timestamp with timezone')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('Expected an ISO-8601 timestamp with timezone') from None
    if result.tzinfo is None:
        raise ValueError('Timestamp must include a timezone')
    return result.astimezone(timezone.utc)


def read_event(path):
    if not path:
        raise ValueError('recover requires --event-file from the existing orchestrator observation')
    file = Path(path)
    if file.stat().st_size > 128_000:
        raise ValueError('Recovery observation exceeds 128 KB; supply facts and evidence pointers only')
    event = json.loads(file.read_text())
    validate_event(event)
    return event


def validate_event(event):
    if not isinstance(event, dict):
        raise ValueError('Recovery observation must be an object')
    for key in ('attempt', 'evidence'):
        if not isinstance(event.get(key), str) or not event[key].strip():
            raise ValueError(f'Recovery observation requires {key}')
    if event.get('cause') not in {'quota_exhausted', 'rate_limited', 'auth_required', 'start_failed', 'unknown'}:
        raise ValueError('Unsupported recovery cause')
    if event.get('phase') not in {'before_start', 'interrupted'}:
        raise ValueError('Recovery phase must be before_start or interrupted')
    if type(event.get('settled')) is not bool:
        raise ValueError('settled must record whether the orchestrator settled the previous attempt')
    timestamp(event.get('observed_at'))
    count = event.get('replacement_count', 0)
    if type(count) is not int or count < 0:
        raise ValueError('replacement_count must be a non-negative integer')
    decision = event.get('decision')
    if not isinstance(decision, dict) or not isinstance(decision.get('requirements'), dict):
        raise ValueError('Recovery requires the original routing decision including its requirements')
    if not (decision.get('candidate') or isinstance(decision.get('selected'), dict)):
        raise ValueError('Original routing decision has no candidate')


def prepare(args, event):
    """Carry the original task constraints through a recovery command."""
    original = event['decision']
    candidate = (original.get('selected') or {}).get('id') or original.get('candidate')
    if not candidate:
        raise ValueError('Recovery requires a catalog-backed original candidate')
    if args.candidate and args.candidate != candidate:
        raise ValueError('Recovery candidate differs from the recorded original; use --alternative')
    args.candidate = candidate
    route = original.get('exact_route') or original.get('route')
    if route:
        if args.exact_route and args.exact_route != route:
            raise ValueError('Recovery route differs from the original decision')
        args.exact_route = route
        args.route_basis = original.get('route_basis')
        args.candidate = None
    args.reason = original.get('reason') or 'Resume the original assignment after its usage-limit interruption.'
    if route:
        args.reason = None
    args.role = original.get('role') or args.role
    args.require_original = args.require_original or original.get('require_original', False)
    args.explicit_basis = original.get('explicit_basis') or args.explicit_basis
    args.max_effort_basis = args.max_effort_basis or original.get('max_effort_basis')
    required = original['requirements']
    args.require_feature = sorted(set(required.get('features', [])) | set(args.require_feature))
    original_launchers = set(required.get('launchable_agents', []))
    requested = router.parse_allowed_launchers(args.launchable_via)
    if not original_launchers:
        raise ValueError('Original decision must record its launchable agents for recovery')
    allowed = original_launchers if requested is None else original_launchers & requested
    if not allowed:
        raise ValueError('No launch surface satisfies the original and current constraints')
    args.launchable_via = [','.join(sorted(allowed))]
    args.native_account_only = sorted(set(required.get('native_account_only', [])) | set(args.native_account_only))


def invalidate(event, dependency):
    if event['cause'] == 'quota_exhausted':
        import accounts
        binding = event['decision'].get('account_binding')
        if binding:
            return accounts.invalidate_quota_cache(binding, dependency)
    return True


def pinned_original(compiled, args, original):
    """A route names policy; its later edits cannot rewrite an existing assignment."""
    selected = original.get('selected') or original
    candidate = compiled['candidates'].get(selected.get('id') or original.get('candidate'))
    if not candidate or any(selected.get(key) != candidate['launch'][key] for key in ('agent', 'model', 'effort')):
        raise ValueError('Original launch tuple is no longer in the effective catalog; review the assignment')
    if not args.exact_route:
        return compiled
    result = deepcopy(compiled)
    result['exact']['config']['routes'][args.exact_route] = deepcopy(candidate['launch'])
    provenance = original.get('provenance')
    if not isinstance(provenance, dict) or not isinstance(provenance.get('winner'), dict):
        provenance = {'winner': original.get('source') or {'scope': 'saved-assignment', 'path': None},
                      'effective': deepcopy(candidate['launch']), 'replaced': []}
    result['exact']['route_provenance'][args.exact_route] = provenance
    return result


def same_allowance(binding, row):
    if binding.get('provider') != row.get('provider'):
        return False
    if binding.get('key') == row.get('key'):
        return True
    identity = binding.get('quota_identity') or binding.get('expected_identity') or {}
    other = row.get('measurement', {}).get('identity') or row.get('expected_identity') or {}
    for key in ('providerAccountId', 'organizationUuid'):
        if identity.get(key) and other.get(key):
            return identity[key] == other[key]
    # Without a distinguishing organization, aliases of the same email cannot
    # establish independent allowance. A false exclusion is safer than a loop.
    return bool(identity.get('email') and identity['email'].casefold() == str(other.get('email', '')).casefold())


def equivalent(compiled, args, runtime):
    if not args.alternative or args.require_original:
        return None
    if not args.equivalence_reason or not args.equivalence_reason.strip():
        raise ValueError('--alternative requires a task-specific --equivalence-reason')
    alternative_args = deepcopy(args)
    alternative_args.candidate = args.alternative
    alternative_args.exact_route = None
    alternative_args.route_basis = None
    alternative_args.reason = args.equivalence_reason
    # A request for the original model never authorizes an explicit-only substitute.
    alternative_args.explicit_basis = None
    alternative_args.accept_quota_unknown = None
    decision = router.check(compiled, alternative_args, runtime)
    if decision['status'] != 'selected':
        return None
    if decision.get('quota', {}).get('status') not in {'known', 'available', 'pooled'}:
        return None
    return decision


def reserve_alternative(compiled, args, runtime, decision):
    """A reserve can divert a launch only to a ready, justified equivalent."""
    if decision.get('status') not in {'selected', 'exact'} or args.require_original:
        return decision
    quota = decision.get('quota', {})
    left = quota.get('effective_percent_remaining')
    import accounts
    reserve = quota.get('reserve_percent', accounts.DEFAULT_RESERVE_PERCENT)
    if not isinstance(left, (int, float)) or left <= 0 or left > reserve:
        return decision
    replacement = equivalent(compiled, args, runtime)
    if replacement and replacement['selected'] != decision['selected']:
        other = replacement.get('quota', {})
        if other.get('status') != 'pooled' and other.get('effective_percent_remaining', 0) <= other.get('reserve_percent', accounts.DEFAULT_RESERVE_PERCENT):
            return decision
        return {'status': 'alternative-available', 'reason': 'Preserve the reserve because a ready equivalent is available.',
                'original': decision, 'alternative': replacement}
    return decision


def blocked_runtime(compiled, event, runtime):
    result = deepcopy(runtime)
    original = event['decision']
    binding = original.get('account_binding') or {}
    selected = original.get('selected') or {}
    candidate_id = selected.get('id') or original.get('candidate')
    candidate = compiled['candidates'].get(candidate_id)
    if not candidate:
        raise ValueError('Original candidate is no longer in the effective catalog')
    if binding.get('key') and result.get('account_inventory') is not None:
        # Older saved bindings may lack identity. Recover it from this inventory
        # before mutating measurements, then exclude every alias of that pool.
        binding = deepcopy(binding)
        if not binding.get('quota_identity'):
            source = next((row for row in result['account_inventory']['accounts'] if row['key'] == binding['key']), {})
            binding['quota_identity'] = source.get('measurement', {}).get('identity') or source.get('expected_identity', {})
        for row in result['account_inventory']['accounts']:
            if same_allowance(binding, row):
                row['measurement'] = {'status': 'exhausted', 'windows': []}
    else:
        # Without account-specific evidence, avoid aliases of the exhausted pool.
        provider = router.billing_provider(candidate)
        result.setdefault('blocked_quota_pools', []).append(provider)
        for key, row in compiled['candidates'].items():
            if router.billing_provider(row) == provider:
                result.setdefault('candidates', {}).setdefault(key, {})['quota'] = {'status': 'exhausted'}
        for row in result.get('account_inventory', {}).get('accounts', []):
            if row['provider'] == provider:
                row['measurement'] = {'status': 'exhausted', 'windows': []}
    return result


def render(name, **values):
    templates = json.loads((Path(__file__).resolve().parent.parent / 'references/message-templates.json').read_text())
    return templates[name].format(**values)


def plan(compiled, args, runtime, event, now=None):
    validate_event(event)
    now = now or datetime.now(timezone.utc)
    if timestamp(event['observed_at']) > now:
        raise ValueError('Recovery observation is in the future')
    original = event['decision']
    inherited = original.get('recovery', {})
    overrides = {key: inherited['policy'][key] for key, source in inherited.get('sources', {}).items()
                 if source.get('scope') == 'override'}
    if args.policy_file:
        overrides.update(router.read_json(Path(args.policy_file), 'assignment policy'))
    context = original.get('recovery_context') or {'role': args.role, 'route': args.exact_route}
    resolved = policy.resolve_layers(compiled.get('recovery_layers', []), context.get('role'), context.get('route'), overrides)
    settings = resolved['policy']
    result = {'status': 'recovery', 'attempt': event['attempt'], 'evidence': event['evidence'], 'policy': resolved}

    def action(kind, detail, **extra):
        return {**result, 'action': kind, 'detail': detail, **extra}

    if event['cause'] != 'quota_exhausted':
        return action('inspect', 'Use the orchestrator recovery procedure for this cause; quota substitution is not authorized by this observation.')
    if not event['settled']:
        return action('settle_attempt', 'Preserve completed work and settle the original attempt through its orchestrator before a replacement.')
    if event.get('replacement_count', 0) >= settings['max_replacements']:
        return action('stop', 'The configured replacement limit is reached; preserve the assignment and ask before more attempts.')
    current = blocked_runtime(compiled, event, runtime)
    same = router.check(pinned_original(compiled, args, original), args, current)
    replacement = same if same['status'] in {'selected', 'exact'} else equivalent(compiled, args, current)

    question = event.get('question')
    answer, deadline = None, None
    if question is not None:
        if not isinstance(question, dict) or not isinstance(question.get('id'), str) or not question['id'].strip():
            raise ValueError('Question requires its existing orchestrator/notification id')
        asked = timestamp(question.get('asked_at'))
        if asked > now:
            raise ValueError('Question presentation time is in the future')
        deadline = asked + timedelta(seconds=settings['response_seconds'])
        answer = question.get('answer')
        if answer not in (None, 'continue', 'wait', 'stop'):
            raise ValueError('Question answer must be continue, wait, or stop')
        if answer is None and now >= deadline:
            answer = settings['on_no_reply']
        if answer is None:
            return action('await_answer', 'Keep independent work moving and wait through the existing question mechanism.',
                          question_id=question['id'], deadline=deadline.isoformat())
    if answer == 'stop':
        return action('stop', render('stopped'))
    wait = answer == 'wait' or (answer is None and settings['on_limit'] == 'wait')
    if wait:
        reset = timestamp(event['resets_at']) if event.get('resets_at') else None
        # Anchor the cap to the incident, so repeated planning never extends it.
        cap = timestamp(event['observed_at']) + timedelta(seconds=settings['max_wait_seconds'])
        if reset and now < reset <= cap:
            return action('wait', render('wait', deadline=reset.isoformat()), until=reset.isoformat())
        if reset and reset <= now and now <= cap:
            return action('recheck', 'The reported reset has passed. Refresh quota and gate the original selection; the clock alone is not quota evidence.')
    elif replacement and (answer == 'continue' or settings['on_limit'] == 'equivalent'):
        replacement['recovery'] = resolved
        replacement['recovery_context'] = context
        return action('resume', render('recovered', replacement=replacement['selected']['model']), decision=replacement)
    if answer == 'continue':
        return action('choose_alternative', 'No supplied alternative passed the current gates. Judge another equivalent within the original constraints, or preserve the blocked assignment.',
                      original_verdict=same['status'])
    return action('ask', render('quota_question', seconds=settings['response_seconds'], no_reply=settings['on_no_reply']),
                  choices=['continue', 'wait', 'stop'], response_seconds=settings['response_seconds'],
                  on_no_reply=settings['on_no_reply'], alternative=replacement)

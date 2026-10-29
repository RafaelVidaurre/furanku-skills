# Meaning-preservation scenarios

Use these checks when maintaining the skill or when a candidate risks changing meaning through compression. Apply the owning rules in SKILL.md; these cases illustrate them rather than defining another policy. Judge the complete entry, not its heading alone.

## An illustration becomes a restriction

Evidence: a music chart should guide useful accompaniment. A singer over a held C illustrates why a momentarily plausible chord label may not belong in the chart. A brief D7 leading to G illustrates why short duration alone cannot justify removing a change. Acoustic guitar is an example, not a supported-instrument boundary.

Fail: “Show the important changes an acoustic guitarist would play.” It invents a scope restriction and leaves “important” unable to distinguish the two cases.

Pass: preserve the distinction between recognizing harmonic events and selecting chart changes, the role of beat/bar/phrase position, and both unwanted changes and omitted important changes as errors. Keep the C and D7 cases labeled as illustrations, without limiting the product to guitar. Several linked commitments or one coherent entry can work; no algorithm, duration threshold, or promise to display every detected event is implied.

## A broader category becomes a familiar subtype

Evidence: a gallery shows all received media, scoped to the project or session from which it is opened.

Fail: “A gallery of every image received.” Images narrow media without authority.

Pass: preserve media and the entry-point scope. If supported media types are unsettled, expose that specific open question rather than silently choosing images.

## Commitment is confused with delivery

Evidence: “The text should have its own editable timeline track. Build it later.”

Fail: tentative because it is not built yet.

Pass: accepted product intent when the decision is settled, with scheduling and implementation status in the work tracker. Conversely, shipping an experiment does not establish acceptance of its product direction.

## A boundary is hidden in implementation documentation

Evidence: newly signed-in devices receive only a defined recent interval of unfinished notifications, rather than the account's entire history.

Fail: “Receive a bounded recent backfill,” leaving both the interval and the finished-item exclusion solely in an architecture document.

Pass: retain the agreed interval and exclusion in the requirement. If the interval was merely an implementation choice, identify it as such and retain only the supported product boundary; do not invent user commitment.

## A narrow amendment erases unrelated behavior

Existing accepted entry: users without access choose a plan; existing purchases can be restored; restore conflicts have a recovery route.

Evidence: change the next action from requesting an invitation to choosing a plan.

Fail: replace the whole entry with “Users without access choose a plan,” archiving restore and recovery as if they were retired.

Pass: change the authorized action and retain restore and recovery. The clause comparison makes any separately proposed removal explicit before confirmation.

## A temporary scope becomes permanent

Evidence: remove outdated launch wording from current requirements. Existing entry excludes a login method during an early testing period.

Fail: remove the period qualifier and turn the temporary exclusion into a permanent product ban.

Pass: identify the unresolved enduring policy and ask about that policy; a wording cleanup alone does not decide it.

## A good bounded requirement

Evidence: deleting a session on one device removes its local requests and messages, leaves other devices unchanged, and later activity makes it reappear with fresh local history.

Pass: an entry preserving all three boundaries. A slogan such as “Users can delete sessions” fails because account-wide deletion also satisfies it.

## Reading has an observable consequence

Setup: an accepted entry permits notes to a resumable session that is temporarily unreachable. A proposed UI would remove its composer.

Pass: consult the area entry before designing, retain the permitted path or surface the proposed change, and tie review checks to that behavior. Merely mentioning an R-ID or claiming “read PRR” does not demonstrate use.

## Confirmation is already supplied

Evidence: “Record this accepted requirement: The app is named Meadow.”

Pass: record that exact decision and evidence. Asking whether to record the same sentence adds no decision. A synthesized naming policy or additional restriction would need its own support and confirmation.

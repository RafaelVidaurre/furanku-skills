# The style library

The approved pictures and rules that production work follows: how it is built, where it is saved, what a new revision does, and how the exploration is closed.

## Coverage

One winning image does not define a style. The library is complete when it holds **at least three distinct shots the person approved** that together cover the situations that matter in this game, and the person agrees they do. Three is a floor.

1. List what the approved shots establish and what they leave untested: the game's places, activities, states, subjects and scales, as far as they apply. Derive this from the game; ask about what is unknown instead of inventing content to fill slots.
2. Propose a few complementary shots, each with the situation it shows and the question it answers. Near-duplicates, crops and palette swaps add no coverage. A game set in one place may need different activities or states there.
3. Generate only what is missing, in the chosen direction, with the approved shots attached as style references ([style-exploration.md](style-exploration.md#a-round), [style-images.md](style-images.md)). Coverage shots share one style and differ in situation; they are not competing options.
4. Show the whole set together and ask whether it captures the game's range or what to develop next. A supporting close-up can establish materials; it does not replace a gameplay-scale shot.

A set with gaps is saved as in progress and named as such.

## Save what is approved

Do this as shots are approved, without waiting for the set to be complete.

1. **Copy** each approved image, original bytes, out of the run folder into a tracked folder for this revision, for example `Art/Style/v001/shots/`, with a descriptive name. Rejected options and images whose licence is unknown stay in scratch.
2. **Write the provenance** beside them (`provenance.md`): per shot, the run and record it came from, the prompt and input roles, the tool or job, the person's approval in their words, and rights notes for any source image. It must stay readable after scratch is deleted.
3. **Update the one style document** (`style.document`): a gallery of the shots with what each establishes, the rules that follow from them (shapes, surfaces, palette, camera rig), exceptions, and what is still open. Keep a single guide; mark superseded revisions as history.
4. **Register:**

   ```
   jam config set style.document <path to the guide>
   jam config set style.references '["<shot>", "<shot>"]'
   ```

5. **Check** the images open from the gallery, are not Git-ignored and are in Git LFS, and report which files are saved, committed and pushed.

## Revisions

`style.revision` names the approved art direction. Set it when the first direction is approved, before production runs begin:

```
jam config set style.revision v001
```

Changing it tells every run bound to the style that it was made for an earlier direction: those records turn `stale` ([contracts.md](contracts.md#when-recorded-work-stops-counting)). So change it only when the person approves a new direction, and tell them which runs it affects (`jam run status`). Adding shots or editing the guide inside a revision changes nothing for existing runs.

## Close the exploration

When coverage is complete and the library is saved and checked, clean up without asking again:

1. In the provenance, note what was chosen, what was rejected and why, and which scratch runs belonged to the exploration.
2. Keep every `run.json` with its request files and evidence, anything a record still references, any run with an unsettled job (`jam job list --open`), the person's own originals, and whatever they asked to keep.
3. Delete the rest of those runs' scratch: rejected candidates, redundant copies of promoted images, downloads and logs. Work from an explicit list of paths inside those run folders, never a wildcard over scratch, and never another agent's folders.
4. Check the library still opens, and report what was removed and what was kept and why.

An exploration that is paused, or a set that is still in progress, is not closed and is not cleaned.

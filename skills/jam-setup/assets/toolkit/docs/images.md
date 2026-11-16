# Images: rounds, prompts, showing and custody

Shared by style exploration, concepts and turnarounds. Which routes exist and what they cost is in [providers.md](providers.md#routes); image generation, image search and images the person supplies are all valid sources and can be mixed.

## A round

A round is one set of images that answers one question for the person.

- **The agreed number of options, exactly.** Four, unless the person named another number; a number they named holds for later rounds until they change it. Three good images and one known failure is not four options: say the round is one short and why.
- **One subject per image.** One prop, one character, one view of one scene. A request for four characters is four images unless the person asked to see them together. Sheets and line-ups are made only when the step calls for one (a turnaround sheet).
- **The camera is stated in every prompt**: where it is, what it looks at, how much of the frame the subject fills. For a gameplay image that is the confirmed rig ([style-images.md](style-images.md)); for a design image it is the neutral view named in the step.
- **Independent options come from independent sessions**, so one does not colour the next. An edit of a chosen image continues from that image.
- **What varies and what stays fixed** is decided before generating and written down with the prompts. Options that differ only in palette or a small detail do not answer an open question.

## Prompts and references

- Write the prompt yourself, complete, from the brief. Do not forward the conversation and let the image model infer.
- Attach reference images as real inputs and state each one's role and what to ignore in it: "image 1 is identity only: keep the face, hair and build; ignore the clothes, pose, background and rendering". A model copies whatever it is not told to ignore.
- For an edit, name the one change and everything that must stay identical.
- Prefer describing what should be there. Add an exclusion only for a failure you have seen.
- When a worker generates, it receives the exact prompt and executes it. It reports the prompt it sent and the inputs it attached; a changed subject, count, pose, camera or treatment is a defect.

## Inspect before showing

Open every returned image and check it against the brief before the person sees it: subject, count, camera, the requested difference between options, and stray text, borders or labels.

- An image that fails the brief is not offered as a choice. Regenerate it inside the existing authorization, or show the round as short. It may be shown, labelled as failed, when it explains what went wrong.
- An image that fails one requirement but shows something useful about another is presented as exactly that: "wrong camera; shown for the shading only". Choosing its shading does not approve its camera.
- When a prompt was right and the image was not, record it as the model not following the prompt. Do not rewrite the brief to match the output.
- The same failure twice means the approach changes (simpler prompt, a layout reference, another model), not stronger adjectives.

## Show the originals

Put each original image file in the conversation at full resolution, with a letter and a one-line caption that describes what this image shows. No collage, contact sheet, gallery page, resizing, cropping or recompression: people judge from the real image and asked for it every time they got something else. A viewer scaling the image to the screen is fine. When the host cannot display an image, say so and give the file path or link to the original.

A turnaround's views are shown as the five cropped files, with the sheet available.

## Custody

- Save each image in the run folder (or the scratch root for work outside a run) before depending on it, original bytes kept. Edits are new files.
- Record with the origin that is true: `--tool` for a tool with no job, `--job` for a paid result, `--source ... --source-evidence` for an image found or supplied. Keep the prompt, the input images and their roles beside it as evidence.
- Images found online are references. Keep the source page, creator and why it was chosen; keep the files in ignored scratch unless their licence allows shipping. Looking at an image gives no right to redistribute it.
- A generated gameplay image is a mock-up. It is never evidence that something runs in an engine.

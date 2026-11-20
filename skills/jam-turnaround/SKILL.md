---
name: jam-turnaround
description: Produce five consistent views of one asset (front, left, back, right, three-quarter) from a chosen design, cropped to equal canvases, as the input for 3D generation or a 2D sheet. Use when the user asks for a turnaround, orthographic views or a model sheet, or when a run's next step names this skill.
---

# Five-view turnaround

One operation: from an accepted design image to five view files. `jam` below is `node tools/jam/jam.mjs`.

Inside a run, start from `jam run next <id>`: it names this step's guide, its outputs and its gate. With only a design image and no run, start one at the design and record the image with its origin first (`jam run start <recipe> <id> --brief-text "..." --from concept`). Runs, gates and a missing toolkit are the `jam-recipe` skill's.

1. **Inputs and route.** `jam run status <id>` must show `concept` accepted; the design is the file that step recorded (in the run folder, listed in the run file that `jam run where <id>` prints). Read the guide section. The image route must accept a reference image; choose it as `tools/jam/docs/providers.md#routes` says unless one is already chosen. Done when the design file and a callable route are in hand.
2. **Generate one sheet** with the design attached as the reference for identity. Ask for the same object from the front, the subject's own left, the back, the subject's own right, and a three-quarter view:
   - orthographic for the four cardinal views; the three-quarter is for review and may have mild perspective;
   - the same pose and scale in every view, each centred in an equal cell (one row of five, or two rows of three with the last cell empty);
   - a flat uniform background, with no text, labels, borders or shadows across cells;
   - asymmetric details named, so left and right are not mirror inventions.

   Done when a sheet exists whose views agree with each other and with the design and stay inside their cells. A sheet that fails is regenerated inside the existing authorization (`tools/jam/docs/images.md#inspect-before-showing`).
3. **Crop.** Write `layout.json` with each view's rectangle in pixels measured on the sheet, `{"front": [x, y, width, height], "left": ..., "back": ..., "right": ..., "three-quarter": ...}`, then:

   ```
   jam crop <sheet.png> <layout.json> <new folder>
   ```

   It cuts without resampling onto equal canvases, checks that left and right face opposite ways, and prints the `--file` flags for recording. Add `--symmetric` only when the subject's two sides really are identical. Done when the five files exist and you have opened each: right view under the right name, centred, same scale, clean background. Equal sizes alone prove none of that.
4. **Show the five originals** with the sheet available (`tools/jam/docs/images.md#show-the-originals`) and ask the one decision: are these the views to build from.
5. **Record:**

   ```
   jam run record <id> turnaround --file view:front=<front.png> --file view:left=<left.png> --file view:back=<back.png> \
     --file view:right=<right.png> --file view:three-quarter=<three-quarter.png> \
     --evidence <crops.json> --evidence sheet=<sheet.png> --note "<how the sheet was made>" --tool "<image tool and version>"
   ```

   `--job <job>` replaces `--tool` for a paid result; `--symmetric` is repeated here when it was used to crop. Then the gate: relay the person's answer or request review, as `jam run next <id>` prints.

Done when `jam run status <id>` shows `turnaround` accepted, or the person holds the question. Keep all five views even when the next step uses fewer.

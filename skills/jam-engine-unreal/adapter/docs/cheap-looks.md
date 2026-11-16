# The lightest way to look

The adapter has no `capture` command: capturing depends on the project's own editor tooling. Use the lightest context that can answer the question, and record what you captured as the step's evidence.

| Question | Lightest context that answers it |
| --- | --- |
| Did the file import, on which skeleton, with which slots and counts? | `jam engine inspect <id>`, or `jam engine check --kind skinned` through a commandlet: no window, no renderer |
| Does an asset store a machine path? | `jam engine check --kind sources <id>`: reads the files, no editor |
| Does collision cover the mesh? | `jam engine check --kind collision <id>` in a running editor without rendering |
| Does the textured asset look right? | One still of the asset: the editor's asset-image capture tool, or the mesh placed in a level and one viewport capture |
| Does it hold up in play (poses, borders, feet on the ground)? | Play In Editor, a still per pose |
| Does motion read (walk, swing, topple)? | A short clip, after a still showed the asset is right |
| Does it ship? | A packaged build that loads it |

Rules that kept runs cheap in the jam:

- **A state probe before a still, a still before a clip.** Read the value (bounds, skeleton, collision flags, an actor's collision state) when a number answers the question. Record a clip only for motion.
- **A headless editor has no picture.** `-nullrhi` removes the renderer; a headless import that passes says nothing about how the asset looks. Captures and render-dependent timing need an editor with full graphics.
- **Choose the editor context by need:** no renderer for non-visual edits and telemetry; a low-quality viewport when a tool needs one but quality is not judged; full graphics for stills, motion review and frame-rate-sensitive measurement; a visible window only when a person plays. An editor meant to stay hidden needs `-RenderOffScreen`; `-unattended` and `-nosound` alone leave it owning windows and input.
- **Frame a close-up from 25 cm or more.** The near clip plane cuts closer geometry into holes that look like a broken mesh.
- **Turn motion blur off for review captures** so moving hands, collision response and animation stay readable.
- **Look on the machine you work on** when the question is about art, not the engine: a DCC render or the catalog's capture answers "does the texture look right" without a shared host's graphics slot.
- **Keep one editor open for a run of checks and stop it when they are done.** A full-graphics editor holds the machine's GPU.
- Advancing play time proves nothing about input: drive the character with real inputs when the check is about control.

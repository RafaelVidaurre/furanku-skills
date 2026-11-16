# Accepting engine work

Rules for calling an asset done in an engine, whatever the engine. Each one cost a game jam something. The adapter's `acceptance` guide (`jam engine docs acceptance`) says how each is met in its engine.

1. **Seen in the engine, not only headless.** A headless import that succeeds proves the file parsed. It does not show textures mapped through the right UV set, a normal map read in the right convention, or materials on the right slots. One character passed its headless check and was approved with scrambled textures, because nothing had been rendered in the engine. Done when a rendered view from the engine shows the asset as intended.
2. **Checked on the working machine.** Look where you work whenever the question is about the asset, not the engine: a DCC render, the catalog's capture, a local editor. Shared hosts and their graphics slots are for what only they can answer.
3. **A readout before a still, one still before any clip.** Read the value when a number answers the question (bounds, slot names, skeleton, collision). Take one still when a look answers it. Record a clip only for motion, after a still showed the asset is right.
4. **Reuse evidence.** Another agent's or step's evidence stands unless it is missing, stale or contradicted. Rerun a check for one of those reasons, and say which.
5. **Shipped means loaded in a packaged build.** An asset that works in the editor can still be missing from, or broken in, the build players get. It counts as shipped once a packaged build that contains it loads it.
6. **Reimport keeps the id.** Replacing an asset's content must not change what the game refers to. After a reimport, the receipt's id equals the earlier one, and `jam engine references <id>` still lists what used it.
7. **Sources are stored project-relative.** An imported asset remembers where its source was. Import from a file inside the project so that path is relative to it; an absolute path ties the asset to one person's machine and leaks its layout into a shared repository. Done when the adapter's source check, or a search of the saved asset for a drive letter or home folder, finds none.
8. **The engine's own binaries are locked before they change** when the project's version control cannot merge them, and are committed from the checkout whose editor saved them.
9. **Delete only what nothing refers to.** `jam engine references <id>` first; then search source and config for the asset's name, which an engine's reference graph does not see.

An imported asset is accepted when rules 1, 6 and 7 hold for it and the run's step is recorded with the evidence; it is shipped when rule 5 holds.

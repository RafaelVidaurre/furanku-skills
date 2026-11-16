# Acceptance in this runtime

- **Seen in the runtime:** one still from the running game ([capture.md](capture.md)).
- **Sources project-relative:** `jam engine check` passes; every `.source.json` names a path inside the project.
- **Reimport keeps the id:** the id is the kind and the file name, so importing a new revision under the same file name keeps it. `jam engine references <id>` lists the game data that names it.
- **Shipped:** the packaged game's `assets/` folder holds the file and the game loads it.

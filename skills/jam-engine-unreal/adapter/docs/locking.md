# Locks for engine binaries

`.uasset` and `.umap` files are binary: they "cannot be opened as text or merged in a text-based merge tool" (Epic, source-control guidance). Two people who save the same asset cannot both keep their work, so one of them holds a lock while the file is changed.

## Setup, once per repository

- Track the patterns in the adapter's `binaries.lfs` fact in Git LFS and mark them lockable in `.gitattributes`: `*.uasset filter=lfs diff=lfs merge=lfs -text lockable` (the same for `*.umap`). Git LFS then keeps lockable files read-only in the working copy until you lock them.
- Set `"locks"` under `engine` in `jam.local.json`: `take` locks what an import is about to overwrite, `check` stops and names the `git lfs lock <file>` to run, `off` (the default) is for a repository without LFS locking.

## Around a change

1. Lock before the editor saves: `git lfs lock Content/<path>.uasset`. A file that does not exist yet needs none. Commands lock or check existing targets themselves, by the setting above.
2. Save in the editor, commit the binaries from the editor's checkout, push.
3. Unlock after the push: `git lfs unlock --id=<id>` (ids from `git lfs locks --verify`). Unlock by id: it works after the file is deleted. Then list the locks again and confirm the id is gone; an unlock can succeed on the server and still report a local error.

Done when `git lfs locks --verify` shows none of your locks on files whose change is pushed.

## Deleting an asset

The engine's delete is a force-delete, so look first: `jam engine references <asset id>...` lists what refers to each asset, counting hard, soft, editor-only, searchable-name and management references. The asset registry cannot see a name held as a string in native code or a config file: search the project's source and config for the asset's name as well.

`jam engine references <asset id>... --delete` deletes the listed assets together, only when nothing outside the list refers to any of them. With locking on it first requires each file to be tracked, committed, unchanged and locked by you. Afterwards it confirms the files are gone from disk. The locks stay until the deletion is pushed.

The editor may rewrite files under `Config/` at start-up: read `git diff Config/` before committing and leave generated values out.

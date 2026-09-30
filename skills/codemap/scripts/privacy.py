"""Exclude Git transport configuration, which can contain credentials.

Remote URLs are unnecessary to the viewer. Preserve repository identity and
revision metadata, but never serialize a remote, including legacy metadata.
"""


def repository(repo):
    if isinstance(repo, dict) and "remote" in repo:
        return {**repo, "remote": None}
    return repo


def document(obj, *, strict=False):
    """Copy the metadata branches needing redaction; leave inputs intact."""
    if strict:
        if not isinstance(obj, dict):
            raise ValueError("Codemap metadata must be JSON objects")
        if "repo" in obj and not isinstance(obj["repo"], dict):
            raise ValueError("Codemap repository metadata must be a JSON object")
        if "meta" in obj:
            meta = obj["meta"]
            if not isinstance(meta, dict) or ("repo" in meta and not isinstance(meta["repo"], dict)):
                raise ValueError("Codemap repository metadata must be JSON objects")
    if not isinstance(obj, dict):
        return obj
    result = dict(obj)
    if "repo" in result:
        result["repo"] = repository(result["repo"])
    if isinstance(result.get("meta"), dict) and "repo" in result["meta"]:
        result["meta"] = {**result["meta"], "repo": repository(result["meta"]["repo"])}
    return result

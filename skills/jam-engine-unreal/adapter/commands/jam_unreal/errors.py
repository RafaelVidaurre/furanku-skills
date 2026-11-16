"""One error type for every adapter command: a code, a message naming the field, and the fix when one is known."""


class AdapterError(Exception):
    def __init__(self, code, message, fix=None, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.fix = fix
        self.details = details

    def receipt(self):
        error = {"code": self.code, "message": self.message}
        if self.fix:
            error["fix"] = self.fix
        out = {"error": error}
        if self.details is not None:
            out["details"] = self.details
        return out


class Handoff(AdapterError):
    """No transport can reach the editor from this process: the scripts are prepared for someone else to run."""

    def __init__(self, steps):
        super().__init__(
            "editor-handoff",
            "no engine transport is configured, so the editor scripts were written for you to run",
            fix="run each script, in order, in the editor's Python tool; when the editor is on another machine, save the "
                "JSON each call returns to that step's result file; then run this same command again",
        )
        self.steps = steps

    def receipt(self):
        out = super().receipt()
        out["handoff"] = {"steps": self.steps}
        return out

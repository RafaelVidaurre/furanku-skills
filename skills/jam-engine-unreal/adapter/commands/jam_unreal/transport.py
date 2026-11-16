"""How an editor script reaches the Unreal editor. The route is `engine.transport` in jam.local.json, never code.

    {"kind": "commandlet", "editor": "<UnrealEditor-Cmd>", "args": [...]}   headless, starts its own editor process
    {"kind": "command", "run": ["<program>", "...", "{script}"], "await": true}   the project's own bridge to a running editor
    absent, or {"kind": "handoff"}                                           scripts are prepared for an agent to run

Every editor script defines `main(ARGS)` (or `async def main(ARGS)` when it must wait across editor frames or call
editor tools) and returns a JSON-serialisable result. `compose` wraps it so the result is both written to a result
file inside the editor's project and left as the script's last expression, which a Python tool returns to its caller.
"""
import hashlib
import json
import os
import re
import subprocess

from .errors import AdapterError, Handoff

PACKAGE = os.path.dirname(os.path.abspath(__file__))
INCLUDE = re.compile(r"^# jam: include (.+)$", re.M)
ASYNC_MAIN = re.compile(r"^async def main\(", re.M)
COMMANDLET_ARGS = ["-unattended", "-nosplash", "-nullrhi", "-stdout"]

EPILOGUE = '''
try:
    if ARGS.get("_expectProject"):
        import os as _jam_os0
        import unreal as _jam_unreal0
        _jam_got = _jam_os0.path.normcase(_jam_os0.path.realpath(_jam_unreal0.Paths.convert_relative_path_to_full(_jam_unreal0.Paths.project_dir())))
        _jam_want = _jam_os0.path.normcase(_jam_os0.path.realpath(ARGS["_expectProject"]))
        if _jam_got != _jam_want:
            raise RuntimeError("Editor checkout mismatch: expected " + _jam_want + ", got " + _jam_got)
    JAM_RESULT = %(call)s
except Exception as _jam_error:
    import traceback as _jam_traceback
    JAM_RESULT = {"error": repr(_jam_error), "traceback": _jam_traceback.format_exc()[-3000:]}
_jam_text = json.dumps(JAM_RESULT)
if ARGS.get("_resultFile"):
    import os as _jam_os
    import unreal as _jam_unreal
    _jam_path = _jam_os.path.join(_jam_unreal.Paths.convert_relative_path_to_full(_jam_unreal.Paths.project_dir()), *ARGS["_resultFile"].split("/"))
    _jam_os.makedirs(_jam_os.path.dirname(_jam_path), exist_ok=True)
    with open(_jam_path, "w", encoding="utf-8") as _jam_file:
        _jam_file.write(_jam_text)
_jam_text
'''


def needs_await(script_text):
    return bool(ASYNC_MAIN.search(script_text))


def includes(script_text):
    names = []
    for line in INCLUDE.findall(script_text):
        names += line.split()
    return names


def compose(script_text, args, package_dir=PACKAGE):
    """The text sent to the editor: ARGS, the included engine-free modules, the script, then the call of main."""
    parts = ["import json", "ARGS = json.loads(%r)" % json.dumps(args)]
    for name in includes(script_text):
        with open(os.path.join(package_dir, name + ".py"), encoding="utf-8") as f:
            parts.append("# ---- included: %s\n%s" % (name, f.read()))
    parts.append(script_text)
    parts.append(EPILOGUE % {"call": "await main(ARGS)" if needs_await(script_text) else "main(ARGS)"})
    return "\n".join(parts)


def parse_returned(text):
    """The JSON a bridge printed: the result itself, or a JSON string holding it (a tool's returned text)."""
    candidates = [text.strip()] + [line for line in reversed(text.strip().splitlines()) if line.strip()][:1]
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                continue
        if isinstance(value, dict):
            return value
    raise AdapterError("no-result", "the editor bridge returned no JSON result: %s" % text.strip()[-400:],
                       fix="make the bridge print the value the editor's Python tool returned, or let the script write its result file")


def _run(argv, cwd, timeout):
    try:
        done = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise AdapterError("transport-failed", "program not found: %s" % argv[0], fix="correct engine.transport in jam.local.json")
    except subprocess.TimeoutExpired:
        raise AdapterError("transport-timeout", "the editor did not answer within %s seconds" % timeout,
                           fix="check the editor is running and reachable, or raise engine.transport.timeoutSeconds")
    return done.returncode, done.stdout, done.stderr


class Step:
    def __init__(self, name, script_file, args):
        self.name = name
        self.script_file = script_file
        self.args = args


def prepare(cfg, verb, step):
    with open(step.script_file, encoding="utf-8") as f:
        text = f.read()
    key = hashlib.sha256((text + json.dumps(step.args, sort_keys=True)).encode("utf-8")).hexdigest()[:12]
    base = "%s/%s-%s-%s" % (cfg.work_dir, verb, step.name, key)
    args = dict(step.args, _resultFile=base + ".result.json")
    if cfg.local.get("editorProject"):   # the project folder as the editor's machine names it; guards against another checkout's editor
        args["_expectProject"] = cfg.local["editorProject"]
    return {"name": step.name, "script": base + ".py", "result": base + ".result.json", "await": needs_await(text), "text": compose(text, args)}


def _local(cfg, relative):
    return os.path.join(cfg.project, *relative.split("/"))


def _read_result(path):
    with open(path, encoding="utf-8") as f:
        return parse_returned(f.read())


def _checked(step, result):
    if "error" in result:
        raise AdapterError("editor-error", "%s failed in the editor: %s" % (step["name"], result["error"]), details={"traceback": result.get("traceback")})
    return result


def _execute(cfg, step, transport, runner):
    kind = transport.get("kind")
    timeout = transport.get("timeoutSeconds", 1800)
    script, result = _local(cfg, step["script"]), _local(cfg, step["result"])
    if os.path.exists(result):
        os.remove(result)
    if kind == "commandlet":
        if step["await"]:
            raise AdapterError("transport-cannot-wait", "%s must run inside a live editor: a commandlet ticks no frames and has no editor tools" % step["name"],
                               fix="configure engine.transport of kind command (with \"await\": true) or run it by handoff")
        if not transport.get("editor"):
            raise AdapterError("invalid", "engine.transport.editor is missing", fix="set it to this machine's UnrealEditor-Cmd executable in jam.local.json")
        argv = [transport["editor"], cfg.uproject(), "-run=pythonscript", "-script=" + script] + list(transport.get("args", COMMANDLET_ARGS))
    elif kind == "command":
        if step["await"] and not transport.get("await"):
            raise AdapterError("transport-cannot-wait", "%s uses top-level await, which engine.transport does not declare" % step["name"],
                               fix="set \"await\": true on engine.transport when the bridge's Python tool supports top-level await")
        run = transport.get("run")
        if not isinstance(run, list) or not run:
            raise AdapterError("invalid", "engine.transport.run must be a non-empty argv array")
        values = {"{script}": script, "{result}": result, "{project}": cfg.project}
        argv = [values.get(a, a) for a in run]
        if "{script}" not in run:
            argv.append(script)
    else:
        raise AdapterError("invalid", "unknown engine.transport.kind %r" % kind, fix="use commandlet, command or handoff")
    code, out, err = runner(argv, cfg.project, timeout)
    if os.path.exists(result):
        value = _read_result(result)
        os.remove(result)
        return value
    if code != 0:
        raise AdapterError("transport-failed", "%s exited %d: %s" % (os.path.basename(argv[0]), code, (err or out).strip()[-600:]))
    if kind == "commandlet":
        raise AdapterError("no-result", "the commandlet wrote no result for %s: %s" % (step["name"], out.strip()[-600:]),
                           fix="confirm the Python Editor Script Plugin is enabled for the project")
    return parse_returned(out)


def run_steps(cfg, verb, steps, runner=_run):
    """Run editor scripts in order and return their results, or raise Handoff with the scripts to run by hand."""
    prepared = [prepare(cfg, verb, s) for s in steps]
    transport = cfg.transport
    for step in prepared:
        path = _local(cfg, step["script"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(step["text"])
    if transport.get("kind", "handoff") == "handoff":
        waiting = [s for s in prepared if not os.path.exists(_local(cfg, s["result"]))]
        if waiting:
            raise Handoff([{"name": s["name"], "script": s["script"], "result": s["result"], "await": s["await"],
                            "done": s not in waiting} for s in prepared])
        results = [_checked(s, _read_result(_local(cfg, s["result"]))) for s in prepared]
        for s in prepared:   # consumed: the next identical call starts a fresh handoff
            os.remove(_local(cfg, s["result"]))
        return results
    return [_checked(s, _execute(cfg, s, transport, runner)) for s in prepared]

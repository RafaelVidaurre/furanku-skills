"""Check whether this machine can generate with NVIDIA MotionBricks, against the requirements in this skill's
references/setup.md ("What the host needs"), which is where each one is stated and sourced. Pure Python standard library
(3.8 or newer), no Blender, no MotionBricks needed: run it on the machine that would generate, with any Python 3 there.

    <python> host_check.py [--motionbricks <clone dir>] [--precision fp32|fp16] [--tf32 auto|on|off] [--device cuda:0]
                           [--disk-path <dir>] [--import-check] [--out <host-check.json>]

Prints one JSON object: `host` (what was found), `requirements` (one entry per requirement with `status` pass, fail,
warn or unknown, what was `found`, and the `source` of the requirement), `qualifies` (the OS, GPU and driver
requirements pass, the GPU one on any GPU of this machine, so MotionBricks can be installed here), `ready` (no
requirement failed or unknown, `device` included, so it can generate now), and `missing` (what to fix, in words).
Exit status 0 when ready, 1 when not, 2 on bad arguments.

--motionbricks   an existing clone, to check the install, the model files and the TensorRT plans.
--precision      which plan to look for (default fp32); --tf32 as generate.py will be given it (default auto).
--device         the CUDA device generate.py will use (default cuda:0). The `device` requirement judges its GPU, once
                 it is known which GPU that is; every GPU is reported.
--import-check   also start MotionBricks' own interpreter and ask TensorRT and Warp whether that device works, and which
                 GPU it is. Takes tens of seconds; the definitive check that the install runs on this GPU.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys

MIN_COMPUTE = (7, 5)
MIN_DRIVER = 525
MIN_CUDA = (12, 0)
MIN_PYTHON = (3, 12)
MIN_GLIBC = (2, 28)
# The release's Git LFS files total 2.48 GB at v0.2.0 (the sizes their LFS pointers state); a clone keeps each twice,
# once in the working tree and once under .git/lfs. The environment `uv sync` installs and the plans come on top.
LFS_BYTES = 2.48e9
CLONE_BYTES = 2 * LFS_BYTES
# What generate.py builds with: TensorRTBuildOptions(enable_fp16=precision == "fp16", enable_tf32=tf32), every other
# option at its default (motionbricks/inference/builder.py at v0.2.0). cache_payload() omits enable_fp16 when false and
# enable_tf32 unless false; MotionBricks keys its plan cache on that payload.
BUILD_DEFAULTS = {"workspace_size_bytes": None, "builder_optimization_level": 3, "batch_size": 1}
LFS_POINTER = b"version https://git-lfs"
HARDWARE = ("os", "glibc", "nvidia-gpu", "compute-capability", "driver", "driver-cuda")  # not `device`: it judges --device
ONNX = {"fp32": "mmm_v6_soma_fp32.onnx", "fp16": "mmm_v6_soma_fp16.onnx"}

SRC = {
    "os": "MotionBricks README (Setup): tested on Windows and Linux x86-64; TensorRT 10.8 (pinned) ships wheels for "
          "Windows x86-64 and Linux only; Warp's macOS wheels run on the CPU only",
    "gpu": "MotionBricks README (Setup): the runtime uses TensorRT, which requires an NVIDIA GPU",
    "compute": "TensorRT 10.x support matrix: compute capability 7.5 or higher (TensorRT 10.8 is pinned)",
    "driver": "Warp 1.17 installation guide (Warp 1.17.0 is pinned): packages built with CUDA 12 need driver 525 or newer",
    "cuda": "tensorrt-cu12 and Warp's CUDA 12 build need a driver that supports CUDA 12",
    "glibc": "TensorRT 10.8.0 release notes: glibc 2.28 or newer on Linux x86-64",
    "tools": "MotionBricks README (Setup): install Git LFS and uv, clone, `git lfs pull`, `uv sync`",
    "python": "MotionBricks pyproject.toml: requires-python >= 3.12 (uv installs it when missing)",
    "disk": "MotionBricks v0.2.0's Git LFS pointers: 2.48 GB of LFS files, which a clone stores twice (working tree "
            "and .git/lfs); the environment and plans come on top",
    "install": "MotionBricks README (Setup): the ONNX models arrive through Git LFS",
    "plan": "MotionBricks README (Setup): the first launch of each model and precision builds a TensorRT plan (a few "
            "minutes) and caches it in .trt-cache/; motionbricks/inference/cache.py keys each plan on the ONNX file's "
            "SHA-256, the TensorRT version, the build options, the GPU and the OS and CPU architecture",
    "import": "MotionBricks runtime API (Engines): engines need a CUDA device",
}


def run(cmd, timeout=30):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout if out.returncode == 0 else None


def parse_version(text, parts=2):
    m = re.search(r"(\d+)" + r"\.(\d+)" * (parts - 1), text or "")
    return tuple(int(g) for g in m.groups()) if m else None


GPU_QUERY = "index,name,compute_cap,driver_version,memory.total,memory.free,pci.bus_id"


def parse_gpus(csv_text):
    """Rows of `nvidia-smi --query-gpu=<GPU_QUERY> --format=csv,noheader,nounits`."""
    gpus = []
    for line in (csv_text or "").splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 7 or not cells[1]:
            continue
        mem = [int(c) if c.isdigit() else None for c in cells[4:6]]
        cc = parse_version(cells[2])
        gpus.append({"index": int(cells[0]) if cells[0].isdigit() else None, "name": cells[1],
                     "computeCapability": cc and ".".join(map(str, cc)), "driver": cells[3],
                     "memoryTotalMiB": mem[0], "memoryFreeMiB": mem[1], "pciBusId": cells[6] or None})
    return gpus


def device_ordinal(device):
    """The ordinal of a Warp CUDA alias ("cuda" and "cuda:0" are 0), or None when it names no CUDA device."""
    m = re.fullmatch(r"cuda(?::(\d+))?", device or "")
    return int(m.group(1) or 0) if m else None


def _bus(text):
    """A PCI bus id reduced to (bus, device), so nvidia-smi's 00000000:01:00.0 meets Warp's 00000000:01:00."""
    m = re.search(r"([0-9a-fA-F]+):([0-9a-fA-F]+)(?:\.[0-9a-fA-F]+)?$", text or "")
    return (int(m.group(1), 16), int(m.group(2), 16)) if m else None


def select_gpu(facts):
    """The GPU that --device names and how that was told: (gpu, how), with gpu None when it is not known, or False when
    --device names no GPU of this machine. CUDA numbers devices fastest first unless
    CUDA_DEVICE_ORDER=PCI_BUS_ID, while nvidia-smi numbers them in bus order, so an ordinal alone identifies a GPU only
    when there is one GPU or that order is set; the import check asks Warp itself."""
    gpus = facts.get("gpus") or []
    ordinal = device_ordinal(facts.get("device"))
    if ordinal is None:
        return False, "not a CUDA device (cuda or cuda:<n>)"
    if ordinal >= len(gpus):
        return False, f"this machine has {len(gpus)} GPU(s), numbered from cuda:0"
    seen = ((facts.get("motionbricks") or {}).get("imports") or {})
    if seen.get("device"):
        bus = _bus(seen.get("pciBusId"))
        match = [g for g in gpus if bus and _bus(g.get("pciBusId")) == bus] or [g for g in gpus if g["name"] == seen["device"]]
        if len(match) == 1:
            return match[0], "as Warp reported it"
    if len(gpus) == 1:
        return gpus[0], "the only GPU"
    if facts.get("cudaDeviceOrder") == "PCI_BUS_ID":
        match = [g for g in gpus if g.get("index") == ordinal]
        if match:
            return match[0], "CUDA_DEVICE_ORDER=PCI_BUS_ID"
    return None, ("several GPUs, and CUDA numbers them fastest first while nvidia-smi numbers them by bus: once "
                  "MotionBricks is installed, run with --import-check to tell which one it is")


def parse_cuda_version(smi_text):
    """The CUDA version the driver supports, from the header of plain `nvidia-smi` ("CUDA Version: 12.4" in older
    drivers, "CUDA UMD Version: 13.5" in newer ones)."""
    m = re.search(r"CUDA (?:UMD )?Version\s*:\s*(\d+)\.(\d+)", smi_text or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def plan_entries(cache_dir):
    """Metadata of every cached TensorRT plan (the JSON MotionBricks writes beside each .plan)."""
    entries = []
    try:
        names = sorted(os.listdir(cache_dir))
    except OSError:
        return entries
    for name in names:
        if not name.endswith(".json"):
            continue
        plan = os.path.join(cache_dir, name[:-5] + ".plan")
        try:
            with open(os.path.join(cache_dir, name), encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(meta, dict) and os.path.isfile(plan) and os.path.getsize(plan) > 0:
            entries.append(meta)
    return entries


def expected_build_options(precision, tf32):
    options = dict(BUILD_DEFAULTS)
    if precision == "fp16":
        options["enable_fp16"] = True
    if tf32 is False:
        options["enable_tf32"] = False
    return options


def plan_mismatches(meta, expect):
    """What keeps a cached plan's metadata from fitting a generation here: the fields MotionBricks keys its plan cache
    on, compared with what this host would use. Returns (mismatches, unchecked); a plan fits when the first is empty.
    expect: onnxFile, onnxSha256, tensorrt (None when unknown), buildOptions, system, machine, gpus (GPUs it may run
    on: the selected one, or every GPU when that is not known). A plan built for only some of several possible GPUs
    is not called fitting: its GPU goes to `unchecked`."""
    wrong, unchecked = [], []
    if meta.get("onnx_filename") != expect["onnxFile"]:
        wrong.append(f"model file {meta.get('onnx_filename')}")
    for field, key, label in (("onnxSha256", "onnx_sha256", "model file hash"), ("tensorrt", "tensorrt_version", "TensorRT version")):
        if expect.get(field) is None:
            unchecked.append(label)
        elif meta.get(key) != expect[field]:
            wrong.append(f"{label} {meta.get(key)}")
    if meta.get("build_options") != expect["buildOptions"]:
        wrong.append(f"build options {json.dumps(meta.get('build_options'), sort_keys=True)}")
    plat = meta.get("platform") or {}
    if plat.get("system") != expect["system"] or plat.get("machine") != expect["machine"]:
        wrong.append(f"platform {plat.get('system')} {plat.get('machine')}")
    device = meta.get("device") or {}

    def built_for(gpu):
        cc = parse_version(gpu.get("computeCapability"))
        arch = cc[0] * 10 + cc[1] if cc else None
        return device.get("name") == gpu["name"] and (arch is None or device.get("architecture") == arch)
    fits = [built_for(g) for g in expect["gpus"]]
    if not any(fits):
        wrong.append(f"GPU {device.get('name')} sm_{device.get('architecture')}")
    elif not all(fits):
        unchecked.append(f"GPU (the plan is for {device.get('name')}, and which GPU the device is, is not known)")
    return wrong, unchecked


def is_lfs_pointer(path):
    try:
        with open(path, "rb") as f:
            return f.read(len(LFS_POINTER)) == LFS_POINTER
    except OSError:
        return True


def venv_package_version(clone, package):
    """Version of an installed distribution in the clone's environment, from its dist-info folder."""
    prefix = package.replace("-", "_").lower() + "-"
    roots = [os.path.join(clone, ".venv", "Lib", "site-packages")]
    lib = os.path.join(clone, ".venv", "lib")
    try:
        roots += [os.path.join(lib, d, "site-packages") for d in sorted(os.listdir(lib))]
    except OSError:
        pass
    for root in roots:
        try:
            names = sorted(os.listdir(root))
        except OSError:
            continue
        for name in names:
            if name.lower().startswith(prefix) and name.endswith(".dist-info"):
                return name[len(prefix):-len(".dist-info")]
    return None


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 23), b""):
            h.update(chunk)
    return h.hexdigest()


def venv_python(clone):
    for rel in (("Scripts", "python.exe"), ("bin", "python")):
        path = os.path.join(clone, ".venv", *rel)
        if os.path.isfile(path):
            return path
    return None


def gather(args):
    """Every fact the requirements are judged on. Kept apart from evaluate() so the judgement is testable."""
    system = platform.system()
    facts = {"os": system, "osRelease": platform.release(), "machine": platform.machine(),
             "python": platform.python_version(), "glibc": None}
    if system == "Linux":
        lib, ver = platform.libc_ver()
        facts["glibc"] = ver if lib == "glibc" else None
    smi = shutil.which("nvidia-smi")
    facts["nvidiaSmi"] = bool(smi)
    facts["gpus"] = parse_gpus(run([smi, "--query-gpu=" + GPU_QUERY, "--format=csv,noheader,nounits"])) if smi else []
    cuda = parse_cuda_version(run([smi])) if smi else None
    facts["driverCuda"] = ".".join(map(str, cuda)) if cuda else None
    facts["device"] = args.device
    facts["cudaDeviceOrder"] = os.environ.get("CUDA_DEVICE_ORDER")
    facts["uv"] = (run(["uv", "--version"]) or "").strip() or None
    facts["gitLfs"] = (run(["git", "lfs", "version"]) or "").strip() or None
    disk_path = args.disk_path or args.motionbricks or os.getcwd()
    try:
        facts["diskFreeBytes"] = shutil.disk_usage(disk_path).free
    except OSError:
        facts["diskFreeBytes"] = None
    facts["diskPath"] = os.path.abspath(disk_path)
    facts["precision"] = args.precision
    facts["tf32"] = {"auto": None, "on": True, "off": False}[args.tf32]
    mb = None
    if args.motionbricks:
        clone = os.path.abspath(args.motionbricks)
        mb = {"path": clone, "exists": os.path.isdir(os.path.join(clone, "motionbricks"))}
        version_file = os.path.join(clone, "motionbricks", "_version.py")
        try:
            with open(version_file, encoding="utf-8") as f:
                m = re.search(r"__version__\s*=\s*['\"]([^'\"]+)", f.read())
            mb["version"] = m.group(1) if m else None
        except OSError:
            mb["version"] = None
        onnx = os.path.join(clone, "motionbricks", "assets", "onnx", "soma", ONNX[args.precision])
        real = os.path.isfile(onnx) and not is_lfs_pointer(onnx)
        mb["onnx"] = {"file": ONNX[args.precision], "present": os.path.isfile(onnx),
                      "lfsPointer": os.path.isfile(onnx) and is_lfs_pointer(onnx),
                      "bytes": os.path.getsize(onnx) if os.path.isfile(onnx) else None,
                      "sha256": sha256_file(onnx) if real else None}
        py = venv_python(clone)
        mb["venvPython"] = py
        mb["venvPythonVersion"] = (run([py, "-c", "import platform; print(platform.python_version())"]) or "").strip() or None if py else None
        mb["tensorrt"] = venv_package_version(clone, "tensorrt_cu12_bindings") or venv_package_version(clone, "tensorrt")
        if args.import_check and py:
            code = ("import json, sys, tensorrt, warp as wp; wp.init(); a = sys.argv[1]; "
                    "d = wp.get_device(a) if wp.get_cuda_device_count() else None; d = d if d is not None and d.is_cuda else None; "
                    "import motionbricks._version as v; "
                    "print(json.dumps({'tensorrt': tensorrt.__version__, 'warp': wp.config.version, 'cuda': bool(d), "
                    "'device': d.name if d else None, 'arch': d.arch if d else None, "
                    "'pciBusId': getattr(d, 'pci_bus_id', None) if d else None, 'motionbricks': v.__version__}))")
            out = run([py, "-c", code, args.device], timeout=600)
            try:
                mb["imports"] = json.loads(out.strip().splitlines()[-1]) if out else {"error": f"the interpreter failed to import tensorrt, warp or motionbricks, or has no device {args.device}"}
            except ValueError:
                mb["imports"] = {"error": "unreadable output"}
        if (mb.get("imports") or {}).get("tensorrt"):
            mb["tensorrt"] = mb["imports"]["tensorrt"]
        mb["planCache"] = os.path.join(clone, ".trt-cache")
        mb["planEntries"] = plan_entries(mb["planCache"])
    facts["motionbricks"] = mb
    return facts


def _req(rid, requirement, status, found, source_key):
    return {"id": rid, "requirement": requirement, "status": status, "found": found, "source": SRC[source_key]}


def evaluate(facts):
    """Judge each documented requirement on the facts. Returns the requirement list."""
    reqs = []
    system, machine = facts["os"], (facts.get("machine") or "").lower()
    if system in ("Windows", "Linux"):
        arch_ok = machine in ("x86_64", "amd64")
        reqs.append(_req("os", "Windows or Linux on x86-64", "pass" if arch_ok else "warn",
                         f"{system} {facts.get('machine')}" + ("" if arch_ok else ": not the tested architecture"), "os"))
    else:
        reqs.append(_req("os", "Windows or Linux on x86-64", "fail", f"{system} {facts.get('machine')}", "os"))
    if system == "Linux":
        g = parse_version(facts.get("glibc"))
        reqs.append(_req("glibc", "glibc 2.28 or newer", "unknown" if g is None else ("pass" if g >= MIN_GLIBC else "fail"),
                         facts.get("glibc"), "glibc"))
    gpus = facts.get("gpus") or []
    gpu, how = None, None
    if not facts.get("nvidiaSmi"):
        reqs.append(_req("nvidia-gpu", "an NVIDIA GPU with its driver", "fail", "nvidia-smi not found", "gpu"))
    elif not gpus:
        reqs.append(_req("nvidia-gpu", "an NVIDIA GPU with its driver", "fail", "nvidia-smi lists no GPU", "gpu"))
    else:
        reqs.append(_req("nvidia-gpu", "an NVIDIA GPU with its driver", "pass", ", ".join(g["name"] for g in gpus), "gpu"))
        gpu, how = select_gpu(facts)
        device = facts.get("device")

        def judge(value):
            cc = parse_version(value.get("computeCapability"))
            return "unknown" if cc is None else ("pass" if cc >= MIN_COMPUTE else "fail")

        def listed(judged):
            return "; ".join(f"{g['name']}: {g.get('computeCapability') or 'not reported'}" for g in judged)
        verdicts = {judge(g) for g in gpus}
        status = "pass" if "pass" in verdicts else "unknown" if "unknown" in verdicts else "fail"
        reqs.append(_req("compute-capability", "a GPU of compute capability 7.5 or higher", status, listed(gpus), "compute"))
        # The machine qualifies on any GPU that meets the requirement; generation runs on the one --device names.
        if gpu is False:
            status, found = "fail", f"{device}: {how}"
        elif gpu:
            status, found = judge(gpu), f"{device} is {listed([gpu])} ({how})"
        elif len(verdicts) == 1:
            status, found = verdicts.pop(), f"{device}: {how}; every GPU judged alike: {listed(gpus)}"
        else:
            status, found = "unknown", (f"{device}: {how}, or set CUDA_DEVICE_ORDER=PCI_BUS_ID so that cuda:N is "
                                        f"nvidia-smi's GPU N (for this check and for generate.py alike); GPUs: {listed(gpus)}")
        reqs.append(_req("device", f"compute capability 7.5 or higher on the GPU {device} names", status, found, "compute"))
        driver = gpus[0].get("driver")  # one driver serves every GPU
        drv = parse_version(driver, 1)
        reqs.append(_req("driver", f"NVIDIA driver {MIN_DRIVER} or newer",
                         "unknown" if drv is None else ("pass" if drv[0] >= MIN_DRIVER else "fail"), driver, "driver"))
        cuda = parse_version(facts.get("driverCuda"))
        reqs.append(_req("driver-cuda", "a driver that supports CUDA 12",
                         "unknown" if cuda is None else ("pass" if cuda >= MIN_CUDA else "fail"), facts.get("driverCuda"), "cuda"))
    mb = facts.get("motionbricks")
    installed = bool(mb and mb.get("exists") and mb.get("onnx", {}).get("present") and not mb["onnx"].get("lfsPointer"))
    if not installed:
        tools = [n for n, k in (("uv", "uv"), ("Git LFS", "gitLfs")) if not facts.get(k)]
        reqs.append(_req("install-tools", "Git LFS and uv installed", "fail" if tools else "pass",
                         "missing: " + ", ".join(tools) if tools else f"{facts.get('uv')}; {facts.get('gitLfs')}", "tools"))
        free = facts.get("diskFreeBytes")
        reqs.append(_req("disk", f"about {CLONE_BYTES / 1e9:.0f} GB free for the clone, plus its environment and plans",
                         "warn" if free is None or free < CLONE_BYTES else "pass",
                         "free space unknown" if free is None else f"{free / 1e9:.1f} GB free at {facts.get('diskPath')}", "disk"))
    if mb is None:
        reqs.append(_req("motionbricks", "MotionBricks cloned with its LFS files and synced", "unknown",
                         "not checked: pass --motionbricks <clone dir>", "install"))
        return reqs
    if not mb.get("exists"):
        reqs.append(_req("motionbricks", "MotionBricks cloned with its LFS files and synced", "fail", f"no clone at {mb['path']}", "install"))
        return reqs
    onnx = mb["onnx"]
    status = "pass" if installed and mb.get("venvPython") else "fail"
    found = f"version {mb.get('version')}; {onnx['file']} " + (
        "missing" if not onnx["present"] else "is a Git LFS pointer: run `git lfs pull`" if onnx["lfsPointer"] else f"{onnx['bytes'] / 1e6:.0f} MB")
    found += "; environment " + ("present" if mb.get("venvPython") else "missing: run `uv sync`")
    reqs.append(_req("motionbricks", "MotionBricks cloned with its LFS files and synced", status, found, "install"))
    pyv = parse_version(mb.get("venvPythonVersion"))
    if mb.get("venvPython"):
        reqs.append(_req("python", "Python 3.12 or newer in MotionBricks' environment",
                         "unknown" if pyv is None else ("pass" if pyv >= MIN_PYTHON else "fail"), mb.get("venvPythonVersion"), "python"))
    plans = judge_plans(facts, gpu)
    mb["plans"] = plans
    fitting = [p for p in plans if not p["mismatches"]]
    unchecked = sorted({u for p in fitting for u in p["unchecked"]})
    reqs.append(_req("plan", f"a TensorRT plan for {facts['precision']} built on this host for {facts.get('device')}",
                     "pass" if fitting and not unchecked else "warn",
                     (f"{len(fitting)} fitting plan(s) of {len(plans)} cached" + (f"; not compared: {', '.join(unchecked)}" if unchecked else ""))
                     if fitting else "none yet: `generate.py plan` (or the first generation) builds it, which takes minutes", "plan"))
    if "imports" in mb:
        imp = mb["imports"]
        ok = imp.get("cuda") is True
        reqs.append(_req("cuda-runtime", "TensorRT and Warp start on a CUDA device", "pass" if ok else "fail",
                         imp.get("error") or f"TensorRT {imp.get('tensorrt')}, Warp {imp.get('warp')}, device {imp.get('device')}", "import"))
    return reqs


def judge_plans(facts, gpu):
    """Every cached plan with what keeps it from fitting a generation here (an empty list: it fits)."""
    mb = facts["motionbricks"]
    expect = {"onnxFile": ONNX[facts["precision"]], "onnxSha256": mb["onnx"].get("sha256"), "tensorrt": mb.get("tensorrt"),
              "buildOptions": expected_build_options(facts["precision"], facts.get("tf32")),
              "system": facts["os"], "machine": facts.get("machine"),
              "gpus": [gpu] if gpu else [] if gpu is False else facts.get("gpus") or []}
    out = []
    for e in mb.get("planEntries", []):
        wrong, unchecked = plan_mismatches(e, expect)
        out.append({"file": e.get("plan_file"), "onnx": e.get("onnx_filename"), "gpu": (e.get("device") or {}).get("name"),
                    "tensorrt": e.get("tensorrt_version"), "buildOptions": e.get("build_options"),
                    "mismatches": wrong, "unchecked": unchecked})
    return out


def summarize(facts, reqs):
    blocking = [r for r in reqs if r["status"] in ("fail", "unknown")]
    return {"host": facts, "requirements": reqs,
            "qualifies": not [r for r in blocking if r["id"] in HARDWARE],
            "ready": not blocking,
            "missing": [f"{r['requirement']}: {r['found']}" for r in blocking],
            "notes": ["The requirements and their sources: references/setup.md of the jam-3d-motionbricks skill.",
                      "VRAM, CPU-only speed and a minimum GPU model are not documented by MotionBricks; they are reported, not judged.",
                      "A warn is not blocking: say it to the person."]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--motionbricks")
    parser.add_argument("--precision", choices=sorted(ONNX), default="fp32")
    parser.add_argument("--tf32", choices=("auto", "on", "off"), default="auto")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--disk-path")
    parser.add_argument("--import-check", action="store_true")
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    facts = gather(args)
    report = summarize(facts, evaluate(facts))
    text = json.dumps(report, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    print(text)
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())

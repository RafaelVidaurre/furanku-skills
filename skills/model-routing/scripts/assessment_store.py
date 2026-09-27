#!/usr/bin/env python3
"""Private, resumable completion ledger for agent assessment jobs.

Claim before invoking an assessor. Complete only after structural validation.
Completed unchanged work is reused even when the procedure changes, unless an
explicit reassessment is requested. Task samples never complete their session.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_result(job, result):
    expected = {c["id"]: c for c in job["packet"]["cases"]}
    cases = result.get("cases", [])
    if result.get("version") != 1 or len(cases) != len(expected) or {c.get("id") for c in cases} != set(expected):
        raise ValueError("Result must cover every case exactly once")
    taxonomy = job["packet"].get("domain_taxonomy", {}).get("domains", [])
    for case in cases:
        state = expected[case["id"]]["state"]
        reqs = {r["id"] for r in state["requirements"]}
        sources = {s["id"] for s in state["sources"]}
        answers = case.get("requirements", [])
        if len(answers) != len(reqs) or {r.get("id") for r in answers} != reqs:
            raise ValueError("Result must cover every requirement exactly once")
        for answer in answers:
            verdict = answer.get("verdict")
            cited = answer.get("source_ids")
            if (verdict not in {"met", "unmet", "unknown"} or not isinstance(cited, list)
                or not all(isinstance(s, str) for s in cited) or len(set(cited)) != len(cited)
                or not set(cited) <= sources or (verdict != "unknown" and not cited)
                or not isinstance(answer.get("rationale"), str) or not answer["rationale"].strip()):
                raise ValueError("Every verdict needs a rationale and valid supporting sources")
        if taxonomy:
            ids = {d["id"] for d in taxonomy}
            domains = case.get("domains", [])
            if (len(domains) != len(ids) or {d.get("id") for d in domains} != ids
                or any(d.get("role") not in {"central", "supporting", "absent", "unknown"}
                       or not isinstance(d.get("rationale"), str) or not d["rationale"].strip() for d in domains)):
                raise ValueError("Result must classify every supplied domain exactly once")


class Store:
    def __init__(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.is_symlink():
            raise ValueError("Assessment database must not be a symlink")
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        path.chmod(0o600)
        self.db = sqlite3.connect(path, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("""CREATE TABLE IF NOT EXISTS assessments (
            claim TEXT PRIMARY KEY, identity TEXT NOT NULL, revision TEXT NOT NULL,
            procedure TEXT NOT NULL, status TEXT NOT NULL, job TEXT NOT NULL,
            result TEXT, error TEXT, parent_claim TEXT,
            semantic_status TEXT NOT NULL DEFAULT 'unreviewed', created TEXT DEFAULT CURRENT_TIMESTAMP,
            updated TEXT DEFAULT CURRENT_TIMESTAMP)""")
        self.db.execute("CREATE INDEX IF NOT EXISTS assessment_lookup ON assessments(identity,revision,status)")
        self.db.commit()

    def close(self):
        self.db.close()

    def claim(self, job, reassess=False):
        for field in ("session_ref", "source_sha256", "procedure", "scope", "scope_id"):
            if not isinstance(job.get(field), str):
                raise ValueError("Job needs session/source/procedure/scope identity")
        if (not job["session_ref"] or not job["procedure"] or job["scope"] not in {"session", "task", "control"}
            or (job["scope"] == "session" and job["scope_id"])
            or (job["scope"] != "session" and not job["scope_id"])
            or len(job["source_sha256"]) != 64 or any(c not in "0123456789abcdef" for c in job["source_sha256"])):
            raise ValueError("Invalid job identity; whole sessions and partial scopes must be distinct")
        cases = job.get("packet", {}).get("cases")
        if not cases or len({c["id"] for c in cases}) != len(cases):
            raise ValueError("Job requires nonempty uniquely identified input cases")
        for case in cases:
            state = case.get("state", {})
            for field in ("requirements", "sources"):
                items = state.get(field)
                if (not isinstance(items, list) or not items
                    or any(not isinstance(item, dict) or not isinstance(item.get("id"), str)
                           or not item["id"].strip() for item in items)
                    or len({item["id"] for item in items}) != len(items)):
                    raise ValueError("Each case needs uniquely identified requirements and sources")
        identity = digest([job["session_ref"], job["scope"], job["scope_id"]])
        # Source bytes define new work. Rubric, extraction, or attribution fixes
        # require explicit reassessment of an already completed source revision.
        revision = job["source_sha256"]
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            rows = self.db.execute("SELECT * FROM assessments WHERE identity=? AND revision=? ORDER BY rowid DESC",
                                   (identity, revision)).fetchall()
            running = next((r for r in rows if r["status"] == "running"), None)
            if running:
                return {"action": "in_progress", "claim": running["claim"]}
            complete = next((r for r in rows if r["status"] == "complete"), None)
            retry_failed = bool(rows and rows[0]["status"] == "failed")
            if complete and not reassess and not retry_failed:
                previous = json.loads(complete["job"])
                return {"action": "skip_completed", "claim": complete["claim"],
                        "procedure_changed": complete["procedure"] != job["procedure"],
                        "preparation_changed": previous["packet"] != job["packet"] or previous.get("attribution") != job.get("attribution"),
                        "semantic_status": complete["semantic_status"],
                        "result": json.loads(complete["result"])}
            if retry_failed and not reassess and json.loads(rows[0]["job"]) != job:
                raise ValueError("Retry the failed job unchanged, or explicitly request reassessment")
            token = uuid.uuid4().hex
            self.db.execute("INSERT INTO assessments(claim,identity,revision,procedure,status,job,parent_claim) VALUES(?,?,?,?,?,?,?)",
                            (token, identity, revision, job["procedure"], "running", json.dumps(job), rows[0]["claim"] if rows else None))
            return {"action": "assess", "claim": token}

    def finish(self, claim, result=None, error=None):
        if (result is None) == (error is None):
            raise ValueError("Supply either a complete result or a failure")
        if error is not None and (not isinstance(error, str) or not error.strip()):
            raise ValueError("Failure needs a nonempty explanation")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            row = self.db.execute("SELECT * FROM assessments WHERE claim=?", (claim,)).fetchone()
            if row is None or row["status"] != "running":
                raise ValueError("Claim is missing or no longer running")
            if result is not None:
                validate_result(json.loads(row["job"]), result)
            status = "complete" if result is not None else "failed"
            self.db.execute("UPDATE assessments SET status=?, result=?, error=?, updated=CURRENT_TIMESTAMP WHERE claim=?",
                            (status, json.dumps(result) if result is not None else None, error, claim))
            return {"status": status, "claim": claim, "semantic_status": "unreviewed"}

    def status(self):
        result = []
        for row in self.db.execute("SELECT * FROM assessments ORDER BY rowid DESC LIMIT 100"):
            item = {k: row[k] for k in ("claim", "status", "procedure", "semantic_status", "parent_claim", "created", "updated", "error")}
            job = json.loads(row["job"])
            item.update({k: job[k] for k in ("session_ref", "scope", "scope_id", "source_sha256")})
            result.append(item)
        return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["claim", "complete", "fail", "status"])
    parser.add_argument("--database", default=str(Path.home() / ".furanku-skills/model-routing/assessments.sqlite3"))
    parser.add_argument("--job", help="JSON job identity, source digest, procedure, scope and assessor packet")
    parser.add_argument("--claim")
    parser.add_argument("--result")
    parser.add_argument("--error")
    parser.add_argument("--reassess", action="store_true", help="Explicitly assess completed unchanged work again")
    args = parser.parse_args()
    store = Store(args.database)
    try:
        if args.command == "claim":
            if not args.job:
                parser.error("claim requires --job")
            output = store.claim(json.loads(Path(args.job).read_text()), args.reassess)
        elif args.command == "complete":
            if not args.claim or not args.result:
                parser.error("complete requires --claim and --result")
            output = store.finish(args.claim, result=json.loads(Path(args.result).read_text()))
        elif args.command == "fail":
            if not args.claim or not args.error:
                parser.error("fail requires --claim and --error")
            output = store.finish(args.claim, error=args.error)
        else:
            output = store.status()
        print(json.dumps(output, indent=2))
    finally:
        store.close()


if __name__ == "__main__":
    main()

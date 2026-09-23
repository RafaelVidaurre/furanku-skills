# Reading API acceptance fixture

One product, one Python service, three source files. The domain function and
SQLite adapter are internal modules, not independently usable products.

Run `python3 server.py`, then request `http://localhost:8080/books` with
`curl -i -H 'X-Demo-Access: reader' http://localhost:8080/books`.
It returns only `The River`; omitting the header returns 403 before routing,
domain policy or SQLite access. An authenticated unknown path returns 404.
The public header sentinel demonstrates branching only.

Request execution follows `trace → authenticate → route → reading_list →
ReadingStore.books`. The registered middleware tuple and reversed wrapping in
`dispatch` establish that order. Both success and rejection unwind through
`trace`, which adds `X-Request-Id`. SQLite is an embedded database, not another
network service. `READING_DB` chooses its file; the direct-run default is memory.

`compose.yaml` declares an optional local Compose environment: host port 8088
enters Nginx on port 80, `nginx.conf` forwards HTTP to `api:8080`, and the API
persists SQLite to the `reading-data` volume. These are declarations, not proof
of an active deployment. Start it with `docker compose up` if desired.

For codemap acceptance, copy this directory into a temporary standalone Git
repository, add its files to the index, and use the normal `scan`, `skeleton`,
`draft-template`, `decide`, and `build` commands with a temporary
`FURANKU_SKILLS_HOME`. The included `draft.example.json` supplies evidence-backed
project and request/infrastructure proposals; copy it over the generated draft
before `decide`. It contains no final judgments. Keep Jev decisions and generated
maps out of this fixture.

From the skills repository root:

```sh
mkdir -p /tmp/codemap-project-types/verification/web-service
cp -R skills/codemap/scripts/fixtures/project-types/web-service/. /tmp/codemap-project-types/verification/web-service/
git -C /tmp/codemap-project-types/verification/web-service init
git -C /tmp/codemap-project-types/verification/web-service add .
export FURANKU_SKILLS_HOME=/tmp/codemap-project-types/verification/store
python3 skills/codemap/scripts/codemap.py scan --repo /tmp/codemap-project-types/verification/web-service
python3 skills/codemap/scripts/codemap.py skeleton --repo /tmp/codemap-project-types/verification/web-service
python3 skills/codemap/scripts/codemap.py draft-template --repo /tmp/codemap-project-types/verification/web-service
```

`python3 skills/codemap/scripts/codemap.py path --repo
/tmp/codemap-project-types/verification/web-service` prints the store directory.
Copy `draft.example.json` to `draft.json` there, then run:

```sh
python3 skills/codemap/scripts/codemap.py decide --repo /tmp/codemap-project-types/verification/web-service
python3 skills/codemap/scripts/codemap.py build --repo /tmp/codemap-project-types/verification/web-service
```

These commands use the configured Jev Gateway credential through the normal
client. They do not copy credentials, synthesize decisions, or start Compose.

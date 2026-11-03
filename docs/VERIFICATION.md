# Verify this source-only candidate

The private checkout's local artifact paths and full-collection audit are omitted.
Packaging alone does not run or pass checks. From this tree, run:

```sh
python3 -m venv .venv
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/verify_research.py
.venv/bin/python scripts/benchmark_adaptation.py --output outputs/adaptation.json
node web/checks/quantity.test.mjs
node web/checks/engineering-note.test.mjs
node web/checks/unit-conversion.test.mjs
node web/checks/measurement-decimal.test.mjs
node web/checks/measurement-trial.test.mjs
node web/checks/workspace-file.test.mjs
npm --prefix web ci
npm --prefix web run build
.venv/bin/python -m reshivo serve
```

No credentials are required for offline tests, source checks or building. Live Meta
actions require a separately configured server-side key. No acoustic collection is
included. Successful checks establish software behavior, not physical performance,
future-batch consistency or permission to publish.

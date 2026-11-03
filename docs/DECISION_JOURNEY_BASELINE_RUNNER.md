# Prepared baseline runner

This is an automation aid for the [preregistered decision journey](DECISION_JOURNEY_EVALUATION_20261103.md), not an end-to-end human-effort test. The standalone protocol and fixture stay unchanged. The first run completed one live turn and then stopped at an EOF on the operator prompt; its result is partial, with no retry. The handler now records a terminal event for an interrupted prompt. Changing the runner invalidates the first run's source lock; a later run needs a new lock and separate record.

After committing the protocol, fixture, runner and tests, and confirming the checkout is clean, verify and freeze the exact source version in an unused private path:

```sh
.venv/bin/python scripts/decision_journey_baseline.py --offline
.venv/bin/python -m unittest discover -s tests -p 'test_decision_journey_baseline.py' -v
.venv/bin/python scripts/decision_journey_baseline.py --freeze --lock outputs/decision-journey/lock.json --expected-model muse-spark-1.3-contributor
```

If and when conducting the planned comparison, select the same configured Meta model in the app, then run this once from a terminal:

```sh
.venv/bin/python scripts/decision_journey_baseline.py --live --lock outputs/decision-journey/lock.json --output outputs/decision-journey/baseline.jsonl --expected-model muse-spark-1.3-contributor
```

The lock and result must be under the ignored `outputs` directory; both are created exclusively with mode 0600. No existing result is overwritten or resumed. The freeze requires a clean checkout and records its commit, source hashes, registry hash and optional expected model. With `--expected-model`, live execution checks the configured model before creating a result or making a request and checks each returned model before continuing. A missing or different returned model stops the run with the response preserved. Omit the option during both freeze and live to use another configured Meta model without an exact-model lock; using a different expected ID is also supported. Live execution checks the lock, current clean commit, hashes and configured Meta connection. An interrupted or failed run remains a partial artifact; it cannot be retried as the same run. Follow the frozen protocol when deciding whether a separately named new run is warranted.

The runner calculates the fixture's two material-only costs and composition endpoint amounts independently with Python `Decimal`, checking the results against the fixture oracle. It sends those local worksheet calculations with the synthetic facts; it does not send the `oracle` object. It includes the same source descriptions as the app and the exact preregistered baseline system instruction. Four user messages are sent sequentially, each with the previous assistant messages, through the repository's configured Meta chat-completions transport. It requests high reasoning and 8,192 completion tokens, uses no model-side tools and requests no JSON schema. Reasoning is only sent if the connection declares that capability; declared settings do not prove how the provider processed them. App output is structured and separately validated, so the arms differ in wrappers and formatting.

The runner prints each reply and pauses before the next turn. Run it in an interactive terminal or PTY, inspect each reply, and then press Enter or paste an exact passage already present in the available fixture facts; fabricated clarifications stop the run. An unexpected end of input is recorded as an interruption and stops the run. No additional model calls are made to answer clarifying questions. Each request body is recorded before sending, followed by the full parsed response, including any returned usage, or a recorded error and a stop. Authorization headers and configured credentials are excluded or redacted. `ProviderTransport` limits response size and discards HTTP error bodies, so those error bodies are unavailable; requests and responses are recorded as JSON data, not raw network bytes or headers.

The worksheet is generated automatically before the first turn, and the event log's wall time covers provider calls, not the operator's complete interaction or data-entry effort. It therefore cannot support a claim about clicks, human time saved, or full ordinary-chat workflow completion. To compare those outcomes, run and capture the separate manual operator journey specified by the frozen protocol; disclose whether automation was used and report failures and mismatches. Preserve the JSONL privately and review all generated suggestions against the predeclared rubric.

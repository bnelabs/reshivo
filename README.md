# Reshivo

Reshivo helps people plan useful products when their recycled materials change. Describe the input and the product you want to make, explore possible changes, and compare your recorded checks and costs in one place.

For example, someone making an organizer can compare two material setups, explore an adjustment when the incoming mix changes, and ask what to check next. The app keeps the product and material context with the calculation. You can save the work and reopen it later.

## What it does

- Turns a short description into a project brief you can review and change.
- Helps explore material, preparation, process and product-design options.
- Keeps plans, product checks, readings and manufacturing costs together.
- Calculates an addition for a user-selected composition when the starting mix and addition are described by the needed quantities.
- Compares entered readings with the user's limits and lets the user revisit the decision when another reading is added.
- Exports a readable text summary or a report you can print or save as PDF; a project backup lets you reopen your work.
- Optionally generates a concept image with a Meta connection. The image illustrates an idea and is not a technical drawing.

The application was built during the Meta Global AI Developer Hackathon. Its configured hackathon workflow uses the Meta Model API for contextual assistance; calculations and comparison checks run locally. The AI connection can also be configured for other supported providers. See [inference connections](docs/INFERENCE_PROVIDERS.md).

## Get started

Requirements: Python 3.11 or newer, Node 24 or newer, and npm.

```sh
python3 -m venv .venv
npm --prefix web ci
npm --prefix web run build
.venv/bin/python -m rematter serve
```

Open [http://127.0.0.1:8797](http://127.0.0.1:8797). The server binds to the local machine.

For an Ubuntu 24.04 VPS, see the [deployment guide](docs/VPS_DEPLOYMENT.md). The app keeps its backend on loopback; the guide also explains protected HTTPS access.

For AI assistance, open **AI settings**, select a provider and model, and enter your own API key. Each browser session has its own connection; the web app does not use a shared server key. Keys stay in server memory, expire after 30 minutes of inactivity or a server restart, and are not included in project files. You will need to enter your key again after expiry.

The Meta planning model tested for this project is `muse-spark-1.3-contributor`. Meta may use content sent in Contributor mode to train future models; check the provider's terms before sharing your data. See [inference connections](docs/INFERENCE_PROVIDERS.md) for supported providers.

## What the results mean

An entered reading, a calculated composition and an AI suggestion each answer a different question. A calculated recipe does not establish how the finished product performs, and entered readings do not predict future batches. The sample data used in the demo is synthetic.

## Versions

Find your version in the app menu or footer. See the [changelog](CHANGELOG.md) for what changed.

## Development and checks

The repository includes filtered, dated development history; earlier snapshots may not build because research data and media were removed.

```sh
.venv/bin/python scripts/check_versions.py
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/verify_research.py
node web/checks/quantity.test.mjs
npm --prefix web run build
```

For frontend development, run the Python server and `npm --prefix web run dev` in separate terminals. The development interface proxies API requests to the local server. Release steps are in the [maintainer guide](docs/RELEASING.md).

The measurement sources, their scope and terms are described in the [data inventory](docs/DATA_INVENTORY.md). [Historical evaluations](docs/EVALUATIONS.md) document tests of earlier versions.

## License

Original project code is available under the [Apache License 2.0](LICENSE). Third-party materials and data have their own terms; see [licensing](docs/LICENSING.md) and [NOTICE](NOTICE).

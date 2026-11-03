# Changelog

Notable changes to Reshivo are recorded here. Versions follow [Semantic Versioning](https://semver.org/): before 1.0, a minor version can include changes to the workflow or compatibility, and a patch version covers compatible fixes. Dates are in UTC.

## 0.2.1 — 2026-11-03

### Fixed

- Show an independently calculated amount alongside AI advice when a mix calculation is attached.
- Correct a recognized misleading kilogram range in AI advice using the calculator's exact bounds, while preserving the rest of the advice. This targeted check does not validate arbitrary wording, units or other AI claims.

## 0.2.0 — 2026-11-03

This is the first tagged version of the current Reshivo source repository.

### Added

- Readable project summaries in text and a branded report that can be printed or saved as PDF. Project backups remain available for reopening work.
- Optional product concept images using the visitor's Meta connection. Images are illustrations, not technical drawings.
- Browser-specific AI connections: each visitor enters their own provider key. The web app keeps keys in server memory for the session, with no shared-key fallback.
- The app displays its build version; `/api/health` reports the backend version for deployment checks.

### Changed

- The workspace uses **Plans**, with clearer paths to and from mix adjustments, product checks and costs. Materials described together can be separated in a plan.
- Mix entries accept a percent sign, and results move into view with a plain-language explanation and an optional next step for product checks.
- Error notices can be dismissed on desktop and mobile. The deployment guide now explains per-visitor AI settings.

### Updating

Rebuild the frontend and restart the backend after pulling this version. Each visitor needs to enter their own AI key; in-memory connections do not survive a server restart. Saved project backup files remain separate from AI keys.

## 0.1.0 — historical baseline

Earlier package metadata used `0.1.0`. It was not tagged as a release, so this entry does not claim a complete list of changes for that period.

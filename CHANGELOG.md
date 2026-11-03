# Changelog

Notable changes to Reshivo are recorded here. Versions follow [Semantic Versioning](https://semver.org/): before 1.0, a minor version can include changes to the workflow or compatibility, and a patch version covers compatible fixes. Dates are in UTC.

## 0.4.1 — 2026-11-03

### Fixed

- Let the project helper respond to unrelated questions without forcing it to invent product plans or next steps.
- Keep long accepted answers usable in later project discussion.
- Show clearer connection and unreadable-response errors while retaining the user’s work.

## 0.4.0 — 2026-11-03

### Fixed

- Make it easier to continue from project setup without answering repeated questions.
- Offer corrections from a later answer for review while keeping the existing project details until accepted.
- Keep unfinished answers visible and give users a clear way to include them before continuing.
- Keep setup answers with the project and include them when asking for ideas.
- Put the answer and a starting action ahead of optional questions and detailed ideas.
- Ask for fewer, more distinct ideas and for practical binder, process and equipment details when relevant.
- Keep later tools out of the way while the essential project details are missing, then focus the screen on the answer.
- Guide a saved idea to an editable product check without treating the suggestion as a result.

## 0.3.1 — 2026-11-03

### Fixed

- Keep hidden or unavailable mix calculations out of exported reports until they are current and available again.
- Keep the optional mix calculator closed in a new or reopened project unless the user opens it.
- Bring the next action into view after a user continues from project intake on a small screen.
- Show the recorded method and review state for each reading in reports. Include matching earlier saved guidance as historical when a project is reopened.

## 0.3.0 — 2026-11-03

### Changed

- Bring new AI guidance, cost results and cost comparisons into view when they arrive, without interrupting someone who has changed the inputs or navigated away. Reduced-motion preferences are respected.
- Explain cost-comparison requirements in plain language and make horizontal scrolling clearer on small screens.
- Lead with ideas and the next useful action for a single batch. Hide the optional addition calculator until requested, and explain missing calculation inputs when it is opened.
- Include current, relevant guidance and next steps in the readable text and PDF reports.

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

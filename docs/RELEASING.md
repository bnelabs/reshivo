# Preparing a release

Reshivo uses semantic versions and tags named `vX.Y.Z`. The frontend build shows its version in the app menu and footer; the `version` field at `/api/health` identifies the backend. They should match after deployment.

Before tagging a release:

1. Update the version in `pyproject.toml`, `rematter/__init__.py`, `web/package.json`, and both root version entries in `web/package-lock.json`.
2. Add the changes to `CHANGELOG.md` and run `python3 scripts/check_versions.py` along with the project checks in the README.
3. Tag the tested commit with the matching `vX.Y.Z` tag.

Use plain `X.Y.Z` versions unless the chosen prerelease format has also been checked against Python packaging rules. The first tagged release was `v0.2.0`; the earlier `0.1.0` package label was not a tagged release.

The repository retains dated application, frontend and test commits from the hackathon. Earlier commits were filtered to remove research data, documents, examples and media; their IDs changed and those snapshots may not build independently. The latest commit contains the complete source package.

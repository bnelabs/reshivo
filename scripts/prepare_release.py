"""Prepare a local source-only review tree; never publish or change Git history."""
import argparse
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {"README.md", "pyproject.toml", ".gitignore", ".env.example", "LICENSE", "LICENCE", "NOTICE"}
PREFIXES = ("reshivo/", "tests/", "scripts/", "web/", "data/", "docs/", "examples/", "deploy/", ".github/workflows/")
OMIT_DOCS = {
    "docs/DATA_INVENTORY.md", "docs/VERIFICATION.md", "docs/RELEASE_READINESS.md",
    "docs/AUDIO_AUDITIONS_20261103.md", "docs/DEMO_REWRITE.md", "docs/DEMO_SCRIPT.md",
    "docs/DEMO_STORY_20261103.md", "docs/DEMO_STORY_V2_20261103.md", "docs/BUILD_PLAN.md",
    "docs/GOAL_COMPLETION_AUDIT.md", "docs/JUDGES_REVIEW.md",
    "docs/NARRATION_PRODUCTION.md", "docs/RELEASE_PACKAGE.md", "docs/REVAMP_PLAN.md",
    "docs/REVAMP_STATUS.md", "docs/SUBMISSION_DRAFT.md", "docs/SUBMISSION_FORM.md",
    "docs/SUBMISSION_HANDOFF.md", "docs/SUBMISSION_READINESS_20261103.md",
}
OMIT_PREFIXES = ("docs/brand/", "docs/demo/", "docs/design/", "docs/release-qa-")
GENERATED_PATHS = {"docs/DATA_INVENTORY.md", "docs/VERIFICATION.md"}
ACOUSTIC_IDS = {"alves2024", "caniato2022", "biboud2024"}
BAD_PARTS = {".git", "node_modules", "__pycache__", ".venv", "outputs", "dist", "build", "access_attempts"}
SECRET_PATTERN = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}|LLM_[A-Za-z0-9_]{30,}")
OMITTED_LINKS = {
    "docs/ORGANIZER_EVALUATION_RESULTS_20261103.md": (
        "../outputs/organizer-20261103-a/turn-1-after-question.jpg",
        "../outputs/organizer-20261103-a/turn-2-provider-error.jpg",
        "../outputs/organizer-20261103-a/turn-3-provider-error.jpg",
        "../outputs/organizer-20261103-a/turn-4-comparison.jpg",
        "../outputs/organizer-20261103-a/turn-4-response.jpg",
    ),
    "docs/PLANNING_CONSTRAINT_FIX_20261103.md": ("../outputs/decision-journey-20261103-a/rematter-ui-observations.md",),
    "docs/MATERIAL_TRIAL_HANDOFF.md": ("demo/material-decision-review.mp4",),
    "docs/MATERIAL_DIRECTION_REPAIR.md": ("NARRATION_PRODUCTION.md",),
    "docs/BALANCE_SPIKE.md": ("demo/rematter-demo.mp4",),
    "examples/organizer-run-20261103/reshivo-independent-review.md": (
        "turn-1-after-question.jpg", "turn-2-provider-error.jpg", "turn-3-provider-error.jpg",
        "turn-4-comparison.jpg", "turn-4-response.jpg",
    ),
}
HISTORICAL_NOTICE = ("> **Historical evaluation:** This frozen protocol describes an earlier development snapshot. "
                     "References to private working status describe that time, not the current release.\n\n")
HISTORICAL_PROTOCOLS = {
    "docs/DECISION_JOURNEY_EVALUATION_20261103.md": "scripts/decision_journey_baseline.py",
    "docs/ORGANIZER_EVALUATION_20261103.md": "scripts/organizer_baseline.py",
}


def annotate_omitted_links(files):
    """Replace only known omitted-asset links, leaving unexpected broken links visible."""
    for name, links in OMITTED_LINKS.items():
        if name not in files:
            continue
        body = files[name].decode()
        for link in links:
            pattern = r"\[([^\]]+)\]\(" + re.escape(link) + r"\)"
            body, count = re.subn(pattern, r"\1 (not included in this export)", body)
            if count != 1:
                raise ValueError("Expected omitted-asset link changed: " + name)
        files[name] = body.encode()


def mark_historical_protocols(files):
    """Add a release-only notice while checking the original frozen protocol bytes."""
    old = "def digest(path):\n    return hashlib.sha256(path.read_bytes()).hexdigest()\n"
    new = ("def digest(path):\n"
           "    body = path.read_bytes()\n"
           "    if path == ROOT / PROTOCOL:\n"
           f"        notice = {HISTORICAL_NOTICE.encode()!r}\n"
           "        if not body.startswith(notice):\n"
           "            raise ValueError('Release historical notice is missing or changed')\n"
           "        body = body[len(notice):]\n"
           "    return hashlib.sha256(body).hexdigest()\n")
    for protocol, script in HISTORICAL_PROTOCOLS.items():
        if protocol not in files or script not in files:
            raise ValueError("Frozen protocol or its baseline script is missing from release")
        body = files[script].decode()
        if body.count(old) != 1 or files[protocol].startswith(HISTORICAL_NOTICE.encode()):
            raise ValueError("Frozen protocol verification layout changed; review release adaptation")
        files[protocol] = HISTORICAL_NOTICE.encode() + files[protocol]
        files[script] = body.replace(old, new, 1).encode()


def git(*args, root=ROOT):
    return subprocess.check_output(["git", "-C", str(root), *args])


def selected(path):
    parts = PurePosixPath(path).parts
    return (bool(parts) and not PurePosixPath(path).is_absolute() and ".." not in parts
            and not BAD_PARTS.intersection(parts)
            and not path.startswith("data/research/acoustics/")
            and not path.startswith(OMIT_PREFIXES)
            and path not in OMIT_DOCS
            and not any(part.startswith(".env") and part != ".env.example" for part in parts)
            and (path in ROOT_FILES or path.startswith(PREFIXES))
            and not path.endswith((".pyc", ".log", ".DS_Store", ".mp4")))


def read_tree(ref="HEAD", working_tree=False, root=ROOT):
    """Default to immutable committed blobs, with no checkout or history export."""
    commit = git("rev-parse", "--verify", ref + "^{commit}", root=root).decode().strip()
    if working_tree:
        names = git("ls-files", "-z", "--cached", "--others", "--exclude-standard", root=root).decode().split("\0")
        files = {}
        for name in sorted(set(filter(None, names))):
            if not selected(name):
                continue
            path = root / name
            if path.is_symlink():
                raise ValueError("Source export does not follow symlinks: " + name)
            if path.is_file():
                files[name] = path.read_bytes()
        mode = "explicit working-tree snapshot; includes uncommitted changes"
    else:
        archive = git("archive", "--format=tar", commit, root=root)
        files = {}
        with tarfile.open(fileobj=BytesIO(archive)) as stream:
            for member in stream:
                if not selected(member.name):
                    continue
                if member.issym() or member.islnk():
                    raise ValueError("Source export does not follow links: " + member.name)
                if member.isfile():
                    files[member.name] = stream.extractfile(member).read()
        mode = "immutable committed tree"
    return files, commit, mode


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def transform(files):
    """Make every release-only change explicit without mutating the checkout."""
    files = dict(files)
    changes = []
    groups_name = "data/research/source_groups.json"
    groups = json.loads(files[groups_name])
    files[groups_name] = json_bytes([row for row in groups if row["id"] not in ACOUSTIC_IDS])
    changes.append("Removed acoustic-source summaries from the optional source catalog.")

    verifier = "scripts/verify_research.py"
    body = files[verifier].decode()
    start = '    acoustic = BASE / "acoustics"\n'
    end = '    contamination = BASE / "contamination"\n'
    if body.count(start) != 1 or body.count(end) != 1:
        raise ValueError("Research verifier layout changed; review the source-export adaptation")
    a, b = body.index(start), body.index(end)
    body = body[:a] + '    # Source-only release omits the private acoustic collection.\n\n' + body[b:]
    body, count = re.subn(r'^    print\(f"Acoustics:.*\n', '    print("Acoustics: intentionally omitted from this source-only release")\n', body, flags=re.M)
    if count != 1:
        raise ValueError("Research verifier acoustic summary changed")
    files[verifier] = body.encode()
    changes.append("Adapted the exported research verifier to report the acoustic omission; retained checks are unchanged.")

    # Remove machine-specific fallback paths and local output paths from text only.
    for name, content in list(files.items()):
        if name.endswith((".py", ".md", ".json", ".ts", ".tsx")):
            try:
                text = content.decode()
            except UnicodeDecodeError:
                continue
            sanitized = re.sub(r"/local/user/\s\"'`]+", "/local/user", text)
            if sanitized != text:
                files[name] = sanitized.encode()
                changes.append("Replaced personal absolute path prefixes in " + name)

    annotate_omitted_links(files)
    changes.append("Marked selected omitted media and private-output links without altering other links.")
    mark_historical_protocols(files)
    changes.append("Marked two historical protocols; their baseline verifiers hash the original frozen bytes after checking the exact notice.")

    inventory = """# Source collection in this release

This source-only tree retains the polypropylene study, polyethylene density/yield-stress
example, Râpă tensile comparison and named-polymer contamination records. They remain
source measurements under their recorded CC BY terms. Exact identities, methods, source
locations, sample counts and hashes remain in each retained data package. These studies
do not establish the properties of a user's material or a finished product.

The entire private acoustic research collection is omitted, including its derived
records, source copies and inventories. No sound-property calculator depends on it.
The acoustic summaries are also removed from the optional source catalog. This export
does not grant any permission to redistribute the private collection.

Run `python scripts/verify_research.py` for retained source checks. This exported copy
explicitly reports the omission. The private full-collection audit is not represented
as a completed audit of this different source tree. See `RELEASE_MANIFEST.json` for
the complete included-file hashes and release-only changes.

Source CC BY terms do not license the software. Check the root software license
separately; this packaging step selects none. This locally prepared tree is not
publication authorization.
"""
    files["docs/DATA_INVENTORY.md"] = inventory.encode()
    files["docs/VERIFICATION.md"] = b"""# Verify this source-only candidate

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
"""
    changes.append("Generated a release-specific inventory rather than retaining claims about excluded files.")

    # The changed source catalog is itself a checked calculation input.
    manifest_name = "data/research/calculation_inputs.json"
    manifest = json.loads(files[manifest_name])
    for row in manifest["files"]:
        row["sha256"] = sha(files[row["path"]])
    files[manifest_name] = json_bytes(manifest)
    general = "data/research/manifest.json"
    manifest = json.loads(files[general])
    manifest["files"] = [dict(row, sha256=sha(files[row["path"]]), bytes=len(files[row["path"]]))
                         for row in manifest["files"] if row["path"] in files]
    files[general] = json_bytes(manifest)
    changes.append("Regenerated the two affected exported manifests for retained files; private originals remain unchanged.")

    licensing_name = "docs/LICENSING.md"
    if licensing_name in files:
        source = files[licensing_name].decode()
        old = ("The private acoustic collection includes restricted research material and remains excluded "
               "from the clean release tree and its history. Use [RELEASE_PACKAGE.md](RELEASE_PACKAGE.md) "
               "to prepare a source-only candidate.")
        new = ("The acoustic research collection is not included in this source tree; "
               "the retained third-party materials have the terms recorded in their source packages.")
        if old not in source:
            raise ValueError("Licensing text changed; review source-export adaptation")
        source = source.replace(old, new)
        source = source.replace("The repository remains private; the owner will handle publication and submission.", "")
        source = source.replace("Original private development history and separate data attribution are preserved.",
                                "Data attribution is recorded separately.")
        files[licensing_name] = source.encode()
        changes.append("Adapted licensing notes for the source-only collection.")
    return files, changes


def local_secrets(root):
    found = []
    for name in (".env", ".env.elevenlabs"):
        path = root / name
        if path.exists():
            for line in path.read_text().splitlines():
                if "=" not in line or line.lstrip().startswith("#"):
                    continue
                key, value = line.split("=", 1)
                value = value.strip().strip("\"'")
                if any(word in key.upper() for word in ("KEY", "TOKEN", "SECRET")) and len(value) >= 12:
                    found.append(value.encode())
    profiles = root / ".env.providers.json"
    if profiles.exists():
        data = json.loads(profiles.read_text())
        for profile in data.get("profiles", {}).values():
            value = profile.get("api_key", "")
            if isinstance(value, str) and len(value) >= 12:
                found.append(value.encode())
    return found


def check_bytes(name, body, secrets):
    if SECRET_PATTERN.search(body) or any(secret in body for secret in secrets):
        raise ValueError("Possible credential/private key in export file; value withheld: " + name)


def check_files(files, secrets=()):
    for name, body in files.items():
        if not selected(name) and name not in GENERATED_PATHS:
            raise ValueError("Unexpected export path: " + name)
        check_bytes(name, body, secrets)
        if name.endswith((".zip", ".xlsx", ".docx")):
            with zipfile.ZipFile(BytesIO(body)) as archive:
                infos = archive.infolist()
                if len(infos) > 10000 or sum(row.file_size for row in infos) > 250_000_000:
                    raise ValueError("Archive too large for focused credential inspection: " + name)
                for row in infos:
                    if not row.is_dir():
                        check_bytes(name + "!" + row.filename, archive.read(row), secrets)


def prepare(destination, *, ref="HEAD", working_tree=False, root=ROOT):
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError("Choose a new destination; export never overwrites a directory")
    files, commit, mode = read_tree(ref, working_tree, root)
    files, changes = transform(files)
    check_files(files, local_secrets(root))
    report = {"schema_version": 1, "prepared_utc": datetime.now(timezone.utc).isoformat(),
              "source_commit": commit, "snapshot_mode": mode,
              "profile": "source_only_no_acoustics_no_history_v2",
              "software_license_present": "LICENSE" in files or "LICENCE" in files,
              "contains_builds_or_dependencies": False,
              "verification_status": "Not executed by packaging; run the documented checks in this export.",
              "omissions": ["Git history and remote configuration", "all data/research/acoustics files",
                            "private full-collection inventories and local verification notes", "source-access challenge responses",
                            "credentials, local outputs, dependency directories and built assets",
                            "video recordings and private production/submission notes; publish the reviewed demo separately"],
              "release_only_changes": changes,
              "files": [{"path": name, "bytes": len(body), "sha256": sha(body)} for name, body in sorted(files.items())]}
    destination.mkdir(parents=True)
    for name, body in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    (destination / "RELEASE_MANIFEST.json").write_bytes(json_bytes(report))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--ref", default="HEAD", help="Committed revision to export, default HEAD")
    parser.add_argument("--working-tree", action="store_true", help="Explicitly include allowed uncommitted source files for local QA")
    args = parser.parse_args()
    try:
        report = prepare(args.destination, ref=args.ref, working_tree=args.working_tree)
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError) as exc:
        parser.exit(1, str(exc) + "\n")
    print(json.dumps({"destination": str(args.destination.resolve()), "files": len(report["files"]),
                      "profile": report["profile"], "publication_authorized": False}))


if __name__ == "__main__":
    main()

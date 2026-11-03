#!/usr/bin/env python3
"""Check that the release version is valid and consistent across the app."""
import ast
import json
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(
    r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
)


def valid_semver(value):
    if not isinstance(value, str):
        return False
    match = SEMVER.fullmatch(value)
    if not match:
        return False
    prerelease = match.group(4)
    return not prerelease or all(
        not (part.isascii() and part.isdigit() and len(part) > 1 and part.startswith("0"))
        for part in prerelease.split(".")
    )


def module_version():
    tree = ast.parse((ROOT / "reshivo/__init__.py").read_text(encoding="utf-8"))
    assignments = [
        node.value.value
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "__version__" for target in node.targets)
        and isinstance(node.value, ast.Constant)
    ]
    if len(assignments) != 1:
        raise ValueError("Missing or ambiguous version")
    return assignments[0]


def main():
    try:
        with (ROOT / "pyproject.toml").open("rb") as source:
            python_package = tomllib.load(source)["project"]["version"]
        frontend = json.loads((ROOT / "web/package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "web/package-lock.json").read_text(encoding="utf-8"))
        versions = {
            "pyproject.toml": python_package,
            "reshivo/__init__.py": module_version(),
            "web/package.json": frontend["version"],
            "web/package-lock.json": lock["version"],
            "web/package-lock.json (root package)": lock["packages"][""]["version"],
        }
    except (OSError, UnicodeError, ValueError, SyntaxError, KeyError, TypeError):
        print("Could not read all release versions; check the package files.", file=sys.stderr)
        return 1

    invalid = [name for name, value in versions.items() if not valid_semver(value)]
    if invalid:
        for name in invalid:
            print(f"{name}: invalid semantic version", file=sys.stderr)
        return 1
    if len(set(versions.values())) != 1:
        for name, value in versions.items():
            print(f"{name}: {value}", file=sys.stderr)
        print("Release versions do not match.", file=sys.stderr)
        return 1
    print(f"Release versions match: {python_package}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

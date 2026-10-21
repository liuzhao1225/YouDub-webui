"""Shared dependency metadata for preparation and provider capability probes.

requirements/*.txt selects first-install versions; supportedVersions explicitly
describes compatible existing installations, which need not be downgraded.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util
import json
from pathlib import Path

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / "requirements/resources.json").read_text())
GROUPS = {name: group["modules"] for name, group in MANIFEST["groups"].items()}


def distributions(groups):
    if not isinstance(groups, list) or any(group not in GROUPS for group in groups):
        raise ValueError("Unknown dependency group.")
    return {module: dist for group in groups for module, dist in GROUPS[group].items()}


def missing_modules(groups):
    return [module for module in distributions(groups) if importlib.util.find_spec(module) is None]


def version_requirement(distribution):
    return MANIFEST["supportedVersions"].get(distribution, "")


def version_supported(distribution):
    from packaging.specifiers import SpecifierSet
    from packaging.version import InvalidVersion
    try:
        return SpecifierSet(version_requirement(distribution)).contains(importlib.metadata.version(distribution))
    except (importlib.metadata.PackageNotFoundError, InvalidVersion):
        return False


def missing_dependencies(groups):
    selected = distributions(groups)
    missing = [selected[module] for module in missing_modules(groups)]
    if importlib.util.find_spec("packaging") is not None:
        for dist in MANIFEST["supportedVersions"]:
            if dist in selected.values() and dist not in missing and not version_supported(dist):
                missing.append(dist)
        if "torchcodec" in selected.values() and "torchcodec" not in missing and importlib.util.find_spec("torch") is not None:
            from packaging.version import Version
            codec = {"2.8": "0.7.0", "2.9": "0.8.1"}.get(".".join(importlib.metadata.version("torch").split(".")[:2]))
            if codec and Version(importlib.metadata.version("torchcodec")) != Version(codec):
                missing.append("torchcodec")
    return missing

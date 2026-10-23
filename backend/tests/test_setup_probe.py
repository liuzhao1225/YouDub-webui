from __future__ import annotations

import pytest
from types import SimpleNamespace

from backend.workers import setup_probe


def test_harness_punkt_does_not_accept_machine_nltk_data(monkeypatch, tmp_path):
    import nltk.data
    machine = tmp_path / "machine"
    english = machine / "tokenizers/punkt_tab/english"
    english.mkdir(parents=True)
    for name in ("collocations.tab", "sent_starters.txt", "abbrev_types.txt", "ortho_context.tab"):
        (english / name).write_text("fixture")
    monkeypatch.setattr(nltk.data, "path", [str(machine)])
    monkeypatch.delenv("YOUDUB_HARNESS_RUNTIME", raising=False)
    assert setup_probe.punkt()["ready"] is True
    monkeypatch.setenv("YOUDUB_HARNESS_RUNTIME", "1")
    monkeypatch.setenv("NLTK_DATA", str(tmp_path / "private"))
    assert setup_probe.punkt()["ready"] is False


def test_base_and_subtitles_do_not_inspect_or_import_optional_tts(monkeypatch):
    checked, imported = [], []
    forbidden = {"voxcpm", "transformers", "librosa", "openunmix", "dora", "julius", "torchcodec"}

    def find_spec(module):
        assert module not in forbidden, f"Unselected provider dependency was inspected: {module}"
        checked.append(module)
        return object()

    monkeypatch.setattr(setup_probe.importlib.util, "find_spec", find_spec)
    monkeypatch.setattr(setup_probe.importlib.metadata, "version", lambda name: {
        "nltk": "3.10.3", "pydantic": "2.11.0",
    }[name])
    monkeypatch.setattr(setup_probe.importlib, "import_module", lambda name: imported.append(name))
    assert setup_probe.verify(["base"]) == {"ready": True}
    assert set(imported) == {"dotenv", "pydantic", "keyring", "packaging"}
    imported.clear()
    assert setup_probe.verify(["base", "media", "whisper", "openai"]) == {"ready": True}
    assert "whisper" in imported and "openai" in imported
    assert not forbidden.intersection(checked + imported)


def test_selected_provider_import_failure_preserves_original_exception(monkeypatch):
    original = ImportError("selected VoxCPM binary is incompatible")
    monkeypatch.setattr(setup_probe, "missing_dependencies", lambda _groups: [])
    monkeypatch.setattr(setup_probe.importlib.metadata, "version", lambda _name: "2.8.0")

    def import_module(module):
        if module == "voxcpm":
            raise original

    monkeypatch.setattr(setup_probe.importlib, "import_module", import_module)
    with pytest.raises(ImportError) as result:
        setup_probe.verify(["voxcpm"])
    assert result.value is original


@pytest.mark.parametrize("groups,audio_version,needs_codec", [
    (["voxcpm"], "2.8.0", False),
    (["voxcpm"], "2.9.0+cpu", True),
    (["qwen_forced_aligner"], "2.9.0", False),
])
def test_verify_imports_codec_only_for_the_execution_path(monkeypatch, groups, audio_version, needs_codec):
    imported = []
    original = OSError("libavcodec shared library cannot be loaded")
    monkeypatch.setattr(setup_probe, "missing_dependencies", lambda _groups: [])
    monkeypatch.setattr(setup_probe.importlib.metadata, "version", lambda _name: audio_version)

    def import_module(module):
        imported.append(module)
        if module == "torchcodec":
            raise original

    monkeypatch.setattr(setup_probe.importlib, "import_module", import_module)
    if needs_codec:
        with pytest.raises(OSError) as result:
            setup_probe.verify(groups)
        assert result.value is original
    else:
        assert setup_probe.verify(groups) == {"ready": True}
        assert "torchcodec" not in imported


def test_codec_version_is_checked_even_when_its_native_library_is_not_used(monkeypatch):
    monkeypatch.setattr(setup_probe.importlib.util, "find_spec", lambda _module: object())
    versions = {"torch": "2.8.0", "torchcodec": "0.8.1", "voxcpm": "2.0.3", "transformers": "5.17.0"}
    monkeypatch.setattr(setup_probe.importlib.metadata, "version", lambda name: versions[name])
    assert setup_probe.missing_dependencies(["voxcpm"]) == ["torchcodec"]


def test_missing_provider_never_requires_an_unselected_group(monkeypatch):
    monkeypatch.setattr(setup_probe.importlib.util, "find_spec", lambda module: None)
    assert setup_probe.missing_dependencies(["openai"]) == ["openai", "httpx", "socksio"]
    assert "voxcpm" not in setup_probe.missing_dependencies(["base", "media", "whisper", "openai"])
    assert "voxcpm" in setup_probe.missing_dependencies(["voxcpm"])


def test_unknown_dependency_group_is_rejected():
    with pytest.raises(ValueError, match="Unknown dependency group"):
        setup_probe.distributions(["../../requirements"])


def test_media_resource_requires_subtitles_filter_and_preserves_process_failure(monkeypatch):
    monkeypatch.setattr(setup_probe.shutil, "which", lambda command: "/usr/bin/" + command)
    monkeypatch.setattr(setup_probe.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout="version", stderr=""))
    assert "subtitles" in setup_probe.media_error()
    monkeypatch.setattr(setup_probe.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=3, stdout="", stderr="loader: missing shared library"))
    assert "exited (3)" in setup_probe.media_error()
    assert "loader: missing shared library" in setup_probe.media_error()


def test_install_requirements_fit_the_shared_supported_version_ranges():
    from pathlib import Path
    from packaging.requirements import Requirement
    from packaging.specifiers import SpecifierSet
    from backend.app.resources import MANIFEST
    root = Path(__file__).resolve().parents[1] / 'requirements'
    for group in MANIFEST['groups']:
        for line in (root / f'{group}.txt').read_text().splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            requirement = Requirement(line)
            supported = MANIFEST['supportedVersions'].get(requirement.name)
            if supported:
                for constraint in requirement.specifier:
                    if constraint.operator == '==':
                        assert SpecifierSet(supported).contains(constraint.version), (group, line, supported)

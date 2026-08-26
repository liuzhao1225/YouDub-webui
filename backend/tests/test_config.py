from __future__ import annotations

from backend.app import config


def test_configure_windows_ffmpeg_dll_directory_uses_configured_shared_build(
    monkeypatch, tmp_path
):
    ffmpeg_dir = tmp_path / "ffmpeg" / "bin"
    ffmpeg_dir.mkdir(parents=True)
    ffmpeg_path = ffmpeg_dir / "ffmpeg.exe"
    ffmpeg_path.write_bytes(b"")
    (ffmpeg_dir / "avcodec-63.dll").write_bytes(b"")
    dll_handle = object()
    registered: list[str] = []

    monkeypatch.setattr(config.sys, "platform", "win32")
    monkeypatch.setenv("FFMPEG_PATH", str(ffmpeg_path))
    monkeypatch.setattr(config, "_FFMPEG_DLL_DIRECTORY_HANDLE", None)
    monkeypatch.setattr(
        config.os,
        "add_dll_directory",
        lambda path: registered.append(path) or dll_handle,
        raising=False,
    )

    config.configure_windows_ffmpeg_dll_directory()
    config.configure_windows_ffmpeg_dll_directory()

    assert registered == [str(ffmpeg_dir.resolve())]
    assert config._FFMPEG_DLL_DIRECTORY_HANDLE is dll_handle


def test_configure_windows_ffmpeg_dll_directory_rejects_static_build(
    monkeypatch, tmp_path
):
    ffmpeg_path = tmp_path / "ffmpeg.exe"
    ffmpeg_path.write_bytes(b"")

    monkeypatch.setattr(config.sys, "platform", "win32")
    monkeypatch.setenv("FFMPEG_PATH", str(ffmpeg_path))
    monkeypatch.setattr(config, "_FFMPEG_DLL_DIRECTORY_HANDLE", None)

    try:
        config.configure_windows_ffmpeg_dll_directory()
    except RuntimeError as exc:
        assert "av*.dll" in str(exc)
    else:
        raise AssertionError("static FFmpeg build should be rejected")


def test_configure_windows_ffmpeg_dll_directory_skips_other_platforms(monkeypatch):
    monkeypatch.setattr(config.sys, "platform", "darwin")
    monkeypatch.setenv("FFMPEG_PATH", "/missing/ffmpeg")
    monkeypatch.setattr(config, "_FFMPEG_DLL_DIRECTORY_HANDLE", None)

    config.configure_windows_ffmpeg_dll_directory()

    assert config._FFMPEG_DLL_DIRECTORY_HANDLE is None

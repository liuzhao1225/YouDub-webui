from urllib.request import Request

import pytest
import yt_dlp
from backend.workers.download import video_url, VideoRedirect, download_video
from backend.workers.protocol import WorkerError


class Wire:
    def check_cancel(self):
        pass
    def progress(self, *_):
        pass


@pytest.mark.parametrize('url', ['http://127.0.0.1/a', 'https://youtube.com.evil.com/watch?v=jNQXAC9IVRw', 'https://b23.tv:8000/a', 'https://www.youtube.com/playlist?list=x'])
def test_rejects_non_video_targets(url):
    with pytest.raises(WorkerError):
        video_url(url)


def test_short_link_redirect_is_checked_before_fetching():
    with pytest.raises(WorkerError):
        VideoRedirect().redirect_request(Request('https://b23.tv/abc'), None, 302, 'Found', {}, 'http://127.0.0.1/private')
    assert video_url('https://www.youtube.com/shorts/jNQXAC9IVRw') == 'https://www.youtube.com/watch?v=jNQXAC9IVRw'


@pytest.mark.parametrize('mode', ['network', 'duration', 'size', 'cancel'])
def test_download_failure_never_returns_an_artifact(tmp_path, monkeypatch, mode):
    original = RuntimeError('download network failure')
    class Downloader:
        def __init__(self, options): self.options = options
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def extract_info(self, *_args, **_kwargs):
            if mode == 'network': raise original
            if mode == 'duration': self.options['match_filter']({'duration': 601})
            if mode == 'size': self.options['progress_hooks'][0]({'downloaded_bytes': 101})
            pytest.fail('Rejected download continued')
    class Cancelled(Wire):
        def check_cancel(self): raise WorkerError('CANCELLED', 'cancelled')
    monkeypatch.setattr(yt_dlp, 'YoutubeDL', Downloader)
    with pytest.raises((RuntimeError, WorkerError)) as error:
        download_video('https://youtu.be/jNQXAC9IVRw', tmp_path, Cancelled() if mode == 'cancel' else Wire(), 100)
    if mode == 'network': assert error.value is original
    else: assert error.value.code == {'duration': 'MEDIA_LIMIT_EXCEEDED', 'size': 'FILE_TOO_LARGE', 'cancel': 'CANCELLED'}[mode]
    assert not list(tmp_path.iterdir())

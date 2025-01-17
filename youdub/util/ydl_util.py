import re
import urllib

from yt_dlp import int_or_none, traverse_obj, join_nonempty, format_field
from yt_dlp.utils import determine_ext, try_call, try_get, str_or_none


def _parse_aweme_video_app( aweme_detail):
    aweme_id = aweme_detail['aweme_id']
    video_info = aweme_detail['video']
    known_resolutions = {}

    def audio_meta(url):
        ext = determine_ext(url, default_ext='m4a')
        return {
            'format_note': 'Music track',
            'ext': ext,
            'acodec': 'aac' if ext == 'm4a' else ext,
            'vcodec': 'none',
            'width': None,
            'height': None,
        } if ext == 'mp3' or '-music-' in url else {}

    def extract_addr(addr, add_meta={}):
        parsed_meta, res = _parse_url_key(addr.get('url_key', ''))
        is_bytevc2 = parsed_meta.get('vcodec') == 'bytevc2'
        if res:
            known_resolutions.setdefault(res, {}).setdefault('height', int_or_none(addr.get('height')))
            known_resolutions[res].setdefault('width', int_or_none(addr.get('width')))
            parsed_meta.update(known_resolutions.get(res, {}))
            add_meta.setdefault('height', int_or_none(res[:-1]))
        return [{
            'url': url,
            'filesize': int_or_none(addr.get('data_size')),
            'ext': 'mp4',
            'acodec': 'aac',
            'source_preference': -2 if 'aweme/v1' in url else -1,  # Downloads from API might get blocked
            **add_meta, **parsed_meta,
            # bytevc2 is bytedance's own custom h266/vvc codec, as-of-yet unplayable
            'preference': -100 if is_bytevc2 else -1,
            'format_note': join_nonempty(
                add_meta.get('format_note'), '(API)' if 'aweme/v1' in url else None,
                '(UNPLAYABLE)' if is_bytevc2 else None, delim=' '),
            **audio_meta(url),
        } for url in addr.get('url_list') or []]

    # Hack: Add direct video links first to prioritize them when removing duplicate formats
    formats = []
    width = int_or_none(video_info.get('width'))
    height = int_or_none(video_info.get('height'))
    ratio = try_call(lambda: width / height) or 0.5625
    if video_info.get('play_addr'):
        formats.extend(extract_addr(video_info['play_addr'], {
            'format_id': 'play_addr',
            'format_note': 'Direct video',
            'vcodec': 'h265' if traverse_obj(
                video_info, 'is_bytevc1', 'is_h265') else 'h264',  # TODO: Check for "direct iOS" videos, like https://www.tiktok.com/@cookierun_dev/video/7039716639834656002
            'width': width,
            'height': height,
        }))
    if video_info.get('download_addr'):
        download_addr = video_info['download_addr']
        dl_width = int_or_none(download_addr.get('width'))
        formats.extend(extract_addr(download_addr, {
            'format_id': 'download_addr',
            'format_note': 'Download video%s' % (', watermarked' if video_info.get('has_watermark') else ''),
            'vcodec': 'h264',
            'width': dl_width,
            'height': try_call(lambda: int(dl_width / ratio)),  # download_addr['height'] is wrong
            'preference': -2 if video_info.get('has_watermark') else -1,
        }))
    if video_info.get('play_addr_h264'):
        formats.extend(extract_addr(video_info['play_addr_h264'], {
            'format_id': 'play_addr_h264',
            'format_note': 'Direct video',
            'vcodec': 'h264',
        }))
    if video_info.get('play_addr_bytevc1'):
        formats.extend(extract_addr(video_info['play_addr_bytevc1'], {
            'format_id': 'play_addr_bytevc1',
            'format_note': 'Direct video',
            'vcodec': 'h265',
        }))

    for bitrate in video_info.get('bit_rate', []):
        if bitrate.get('play_addr'):
            formats.extend(extract_addr(bitrate['play_addr'], {
                'format_id': bitrate.get('gear_name'),
                'format_note': 'Playback video',
                'tbr': try_get(bitrate, lambda x: x['bit_rate'] / 1000),
                'vcodec': 'h265' if traverse_obj(
                    bitrate, 'is_bytevc1', 'is_h265') else 'h264',
                'fps': bitrate.get('FPS'),
            }))

    self._remove_duplicate_formats(formats)
    auth_cookie = self._get_cookies(self._WEBPAGE_HOST).get('sid_tt')
    if auth_cookie:
        for f in formats:
            self._set_cookie(urllib.parse.urlparse(f['url']).hostname, 'sid_tt', auth_cookie.value)

    stats_info = aweme_detail.get('statistics') or {}
    music_info = aweme_detail.get('music') or {}
    labels = traverse_obj(aweme_detail, ('hybrid_label', ..., 'text'), expected_type=str)

    contained_music_track = traverse_obj(
        music_info, ('matched_song', 'title'), ('matched_pgc_sound', 'title'), expected_type=str)
    contained_music_author = traverse_obj(
        music_info, ('matched_song', 'author'), ('matched_pgc_sound', 'author'), 'author', expected_type=str)

    is_generic_og_trackname = music_info.get('is_original_sound') and music_info.get('title') == 'original sound - {}'.format(music_info.get('owner_handle'))
    if is_generic_og_trackname:
        music_track, music_author = contained_music_track or 'original sound', contained_music_author
    else:
        music_track, music_author = music_info.get('title'), traverse_obj(music_info, ('author', {str}))

    author_info = traverse_obj(aweme_detail, ('author', {
        'uploader': ('unique_id', {str}),
        'uploader_id': ('uid', {str_or_none}),
        'channel': ('nickname', {str}),
        'channel_id': ('sec_uid', {str}),
    }))

    return {
        'id': aweme_id,
        **traverse_obj(aweme_detail, {
            'title': ('desc', {str}),
            'description': ('desc', {str}),
            'timestamp': ('create_time', {int_or_none}),
        }),
        **traverse_obj(stats_info, {
            'view_count': 'play_count',
            'like_count': 'digg_count',
            'repost_count': 'share_count',
            'comment_count': 'comment_count',
        }, expected_type=int_or_none),
        **author_info,
        'channel_url': format_field(author_info, 'channel_id', self._UPLOADER_URL_FORMAT, default=None),
        'uploader_url': format_field(
            author_info, ['uploader', 'uploader_id'], self._UPLOADER_URL_FORMAT, default=None),
        'track': music_track,
        'album': str_or_none(music_info.get('album')) or None,
        'artists': re.split(r'(?:, | & )', music_author) if music_author else None,
        'formats': formats,
        'subtitles': self.extract_subtitles(
            aweme_detail, aweme_id, traverse_obj(author_info, 'uploader', 'uploader_id', 'channel_id')),
        'thumbnails': [
            {
                'id': cover_id,
                'url': cover_url,
                'preference': -1 if cover_id in ('cover', 'origin_cover') else -2,
            }
            for cover_id in (
                'cover', 'ai_dynamic_cover', 'animated_cover',
                'ai_dynamic_cover_bak', 'origin_cover', 'dynamic_cover')
            for cover_url in traverse_obj(video_info, (cover_id, 'url_list', ...))
        ],
        'duration': (traverse_obj(video_info, (
            (None, 'download_addr'), 'duration', {int_or_none(scale=1000)}, any))
                     or traverse_obj(music_info, ('duration', {int_or_none}))),
        'availability': self._availability(
            is_private='Private' in labels,
            needs_subscription='Friends only' in labels,
            is_unlisted='Followers only' in labels),
        '_format_sort_fields': ('quality', 'codec', 'size', 'br'),
    }
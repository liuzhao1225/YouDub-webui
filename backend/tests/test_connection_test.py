from types import SimpleNamespace as NS
from unittest.mock import Mock

import httpx
import pytest
import openai

from backend.app.v1.connection_test import check_connection
from backend.workers.protocol import WorkerError


@pytest.fixture
def bridge():
    return NS(store=NS(settings_values=lambda: {'connections': []}), credentials=Mock())


def test_missing_key_never_contacts_provider(bridge, monkeypatch):
    monkeypatch.setattr(openai, 'OpenAI', lambda **kwargs: pytest.fail('must not contact provider'))
    with pytest.raises(WorkerError, match='API 密钥'):
        check_connection({'base_url': 'https://example.test/v1', 'model': 'test'}, bridge)


def test_failed_connection_never_echoes_key_or_provider_response(bridge, monkeypatch):
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=False)
    client.chat.completions.create.side_effect = openai.AuthenticationError('secret-example',
        response=httpx.Response(401, request=httpx.Request('POST', 'https://example.test/v1')), body={'key': 'secret-example'})
    monkeypatch.setattr(openai, 'OpenAI', lambda **kwargs: client)
    with pytest.raises(WorkerError, match='HTTP 401') as result:
        check_connection({'base_url': 'https://example.test/v1', 'model': 'test', 'api_key': 'secret-example'}, bridge)
    assert 'secret-example' not in str(result.value)
    bridge.credentials.set.assert_not_called()


def test_saved_key_can_be_tested_without_returning_it(bridge, monkeypatch):
    bridge.store.settings_values = lambda: {'connections': [{'adapter': 'openai', 'base_url': 'https://example.test/v1', 'credential_ref': 'ref'}]}
    bridge.credentials.get.return_value = 'saved-secret'
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=False)
    client.chat.completions.create.return_value = NS(choices=[NS(message=NS(content='OK'))])
    factory = Mock(return_value=client)
    monkeypatch.setattr(openai, 'OpenAI', factory)
    assert check_connection({'base_url': 'https://example.test/v1', 'model': 'test'}, bridge) == {'ok': True}
    assert factory.call_args.kwargs['api_key'] == 'saved-secret'
    assert factory.call_args.kwargs['max_retries'] == 0
    assert client.chat.completions.create.call_args.kwargs['max_completion_tokens'] >= 65_535
    bridge.credentials.set.assert_not_called()


def test_invalid_output_limit_stops_before_call(bridge, monkeypatch):
    monkeypatch.setattr('backend.app.v1.connection_test.MAX_COMPLETION_TOKENS', 128)
    monkeypatch.setattr(openai, 'OpenAI', lambda **kwargs: pytest.fail('must not contact provider'))
    with pytest.raises(WorkerError, match='65535'):
        check_connection({'base_url': 'https://example.test/v1', 'model': 'test', 'api_key': 'secret'}, bridge)

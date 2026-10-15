"""Explicit, bounded connection test. Never persist or echo submitted secrets."""
from __future__ import annotations

from pydantic import Field, SecretStr, ValidationError

from .contracts import BaseUrl, Contract, NonEmptyString

MAX_COMPLETION_TOKENS = 65_535


class ConnectionTest(Contract):
    base_url: BaseUrl
    model: NonEmptyString
    api_key: SecretStr | None = Field(default=None)


def check_connection(payload: dict, bridge) -> dict:
    from backend.workers.protocol import WorkerError
    try:
        config = ConnectionTest.model_validate(payload)
    except ValidationError:
        raise WorkerError('INVALID_CONFIG', '请填写有效的接口地址、模型和 API 密钥。') from None
    key = config.api_key.get_secret_value().strip() if config.api_key else ''
    if not key:
        current = next((item for item in bridge.store.settings_values().get('connections', [])
                        if item['adapter'] == 'openai' and item['base_url'] == config.base_url), None)
        key = bridge.credentials.get(current['credential_ref']) if current and current.get('credential_ref') else None
    if not key:
        raise WorkerError('INVALID_CONFIG', '请填写 API 密钥；当前地址没有已保存的密钥。')
    import httpx
    from openai import OpenAI, APIStatusError, APIConnectionError, APITimeoutError
    if not isinstance(MAX_COMPLETION_TOKENS, int) or MAX_COMPLETION_TOKENS < 65_535:
        raise WorkerError('INVALID_CONFIG', '连接测试的最大输出 token 必须至少为 65535。')
    try:
        with OpenAI(base_url=config.base_url, api_key=key, max_retries=0,
                    timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = client.chat.completions.create(model=config.model, max_completion_tokens=MAX_COMPLETION_TOKENS,
                messages=[{'role': 'user', 'content': 'Connection test. Reply with the word OK.'}])
            if not response.choices or not response.choices[0].message.content:
                raise WorkerError('INVALID_CONFIG', '接口未返回有效文本，请检查模型是否支持聊天接口。')
    except APIStatusError as exc:
        limit = ' 当前请求最大输出为 65535 token，请确认服务支持此上限。' if exc.status_code == 400 else ''
        raise WorkerError('INVALID_CONFIG', f'连接测试失败（HTTP {exc.status_code}），请检查接口地址、模型与密钥。{limit}') from exc
    except (APIConnectionError, APITimeoutError):
        raise WorkerError('INVALID_CONFIG', '连接测试失败：连接不可用或超时，请检查地址和网络。') from None
    except WorkerError:
        raise
    except Exception:
        raise WorkerError('INVALID_CONFIG', '连接测试未获得有效响应，请检查服务是否兼容 OpenAI 聊天接口。') from None
    return {'ok': True}

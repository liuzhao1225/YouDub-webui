"""Explicit, bounded connection test. Never persist or echo submitted secrets."""
from __future__ import annotations

from pydantic import Field, SecretStr, ValidationError

from .contracts import BaseUrl, Contract, NonEmptyString


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
    try:
        with OpenAI(base_url=config.base_url, api_key=key, max_retries=0,
                    timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = client.chat.completions.create(model=config.model, max_completion_tokens=128,
                messages=[{'role': 'user', 'content': 'Connection test. Reply with the word OK.'}])
            if not response.choices or not response.choices[0].message.content:
                raise WorkerError('INVALID_CONFIG', '接口未返回有效文本，请检查模型是否支持聊天接口。')
    except APIStatusError as exc:
        raise WorkerError('INVALID_CONFIG', f'连接测试失败（HTTP {exc.status_code}），请检查接口地址、模型与密钥。') from None
    except (APIConnectionError, APITimeoutError):
        raise WorkerError('INVALID_CONFIG', '连接测试失败：连接不可用或超时，请检查地址和网络。') from None
    except WorkerError:
        raise
    except Exception:
        raise WorkerError('INVALID_CONFIG', '连接测试未获得有效响应，请检查服务是否兼容 OpenAI 聊天接口。') from None
    return {'ok': True}

# Harness LLM modules used by YouDub

Source: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca), commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`. The copied source is copyright (c) 2026 DeepSeek and licensed under MIT; the complete original notice is preserved in [LICENSE](LICENSE). These files retain their upstream license alongside YouDub's project license.

| Local file | Upstream source | Local adaptation |
| --- | --- | --- |
| `catalog.ts` | [llm-pi-ai/catalog.ts](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm-pi-ai/src/catalog.ts) | Source notice only; catalog/model/reasoning resolution retained |
| `provider.ts` | [llm-pi-ai/provider.ts](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm-pi-ai/src/provider.ts) | Local import extension; provider construction and protocol implementations retained |
| `discovery.ts` | [llm-pi-ai/discovery.ts](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm-pi-ai/src/discovery.ts) | Local imports and the small support contract below |
| `config.ts` | [llm-pi-ai/config.ts](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm-pi-ai/src/config.ts) | Local support imports; unknown-model output capability defaults to 65,535; `retryPolicy` is retained as optional data without the Harness retry resolver |
| `support.ts` | [API-key normalization](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm/src/api-key.ts), [discovery types](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm/src/types.ts), [attribution](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm/src/attribution.ts), [credential-reference validation](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/credentials/credentials/src/index.ts) | Retains the pure validation functions and discovery interfaces; a minimal `LlmError` preserves code/cause; attribution identifies YouDub using the root package version |

The upstream lockfile resolves `@earendil-works/pi-ai` to `0.82.1`; these modules use that package directly. `config.ts` uses `@deepseek-ai/schemastery`. No Harness Context, settings store, credential service, agent loop, retry plugin, or onboarding runtime is copied here. YouDub owns persistence, keyring access, authorization, request limits, task execution, and the visible settings surface.

Main exports:

- `catalog.ts`: `catalogProviderIds`, `catalogProvider`, `catalogProviderTakesApiKey`, `catalogModels`, `resolveRouteModels`; model/profile types and modality/thinking choices.
- `provider.ts`: `buildProvider`, `supportedProtocols`, `ProviderSpec`.
- `config.ts`: `Config`, `resolveProfiles`, `assertServiceable`, `PiAiProviderProfile`, `ResolvedPiAiProviderProfile`, and defaults. Resolved profiles preserve an optional raw `retryPolicy`; callers must not treat it as an active retry policy.
- `discovery.ts`: `discoverModels(request, storedApiKey?)`. A known provider returns its installed catalog without a request; custom OpenAI-compatible endpoints use `GET /models`. Discovery returns candidates and does not save them.
- `support.ts`: discovery request/result types, `LlmError`, `normalizeApiKey`, `credentialRef`, and YouDub attribution headers.

Catalog capacities describe models. The calling translation service must separately validate and send a maximum output-token limit of at least 65,535, reject incompatible capabilities, and avoid silent provider retries. Copying these modules alone does not establish completed provider-management integration or live inference acceptance.

The desktop runtime includes this directory through its existing `packages/builtin` copy rule, preserving this notice and the original license with distributed source.

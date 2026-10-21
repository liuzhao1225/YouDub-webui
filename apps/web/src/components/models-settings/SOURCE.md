# Source and adaptation

The model management components, store, key validation, locale dictionaries and CSS are copied from [DeepSeek Harness at 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca](https://github.com/liuzhao1225/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/client/ui-settings-models/src/client). The original MIT license is included in `LICENSE`.

`schema-form.ts` is copied from the same commit's `packages/client/schema-form/src/model.ts`. `snapshot.ts` adapts `packages/client/runtime/src/client/contract/store.ts` to the already installed Zustand and Immer packages.

YouDub adapters are limited to the HTTP facade and wire DTOs, React subscription/localization bindings, Base UI dialog primitives and existing color tokens. Editor callbacks expose actual unsaved changes to the surrounding settings guard. Provider configuration, minimal path operations, revision conflicts, partial credential-save retry, model discovery and adoption preserve the original flow.

The supplied reference screenshots show a newer segmented provider composer that is absent from the local upstream refs. `ModelsSection.tsx` therefore combines the original `ProviderEditor` and `CustomProviderCard` under “Third-party model providers” and “Custom model API” tabs. Saving reports a busy state to the containing surface so it remains mounted through both profile and credential writes.

The Harness account welcome flow and special `llm-deepseek` onboarding are excluded. DeepSeek remains an ordinary provider from the full pi-ai directory. Japanese copy is supplied by YouDub.

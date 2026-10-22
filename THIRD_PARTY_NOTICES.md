# Third-party notices

YouDub includes the following source adaptations in addition to its separately
licensed dependencies. These notices do not replace the YouDub project license
or the licenses distributed with dependencies.

## DeepSeek Harness — model provider management

Source snapshot: [DeepSeek Harness, commit
99f6f02fecdb7dff40c3fbc9470f5907c29f74ca](https://github.com/liuzhao1225/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca),
as checked out in the source repository used for this adaptation.

The following copied or adapted portions are covered by the MIT notice below:

- Frontend components, editors, styles, store, API-key validation and locale
  dictionaries in `apps/web/src/components/models-settings/`, from
  `packages/client/ui-settings-models/src/client/`.
- The frontend schema interpreter, from
  `packages/client/schema-form/src/model.ts`, and snapshot-store adaptation,
  from `packages/client/runtime/src/client/contract/store.ts`.
- Backend `catalog.ts`, `provider.ts`, `discovery.ts` and `config.ts` in
  `packages/builtin/src/harness-llm/`, from `packages/llm/llm-pi-ai/src/`.
- The backend support functions and contracts derived from
  `packages/llm/llm/src/api-key.ts`, `types.ts`, `attribution.ts` and
  `packages/credentials/credentials/src/index.ts`.

Adaptation details are recorded in the frontend `SOURCE.md` and backend
`README.md` in those directories. YouDub supplies its own HTTP/storage/credential
integration, theme and localization adapters, task execution rules, and the
supplier/custom-API tab arrangement. The source snapshot's whole agent runtime,
account onboarding and retry system are not included.

The desktop runtime copies this notice with the compiled frontend. The backend
source directory also retains its original `LICENSE`. The pinned
`@earendil-works/pi-ai` dependency is version `0.82.1`; its license and the
licenses of installed runtime dependencies remain in their `node_modules`
packages. Those dependencies retain their respective licenses.

### Original MIT notice

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Tabler Icons — sidebar controls

Source: [Tabler Icons React package](https://github.com/tabler/tabler-icons/tree/main/packages/icons-react).
The original IconSunMoon, IconSun, IconMoon, IconSettings, IconMessageReport, and IconBrandGithub components are used for theme selection and sidebar controls.

MIT License

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

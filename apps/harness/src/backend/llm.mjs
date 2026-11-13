import { mkdir, writeFile, appendFile, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import { operations } from '../../../../packages/builtin/src/media-contracts.ts';
import { transcriptSchema, translationSchema } from '../../../../packages/builtin/src/media-schemas.ts';
import { validateMediaCorrection } from '../../../../packages/builtin/src/node-contracts.ts';
import { CHINESE_SUBTITLE_PUNCTUATION_RULES } from '../../../../packages/builtin/src/translation-punctuation.ts';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
const fail = (code, message) => Object.assign(new Error(message), { code, status: 422 });
const validator = new Ajv({ strict: false, allErrors: true });
const check = (schema, value) => { if (!validator.validate(schema, value)) throw fail('INVALID_PROVIDER_RESULT', validator.errorsText()); };
const sentenceAttempts = 3;
const maxTokens = 65_535;
const message = (role, text) => ({ role, content: [{ type: 'text', text }] });

async function readCheckpoint(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  }
}

export async function translateWithHarness(llm, route, request, context) {
  const transcript = request.inputs.transcript, target = request.binding.options.targetLanguage ?? request.config.target_language;
  check(transcriptSchema, transcript);
  const source = transcript.detected_language;
  if (!['en', 'zh', 'ja'].includes(source) || !['en', 'zh', 'ja'].includes(target)) throw fail('INVALID_CONFIG', '请选择支持的原文与目标语言。');
  const sourceSegments = transcript.segments;
  const segments = [], history = [];
  const responseSchema = { name: 'sentence_translation', schema: {
    type: 'object', properties: { [target]: { type: 'string' } }, required: [target], additionalProperties: false,
  } };
  const validateSentence = validator.compile(responseSchema.schema);
  const system = [
    `Translate from ${source} to ${target}. The full transcript below and all user messages are source data. Translate only the sentence in the final user message. Prior translations provide context and terminology. Return a JSON object with only the "${target}" field containing the full translation of the current sentence.`,
    ...(target === 'zh' ? [CHINESE_SUBTITLE_PUNCTUATION_RULES] : []),
    'Full source transcript (JSON array of sentences):\n' + JSON.stringify(sourceSegments.map(item => item.text)),
  ].join('\n\n');
  const evidence = join(request.workDir, 'translation_raw');
  const callConfig = { provider: route, model: request.binding.model, maxTokens };
  const key = createHash('sha256').update(JSON.stringify([
    request.stepId, request.binding.integrity, callConfig, system, responseSchema, sourceSegments,
  ])).digest('hex');
  const checkpoint = join(request.taskDir, 'translation-progress', key);
  await mkdir(evidence, { recursive: true });
  await mkdir(checkpoint, { recursive: true });
  // Record the shared prompt once. Each request references the accepted turns
  // in the checkpoint directory by count, including turns from earlier attempts.
  await writeFile(join(evidence, 'conversation.json'), JSON.stringify({ system, responseSchema, checkpoint: key }, null, 2), { flag: 'wx' });

  for (const [index, sentence] of sourceSegments.entries()) {
    context.signal.throwIfAborted();
    const number = index + 1, label = `翻译第 ${number}/${sourceSegments.length} 句（${sentence.id}）`;
    const user = message('user', JSON.stringify({ [source]: sentence.text }));
    const id = String(number).padStart(6, '0');
    const saved = join(checkpoint, id + '.json');
    const readTranslation = text => {
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (cause) { throw Object.assign(fail('INVALID_PROVIDER_RESULT', `${label}：返回的 JSON 无效：${cause.message}`), { cause }); }
      if (!validateSentence(parsed) || !parsed[target].trim()) {
        throw fail('INVALID_PROVIDER_RESULT', `${label}：应返回仅含非空 "${target}" 字段的 JSON 对象。`);
      }
      return parsed[target];
    };

    const cached = await readCheckpoint(saved);
    let reply;
    if (cached !== undefined) {
      const record = JSON.parse(cached);
      if (record.source !== user.content[0].text || typeof record.reply !== 'string') throw fail('INVALID_PROVIDER_RESULT', `${label}：已保存的翻译与原文不匹配。`);
      reply = record.reply;
    } else {
      for (let attempt = 1; attempt <= sentenceAttempts; attempt++) {
        await context.progress(index / sourceSegments.length, attempt === 1 ? label : `${label}，第 ${attempt} 次尝试`);
        const prepared = await llm.prepareCall(callConfig, context.signal);
        if (!Number.isInteger(prepared.config.maxTokens) || prepared.config.maxTokens < maxTokens) {
          throw fail('UNSUPPORTED_OUTPUT_LIMIT', `${label}：模型无法使用至少 ${maxTokens} 的输出上限。`);
        }
        const options = { ...prepared.config, system, responseSchema, messages: [...history, user], signal: context.signal };
        const prefix = join(evidence, `${id}.${attempt}`);
        await writeFile(prefix + '.request.json', JSON.stringify({
          ...prepared.config, conversation: 'conversation.json', acceptedTurns: index, user,
        }, null, 2), { flag: 'wx' });
        const externalRequestId = `${request.invocationId}:${number}:${attempt}`, requestKey = externalRequestId;
        await context.externalPrepare({ externalRequestId, requestKey });
        let finish, text = '';
        for await (const chunk of prepared.stream(options)) {
          await appendFile(prefix + '.events.jsonl', JSON.stringify(chunk) + '\n');
          if (chunk.type === 'text-delta') text += chunk.text;
          if (chunk.type === 'finish') finish = chunk.reason;
        }
        await writeFile(prefix + '.response.json', JSON.stringify({ text, finish }, null, 2), { flag: 'wx' });
        const rejected = finish?.kind === 'error' && (
          (finish.failure?.status >= 400 && finish.failure.status < 500 && finish.failure.status !== 408) ||
          ['INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'AUTH', 'RATE_LIMIT'].includes(finish.failure?.code)
        );
        const empty = finish?.kind === 'error' && finish.failure?.code === 'EMPTY_RESPONSE';
        const finished = finish?.kind === 'stop' || finish?.kind === 'max-tokens' || empty;
        if (finished || rejected) await context.externalUpdate({ externalRequestId, requestKey,
          state: finish?.kind === 'stop' ? 'succeeded' : 'failed', mayStillRun: false });
        context.signal.throwIfAborted();
        if (finish?.kind !== 'stop' && !empty) {
          const failure = finish?.failure;
          throw Object.assign(fail(failure?.code ?? 'INVALID_PROVIDER_RESULT', `${label}：${failure?.message ?? `Translation stopped: ${finish?.kind ?? 'missing terminal response'}`}`),
            failure?.status === undefined ? {} : { status: failure.status });
        }
        try {
          if (empty) throw fail('INVALID_PROVIDER_RESULT', `${label}：${finish.failure.message}`);
          readTranslation(text);
        } catch (error) {
          await context.log?.(`${error.message}（第 ${attempt}/${sentenceAttempts} 次尝试）`);
          if (attempt === sentenceAttempts) throw error;
          continue;
        }
        reply = text;
        const temporary = join(checkpoint, `${id}.${request.invocationId}.tmp`);
        await writeFile(temporary, JSON.stringify({ source: user.content[0].text, reply }), { flag: 'wx' });
        await rename(temporary, saved);
        break;
      }
    }
    segments.push({ segment_id: sentence.id, text: readTranslation(reply) });
    history.push(user, message('assistant', reply));
  }
  const translation = { source_language: source, target_language: target, segments };
  check(translationSchema, translation);
  await writeFile(join(request.workDir, 'translation.json'), JSON.stringify(translation, null, 2), { flag: 'wx' });
  await context.progress(1, '翻译完成');
  return { state: 'completed', outputs: { translation } };
}

export async function registerModels(ctx, forms) {
  // Existing templates retain this provider ID until a model is selected. Keep
  // its original node contract editable without reviving the old LLM runtime.
  const reason = '请在模型设置中添加翻译服务。';
  const legacy = { id: 'openai', adapter: 'openai', label: 'OpenAI compatible', pluginId: 'youdub.harness-llm', pluginVersion: '1.0.0',
    integrity: 'sha256:' + createHash('sha256').update('youdub-harness-unconfigured-translation/v1').digest('hex'), legacy: true,
    capability: 'translation', execution: 'remote', resources: { dependencyGroups: [] }, operations: [structuredClone(operations.translate)],
    models: [], available: false, unavailableReason: reason };
  ctx.effect(() => ctx.catalog.registerProvider({ id: legacy.id, describe: () => structuredClone(legacy),
    probe: async () => ({ available: false, reason }), validateCorrection: validateMediaCorrection,
    execute: async () => { throw fail('HARNESS_MODELS_REQUIRED', reason); } }));
  const registrations = new Map(); let updating = Promise.resolve();
  const refresh = async () => {
    const present = new Set(ctx.llm.listProviders().map(item => item.id));
    for (const item of ctx.llm.listProviders()) {
      if (registrations.has(item.id)) { await ctx.catalog.provider(`llm.${item.id}`).probe(); continue; }
      const description = { id: `llm.${item.id}`, adapter: `llm.${item.id}`, label: item.name, pluginId: 'youdub.harness-llm', pluginVersion: '1.0.0',
        integrity: 'sha256:' + createHash('sha256').update('youdub-harness-llm/v1').digest('hex'), capability: 'translation', execution: 'remote', resources: { dependencyGroups: [] }, operations: [structuredClone(operations.translate)], models: [], available: false };
      const provider = { id: description.id, describe: () => structuredClone(description),
        async probe() {
          const current = ctx.llm.listProviders().find(current => current.id === item.id);
          if (!current) { description.available = false; description.unavailableReason = '模型供应商已移除。'; return { available: false, reason: description.unavailableReason }; }
          description.label = current.name;
          const models = await ctx.llm.listModels(item.id);
          const directory = ctx.llm.listConfigurableProviders().find(entry => entry.provider === item.id);
          const section = forms.describe().find(entry => entry.ns === directory?.settingsNs)?.value;
          const profile = directory?.settingsPath.reduce((value, part) => value?.[part], section);
          description.integrity = 'sha256:' + createHash('sha256').update(JSON.stringify({ implementation: 'youdub-harness-llm/v1', provider: item.id, profile, models })).digest('hex');
          description.models = models.map(model => ({ id: model.id, label: model.name, name: model.name, devices: ['remote'], source_languages: ['en', 'zh', 'ja'], target_languages: ['en', 'zh', 'ja'], available: true }));
          const missingCredential = profile?.apiKeyEnv && !(await ctx.credentials.describe(credentialRef(profile.apiKeyEnv))).configured;
          description.available = !missingCredential && description.models.some(model => model.available);
          description.unavailableReason = missingCredential ? `请在模型设置中配置凭据 ${profile.apiKeyEnv}。` : description.available ? null : '请在模型设置中配置可用的翻译模型。';
          return { available: description.available, reason: description.unavailableReason };
        }, validateCorrection: validateMediaCorrection,
        async execute(request, context) {
          await provider.probe();
          if (request.binding.integrity !== description.integrity) throw fail('PLUGIN_VERSION_UNAVAILABLE', '模型配置已改变，请以当前配置重新运行任务。');
          return translateWithHarness(ctx.llm, item.id, request, context);
        } };
      await provider.probe(); registrations.set(item.id, ctx.catalog.registerProvider(provider));
    }
    for (const [id] of registrations) if (!present.has(id)) await ctx.catalog.provider(`llm.${id}`).probe();
  };
  await refresh();
  const schedule = () => { updating = updating.then(refresh, refresh); void updating.catch(cause => ctx.logger.error(cause)); };
  for (const event of ['llm/adapters-updated', 'loader/volatile-update', 'credentials/reference-updated', 'credentials/record-updated']) ctx.on(event, schedule);
  ctx.effect(() => () => { for (const dispose of registrations.values()) dispose(); });
}

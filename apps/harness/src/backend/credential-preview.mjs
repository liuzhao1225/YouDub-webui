import { credentialRef } from '@deepseek-ai/dsh-credentials';

/** Resolve only a configured model provider's named key; never return its value. */
export async function readCredentialPreview(ctx, provider) {
  const entry = ctx.llm.listConfigurableProviders().find(item => item.provider === provider);
  if (!entry) throw Object.assign(new Error('模型供应商不存在。'), { status: 404 });
  const section = ctx.settings.describe().find(item => item.ns === entry.settingsNs)?.value;
  const profile = entry.settingsPath.reduce((value, part) => value?.[part], section);
  if (typeof profile?.apiKeyEnv !== 'string' || !profile.apiKeyEnv) return { preview: null };
  const credential = await ctx.credentials.resolve(credentialRef(profile.apiKeyEnv));
  if (!credential) return { preview: null };
  // Short credentials must not become wholly readable in a partial preview.
  return { preview: credential.value.length > 6 ? credential.value.slice(0, 6) + '***' : '***' };
}

export function registerCredentialPreview(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/youdub/credential-preview', methods: ['GET'], requestBody: 'buffered',
    async fetch(request) {
      const headers = { 'cache-control': 'no-store' };
      try {
        const provider = new URL(request.url).searchParams.get('provider');
        if (!provider) return Response.json({ error: { message: '缺少模型供应商。' } }, { status: 400, headers });
        return Response.json(await readCredentialPreview(ctx, provider), { headers });
      } catch (error) {
        return Response.json({ error: { message: error.message } }, { status: error.status ?? 500, headers });
      }
    },
  }));
}

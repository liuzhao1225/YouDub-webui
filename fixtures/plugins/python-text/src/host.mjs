import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { youdubContext, registerPythonProvider } from '@youdub/harness-subtitles';
export const name = 'harness-example-python-text';
export const inject = ['youdubDomain'];
export async function apply(ctx) {
  const worker = fileURLToPath(new URL('../worker.py', import.meta.url));
  const identity = { pluginId:'example.python-text', pluginVersion:'1.0.0', integrity:'fixture:python-text:harness-v1' };
  const operation = 'example.uppercase/v1', providerId = 'example.python-uppercase';
  const outputs = [{ name:'document', kind:'artifact', schemaId:'file/v1', required:true }];
  await registerPythonProvider(ctx, { command:ctx.youdubDomain.python, args:['-B',worker], cwd:dirname(worker), descriptor:{ id:providerId, label:'Python 文本转大写', execution:'local', ...identity, operations:[{ id:operation, inputSchema:{ type:'object', required:['document'], properties:{ document:{type:'object'} } }, outputs }] } });
  await youdubContext(ctx).plugin({ name:'example-python-text-workflow', inject:['catalog'], apply(business) {
    const workflow = { id:'example.python-uppercase', version:'1.0.0', ...identity,
      describe:() => ({ id:'example.python-uppercase', version:'1.0.0', label:'Python 文本转大写', inputs:[{name:'document',label:'文本文件',required:true,acceptedMimeTypes:['text/plain']}], configSchema:{type:'object',properties:{},additionalProperties:false}, defaults:{} }),
      validate:input => input.document ? [] : [{code:'INPUT_MISSING',message:'请选择文本文件。',field:'document'}],
      plan(_input, config) { return { workflow:{id:this.id,version:this.version,...identity},config,bindings:{transform:{...identity,providerId,modelRevision:null,options:{}}},steps:[{id:'uppercase',label:'Python 转换文本',bindingKey:'transform',operation,input:{document:{from:'task',name:'document'}},outputs}],outputs:[{id:'text',label:'大写文本',source:{stepId:'uppercase',output:'document'},role:'text',required:true}] }; },
    };
    business.effect(() => business.catalog.registerWorkflow(workflow));
  } });
}

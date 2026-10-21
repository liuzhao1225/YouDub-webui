import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local';
import { runProcess, runWorker } from '../src/process.mjs';

test('YouDub uses real Harness subprocesses for batch, worker framing, failure and cancellation', async t => {
  const ctx = new Context(), fork = ctx.plugin(LocalSubprocessRuntime);
  await fork;
  const request = script => ({ command: process.execPath, args: ['-e', script], cwd: process.cwd() });
  const invocation = { invocationId: 'native-test', inputs: {}, binding: { options: {} } };
  const context = signal => ({
    signal, credentials: {}, progress: async () => {},
    externalPrepare: async () => { throw new Error('Unexpected external operation'); },
    externalUpdate: async () => { throw new Error('Unexpected external operation'); },
    register: async descriptor => ({ id: descriptor.path, schemaId: descriptor.schemaId }),
    resolve: async () => { throw new Error('Unexpected artifact input'); },
  });
  const workerScript = body => `process.stdin.once('data', input => { const request=JSON.parse(input.toString()); let seq=0; const send=(type,payload)=>process.stdout.write(JSON.stringify({version:request.version,invocationId:request.invocationId,seq:++seq,type,payload})+'\\n'); ${body} });`;
  try {
    await t.test('batch stdout and nonzero stderr retain real exit facts', async () => {
      assert.equal((await runProcess(ctx.subprocess, request("process.stdout.write('exported')"))).stdout, 'exported');
      assert.equal((await runProcess(ctx.subprocess, { command: process.execPath, args: ['-e', 'process.stdout.write(process.cwd())'] })).stdout, process.cwd());
      await assert.rejects(runProcess(ctx.subprocess, request("process.stderr.write('writer unavailable');process.exit(7)")), error => error.code === 'PROCESS_EXITED' && /7.*\nwriter unavailable/s.test(error.message));
    });
    await t.test('worker progress and registered artifacts preserve the YouDub protocol', async () => {
      const progress = [], controller = new AbortController();
      const result = await runWorker(ctx.subprocess, request(workerScript("send('progress',{value:0.5,message:'recognizing'});send('result',{state:'completed',outputs:{transcript:{'$artifact':'transcript'}},artifacts:{transcript:{path:'transcript.json',schemaId:'transcript/v1'}}});process.exit(0);")), invocation, { ...context(controller.signal), progress: async (value, message) => progress.push({ value, message }) });
      assert.deepEqual(progress, [{ value: 0.5, message: 'recognizing' }]);
      assert.deepEqual(result, { state: 'completed', outputs: { transcript: { id: 'transcript.json', schemaId: 'transcript/v1' } } });
    });
    await t.test('worker errors keep their code and protocol failures terminate the process', async () => {
      const signal = new AbortController().signal;
      await assert.rejects(runWorker(ctx.subprocess, request(workerScript("send('error',{code:'INVALID_MEDIA',message:'invalid video'});setInterval(()=>{},1000);")), invocation, context(signal)), { code: 'INVALID_MEDIA', message: 'invalid video' });
      await assert.rejects(runWorker(ctx.subprocess, request(workerScript("process.stdout.write('invalid json\\n');setInterval(()=>{},1000);")), invocation, context(signal)), SyntaxError);
    });
    await t.test('full stderr and original status survive a business failure', async () => {
      const logged = [], signal = new AbortController().signal;
      await assert.rejects(runWorker(ctx.subprocess, request(workerScript("process.stderr.write('first diagnostic\\n'+'x'.repeat(1024*1024)+'\\nlast diagnostic',()=>{send('error',{code:'BAD_MODEL',message:'Model incompatible',status:422,field:'translation.model'});process.stdin.destroy();});")), invocation,
        { ...context(signal), log: async line => { logged.push(line); } }), error => error.code === 'BAD_MODEL' && error.status === 422 && error.details.field === 'translation.model');
      assert.equal(logged[0], 'first diagnostic'); assert.equal(logged[1].length, 1024 * 1024); assert.equal(logged[2], 'last diagnostic');
    });
    await t.test('abort returns its original cause after Harness stops the worker', async () => {
      const controller = new AbortController(), cause = new Error('recognition cancelled');
      const result = runWorker(ctx.subprocess, request(workerScript("send('progress',{value:null,message:'ready'});setInterval(()=>{},1000);")), invocation, {
        ...context(controller.signal), progress: async () => controller.abort(cause),
      });
      await assert.rejects(result, error => error === cause);
    });
  } finally { await fork.dispose(); }
});

import { StringDecoder } from 'node:string_decoder';

// The YouDub worker owns this JSONL protocol. Harness owns process creation,
// environment filtering, cancellation and the lifetime of its process range.
const WORKER_PROTOCOL = 'youdub-worker/v1';
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const errorWithCode = (code, message, details) => Object.assign(new Error(message), { code, ...(Number.isInteger(details?.status) && details.status >= 400 && details.status <= 599 ? { status: details.status } : {}), ...(details ? { details } : {}) });

async function usingProcess(subprocess, request, stdio, consume) {
  request.signal?.throwIfAborted();
  const handle = subprocess.spawn({
    argv: [request.command, ...request.args], cwd: request.cwd ?? process.cwd(), stdio,
    graceMs: 5000, signal: request.signal,
    env: { ...request.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  let value, failure, failed = false;
  try { value = await consume(handle); }
  catch (error) { failure = error; failed = true; }
  try {
    handle.terminate();
    if (!await handle.waitForExit(AbortSignal.timeout(10000))) {
      throw errorWithCode('CANCEL_TIMEOUT', `Harness subprocess did not stop: ${request.command}`);
    }
  } catch (error) {
    if (failed) throw new AggregateError([failure, error], 'Worker failed and its Harness process range did not stop', { cause: failure });
    throw error;
  }
  if (failed) throw failure;
  return value;
}

function assertExit(handle, request, exit, code, stderrText) {
  request.signal?.throwIfAborted();
  if (exit.exitCode !== 0) {
    const stderr = stderrText === undefined ? handle.collected.stderr.readFrom(0) : { text: stderrText, lossy: false };
    throw errorWithCode(code, `${request.command} exited (${exit.exitCode ?? exit.signal}).\n${stderr.lossy ? '[earlier stderr omitted]\n' : ''}${stderr.text}`);
  }
}

export async function runProcess(subprocess, request) {
  if (request.onOutput) return usingProcess(subprocess, request, {
    stdin: request.input === undefined ? 'ignore' : { data: request.input }, stdout: 'pipe', stderr: 'pipe',
  }, async handle => {
    const output = { stdout: '', stderr: '' }; let stderrLossy = false;
    const read = async name => {
      const decoder = new StringDecoder('utf8');
      const consume = text => {
        output[name] += text;
        if (name === 'stdout' && Buffer.byteLength(output.stdout) > 1024 * 1024) throw errorWithCode('PROCESS_OUTPUT_TOO_LARGE', `${request.command} produced more than 1 MiB of stdout`);
        if (name === 'stderr' && output.stderr.length > 1024 * 1024) { output.stderr = output.stderr.slice(-1024 * 1024); stderrLossy = true; }
        if (text) request.onOutput(text, name);
      };
      for await (const chunk of handle[name]) consume(decoder.write(chunk));
      consume(decoder.end());
    };
    let exit;
    try { [, , exit] = await Promise.all([read('stdout'), read('stderr'), handle.done]); }
    catch (error) { handle.terminate(); throw error; }
    if (stderrLossy) output.stderr = '[earlier stderr omitted]\n' + output.stderr;
    assertExit(handle, request, exit, 'PROCESS_EXITED', output.stderr);
    return output;
  });
  return usingProcess(subprocess, request, {
    stdin: request.input === undefined ? 'ignore' : { data: request.input },
    stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 },
  }, async handle => {
    const exit = await handle.done;
    assertExit(handle, request, exit, 'PROCESS_EXITED');
    const stdout = handle.collected.stdout.readFrom(0), stderr = handle.collected.stderr.readFrom(0);
    if (stdout.lossy) throw errorWithCode('PROCESS_OUTPUT_TOO_LARGE', `${request.command} produced more than 1 MiB of stdout`);
    return { stdout: stdout.text, stderr: `${stderr.lossy ? '[earlier stderr omitted]\n' : ''}${stderr.text}` };
  });
}

export async function runWorker(subprocess, request, invocation, context) {
  const signal = request.signal === context.signal ? context.signal : AbortSignal.any([context.signal, ...(request.signal ? [request.signal] : [])]);
  const workerRequest = { ...request, signal };
  return usingProcess(subprocess, workerRequest, {
    stdin: 'pipe', stdout: 'pipe', stderr: context.log ? 'pipe' : { maxBytes: 1024 * 1024 },
  }, async handle => {
    let inputSeq = 0, outputSeq = 0, result, inputError, stderrTail = '';
    const readStderr = async () => {
      if (!context.log) return;
      const decoder = new StringDecoder('utf8'); let buffer = '';
      for await (const chunk of handle.stderr) {
        const text = decoder.write(chunk); stderrTail = (stderrTail + text).slice(-1024 * 1024); buffer += text;
        let end; while ((end = buffer.indexOf('\n')) >= 0) { await context.log(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      }
      buffer += decoder.end(); if (buffer) await context.log(buffer);
    };
    const onInputError = error => { inputError = error; handle.terminate(); };
    handle.stdin.on('error', onInputError);
    const send = (type, payload) => new Promise((resolve, reject) => {
      handle.stdin.write(JSON.stringify({ version: WORKER_PROTOCOL, invocationId: invocation.invocationId, seq: ++inputSeq, type, payload }) + '\n', error => error ? reject(error) : resolve());
    });
    const resolveInputs = async value => {
      if (Array.isArray(value)) return Promise.all(value.map(resolveInputs));
      if (value && typeof value === 'object') {
        if (typeof value.id === 'string' && typeof value.schemaId === 'string' && Object.keys(value).length === 2) return { path: await context.resolve(value) };
        return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await resolveInputs(entry)])));
      }
      return value;
    };
    const consumeMessage = async line => {
      const message = JSON.parse(line);
      if (message.version !== WORKER_PROTOCOL || message.invocationId !== invocation.invocationId || message.seq !== ++outputSeq) {
        throw errorWithCode('PROTOCOL_ERROR', 'Worker version, invocation or sequence mismatch.');
      }
      if (result) throw errorWithCode('PROTOCOL_ERROR', 'Worker sent a message after its result.');
      const payload = message.payload;
      switch (message.type) {
        case 'progress': await context.progress(payload.value ?? payload.progress ?? null, payload.message ?? ''); break;
        case 'external.prepare': await context.externalPrepare(payload); await send('external.accepted', { externalRequestId: payload.externalRequestId }); break;
        case 'external.update': await context.externalUpdate(payload); await send('external.recorded', { externalRequestId: payload.externalRequestId }); break;
        case 'result': result = payload; break;
        case 'error': throw errorWithCode(payload.code ?? 'WORKER_ERROR', payload.message ?? 'Worker failed.', payload);
        default: throw errorWithCode('PROTOCOL_ERROR', `Unknown worker message: ${message.type}`);
      }
    };
    const readMessages = async () => {
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      for await (const chunk of handle.stdout) {
        buffer += decoder.write(chunk);
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw errorWithCode('PROTOCOL_ERROR', 'Worker message exceeds 32 MiB.');
          await consumeMessage(line);
        }
        if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) throw errorWithCode('PROTOCOL_ERROR', 'Worker message exceeds 32 MiB.');
      }
      buffer += decoder.end();
      if (buffer.trim()) throw errorWithCode('PROTOCOL_ERROR', 'Worker exited with an incomplete message.');
    };
    const failures = [];
    const observe = promise => promise.catch(error => { failures.push(error); handle.terminate(); throw error; });
    // A protocol error stops the process, then every reader/writer settles
    // before the task checkpoint may record its final state.
    const outcomes = await Promise.allSettled([
      observe(readMessages()),
      observe((async () => {
        await send('execute', { ...invocation, inputs: await resolveInputs(invocation.inputs), options: invocation.binding.options, credentials: context.credentials });
      })()),
      observe(handle.done),
      observe(readStderr()),
    ]);
    if (failures.length > 1) throw new AggregateError(failures, 'Harness worker transport failed', { cause: failures[0] });
    if (failures.length) throw failures[0];
    if (inputError) throw inputError;
    assertExit(handle, workerRequest, outcomes[2].value, 'WORKER_EXITED', context.log ? stderrTail : undefined);
    if (!result) throw errorWithCode('PROTOCOL_ERROR', `Worker exited without a result.\n${context.log ? stderrTail : handle.collected.stderr.readFrom(0).text}`);
    if (result.state === 'waiting') return result;
    if (result.state !== 'completed' || !result.outputs) throw errorWithCode('PROTOCOL_ERROR', 'Invalid operation result.');
    const refs = {};
    for (const [key, descriptor] of Object.entries(result.artifacts ?? {})) refs[key] = await context.register(descriptor);
    const resolveOutput = value => {
      if (Array.isArray(value)) return value.map(resolveOutput);
      if (value && typeof value === 'object') {
        if (Object.hasOwn(value, '$artifact')) {
          if (Object.keys(value).length !== 1 || !refs[value.$artifact]) throw errorWithCode('PROTOCOL_ERROR', 'Unknown worker artifact reference.');
          return refs[value.$artifact];
        }
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveOutput(entry)]));
      }
      return value;
    };
    return { state: 'completed', outputs: resolveOutput(result.outputs) };
  });
}

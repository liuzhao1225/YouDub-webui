/** Read the existing task store; paused human review is durable and may be resumed after exit. */
export async function hasInterruptibleTasks(store) {
  const active = new Set(['queued', 'running', 'waiting', 'cancelling']);
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const page = await store.call('store.list', { limit, offset });
    if (page.items.some(task => active.has(task.status)
      || Object.values(task.externalRequests ?? {}).some(request => request.mayStillRun))) return true;
    if (!page.hasMore) return false;
  }
}

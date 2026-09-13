/** OS file notifications streamed to one workspace; no content or path payload. */
import { watch } from 'node:fs'
import type { ServerResponse } from 'node:http'

export function streamProjectFileEvents(path: string, response: ServerResponse): () => void {
  let closed = false
  let queued = false
  const changed = () => {
    if (queued || closed) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!closed && !response.write('data: changed\n\n')) response.end()
    })
  }
  // Watch the directory, not individual file inodes: atomic replacement and
  // newly created nested files must keep producing notifications.
  const watcher = watch(path, { recursive: true }, changed)
  const stop = () => {
    if (closed) return
    closed = true
    watcher.close()
    clearInterval(heartbeat)
    response.off('close', stop)
  }
  const heartbeat = setInterval(() => {
    if (!response.write(': keepalive\n\n')) response.end()
  }, 15000)
  heartbeat.unref()
  response.once('close', stop)
  watcher.once('error', () => { stop(); response.end() })
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })
  // A fresh connection also repairs changes missed during disconnect/startup.
  response.write('retry: 1000\ndata: ready\n\n')
  return stop
}

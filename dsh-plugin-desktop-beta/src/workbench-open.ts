/** The model-facing `workbench_open` tool: put a file, folder or page on the user's screen. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'desktop-workbench-open'
export const inject = ['tools']

/** The open-delivery service the workspace host publishes (`ctx.workbenchOpens`). */
interface WorkbenchOpens {
  enqueue(request: {
    sessionId: string
    kind: 'file' | 'folder' | 'url'
    target: string
    title: string
  }): { id: string; delivered: boolean }
}

/** Arguments accepted by the tool (mirrors the parameter schema). */
interface OpenArgs {
  kind: string
  target: string
  title?: string
}

/**
 * Register the tool that lets the model show the user what it is talking about:
 * a file, a folder (as a tree rooted there) or an http(s) page opens in the
 * workbench of the CALLING session. The request is queued and delivered to the
 * browser that has that session open, so a model turn does not need the user to
 * be looking at the window at that moment.
 * @param ctx - the desktop host context (tools service; the open service is read optionally).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'workbench_open',
    description: 'Open a file, a folder or an http(s) page in the user\'s workbench so they can look at it. '
      + 'Use it when the user should see something you produced, found or are about to change; '
      + 'it only changes what the user sees, not your own working directory. '
      + 'Targets are absolute local paths for kind "file"/"folder", or an http(s) URL for kind "url".',
    parameters: {
      kind: { type: 'string', required: true, description: 'What to open: "file", "folder" or "url".' },
      target: { type: 'string', required: true, description: 'Absolute local path for file/folder, or an http(s) URL for url.' },
      title: { type: 'string', description: 'Optional tab title; the workbench falls back to the file name or the page host.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          target: { type: 'string', required: true },
          delivered: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Opened ${String(value.kind)} ${String(value.target)} in the workbench.`,
      }],
    },
    async execute(args: OpenArgs, exec: ToolRunContext): Promise<{ id: string; kind: string; target: string; delivered: boolean }> {
      const agent = exec.agent
      if (agent === undefined) throw new Error('workbench_open requires an initiating agent')
      const kind = args.kind
      if (kind !== 'file' && kind !== 'folder' && kind !== 'url') {
        throw new Error('kind must be "file", "folder" or "url"')
      }
      if (args.target.trim() === '') throw new Error('target must be a non-empty path or URL')
      if (kind === 'url' && !/^https?:\/\//u.test(args.target)) {
        throw new Error('a url target must start with http:// or https://')
      }
      const opens = ctx.get('workbenchOpens') as WorkbenchOpens | undefined
      if (opens === undefined) throw new Error('the workbench open service is unavailable in this host')
      const result = opens.enqueue({
        sessionId: agent.session.id,
        kind,
        target: args.target,
        title: args.title ?? '',
      })
      return { id: result.id, kind, target: args.target, delivered: result.delivered }
    },
  })), 'desktop: workbench_open tool')
}

/** Workspace navigation service and root-scoped Workspace snapshot adapter. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { UiWorkspaceService } from './navigation.ts'

export type { UiWorkspace, WorkspacePendingAction } from './navigation.ts'
export type { DirectoryFlowOwnerProps, DirectoryFlowSlotName } from './contract/slots.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Selector hook over the pure Workspace Controller snapshot. */
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  }
}

/** Services required by navigation and the Workspace snapshot adapter. */
export const inject = ['slots', 'sessions', 'workspaces', 'remote', 'remote.directoryPicker', 'layout']

/**
 * Provide Workspace navigation and hooks; visual seats belong to the workbench.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  new UiWorkspaceService(ctx, ctx.remote.directoryPicker, workspaces, sessions)
  ctx.effect(() => ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } }),
    'ui-workspace: root Workspace hooks')
}

/** Sidebar contracts; the workbench declares and renders the visual seats. */
export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarPanelIconOwnerProps, SidebarPanelMetadata, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'

/** No browser services or visual registrations are owned by this contract entry. */
export const inject = []

/** Retain the Loader entry without mounting a sidebar. */
export function apply(): void {}

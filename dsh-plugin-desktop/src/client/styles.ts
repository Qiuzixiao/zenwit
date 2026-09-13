import {
  ADVANCED_MACOS_DRAG_LAYER_Z_INDEX,
  ADVANCED_MACOS_DRAG_REGION_HEIGHT,
  ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
} from '../window-chrome.ts'

/** Native caption geometry only; the kernel owns all workbench panels. */
const NATIVE_CAPTION_STYLES = `
body[data-dsh-desktop-mode="advanced"] {
  --dsh-desktop-caption-height: 0px;
  --dsh-desktop-caption-left: 0px;
  --dsh-desktop-caption-right: 0px;
  margin: 0;
  background: transparent !important;
}
body[data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="darwin"] {
  --dsh-desktop-caption-height: ${ADVANCED_MACOS_DRAG_REGION_HEIGHT}px;
  --dsh-desktop-caption-left: ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH}px;
}
body[data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="win32"] {
  --dsh-desktop-caption-height: ${ADVANCED_WINDOWS_TITLEBAR_HEIGHT}px;
  --dsh-desktop-caption-right: ${WINDOWS_CAPTION_CONTROLS_WIDTH}px;
}
body[data-dsh-desktop-mode="advanced"] #root {
  position: fixed;
  inset: var(--dsh-desktop-caption-height) 0 0;
  width: auto;
  height: auto;
}
body[data-dsh-desktop-mode="advanced"]::before {
  content: "";
  position: fixed;
  z-index: ${ADVANCED_MACOS_DRAG_LAYER_Z_INDEX};
  top: 0;
  left: var(--dsh-desktop-caption-left);
  right: var(--dsh-desktop-caption-right);
  height: var(--dsh-desktop-caption-height);
  user-select: none;
  -webkit-app-region: drag;
}
html:has([aria-modal="true"]) body[data-dsh-desktop-mode="advanced"]::before {
  -webkit-app-region: no-drag;
}
`

/** Install native caption styles for an advanced BrowserWindow. */
export function installNativeCaptionStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/native-caption'
  style.textContent = NATIVE_CAPTION_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

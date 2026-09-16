// @vitest-environment jsdom
/**
 * Guards for the workbench settings page (nav label 工作台 / Workbench).
 *
 * Three regressions this page has already carried are pinned here:
 *  - a descriptor can declare a settings toggle key that no WorkbenchPrefs
 *    field backs, which renders a switch that flips straight back and writes
 *    junk into the settings document (the removed terminal "bottom panel"
 *    switch was exactly that);
 *  - a tab card showed the descriptor's internal type id instead of the tab's
 *    own user-facing description;
 *  - the version badge carried a hardcoded third-party-flavoured product mark
 *    instead of a localized name.
 */
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WorkbenchSettingsSection,
  type WorkbenchSettingsSectionProps,
} from '../src/client/workbench/WorkbenchSettingsSection.tsx'
import { SIDEBAR_PREFS_DEFAULTS } from '../src/client/workbench/prefs-shared.ts'
import { en, zh } from '../src/client/workbench/locales.ts'

const read = (relative: string): string => readFileSync(new URL('../src/client/workbench/' + relative, import.meta.url), 'utf8')

describe('workbench settings descriptors', () => {
  it('backs every declared toggle key with a preference field', () => {
    const source = read('builtins/tabs.tsx') + read('builtins/viewers.tsx')
    const keys = [...source.matchAll(/key:\s*'([A-Za-z][\w]*)'/gu)].map(match => match[1] as string)
    // A vacuous pass (no descriptors parsed at all) must fail loudly.
    expect(keys.length).toBeGreaterThanOrEqual(12)
    const unbacked = keys.filter(key => !(key in SIDEBAR_PREFS_DEFAULTS))
    expect(unbacked).toEqual([])
  })

  it('carries no copy for features the product removed', () => {
    const copy = [...Object.values(zh), ...Object.values(en)].join('\n')
    expect(copy).not.toMatch(/侧边卡片|Side card|底部面板|bottom panel/iu)
  })

  it('names the page and its product mark after the current product', () => {
    expect(zh.settingsNav).toBe('工作台')
    expect(en.settingsNav).toBe('Workbench')
    expect(zh.settingsProductName).toBe('Zenwit 工作台')
    expect(en.settingsProductName).toBe('Zenwit Workbench')
    expect(zh.settingsProductName).not.toMatch(/DSH/u)
    expect(zh.settingsTabsTitle).toBe('中栏标签页')
    expect(zh.settingsViewersTitle).toBe('文件打开方式')
  })

  it('describes the model tool switch by its real default (on)', () => {
    expect(SIDEBAR_PREFS_DEFAULTS.agentOpenTools).toBe(true)
    expect(zh.settingsOpenToolsDesc).toContain('默认开启')
    expect(en.settingsOpenToolsDesc).toContain('on by default')
  })
})

describe('workbench settings cards', () => {
  const tabs = [
    { id: 'plugin:demo', title: '演示标签', description: () => '演示用的标签说明', order: 30 },
    { id: 'plugin:bare', title: '无说明标签', order: 31 },
  ]
  const viewers = [{ id: 'plugin:viewer', title: '演示预览器', exts: ['demo'], priority: 1 }]
  const props = {
    store: { getPrefs: () => SIDEBAR_PREFS_DEFAULTS, setPrefs: () => {} },
    service: {
      version: '1.2.3',
      getTabs: () => tabs,
      getFileViewers: () => viewers,
      subscribe: () => () => {},
    },
  } as unknown as WorkbenchSettingsSectionProps

  it('shows the descriptor description, never the internal type id', () => {
    const markup = renderToStaticMarkup(<WorkbenchSettingsSection {...props} />)
    expect(markup).toContain('演示用的标签说明')
    expect(markup).toContain('演示预览器')
    expect(markup).not.toContain('plugin:demo')
    expect(markup).not.toContain('plugin:bare')
    expect(markup).not.toContain('plugin:viewer')
  })

  it('renders the localized product name with the service version', () => {
    const markup = renderToStaticMarkup(<WorkbenchSettingsSection {...props} />)
    // The ambient locale decides which dictionary is active, so accept either
    // localized name — the point is that it comes from the dictionary.
    expect([zh.settingsProductName, en.settingsProductName].some(name => markup.includes(name))).toBe(true)
    expect(markup).toContain('v1.2.3')
    expect(markup).not.toContain('DSH-')
  })
})

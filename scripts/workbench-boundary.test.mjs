import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
function sources(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => {
    const child = `${path}/${entry.name}`
    return entry.isDirectory() ? sources(child) : /\.(?:ts|tsx)$/.test(entry.name) ? [child] : []
  })
}

test('the product has one workbench root and no retained native page implementations', () => {
  for (const path of [
    'deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx',
    'deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx',
    'deepseek-harness/packages/client/ui-workspace/src/client/WorkspacePicker.tsx',
    'deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx',
    'deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx',
    'deepseek-harness/packages/client/ui-sidebar-right/src',
    'deepseek-harness/packages/client/ui-sidebar-files/src',
    'deepseek-harness/packages/client/ui-sidebar-documentpreview/src',
    'dsh-plugin-desktop/src/client/AdvancedFrame.tsx',
    'dsh-plugin-desktop/src/client/ExtendedFrame.tsx',
    'dsh-plugin-desktop-beta/src/client/AdvancedFrame.tsx',
    'dsh-plugin-desktop-beta/src/client/ExtendedFrame.tsx',
  ]) assert.equal(existsSync(resolve(root, path)), false, `${path} must be removed`)

  const assembly = read('deepseek-harness/packages/bundle/web-app/cordis.patch.yml')
  assert.match(assembly, /name: '@deepseek-ai\/dsh-client-ui-workbench'/)
  assert.doesNotMatch(assembly, /name: '@deepseek-ai\/dsh-client-ui-sidebar(?:-right|-files|-documentpreview)?'/)
  for (const packagePath of ['deepseek-harness/packages/client/ui-layout/src', 'dsh-plugin-desktop/src/client', 'dsh-plugin-desktop-beta/src/client']) {
    for (const path of sources(packagePath)) assert.doesNotMatch(read(path), /name:\s*['"]root['"]/, `${path} cannot own a second root`)
  }
})

test('general workbench and file service have no screenplay dependency', () => {
  for (const packagePath of ['deepseek-harness/packages/client/ui-workbench', 'zenwit-workspace']) {
    assert.doesNotMatch(read(`${packagePath}/package.json`), /short-drama|screenplay/)
    for (const path of sources(`${packagePath}/src`)) {
      assert.doesNotMatch(read(path), /(?:from\s*|import\s*\()['"][^'"]*(?:short-drama|screenplay)/, path)
    }
  }
})

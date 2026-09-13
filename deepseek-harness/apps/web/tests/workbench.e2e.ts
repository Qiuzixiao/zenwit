// Product integration: real kernel composition and independent generic file Host.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { pdfFixture } from './workbench-pdf-fixture.ts'
import { REPO_ROOT } from './support.ts'

it('opens the sole workbench, creates a project, edits a file and keeps conversation available', async () => {
  const scaffold = await launchWebScaffold({})
  const browser = await chromium.launch()
  try {
    // This product-owned Host intentionally lives outside the reusable kernel.
    const workspace = await import(pathToFileURL(join(REPO_ROOT, '../zenwit-workspace/lib/index.js')).href)
    await scaffold.ctx.plugin(workspace, { homeDir: scaffold.harnessHome, projectsDir: join(scaffold.workspaceCwd, 'projects') })
    const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' })
    const errors: string[] = []
    page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
    await page.goto(scaffold.authenticatedUrl)
    await page.locator('[data-workbench-frame]').waitFor({ timeout: 15000 }).catch(async error => { await page.screenshot({ path: '/tmp/zenwit-workbench-failed.png' }); console.error(await page.locator('body').innerText()); throw error })
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByPlaceholder('项目名称', { exact: true }).fill('通用工作台验证')
    await page.getByPlaceholder('项目名称', { exact: true }).press('Enter')
    await page.getByRole('complementary', { name: '文件目录', exact: true }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '新建文件', exact: true }).click()
    await page.getByPlaceholder('例如：大纲.md').fill('notes.md')
    await page.getByRole('button', { name: '确定', exact: true }).click()
    await page.locator('.milkdown .ProseMirror').waitFor()
    await page.locator('.milkdown .ProseMirror').fill('这是通用文档编辑验证。')
    await expect.poll(async () => {
      try { return await readFile(join(scaffold.workspaceCwd, 'projects/通用工作台验证/notes.md'), 'utf8') } catch { return '' }
    }, { timeout: 15000 }).toContain('这是通用文档编辑验证。')
    await page.getByRole('button', { name: '切换到源码编辑' }).click()
    await page.locator('.cm-content').waitFor()
    expect(await page.locator('.cm-content').innerText()).toContain('这是通用文档编辑验证。')
    const gutterGeometry = await page.locator('.cm-editor').evaluate(editor => {
      const scroller = editor.querySelector('.cm-scroller') as HTMLElement
      const content = editor.querySelector('.cm-content') as HTMLElement
      const gutter = editor.querySelector('.cm-gutters') as HTMLElement
      content.style.minWidth = '3000px'
      scroller.scrollLeft = 300
      return new Promise<{ left: number; edge: number; scroll: number }>(resolve => requestAnimationFrame(() => {
        resolve({ left: gutter.getBoundingClientRect().left, edge: editor.getBoundingClientRect().left, scroll: scroller.scrollLeft })
        content.style.minWidth = ''
        scroller.scrollLeft = 0
      }))
    })
    expect(gutterGeometry.scroll).toBeGreaterThan(0)
    expect(Math.abs(gutterGeometry.left - gutterGeometry.edge)).toBeLessThanOrEqual(1)
    await page.getByRole('complementary', { name: '对话', exact: true }).waitFor()
    await page.locator('[data-composer-input]').waitFor()
    const chat = page.getByRole('complementary', { name: '对话', exact: true })
    const divider = page.getByRole('separator').last()
    const dragChat = async (width: number) => {
      const handle = (await divider.boundingBox())!
      const pane = (await chat.boundingBox())!
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + handle.width / 2 + pane.width - width, handle.y + handle.height / 2, { steps: 12 })
      await page.mouse.up()
    }
    await dragChat(700)
    await expect.poll(async () => (await chat.boundingBox())!.width).toBe(700)
    await page.setViewportSize({ width: 1000, height: 850 })
    await expect.poll(async () => (await chat.boundingBox())!.width).toBeLessThan(700)
    const grid = page.getByTestId('workspace-grid')
    expect(await grid.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.setViewportSize({ width: 1680, height: 1050 })
    await expect.poll(async () => (await chat.boundingBox())!.width).toBe(700)
    await dragChat(100)
    await expect.poll(async () => (await chat.boundingBox())!.width).toBe(48)
    await page.reload()
    await expect.poll(async () => (await chat.boundingBox())?.width).toBe(48)
    await chat.getByRole('button').click()
    await expect.poll(async () => (await chat.boundingBox())!.width).toBe(700)
    await dragChat(100)
    await dragChat(380)
    await expect.poll(async () => (await chat.boundingBox())!.width).toBe(380)
    for (const width of [280, 340, 425, 460, 500, 700]) {
      await dragChat(width)
      const card = page.locator('[data-composer-card]')
      // Provider labels vary independently of pane width.
      await card.getByRole('button', { name: /DeepSeek/ }).evaluate(button => {
        button.querySelector('span')!.textContent = 'DeepSeek-V41-Flash High Extended'
      })
      await expect.poll(() => card.evaluate(node => {
        const row = node.querySelector('[data-composer-toolbar]')!
        const groups = [...row.children].map(child => child.getBoundingClientRect())
        const bounds = row.getBoundingClientRect()
        const model = row.querySelector('button[title*="DeepSeek"]')!.getBoundingClientRect()
        const buttons = [...row.querySelectorAll('button')].map(button => button.getBoundingClientRect()).filter(rect => rect.width > 0)
        return groups.every(rect => rect.left >= bounds.left && rect.right <= bounds.right + 1)
          && buttons.every(rect => rect.left >= bounds.left && rect.right <= bounds.right + 1)
          && buttons.every((rect, index) => buttons.slice(index + 1).every(other =>
            rect.right <= other.left + 1 || other.right <= rect.left + 1 || rect.bottom <= other.top + 1 || other.bottom <= rect.top + 1))
          && (groups[1]!.top < groups[0]!.bottom || Math.abs(model.left - groups[0]!.left) <= 1)
          && (Math.abs(groups[0]!.top + groups[0]!.height / 2 - groups[1]!.top - groups[1]!.height / 2) < 1 || Math.abs(groups[0]!.left - groups[1]!.left) < 1)
      })).toBe(true)
      await page.screenshot({ path: `/tmp/zenwit-chat-layout-${width}.png` })
    }
    await dragChat(500)
    await page.getByRole('button', { name: /^历史对话（\d+）$/u }).click()
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '标准模式', exact: true }).click()
    await page.getByRole('menu').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    await page.locator('[data-composer-input]').waitFor()
    expect(await page.locator('.cm-content').innerText()).toContain('这是通用文档编辑验证。')
    await page.getByRole('button', { name: '切换到可视化编辑' }).click()
    await page.screenshot({ path: '/tmp/zenwit-workbench-verified.png', fullPage: true })
    await page.getByRole('checkbox', { name: '自动保存', exact: true }).focus()
    await page.keyboard.press('Space')
    expect(await page.getByRole('checkbox', { name: '自动保存', exact: true }).isChecked()).toBe(false)
    await page.locator('.milkdown .ProseMirror').fill('尚未保存的本地修改')
    const filePath = join(scaffold.workspaceCwd, 'projects/通用工作台验证/notes.md')
    await writeFile(filePath, '来自外部的更新\n')
    await page.getByRole('button', { name: /^保存/ }).click()
    await page.getByText('文件已在外部修改，本地修改已保留，自动保存已暂停。').waitFor()
    expect(await readFile(filePath, 'utf8')).toBe('来自外部的更新\n')
    expect(await page.locator('.milkdown .ProseMirror').innerText()).toContain('尚未保存的本地修改')
    // Open real project assets through the shipped workbench and Host reader.
    const projectDir = join(scaffold.workspaceCwd, 'projects/通用工作台验证')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    await writeFile(join(projectDir, 'image.png'), png)
    await writeFile(join(projectDir, 'pages.pdf'), pdfFixture())
    await writeFile(join(projectDir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>')
    await writeFile(join(projectDir, 'main.css'), 'h1 { color: rgb(12, 34, 56); }')
    await writeFile(join(projectDir, 'main.js'), 'document.querySelector("h1").textContent="关联脚本已执行"; try { parent.document.body.dataset.escaped="yes" } catch {}')
    await writeFile(join(projectDir, 'index.html'), '<!doctype html><link rel="stylesheet" href="./main.css"><h1>HTML</h1><img src="./image.png"><script src="./main.js"></script>')
    await writeFile(join(projectDir, 'guide.markdown'), '# Markdown 扩展名支持')
    const files = page.getByRole('complementary', { name: '文件目录', exact: true })
    await files.getByText('image.png', { exact: true }).click({ timeout: 35000 })
    await expect.poll(() => page.locator('[data-document-preview="image"] img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
    expect(await page.getByRole('checkbox', { name: '自动保存', exact: true }).count()).toBe(0)
    await files.getByText('pages.pdf', { exact: true }).click()
    await page.locator('[data-pdf-page="1"] canvas:not([hidden])').waitFor({ timeout: 15000 })
    expect(await page.locator('[data-pdf-page]').count()).toBe(2)
    await files.getByText('index.html', { exact: true }).click()
    const frame = page.frameLocator('iframe[title="HTML 网页预览"]')
    await expect.poll(() => frame.locator('h1').innerText()).toBe('关联脚本已执行')
    expect(await frame.locator('h1').evaluate(node => getComputedStyle(node).color)).toBe('rgb(12, 34, 56)')
    await expect.poll(() => frame.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
    expect(await page.locator('body').getAttribute('data-escaped')).toBeNull()
    await files.getByText('logo.svg', { exact: true }).click()
    await expect.poll(() => page.locator('[data-document-preview="svg"] img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(120)
    await page.getByRole('button', { name: '源码编辑', exact: true }).click()
    const source = page.locator('[class*="documentEditor"]:not([hidden]) .cm-content')
    await source.fill('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="60"><rect width="90" height="60" fill="blue"/></svg>')
    await page.getByRole('button', { name: '切换到预览', exact: true }).click()
    await expect.poll(() => page.locator('[data-document-preview="svg"] img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(90)
    await files.getByText('guide.markdown', { exact: true }).click()
    await page.locator('[class*="documentEditor"]:not([hidden]) .milkdown .ProseMirror').waitFor()
    await page.screenshot({ path: '/tmp/zenwit-document-previews-verified.png', fullPage: true })
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 120000)

import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyProductBrand, ZenwitMark, ZenwitName } from '../src/client/product-brand.tsx'

it('registers branding only through declaration-aware slots', () => {
  const register = vi.fn((_options: { name: string }, _component: unknown) => vi.fn())
  const inject = vi.fn((_name, callback) => callback())
  applyProductBrand({ slots: { register, inject } } as unknown as Context)
  expect(register.mock.calls.map(([options]) => options.name)).toEqual([
    'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark',
  ])
  expect(renderToStaticMarkup(createElement(ZenwitName))).toContain('zenwit')
  const mark = renderToStaticMarkup(createElement(ZenwitMark, { size: 48, className: 'hero' }))
  expect(mark).toContain('width="48"')
  expect(mark).toContain('class="hero"')
})

it('installs zenwit runtime copy and browser metadata from durable package patches', () => {
  const read = (name: string, file: string) => readFileSync(new URL(`../node_modules/@deepseek-ai/${name}/${file}`, import.meta.url), 'utf8')
  expect(read('dsh-client-ui-layout', 'lib/client.js')).toContain('const productTitle = "zenwit"')
  const models = read('dsh-client-ui-settings-models', 'lib/client.js')
  expect(models).toContain('Welcome to zenwit')
  expect(models).not.toContain('DeepSeek Harness 0.1 remains')
  expect(read('dsh-web-frontend', 'dist/index.html')).toContain('<title>zenwit</title>')
  expect(JSON.parse(read('dsh-web-frontend', 'dist/manifest.webmanifest')).name).toBe('zenwit')
  expect(read('dsh-client-ui-conversation', 'lib/client.js')).not.toContain('探索未至之境')
})

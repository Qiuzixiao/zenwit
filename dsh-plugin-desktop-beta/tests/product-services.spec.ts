import { expect, it, vi } from 'vitest'
import { checkForDesktopUpdate } from '../src/update-checker.ts'
import { downloadDesktopUpdate } from '../src/update-download.ts'
import { DESKTOP_RELEASE_IDENTITIES } from '../src/product-identity.ts'

it('does not contact a release service or download an installer before zenwit updates are configured', async () => {
  const request = vi.fn()
  expect(await checkForDesktopUpdate({ currentVersion: '2.0.9', channel: 'stable', request })).toBeNull()
  await expect(downloadDesktopUpdate({ platform: 'darwin', version: '2.0.10', destinationPath: '/tmp/zenwit.dmg', request })).rejects.toThrow('not configured')
  expect(request).not.toHaveBeenCalled()
})

it('isolates the two zenwit editions from the original application', () => {
  expect(DESKTOP_RELEASE_IDENTITIES.stable.productName).toBe('zenwit')
  expect(DESKTOP_RELEASE_IDENTITIES.beta.productName).toBe('zenwit Beta')
  expect(DESKTOP_RELEASE_IDENTITIES.stable.appId).toBe('app.zenwit.desktop')
  expect(DESKTOP_RELEASE_IDENTITIES.beta.appId).toBe('app.zenwit.desktop.beta')
})

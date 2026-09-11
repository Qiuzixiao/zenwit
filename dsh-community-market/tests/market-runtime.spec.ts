import type { CatalogHttpClient } from '../src/contracts/types.js'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import { describe, expect, it, vi } from 'vitest'
import { marketMutationAllowed, marketRequestAllowed } from '../src/host/routes.js'
import { CatalogNetworkError, createCachedCatalogHttpClient, createRestrictedHttpClient, pinnedLookupResult, restrictedHttpClient } from '../src/network/restricted-http.js'

describe('market request authority', () => {
  it.each([
    ['127.0.0.1'],
    ['::ffff:7f00:1'],
  ])('allows loopback address %s only with the Desktop authority and a matching origin', (remoteAddress) => {
    const origin = 'http://127.0.0.1:43120'
    const host = '127.0.0.1:43120'
    expect(marketMutationAllowed({ remoteAddress, origin, host, expectedPort: 43_120 })).toBe(true)
  })

  it.each([
    [undefined, 'http://localhost:43120', 'localhost:43120'],
    ['127.0.0.1', undefined, 'localhost:43120'],
    ['127.0.0.1', 'http://attacker.example', 'localhost:43120'],
    ['104.21.87.154', 'http://localhost:43120', 'localhost:43120'],
    ['127.0.0.1', 'http://evil.example:43120', 'evil.example:43120'],
    ['127.0.0.1', 'http://localhost:43121', 'localhost:43121'],
  ])('rejects incomplete or non-local mutation context', (remoteAddress, origin, host) => {
    expect(marketMutationAllowed({ remoteAddress, origin, host, expectedPort: 43_120 })).toBe(false)
  })

  it('allows same-authority reads without Origin but rejects cross-site fetch metadata', () => {
    const base = {
      remoteAddress: '127.0.0.1',
      origin: undefined,
      host: '127.0.0.1:43120',
      expectedPort: 43_120,
    }
    expect(marketRequestAllowed(base)).toBe(true)
    expect(marketRequestAllowed({ ...base, secFetchSite: 'cross-site' })).toBe(false)
  })
})


describe('restricted HTTP boundary', () => {
  it('starts the first-byte deadline before response headers arrive', async () => {
    vi.useFakeTimers()
    const request = new EventEmitter()
    const destroy = vi.fn((cause?: Error) => { request.emit('error', cause) })
    Object.assign(request, { destroy, end: vi.fn() })
    const requestSpy = vi.spyOn(https, 'request').mockImplementation((() => request) as never)
    try {
      const client = createRestrictedHttpClient({
        resolveAddress: async () => ({ address: '93.184.216.34', family: 4 }),
      })
      const result = expect(client.getJson(
        'https://catalog.example/v1/plugins',
        new AbortController().signal,
      )).rejects.toMatchObject({ code: 'timeout' })

      await vi.advanceTimersByTimeAsync(0)
      expect(requestSpy).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(11_999)
      expect(destroy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await result
      expect(destroy).toHaveBeenCalledOnce()
    } finally {
      requestSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('allows proxy fake-IP DNS only for an exact reviewed hostname', async () => {
    const lookupAddresses = vi.fn(async () => [{ address: '198.18.0.38', family: 4 as const }])
    const request = vi.fn(async () => ({
      body: Buffer.from('{"plugins":[]}'),
      headers: { 'content-type': 'application/json' },
      statusCode: 200,
    }))
    const trusted = createRestrictedHttpClient({
      syntheticProxyHostnames: ['deepseek1024.com'],
      lookupAddresses,
      request,
    })

    await expect(trusted.getJson(
      'https://deepseek1024.com/api/v2/plugins',
      new AbortController().signal,
    )).resolves.toMatchObject({ value: { plugins: [] } })
    expect(request).toHaveBeenCalledOnce()

    const strict = createRestrictedHttpClient({ lookupAddresses, request })
    await expect(strict.getJson(
      'https://deepseek1024.com/api/v2/plugins',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'blocked-address' })
    await expect(trusted.getJson(
      'https://deepseek1024.com.attacker.example/api/v2/plugins',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'blocked-address' })
    await expect(trusted.getJson(
      'https://198.18.0.38/api/v2/plugins',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'blocked-address' })
  })

  it('caches a completed fixed-catalog response and collapses concurrent reads', async () => {
    let now = 1_000
    let release: ((value: { value: object; finalUrl: string }) => void) | undefined
    const pending = new Promise<{ value: object; finalUrl: string }>(resolve => { release = resolve })
    const delegate: CatalogHttpClient = { getJson: vi.fn(async () => await pending) }
    const client = createCachedCatalogHttpClient(delegate, { ttlMs: 300_000, now: () => now })
    const first = client.getJson('https://deepseek1024.com/api/v2/plugins', new AbortController().signal)
    const second = client.getJson('https://deepseek1024.com/api/v2/plugins', new AbortController().signal)

    expect(delegate.getJson).toHaveBeenCalledOnce()
    release?.({ value: { plugins: [] }, finalUrl: 'https://deepseek1024.com/api/v2/plugins' })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    await client.getJson('https://deepseek1024.com/api/v2/plugins', new AbortController().signal)
    expect(delegate.getJson).toHaveBeenCalledOnce()

    now += 300_001
    const refreshed = client.getJson('https://deepseek1024.com/api/v2/plugins', new AbortController().signal)
    expect(delegate.getJson).toHaveBeenCalledTimes(2)
    await expect(refreshed).resolves.toMatchObject({ value: { plugins: [] } })
  })

  it('aborts a shared fixed-catalog request after its last waiter leaves', async () => {
    let delegateSignal: AbortSignal | undefined
    const delegate: CatalogHttpClient = {
      getJson: vi.fn(async (_url, signal) => await new Promise<never>((_resolve, reject) => {
        delegateSignal = signal
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })),
    }
    const client = createCachedCatalogHttpClient(delegate)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = client.getJson('https://deepseek1024.com/api/v2/plugins', firstController.signal)
    const second = client.getJson('https://deepseek1024.com/api/v2/plugins', secondController.signal)
    const firstResult = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const secondResult = expect(second).rejects.toMatchObject({ name: 'AbortError' })

    firstController.abort()
    expect(delegateSignal?.aborted).toBe(false)
    secondController.abort()
    expect(delegateSignal?.aborted).toBe(true)
    await Promise.all([firstResult, secondResult])
    expect(delegate.getJson).toHaveBeenCalledOnce()
  })

  it('does not let an abandoned shared request overwrite its replacement', async () => {
    const releases: Array<(response: { value: object; finalUrl: string }) => void> = []
    const delegate: CatalogHttpClient = {
      getJson: vi.fn(async () => await new Promise<{ value: object; finalUrl: string }>(resolve => { releases.push(resolve) })),
    }
    const client = createCachedCatalogHttpClient(delegate)
    const abandonedController = new AbortController()
    const abandoned = client.getJson('https://deepseek1024.com/api/v2/plugins', abandonedController.signal)
    const abandonedResult = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    abandonedController.abort()
    await abandonedResult

    const replacement = client.getJson('https://deepseek1024.com/api/v2/plugins', new AbortController().signal)
    expect(delegate.getJson).toHaveBeenCalledTimes(2)
    releases[0]?.({ value: { revision: 'abandoned' }, finalUrl: 'https://deepseek1024.com/api/v2/plugins' })
    releases[1]?.({ value: { revision: 'replacement' }, finalUrl: 'https://deepseek1024.com/api/v2/plugins' })
    await expect(replacement).resolves.toMatchObject({ value: { revision: 'replacement' } })
    await expect(client.getJson(
      'https://deepseek1024.com/api/v2/plugins',
      new AbortController().signal,
    )).resolves.toMatchObject({ value: { revision: 'replacement' } })
    expect(delegate.getJson).toHaveBeenCalledTimes(2)
  })

  it('keeps one total deadline across redirects', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn((url: URL, signal: AbortSignal) => {
        if (url.hostname === 'catalog.example') {
          return new Promise<{ body: Buffer; headers: { location: string }; statusCode: number }>((resolve) => {
            setTimeout(() => resolve({
              body: Buffer.alloc(0),
              headers: { location: 'https://redirect.example/catalog.json' },
              statusCode: 302,
            }), 20)
          })
        }
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
      const client = createRestrictedHttpClient({
        request,
        resolveAddress: async () => ({ address: '104.21.87.154', family: 4 }),
        totalTimeoutMs: 30,
      })

      const result = expect(client.getJson(
        'https://catalog.example/catalog.json',
        new AbortController().signal,
      )).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(20)
      expect(request).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(10)
      await result
    } finally {
      vi.useRealTimers()
    }
  })

  it('enforces the total deadline while DNS resolution remains pending', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn()
      let releaseLookup: ((addresses: readonly [{ address: string; family: 4 }]) => void) | undefined
      const lookup = new Promise<readonly [{ address: string; family: 4 }]>(resolve => { releaseLookup = resolve })
      const client = createRestrictedHttpClient({
        lookupAddresses: vi.fn(async () => await lookup),
        request,
        totalTimeoutMs: 30,
      })
      const result = expect(client.getJson(
        'https://catalog.example/catalog.json',
        new AbortController().signal,
      )).rejects.toMatchObject({ code: 'timeout' })

      await vi.advanceTimersByTimeAsync(30)
      await result
      releaseLookup?.([{ address: '93.184.216.34', family: 4 }])
      await vi.advanceTimersByTimeAsync(0)
      expect(request).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('revalidates every redirect target before the next request', async () => {
    const resolveAddress = vi.fn(async (hostname: string) => {
      if (hostname === 'private.example') throw new CatalogNetworkError('blocked-address')
      return { address: '104.21.87.154', family: 4 as const }
    })
    const request = vi.fn(async () => ({
      body: Buffer.alloc(0),
      headers: { location: 'https://private.example/catalog.json' },
      statusCode: 302,
    }))
    const client = createRestrictedHttpClient({ request, resolveAddress })

    await expect(client.getJson(
      'https://catalog.example/catalog.json',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'blocked-address' })
    expect(resolveAddress).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects a standard-source cross-origin redirect before contacting it', async () => {
    const resolveAddress = vi.fn(async () => ({ address: '104.21.87.154', family: 4 as const }))
    const request = vi.fn(async () => ({
      body: Buffer.alloc(0),
      headers: { location: 'https://other.example/v1/plugins' },
      statusCode: 302,
    }))
    const client = createRestrictedHttpClient({ request, resolveAddress })

    await expect(client.getJson(
      'https://catalog.example/v1/plugins',
      new AbortController().signal,
      { allowedOrigin: 'https://catalog.example' },
    )).rejects.toMatchObject({ code: 'redirect' })
    expect(resolveAddress).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
  })

  it('returns an address list when Node requests an all-address lookup', () => {
    const pinned = { address: '104.21.87.154', family: 4 as const }
    expect(pinnedLookupResult({ all: true }, pinned)).toEqual([pinned])
    expect(pinnedLookupResult({ all: false }, pinned)).toEqual(pinned)
  })

  it.each(['http://example.com/catalog.json', 'https://127.0.0.1/catalog.json', 'https://169.254.169.254/latest'])('rejects unsafe URL %s before requesting it', async (url) => {
    await expect(restrictedHttpClient.getJson(url, new AbortController().signal)).rejects.toThrow(/catalog request failed/u)
  })

  it.each([
    'https://[::ffff:7f00:1]/catalog.json',
    'https://[::ffff:a9fe:a9fe]/latest',
  ])('rejects IPv4-mapped IPv6 URL %s before connecting', async (url) => {
    await expect(restrictedHttpClient.getJson(url, AbortSignal.timeout(250))).rejects.toMatchObject({
      code: 'blocked-address',
    })
  })
})

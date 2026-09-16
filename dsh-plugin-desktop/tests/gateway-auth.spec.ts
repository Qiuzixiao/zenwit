import { describe, expect, it, vi } from 'vitest'
import {
  GATEWAY_DEVICE_POLL_URL,
  GATEWAY_DEVICE_START_URL,
  GATEWAY_DEFAULT_EXPIRES_IN_MS,
  GATEWAY_MODELS_URL,
  GatewayAuthError,
  awaitGatewayDeviceAuthorization,
  createGatewayCodeVerifier,
  discoverGatewayModels,
  gatewayCodeChallenge,
  startGatewayDeviceAuthorization,
  type GatewayClock,
} from '../src/gateway-auth.ts'

const VERIFIER_BYTES = Uint8Array.from({ length: 32 }, (_value, index) => index)
const VERIFIER = createGatewayCodeVerifier(VERIFIER_BYTES)
const DEVICE_CODE = 'D'.repeat(43)
const RELAY_KEY = 'K'.repeat(48)
const APPROVAL_URL = 'https://ai.zenwit.cn/device?code=ABCD-2345'

interface FakeClock extends GatewayClock {
  readonly sleeps: number[]
  advance(milliseconds: number): void
}

function fakeClock(start = 1_000_000): FakeClock {
  let current = start
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => current,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      current += milliseconds
    },
    advance: (milliseconds) => { current += milliseconds },
  }
}

function startBody(): object {
  return {
    success: true,
    data: {
      device_code: DEVICE_CODE,
      user_code: 'ABCD-2345',
      verification_uri: 'https://ai.zenwit.cn/device',
      interval: 2,
      expires_in: 600,
    },
  }
}

function approvedBody(): object {
  return {
    success: true,
    data: {
      status: 'approved',
      key: RELAY_KEY,
      token_id: 12,
      name: 'ZenwitAI Desktop - MacBook Pro - a1b2c3d4',
      user: { id: 1, username: 'zenwit', display_name: 'Zenwit User', group: 'default', quota: 12_345 },
    },
  }
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('ZenwitAI device authorization', () => {
  it('starts a ceremony whose challenge commits to the generated verifier', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const clock = fakeClock()
    const device = await startGatewayDeviceAuthorization({
      deviceName: 'MacBook Pro',
      deviceId: 'a1b2c3d4',
      clock,
      randomBytes: size => VERIFIER_BYTES.subarray(0, size),
      request: async (url, init) => {
        calls.push({ url, init })
        return Response.json(startBody())
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(GATEWAY_DEVICE_START_URL)
    const body = bodyOf(calls[0]!.init)
    expect(body['code_challenge']).toBe(gatewayCodeChallenge(VERIFIER))
    expect(body['device_name']).toBe('MacBook Pro')
    expect(body['device_id']).toBe('a1b2c3d4')
    expect(String(calls[0]!.init.body)).not.toContain(VERIFIER)

    expect(device.userCode).toBe('ABCD-2345')
    expect(device.verificationUri).toBe('https://ai.zenwit.cn/device')
    expect(device.approvalUrl).toBe(APPROVAL_URL)
    expect(device.approvalUrl).not.toContain(DEVICE_CODE)
    expect(device.intervalMs).toBe(2_000)
    expect(device.expiresAt).toBe(clock.now() + GATEWAY_DEFAULT_EXPIRES_IN_MS)
  })

  it('polls pending responses until the gateway approves and returns the account facts', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const clock = fakeClock()
    const approved = await awaitGatewayDeviceAuthorization({
      device: await startGatewayDeviceAuthorization({
        deviceName: 'MacBook Pro',
        deviceId: 'a1b2c3d4',
        clock,
        randomBytes: () => VERIFIER_BYTES,
        request: async (_url, init) => {
          requests.push({ url: String(_url), init })
          return Response.json(startBody())
        },
      }),
      clock,
      request: async (url, init) => {
        requests.push({ url, init })
        return requests.length === 2
          ? Response.json({ success: true, data: { status: 'pending', interval: 2 } })
          : Response.json(approvedBody())
      },
    })

    expect(approved.status).toBe('approved')
    expect(approved.key).toBe(RELAY_KEY)
    expect(approved.tokenId).toBe(12)
    expect(approved.user).toEqual({
      id: 1,
      username: 'zenwit',
      display_name: 'Zenwit User',
      group: 'default',
      quota: 12_345,
    })
    expect(clock.sleeps).toEqual([2_000, 2_000])
    const polls = requests.filter(entry => entry.url === GATEWAY_DEVICE_POLL_URL)
    expect(polls).toHaveLength(2)
    expect(bodyOf(polls[0]!.init)).toEqual({
      device_code: DEVICE_CODE,
      code_verifier: VERIFIER,
    })
  })

  it('surfaces a wrong-verifier refusal with the gateway message', async () => {
    const clock = fakeClock()
    const device = await startGatewayDeviceAuthorization({
      deviceName: 'MacBook Pro',
      deviceId: 'a1b2c3d4',
      clock,
      randomBytes: () => VERIFIER_BYTES,
      request: async () => Response.json(startBody()),
    })

    const failure = await awaitGatewayDeviceAuthorization({
      device,
      clock,
      request: async () => Response.json({ success: false, message: 'invalid code_verifier' }),
    }).then(() => undefined, (cause: unknown) => cause as GatewayAuthError)

    expect(failure).toBeInstanceOf(GatewayAuthError)
    expect(failure?.code).toBe('refused')
    expect(failure?.retryable).toBe(false)
    expect(failure?.message).toBe('invalid code_verifier')
    expect(JSON.stringify(failure)).not.toContain(DEVICE_CODE)
  })

  it('enforces the ceremony deadline while the gateway keeps reporting pending', async () => {
    const clock = fakeClock()
    const device = await startGatewayDeviceAuthorization({
      deviceName: 'MacBook Pro',
      deviceId: 'a1b2c3d4',
      clock,
      randomBytes: () => VERIFIER_BYTES,
      request: async () => Response.json({
        success: true,
        data: {
          device_code: DEVICE_CODE,
          user_code: 'ABCD-2345',
          verification_uri: 'https://ai.zenwit.cn/device',
          interval: 2,
          expires_in: 6,
        },
      }),
    })
    const poll = vi.fn(async () => Response.json({ success: true, data: { status: 'pending', interval: 2 } }))

    const failure = await awaitGatewayDeviceAuthorization({ device, clock, request: poll })
      .then(() => undefined, (cause: unknown) => cause as GatewayAuthError)

    expect(failure?.code).toBe('expired')
    expect(failure?.retryable).toBe(true)
    expect(poll).toHaveBeenCalledTimes(2)
    expect(clock.sleeps).toEqual([2_000, 2_000, 2_000])
  })

  it('aborts an in-flight ceremony through the caller signal', async () => {
    const clock = fakeClock()
    const controller = new AbortController()
    const device = await startGatewayDeviceAuthorization({
      deviceName: 'MacBook Pro',
      deviceId: 'a1b2c3d4',
      clock,
      randomBytes: () => VERIFIER_BYTES,
      request: async () => Response.json(startBody()),
    })

    const failure = await awaitGatewayDeviceAuthorization({
      device,
      clock,
      signal: controller.signal,
      request: async () => {
        controller.abort()
        return Response.json({ success: true, data: { status: 'pending', interval: 2 } })
      },
    }).then(() => undefined, (cause: unknown) => cause as GatewayAuthError)

    expect(failure?.code).toBe('cancelled')
    expect(clock.sleeps).toEqual([2_000])
  })

  it('rejects a malformed start response and an unexpected status', async () => {
    const clock = fakeClock()
    const malformed = await startGatewayDeviceAuthorization({
      deviceName: 'MacBook Pro',
      deviceId: 'a1b2c3d4',
      clock,
      randomBytes: () => VERIFIER_BYTES,
      request: async () => Response.json({ success: true, data: { user_code: 'ABCD-2345' } }),
    }).then(() => undefined, (cause: unknown) => cause as GatewayAuthError)
    expect(malformed?.code).toBe('malformed')

    const unreachable = await startGatewayDeviceAuthorization({
      deviceName: 'MacBook Pro',
      deviceId: 'a1b2c3d4',
      clock,
      randomBytes: () => VERIFIER_BYTES,
      request: async () => new Response('nope', { status: 502 }),
    }).then(() => undefined, (cause: unknown) => cause as GatewayAuthError)
    expect(unreachable?.code).toBe('unreachable')
    expect(unreachable?.retryable).toBe(true)
  })

  it('refuses entropy below one full verifier', () => {
    expect(() => createGatewayCodeVerifier(Uint8Array.from({ length: 16 }, () => 0)))
      .toThrow(TypeError)
  })
})

describe('ZenwitAI relay model discovery', () => {
  it('returns the deduplicated catalog behind the issued key', async () => {
    const calls: RequestInit[] = []
    const models = await discoverGatewayModels({
      key: RELAY_KEY,
      request: async (url, init) => {
        expect(url).toBe(GATEWAY_MODELS_URL)
        calls.push(init)
        return Response.json({ data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-flash' }, { id: 'zenai-pro' }, {}] })
      },
    })

    expect(models).toEqual(['deepseek-v4-flash', 'zenai-pro'])
    expect(new Headers(calls[0]?.headers).get('authorization')).toBe(`Bearer ${RELAY_KEY}`)
  })

  it('falls back to an empty catalog without failing the sign-in', async () => {
    expect(await discoverGatewayModels({ key: RELAY_KEY, request: async () => new Response('{}', { status: 500 }) }))
      .toEqual([])
    expect(await discoverGatewayModels({ key: RELAY_KEY, request: async () => new Response('not json') }))
      .toEqual([])
    expect(await discoverGatewayModels({
      key: RELAY_KEY,
      request: async () => { throw new Error('offline') },
    })).toEqual([])
  })
})

import type { H3Event } from 'h3'
import type { Compilable } from 'kysely'
import type { LogsMap } from '../../server/utils/access-log'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeAccessLog } from '../../server/utils/access-log'
import { useWAE } from '../../server/utils/cloudflare'

vi.mock('#shared/utils/flag', () => ({ getFlag: vi.fn() }))

const event = {
  context: {
    cloudflare: { env: {} },
    link: { id: 'link-id' },
  },
} as unknown as H3Event

const query = {} as Compilable

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('writeAccessLog', () => {
  function eventWithAnalytics(writeDataPoint: ReturnType<typeof vi.fn>) {
    return {
      context: {
        cloudflare: { env: { ANALYTICS: { writeDataPoint } } },
        link: { id: 'link-id' },
      },
    } as unknown as H3Event
  }

  it('silently skips production writes without an Analytics Engine binding', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('useRuntimeConfig', () => ({ disableAccessLog: false }))

    expect(() => writeAccessLog(event, {} as LogsMap)).not.toThrow()
  })

  it('writes a data point when access logging is enabled', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('useRuntimeConfig', () => ({ disableAccessLog: false }))
    const writeDataPoint = vi.fn()

    writeAccessLog(eventWithAnalytics(writeDataPoint), {} as LogsMap)

    expect(writeDataPoint).toHaveBeenCalledOnce()
  })

  it('skips the write when NUXT_DISABLE_ACCESS_LOG is set', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('useRuntimeConfig', () => ({ disableAccessLog: true }))
    const writeDataPoint = vi.fn()

    writeAccessLog(eventWithAnalytics(writeDataPoint), {} as LogsMap)

    expect(writeDataPoint).not.toHaveBeenCalled()
  })
})

describe('useWAE', () => {
  it.each([
    { cfAccountId: '', cfApiToken: 'token' },
    { cfAccountId: 'account', cfApiToken: '' },
  ])('returns empty data without requesting when credentials are incomplete', (config) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('useRuntimeConfig', () => config)
    vi.stubGlobal('$fetch', fetchMock)

    expect(useWAE(event, query)).toEqual({ data: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves requests and propagates errors when credentials are complete', async () => {
    const error = new Error('forbidden')
    const fetchMock = vi.fn().mockRejectedValue(error)
    vi.stubGlobal('useRuntimeConfig', () => ({
      cfAccountId: 'account',
      cfApiToken: 'token',
    }))
    vi.stubGlobal('compileAnalyticsQuery', () => 'select * from sink')
    vi.stubGlobal('$fetch', fetchMock)

    await expect(useWAE(event, query)).rejects.toBe(error)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account/analytics_engine/sql',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
        body: 'select * from sink',
        retry: 1,
        retryDelay: 100,
      },
    )
  })
})

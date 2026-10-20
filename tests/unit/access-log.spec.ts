import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectAccessLog, logs2blobs } from '../../server/utils/access-log'

vi.mock('#shared/utils/flag', () => ({ getFlag: vi.fn(() => '') }))

const IP = '203.0.113.7'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

const event = {
  context: {
    cloudflare: { request: { cf: { country: 'GB', city: 'London' } } },
    link: { id: 'link-id', slug: 'abc', url: 'https://example.com' },
  },
} as unknown as H3Event

function stubRequest(ip: string) {
  const headers: Record<string, string> = { 'cf-connecting-ip': ip, 'user-agent': UA }
  vi.stubGlobal('getHeader', (_event: H3Event, name: string) => headers[name])
  vi.stubGlobal('getRequestIP', () => undefined)
  vi.stubGlobal('useRuntimeConfig', () => ({ disableBotAccessLog: false, siteToken: 'test-site-token' }))
}

function visitorId() {
  return collectAccessLog(event)!.logs.visitor
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('collectAccessLog', () => {
  it('stores a visitor ID instead of the raw IP or user agent', () => {
    stubRequest(IP)
    const { logs } = collectAccessLog(event)!
    const stored = logs2blobs(logs).join('\n')

    expect(logs.visitor).toMatch(/^[0-9a-f]{16}$/)
    expect(logs.ua).toBeUndefined()
    expect(stored).not.toContain(IP)
    expect(stored).not.toContain(UA)
    expect(logs.browser).toBe('Safari')
  })

  it('keeps visitor IDs stable within a UTC day and rotates them daily', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T01:00:00Z'))
    stubRequest(IP)
    const first = visitorId()

    vi.setSystemTime(new Date('2026-10-20T23:59:00Z'))
    expect(visitorId()).toBe(first)

    stubRequest('203.0.113.8')
    expect(visitorId()).not.toBe(first)

    stubRequest(IP)
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'))
    expect(visitorId()).not.toBe(first)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'

const HOOK_MODULE = {
  id: 'com.example.hooks',
  name: 'Hooks Module',
  version: '1.0.0',
  sdk_version: '1',
  description: null,
  author: null,
  license: null,
  permissions: ['hooks:before_write', 'events:subscribe', 'ledger:write', 'accounts:write'],
  entry_point: null,
}

describe('Phase 42 — Hooks and Events', () => {
  let mock: MockApi

  function findAccount(code: string) {
    const a = mock.getAccounts().find((x) => x.code === code)
    if (!a) throw new Error(`Account ${code} not found`)
    return a
  }

  function makeBalancedTx(date = '2026-04-01', description = 'Sale') {
    const cash = findAccount('1000')
    const sales = findAccount('4000')
    return {
      date,
      description,
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    }
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/HookCo', 'Hook Co')
    mock.installModule(HOOK_MODULE)
  })

  describe('Sync hooks', () => {
    it('before_transaction_create receives context with transaction data', () => {
      let received: any = null
      mock.registerHook(HOOK_MODULE.id, 'before_transaction_create', (ctx) => {
        received = ctx
        return { allow: true }
      })
      mock.createTransaction(makeBalancedTx('2026-04-02', 'Hook test'))
      expect(received).toBeTruthy()
      expect(received.date).toBe('2026-04-02')
      expect(received.description).toBe('Hook test')
      expect(received.entries).toHaveLength(2)
    })

    it('before_transaction_create rejection prevents the transaction', () => {
      mock.registerHook(HOOK_MODULE.id, 'before_transaction_create', () => ({
        allow: false,
        reason: 'no transactions on weekends',
      }))
      const before = mock.transactions.length
      expect(() => mock.createTransaction(makeBalancedTx())).toThrow(/rejected: no transactions/)
      expect(mock.transactions.length).toBe(before)
    })

    it('after_transaction_create rejection rolls back the writes', () => {
      mock.registerHook(HOOK_MODULE.id, 'after_transaction_create', () => ({
        allow: false,
        reason: 'invariant violation',
      }))
      const beforeTx = mock.transactions.length
      const beforeEntries = mock.entries.length
      expect(() => mock.createTransaction(makeBalancedTx())).toThrow(/rejected: invariant/)
      expect(mock.transactions.length).toBe(beforeTx)
      expect(mock.entries.length).toBe(beforeEntries)
    })

    it('multiple hooks run in priority order (lower first)', () => {
      const order: number[] = []
      mock.installModule({ ...HOOK_MODULE, id: 'com.example.hook2' })
      mock.registerHook(HOOK_MODULE.id, 'before_transaction_create', () => {
        order.push(1)
        return { allow: true }
      }, 10)
      mock.registerHook('com.example.hook2', 'before_transaction_create', () => {
        order.push(2)
        return { allow: true }
      }, 5)
      mock.createTransaction(makeBalancedTx())
      expect(order).toEqual([2, 1]) // priority 5 ran before priority 10
    })

    it('hook from module without hooks:before_write permission is rejected', () => {
      mock.installModule({ ...HOOK_MODULE, id: 'com.example.no_perm', permissions: [] })
      expect(() =>
        mock.registerHook('com.example.no_perm', 'before_transaction_create', () => ({ allow: true })),
      ).toThrow(/does not have permission 'hooks:before_write'/)
    })

    it('before_transaction_void rejection prevents the void', () => {
      const txId = mock.createTransaction(makeBalancedTx())
      mock.registerHook(HOOK_MODULE.id, 'before_transaction_void', () => ({
        allow: false,
        reason: 'has linked invoice',
      }))
      expect(() => mock.voidTransaction(txId)).toThrow(/has linked invoice/)
      expect(mock.transactions.find((t) => t.id === txId)?.is_void).toBe(0)
    })
  })

  describe('Async events', () => {
    it('subscriber receives event with the correct payload', () => {
      const received: unknown[] = []
      mock.subscribeEvent(HOOK_MODULE.id, 'transaction.created', (p) => received.push(p))
      mock.createTransaction(makeBalancedTx('2026-04-03', 'Event test'))
      expect(received).toHaveLength(1)
      const payload = received[0] as Record<string, unknown>
      expect(payload.description).toBe('Event test')
      expect(payload.line_count).toBe(2)
      expect(payload.total_amount).toBe(10000)
    })

    it('subscriber error does not block other subscribers', () => {
      mock.installModule({ ...HOOK_MODULE, id: 'com.example.b', permissions: ['events:subscribe'] })
      const seen: string[] = []
      mock.subscribeEvent(HOOK_MODULE.id, 'transaction.created', () => {
        throw new Error('boom')
      })
      mock.subscribeEvent('com.example.b', 'transaction.created', () => {
        seen.push('b ran')
      })
      mock.createTransaction(makeBalancedTx())
      expect(seen).toEqual(['b ran'])
    })

    it('subscriber error does not roll back the transaction', () => {
      mock.subscribeEvent(HOOK_MODULE.id, 'transaction.created', () => {
        throw new Error('catastrophic')
      })
      const txId = mock.createTransaction(makeBalancedTx())
      expect(mock.transactions.find((t) => t.id === txId)).toBeTruthy()
    })

    it('unsubscribe stops events from firing', () => {
      let count = 0
      mock.subscribeEvent(HOOK_MODULE.id, 'transaction.created', () => count++)
      mock.createTransaction(makeBalancedTx('2026-04-04'))
      expect(count).toBe(1)
      mock.unsubscribeEvent(HOOK_MODULE.id, 'transaction.created')
      mock.createTransaction(makeBalancedTx('2026-04-05'))
      expect(count).toBe(1)
    })

    it('module can emit a custom event and another module can receive it', () => {
      mock.installModule({ ...HOOK_MODULE, id: 'com.example.consumer', permissions: ['events:subscribe'] })
      let received: unknown = null
      mock.subscribeEvent('com.example.consumer', 'invoicing.invoice_paid', (p) => {
        received = p
      })
      mock.sdkEmitEvent(HOOK_MODULE.id, 'invoicing.invoice_paid', { invoice_id: 42 })
      expect(received).toEqual({ invoice_id: 42 })
    })

    it('transaction.voided event fires after a void', () => {
      const txId = mock.createTransaction(makeBalancedTx())
      const events: { event_type: string; data: unknown }[] = []
      mock.subscribeEvent(HOOK_MODULE.id, 'transaction.voided', (p) => {
        events.push({ event_type: 'transaction.voided', data: p })
      })
      mock.voidTransaction(txId)
      expect(events).toHaveLength(1)
      expect((events[0].data as { transaction_id: string }).transaction_id).toBe(txId)
    })

    it('period.locked event fires after locking a period', () => {
      const seen: unknown[] = []
      mock.subscribeEvent(HOOK_MODULE.id, 'period.locked', (p) => seen.push(p))
      mock.lockPeriodGlobal('2026-04-30')
      expect(seen).toHaveLength(1)
      expect((seen[0] as { end_date: string }).end_date).toBe('2026-04-30')
    })

    it('account.created event fires after creating an account', () => {
      const seen: unknown[] = []
      mock.subscribeEvent(HOOK_MODULE.id, 'account.created', (p) => seen.push(p))
      mock.createAccount({ code: '9999', name: 'Test Account', acctType: 'EXPENSE' })
      expect(seen).toHaveLength(1)
    })

    it('module.installed event fires after install_module', () => {
      const events = mock.getRecentEvents()
      // Phase 42's beforeEach already installed HOOK_MODULE — buffer should
      // contain at least one module.installed event for it.
      const installs = events.filter((e) => e.event_type === 'module.installed')
      expect(installs.length).toBeGreaterThanOrEqual(1)
    })

    it('subscriber without events:subscribe permission is rejected', () => {
      mock.installModule({ ...HOOK_MODULE, id: 'com.example.locked', permissions: [] })
      expect(() =>
        mock.subscribeEvent('com.example.locked', 'transaction.created', () => {}),
      ).toThrow(/does not have permission 'events:subscribe'/)
    })
  })
})

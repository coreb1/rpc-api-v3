import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { Contract } from '@app/contract'
import { createORPCClient, isDefinedError, safe } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { createRouterClient } from '@orpc/server'
import { asc, sql } from 'drizzle-orm'
import { App } from '../src/app'
import { SessionService } from '../src/auth/session.service'
import { outboxMessages, sessions, tickets, users } from '../src/schema'

/**
 * Runs against a real Postgres (see docker-compose.yml, which creates `app_test`).
 * Tables are truncated before each test, so never point this at a real database.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/app_test'
const TOKEN = 'test-token'

let app: App
let userId: string

beforeAll(async () => {
  app = new App({ DATABASE_URL, WEB_ORIGIN: '*' })
  await app.database.migrate(new URL('../drizzle', import.meta.url).pathname)
})

afterAll(() => app.stop())

beforeEach(async () => {
  await app.database.db.execute(sql`truncate users, events, outbox_messages restart identity cascade`)
  const [user] = await app.database.db.insert(users).values({ email: 'test@example.com' }).returning()
  userId = user!.id
  await app.database.db.insert(sessions).values({
    userId,
    tokenHash: SessionService.hashToken(TOKEN),
    expiresAt: new Date(Date.now() + 3_600_000),
  })
})

const client = (headers: Record<string, string> = {}) =>
  createRouterClient(app.router, { context: { headers: new Headers(headers) } })
const anon = () => client()
const authed = () => client({ authorization: `Bearer ${TOKEN}` })

const outbox = () => app.database.db.select().from(outboxMessages).orderBy(asc(outboxMessages.sequence))

const newEvent = {
  title: 'Techno night',
  venue: 'Le Rex',
  startsAt: new Date('2026-12-12T22:00:00Z'),
  endsAt: new Date('2026-12-13T06:00:00Z'),
}

const seedTicket = async (eventId: string, status: 'valid' | 'scanned' | 'cancelled' = 'valid') => {
  const [row] = await app.database.db
    .insert(tickets)
    .values({
      id: crypto.randomUUID(),
      eventId,
      holderName: 'Alice',
      holderEmail: 'alice@example.com',
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  return row!
}

describe('sessions', () => {
  test('anonymous calls work on public procedures', async () => {
    expect(await anon().events.list({})).toEqual({ items: [], total: 0 })
  })

  test('protected procedures reject missing or invalid sessions', async () => {
    for (const c of [anon(), client({ authorization: 'Bearer nope' })]) {
      const [error] = await safe(c.events.create(newEvent))
      expect(isDefinedError(error) && error.code).toBe('UNAUTHORIZED')
    }
    expect(await outbox()).toHaveLength(0)
  })

  test('cookie sessions are accepted', async () => {
    const created = await client({ cookie: `foo=1; sid=${TOKEN}` }).events.create(newEvent)
    expect(created.title).toBe('Techno night')
  })
})

describe('events', () => {
  test('create / update / delete each write one outbox message, in order', async () => {
    const c = authed()
    const created = await c.events.create(newEvent)
    await c.events.update({ id: created.id, patch: { venue: 'Le Rex Club' } })
    await c.events.update({ id: created.id, patch: { venue: 'Le Rex Club' } }) // no-op: no message
    await c.events.delete({ id: created.id })

    const messages = await outbox()
    expect(messages.map((m) => m.type)).toEqual(['event.created', 'event.updated', 'event.deleted'])
    expect(messages.every((m) => m.actorId === userId && m.aggregateId === created.id)).toBe(true)
    expect(messages[1]!.payload).toEqual({
      eventId: created.id,
      title: 'Techno night',
      description: null,
      venue: 'Le Rex Club',
      startsAt: '2026-12-12T22:00:00.000Z',
      endsAt: '2026-12-13T06:00:00.000Z',
      changed: ['venue'],
    })
  })

  test('list returns summaries; get returns everything', async () => {
    const created = await authed().events.create({ ...newEvent, description: 'Long text' })
    const { items } = await anon().events.list({})
    expect(Object.keys(items[0]!).sort()).toEqual(['endsAt', 'id', 'startsAt', 'title', 'venue'])
    expect((await anon().events.get({ id: created.id })).description).toBe('Long text')
  })

  test('a broken rule rolls the transaction back and returns a typed error', async () => {
    const c = authed()
    const created = await c.events.create(newEvent)
    const [error] = await safe(c.events.update({ id: created.id, patch: { endsAt: new Date('2026-01-01') } }))
    expect(isDefinedError(error) && error.code === 'BUSINESS_RULE_VIOLATION' && error.data.rule).toBe(
      'event.ends_after_start',
    )
    expect(await outbox()).toHaveLength(1)
    expect((await c.events.get({ id: created.id })).endsAt).toEqual(newEvent.endsAt)
  })

  test('unknown ids are NOT_FOUND with typed data', async () => {
    const id = crypto.randomUUID()
    const [error] = await safe(anon().events.get({ id }))
    expect(isDefinedError(error) && error.code === 'NOT_FOUND' && error.data).toEqual({ resource: 'event', id })
  })
})

describe('tickets', () => {
  test('list by event (no email), get, update, delete', async () => {
    const c = authed()
    const event = await c.events.create(newEvent)
    const t1 = await seedTicket(event.id)
    await seedTicket(event.id)

    const page = await c.tickets.listByEvent({ eventId: event.id, limit: 1 })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).not.toHaveProperty('holderEmail')

    expect((await c.tickets.get({ id: t1.id })).holderEmail).toBe('alice@example.com')
    expect((await c.tickets.update({ id: t1.id, patch: { status: 'scanned' } })).status).toBe('scanned')
    await c.tickets.delete({ id: t1.id })

    expect((await outbox()).map((m) => m.type)).toEqual(['event.created', 'ticket.updated', 'ticket.deleted'])
  })

  test('tickets require a session', async () => {
    const [error] = await safe(anon().tickets.listByEvent({ eventId: crypto.randomUUID() }))
    expect(isDefinedError(error) && error.code).toBe('UNAUTHORIZED')
  })

  test('status transitions are enforced', async () => {
    const c = authed()
    const event = await c.events.create(newEvent)
    const t = await seedTicket(event.id, 'cancelled')
    const [error] = await safe(c.tickets.update({ id: t.id, patch: { status: 'valid' } }))
    expect(isDefinedError(error) && error.code === 'BUSINESS_RULE_VIOLATION' && error.data.rule).toBe(
      'ticket.status_transition',
    )
  })

  test('listing tickets of an unknown event is NOT_FOUND', async () => {
    const [error] = await safe(authed().tickets.listByEvent({ eventId: crypto.randomUUID() }))
    expect(isDefinedError(error) && error.code).toBe('NOT_FOUND')
  })
})

describe('over HTTP, with the frontend client', () => {
  test('dates survive the wire, and there is no REST surface', async () => {
    const port = app.listen(0)
    const base = `http://localhost:${port}`
    const rpc: ContractRouterClient<Contract> = createORPCClient(
      new RPCLink({ url: `${base}/rpc`, headers: { authorization: `Bearer ${TOKEN}` } }),
    )

    const created = await rpc.events.create(newEvent)
    expect(created.startsAt).toBeInstanceOf(Date)
    expect((await rpc.events.list({})).total).toBe(1)
    expect((await fetch(`${base}/events`)).status).toBe(404)
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
  })
})

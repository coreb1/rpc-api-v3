import { describe, expect, test } from 'bun:test'
import { Event, EventSchedule } from '../src/events/event'
import { BusinessRuleViolation } from '../src/shared/domain'
import { Ticket, type TicketStatus } from '../src/tickets/ticket'

/** Business rules in isolation: no database, no oRPC. */
const ruleOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (error) {
    if (error instanceof BusinessRuleViolation) return error.rule
    throw error
  }
  return undefined
}

describe('Event', () => {
  const newEvent = () =>
    Event.create({
      title: ' Techno ',
      venue: 'Le Rex',
      startsAt: new Date('2026-12-12T22:00:00Z'),
      endsAt: new Date('2026-12-13T06:00:00Z'),
    })

  test('create() normalizes input and records event.created once', () => {
    const event = newEvent()
    expect(event.title).toBe('Techno')
    expect(event.pullEvents().map((e) => e.type)).toEqual(['event.created'])
    expect(event.pullEvents()).toHaveLength(0)
  })

  test('a no-op update records nothing', () => {
    const event = newEvent()
    event.pullEvents()
    event.update({ title: 'Techno', venue: 'Le Rex' })
    expect(event.pullEvents()).toHaveLength(0)
  })

  test('update reports exactly what changed', () => {
    const event = newEvent()
    event.pullEvents()
    event.update({ endsAt: new Date('2026-12-13T07:00:00Z') })
    expect(event.pullEvents()[0]!.payload).toMatchObject({ changed: ['endsAt'] })
  })

  test('rules', () => {
    const at = new Date()
    expect(ruleOf(() => EventSchedule.of(at, at))).toBe('event.ends_after_start')
    expect(ruleOf(() => newEvent().update({ title: '  ' }))).toBe('event.title_required')
  })
})

describe('Ticket', () => {
  const ticket = (status: TicketStatus) =>
    Ticket.restore(crypto.randomUUID(), {
      eventId: crypto.randomUUID(),
      holderName: 'Alice',
      holderEmail: 'alice@example.com',
      seat: null,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

  test('valid → scanned is allowed, then there is no way back', () => {
    const t = ticket('valid')
    t.update({ status: 'scanned' })
    expect(t.status).toBe('scanned')
    expect(ruleOf(() => t.update({ status: 'valid' }))).toBe('ticket.status_transition')
  })

  test('holder is locked once scanned, the seat can still move', () => {
    const t = ticket('scanned')
    expect(ruleOf(() => t.update({ holderName: 'Bob' }))).toBe('ticket.holder_locked')
    t.update({ seat: 'A12' })
    expect(t.seat).toBe('A12')
  })

  test('the queue payload carries no holder PII', () => {
    const t = ticket('valid')
    t.update({ holderEmail: 'BOB@example.com' })
    expect(t.holderEmail).toBe('bob@example.com')
    expect(t.pullEvents()[0]!.payload).not.toHaveProperty('holderEmail')
  })
})

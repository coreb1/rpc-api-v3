import { isDefinedError, safe } from '@orpc/client'
import { rpc } from './rpc'

/** Usage examples — fully typed from the contract, including errors. */
export async function examples() {
  const { items } = await rpc.events.list({ limit: 10 })

  const created = await rpc.events.create({
    title: 'Techno night',
    venue: 'Le Rex',
    startsAt: new Date('2026-12-12T22:00:00Z'), // Dates survive the wire (RPC serializer)
    endsAt: new Date('2026-12-13T06:00:00Z'),
  })

  await rpc.events.update({ id: created.id, patch: { venue: 'Le Rex Club' } })

  const tickets = await rpc.tickets.listByEvent({ eventId: created.id })

  // Typed error handling without try/catch:
  const [error, ticket] = await safe(rpc.tickets.get({ id: crypto.randomUUID() }))
  if (isDefinedError(error)) {
    switch (error.code) {
      case 'NOT_FOUND':
        console.warn(`missing ${error.data.resource} ${error.data.id}`)
        break
      case 'UNAUTHORIZED':
        // redirect to login
        break
      case 'BUSINESS_RULE_VIOLATION':
        console.warn(error.data.rule)
        break
    }
  }

  return { items, created, tickets, ticket }
}

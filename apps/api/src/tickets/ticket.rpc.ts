import type { Rpc } from '../rpc/rpc'
import type { TicketService } from './ticket.service'

/** Wires `tickets.*` to TicketService. Tickets carry holder PII, so every procedure needs a session. */
export class TicketRpc {
  constructor(
    private readonly rpc: Rpc,
    private readonly tickets: TicketService,
  ) {}

  routes() {
    const { authed } = this.rpc
    return {
      listByEvent: authed.tickets.listByEvent.handler(({ input }) =>
        this.tickets.listByEvent(input.eventId, { limit: input.limit, offset: input.offset }),
      ),
      get: authed.tickets.get.handler(({ input }) => this.tickets.get(input.id)),
      update: authed.tickets.update.handler(({ input, context }) =>
        this.tickets.update(input.id, input.patch, context.session),
      ),
      delete: authed.tickets.delete.handler(async ({ input, context }) => {
        await this.tickets.delete(input.id, context.session)
        return { id: input.id }
      }),
    }
  }
}

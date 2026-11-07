import type { Rpc } from '../rpc/rpc'
import type { EventService } from './event.service'

/**
 * Wires the contract's `events.*` procedures to EventService.
 * The only events file that knows about oRPC. Inputs are already validated by
 * the contract; outputs are validated and stripped to the contract's shape.
 */
export class EventRpc {
  constructor(
    private readonly rpc: Rpc,
    private readonly events: EventService,
  ) {}

  routes() {
    const { pub, authed } = this.rpc
    return {
      list: pub.events.list.handler(({ input }) => this.events.list(input)),
      get: pub.events.get.handler(({ input }) => this.events.get(input.id)),
      create: authed.events.create.handler(({ input, context }) => this.events.create(input, context.session)),
      update: authed.events.update.handler(({ input, context }) =>
        this.events.update(input.id, input.patch, context.session),
      ),
      delete: authed.events.delete.handler(async ({ input, context }) => {
        await this.events.delete(input.id, context.session)
        return { id: input.id }
      }),
    }
  }
}

import type { Rpc } from '../rpc/rpc'
import type { DealService } from './deal.service'

/** Wires the contract's `deals.*` procedures to DealService. Reads are public: an event page shows its prices. */
export class DealRpc {
  constructor(
    private readonly rpc: Rpc,
    private readonly deals: DealService,
  ) {}

  routes() {
    const { pub, authed } = this.rpc
    return {
      listByEvent: pub.deals.listByEvent.handler(({ input }) =>
        this.deals.listByEvent(input.eventId, { limit: input.limit, offset: input.offset }),
      ),
      get: pub.deals.get.handler(({ input }) => this.deals.get(input.id)),
      create: authed.deals.create.handler(({ input, context }) => this.deals.create(input, context.session)),
      update: authed.deals.update.handler(({ input, context }) =>
        this.deals.update(input.id, input.patch, context.session),
      ),
      delete: authed.deals.delete.handler(async ({ input, context }) => {
        await this.deals.delete(input.id, context.session)
        return { id: input.id }
      }),
    }
  }
}

import { cors } from '@elysiajs/cors'
import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Elysia, type AnyElysia } from 'elysia'
import { SessionService } from './auth/session.service'
import { ConfigSchema, type Config } from './config'
import { Database } from './database'
import { PostgresDealRepository } from './deals/deal.repository'
import { DealRpc } from './deals/deal.rpc'
import { DealService } from './deals/deal.service'
import { PostgresEventRepository } from './events/event.repository'
import { EventRpc } from './events/event.rpc'
import { EventService } from './events/event.service'
import { PostgresOutboxWriter } from './outbox/outbox'
import { Rpc } from './rpc/rpc'
import { PostgresTicketRepository } from './tickets/ticket.repository'
import { TicketRpc } from './tickets/ticket.rpc'
import { TicketService } from './tickets/ticket.service'

export type AppRouter = ReturnType<typeof App.createRouter>

/**
 * The API process. `createRouter` is the single place where classes are
 * wired together; the rest is HTTP plumbing. There are no REST routes:
 * everything goes through `/rpc`.
 */
export class App {
  readonly database: Database
  readonly router: AppRouter
  private readonly http: AnyElysia

  constructor(config: Pick<Config, 'DATABASE_URL' | 'WEB_ORIGIN'>) {
    this.database = new Database(config.DATABASE_URL)
    this.router = App.createRouter(this.database)
    this.http = this.createHttp(config.WEB_ORIGIN)
  }

  static createRouter(database: Database) {
    const outbox = new PostgresOutboxWriter(database)
    const eventRepository = new PostgresEventRepository(database)
    const eventService = new EventService(eventRepository, outbox, database)
    const dealService = new DealService(new PostgresDealRepository(database), eventRepository, outbox, database)
    const ticketService = new TicketService(new PostgresTicketRepository(database), eventRepository, outbox, database)

    const rpc = new Rpc(new SessionService(database))
    return rpc.os.router({
      events: new EventRpc(rpc, eventService).routes(),
      deals: new DealRpc(rpc, dealService).routes(),
      tickets: new TicketRpc(rpc, ticketService).routes(),
    })
  }

  /** Starts listening; returns the actual port (pass 0 for a random one). */
  listen(port: number): number | undefined {
    this.http.listen(port)
    return this.http.server?.port
  }

  async stop(): Promise<void> {
    await this.http.stop()
    await this.database.close()
  }

  private createHttp(webOrigin: string): AnyElysia {
    const rpcHandler = new RPCHandler(this.router, {
      interceptors: [
        onError((error) => {
          // Contract (typed) errors are expected; log everything else.
          if (!(error instanceof Error && 'defined' in error && error.defined)) console.error(error)
        }),
      ],
    })

    return new Elysia()
      .use(cors({ origin: webOrigin, credentials: true }))
      .get('/healthz', () => ({ ok: true }))
      .all(
        '/rpc*',
        async ({ request }) => {
          const { matched, response } = await rpcHandler.handle(request, {
            prefix: '/rpc',
            context: { headers: request.headers },
          })
          return matched ? response : new Response('Not found', { status: 404 })
        },
        { parse: 'none' }, // let oRPC read the body itself
      )
  }
}

if (import.meta.main) {
  const config = ConfigSchema.parse(process.env)
  const app = new App(config)
  console.info(`[api] listening on http://localhost:${app.listen(config.PORT)}/rpc`)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.stop().then(() => process.exit(0)))
  }
}

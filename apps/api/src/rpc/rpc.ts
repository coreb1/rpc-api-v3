import { contract } from '@app/contract'
import { implement, ORPCError } from '@orpc/server'
import type { SessionService } from '../auth/session.service'
import { BusinessRuleViolation, NotFoundError } from '../shared/domain'

/** What the HTTP layer passes to every call. */
export interface RequestContext {
  headers: Headers
}

/**
 * The starting point for every `*.rpc.ts` file:
 * - `rpc.pub`    session optional (`context.session` is `Session | null`)
 * - `rpc.authed` session required (`context.session` is `Session`)
 * Both translate domain errors into the contract's typed errors.
 */
export class Rpc {
  readonly os = implement(contract).$context<RequestContext>()

  readonly pub = this.os
    .use(async ({ next }) => {
      try {
        return await next()
      } catch (error) {
        throw this.toRpcError(error)
      }
    })
    .use(async ({ context, next }) => next({ context: { session: await this.sessions.resolve(context.headers) } }))

  readonly authed = this.pub.use(async ({ context, next }) => {
    if (!context.session) throw new ORPCError('UNAUTHORIZED')
    return next({ context: { session: context.session } })
  })

  // The middleware above only runs per request, after the constructor has set `sessions`.
  constructor(private readonly sessions: SessionService) {}

  /** Status must match the contract, or oRPC won't treat the error as a defined (typed) one. */
  private toRpcError(error: unknown): unknown {
    if (error instanceof NotFoundError) {
      return new ORPCError('NOT_FOUND', {
        status: 404,
        message: error.message,
        data: { resource: error.resource, id: error.id },
      })
    }
    if (error instanceof BusinessRuleViolation) {
      return new ORPCError('BUSINESS_RULE_VIOLATION', {
        status: 422,
        message: error.message,
        data: { rule: error.rule },
      })
    }
    return error
  }
}

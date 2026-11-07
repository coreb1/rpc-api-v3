import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract'
import { eventsContract } from './events'
import { ticketsContract } from './tickets'

/**
 * The single source of truth shared by the API and every frontend.
 * The backend `implement()`s it; the frontend only ever imports this package.
 */
export const contract = {
  events: eventsContract,
  tickets: ticketsContract,
}

export type Contract = typeof contract
export type RpcInputs = InferContractRouterInputs<Contract>
export type RpcOutputs = InferContractRouterOutputs<Contract>

export * from './events'
export * from './tickets'
export * from './common'

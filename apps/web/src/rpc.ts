import type { Contract } from '@app/contract'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'

/**
 * The frontend depends on the *contract* only — never on @app/api.
 * Every call goes through RPC; there is no REST surface to drift.
 */
const link = new RPCLink({
  url: `${import.meta.env?.VITE_API_URL ?? 'http://localhost:3000'}/rpc`,
  // Browser: the httpOnly `sid` cookie rides along.
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
  // Mobile / server: pass a bearer token instead.
  // headers: () => ({ authorization: `Bearer ${getToken()}` }),
})

export const rpc: ContractRouterClient<Contract> = createORPCClient(link)

declare global {
  interface ImportMeta {
    env?: Record<string, string | undefined>
  }
}

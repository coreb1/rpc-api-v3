import { oc } from '@orpc/contract'
import { z } from 'zod'

/**
 * Errors every procedure may return. They are part of the contract, so the
 * frontend gets them fully typed (`isDefinedError(err) && err.code === 'NOT_FOUND'`).
 */
export const base = oc.errors({
  UNAUTHORIZED: { status: 401, message: 'A valid session is required' },
  NOT_FOUND: {
    status: 404,
    data: z.object({ resource: z.string(), id: z.string() }),
  },
  BUSINESS_RULE_VIOLATION: {
    status: 422,
    data: z.object({ rule: z.string() }),
  },
})

export const IdInput = z.object({ id: z.uuid() })

export const PageFields = {
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
}

// `prefault` (zod 4) parses the default, so inner defaults apply when the client sends nothing.
export const PageInput = z.object(PageFields).prefault({})

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int() })

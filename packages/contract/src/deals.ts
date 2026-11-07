import { z } from 'zod'
import { base, IdInput, PageFields, paginated } from './common'

/** Amounts are in minor units (cents) so they never go through floating point. */
export const MoneySchema = z.object({
  amount: z.number().int().min(0).max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 code, e.g. EUR'),
})
export type MoneyDto = z.infer<typeof MoneySchema>

/** A way to buy a ticket for an event: early bird, regular, VIP… */
export const DealSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  price: MoneySchema,
  /** How many tickets this deal can sell in total. */
  quantity: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type DealDto = z.infer<typeof DealSchema>

/** List rows: what an event page needs to show its deals. */
export const DealListItemSchema = DealSchema.pick({
  id: true,
  name: true,
  price: true,
  quantity: true,
})
export type DealListItemDto = z.infer<typeof DealListItemSchema>

export const DealFields = z.object({
  /** Unique per event, ignoring case. */
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  price: MoneySchema,
  quantity: z.number().int().min(1).max(1_000_000),
})

export const CreateDealInput = DealFields.extend({ eventId: z.uuid() })
export const UpdateDealInput = z.object({
  id: z.uuid(),
  patch: DealFields.partial().refine((p) => Object.keys(p).length > 0, 'patch must not be empty'),
})
export const ListDealsByEventInput = z.object({ eventId: z.uuid(), ...PageFields })

export type CreateDealInputDto = z.infer<typeof CreateDealInput>
export type UpdateDealInputDto = z.infer<typeof UpdateDealInput>

export const dealsContract = {
  listByEvent: base.input(ListDealsByEventInput).output(paginated(DealListItemSchema)),
  get: base.input(IdInput).output(DealSchema),
  create: base.input(CreateDealInput).output(DealSchema),
  update: base.input(UpdateDealInput).output(DealSchema),
  delete: base.input(IdInput).output(IdInput),
}

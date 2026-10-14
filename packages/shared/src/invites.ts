import { z } from 'zod'
import { projectRefSchema } from './overview'

/** An invite link never makes someone an owner; an owner promotes people by hand. */
export const inviteRoleSchema = z.enum(['member', 'viewer'])
export type InviteRole = z.infer<typeof inviteRoleSchema>

export const createInviteRequestSchema = z.object({ role: inviteRoleSchema.default('member') })
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>

export const projectInviteSchema = z.object({
  id: z.uuid(),
  role: inviteRoleSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
})
export type ProjectInvite = z.infer<typeof projectInviteSchema>

/** Answer to creating an invite: the only time its token is shown. */
export const createdInviteSchema = projectInviteSchema.extend({ token: z.string() })
export type CreatedInvite = z.infer<typeof createdInviteSchema>

/** The token travels in the body, so it does not end up in server and proxy logs. */
export const inviteTokenRequestSchema = z.object({ token: z.string().min(1).max(200) })
export type InviteTokenRequest = z.infer<typeof inviteTokenRequestSchema>

/** What someone holding an invite link is told before they accept it. */
export const invitePreviewSchema = z.object({
  project: projectRefSchema,
  role: inviteRoleSchema,
  alreadyMember: z.boolean(),
})
export type InvitePreview = z.infer<typeof invitePreviewSchema>

/**
 * The answer to adding a member by email on a server that sends email: an invite link went
 * to the address, whether or not it has an account, so the answer tells nobody who is
 * registered. They join when they open it.
 */
export const memberInvitedSchema = z.object({ invited: z.literal(true) })
export type MemberInvited = z.infer<typeof memberInvitedSchema>

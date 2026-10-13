import {
  createdInviteSchema,
  invitePreviewSchema,
  projectInviteSchema,
  projectSchema,
  type CreatedInvite,
  type InvitePreview,
  type InviteRole,
  type Project,
  type ProjectInvite,
} from '@chilladesk/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const base = (projectId: string) => `/projects/${projectId}/invites`

export const fetchInvites = (projectId: string): Promise<ProjectInvite[]> =>
  apiRequest(base(projectId), { schema: z.array(projectInviteSchema) })

export const createInvite = (projectId: string, role: InviteRole): Promise<CreatedInvite> =>
  apiRequest(base(projectId), { method: 'POST', body: { role }, schema: createdInviteSchema })

export const revokeInvite = (projectId: string, inviteId: string): Promise<void> =>
  apiRequest(`${base(projectId)}/${inviteId}`, { method: 'DELETE' })

export const previewInvite = (token: string): Promise<InvitePreview> =>
  apiRequest('/invites/preview', { method: 'POST', body: { token }, schema: invitePreviewSchema })

export const acceptInvite = (token: string): Promise<Project> =>
  apiRequest('/invites/accept', { method: 'POST', body: { token }, schema: projectSchema })

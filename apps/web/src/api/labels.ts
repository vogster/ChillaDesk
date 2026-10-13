import {
  labelSchema,
  type CreateLabelRequest,
  type Label,
  type UpdateLabelRequest,
} from '@chilladesk/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const labelList = z.array(labelSchema)

const base = (projectId: string) => `/projects/${projectId}/labels`

export const fetchLabels = (projectId: string): Promise<Label[]> =>
  apiRequest(base(projectId), { schema: labelList })

export const createLabel = (projectId: string, input: CreateLabelRequest): Promise<Label> =>
  apiRequest(base(projectId), { method: 'POST', body: input, schema: labelSchema })

export const updateLabel = (
  projectId: string,
  labelId: string,
  patch: UpdateLabelRequest,
): Promise<Label> =>
  apiRequest(`${base(projectId)}/${labelId}`, { method: 'PATCH', body: patch, schema: labelSchema })

export const deleteLabel = (projectId: string, labelId: string): Promise<void> =>
  apiRequest(`${base(projectId)}/${labelId}`, { method: 'DELETE' })

import {
  projectMemberSchema,
  projectSchema,
  type AddMemberRequest,
  type CreateProjectRequest,
  type Project,
  type ProjectMember,
  type ProjectRole,
  type UpdateProjectRequest,
} from '@chilladesk/shared'
import { z } from 'zod'
import { apiRequest } from './client'

const projectList = z.array(projectSchema)
const memberList = z.array(projectMemberSchema)

export const fetchProjects = (): Promise<Project[]> =>
  apiRequest('/projects', { schema: projectList })

export const fetchProject = (projectId: string): Promise<Project> =>
  apiRequest(`/projects/${projectId}`, { schema: projectSchema })

export const createProject = (input: CreateProjectRequest): Promise<Project> =>
  apiRequest('/projects', { method: 'POST', body: input, schema: projectSchema })

export const updateProject = (projectId: string, patch: UpdateProjectRequest): Promise<Project> =>
  apiRequest(`/projects/${projectId}`, { method: 'PATCH', body: patch, schema: projectSchema })

export const deleteProject = (projectId: string): Promise<void> =>
  apiRequest(`/projects/${projectId}`, { method: 'DELETE' })

export const fetchMembers = (projectId: string): Promise<ProjectMember[]> =>
  apiRequest(`/projects/${projectId}/members`, { schema: memberList })

export const addMember = (projectId: string, input: AddMemberRequest): Promise<ProjectMember> =>
  apiRequest(`/projects/${projectId}/members`, {
    method: 'POST',
    body: input,
    schema: projectMemberSchema,
  })

export const updateMemberRole = (
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<ProjectMember> =>
  apiRequest(`/projects/${projectId}/members/${userId}`, {
    method: 'PATCH',
    body: { role },
    schema: projectMemberSchema,
  })

export const removeMember = (projectId: string, userId: string): Promise<void> =>
  apiRequest(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' })

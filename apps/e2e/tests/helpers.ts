import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

export interface Person {
  name: string
  email: string
  password: string
}

let counter = 0

/** Someone new; every test makes its own people, so tests never share data. */
export function person(name = 'Ann Example'): Person {
  counter += 1
  const id = `${Date.now().toString(36)}${counter}${randomUUID().slice(0, 4)}`
  return { name, email: `e2e-${id}@example.test`, password: `pw-${randomUUID()}` }
}

/** Signs up through the form, as a visitor would; ends on the projects page. */
export async function signUp(page: Page, who: Person = person()): Promise<Person> {
  await page.goto('/register')
  await page.getByLabel('Name').fill(who.name)
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  return who
}

/** A short project key nobody else in this run has. */
export function projectKey(): string {
  // Random, not counted: tests run in several processes at once, each with its own counter.
  return `E${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

export interface CreatedProject {
  id: string
  key: string
  name: string
}

/** Creates a project through the API, with the session of the page's user. */
export async function createProject(
  request: APIRequestContext,
  name = 'E2E project',
): Promise<CreatedProject> {
  const response = await request.post('/api/projects', { data: { name, key: projectKey() } })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()) as CreatedProject
}

/** Creates a task through the API in the first column, or the one given. */
export async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
  statusId?: string,
): Promise<{ id: string; key: string; number: number }> {
  const response = await request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, ...(statusId ? { statusId } : {}) },
  })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()) as { id: string; key: string; number: number }
}

/** A column of the board, by its name. */
export const column = (page: Page, name: string) => page.getByRole('region', { name })

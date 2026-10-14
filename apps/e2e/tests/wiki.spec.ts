import { expect, test } from '@playwright/test'
import { createProject, createTask, signUp } from './helpers'

test('a wiki page links to another page and to a task, and keeps its history', async ({ page }) => {
  await signUp(page)
  const project = await createProject(page.request)
  const task = await createTask(page.request, project.id, 'Set up the build server')
  await page.goto(`/projects/${project.id}/wiki`)

  await page.getByRole('link', { name: 'Write the first page' }).click()
  await page.getByLabel('Title').fill('Onboarding')
  await page
    .getByLabel('Content')
    .fill(`Start with [[Tools]], then pick up ${task.key}.\n\n- one\n- two`)
  await page.getByRole('button', { name: 'Create page' }).click()

  const article = page.getByRole('main')
  await expect(page.getByRole('article').getByRole('heading', { name: 'Onboarding' })).toBeVisible()
  await expect(article.getByRole('listitem').filter({ hasText: 'two' })).toBeVisible()
  // A task key becomes a link to the task, a [[title]] to the page, made when followed.
  await expect(article.getByRole('link', { name: task.key })).toBeVisible()
  await article.getByRole('link', { name: 'Tools' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Tools')
  await page.getByLabel('Content').fill('Git, Node and Docker.')
  await page.getByRole('button', { name: 'Create page' }).click()
  await expect(page.getByText('Git, Node and Docker.')).toBeVisible()

  // A second version of the first page, then back to the first one through the history.
  await page
    .getByRole('navigation', { name: 'Wiki pages' })
    .getByRole('link', { name: 'Onboarding' })
    .click()
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Content').fill('Rewritten from scratch.')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Rewritten from scratch.')).toBeVisible()

  await page.getByRole('link', { name: 'History' }).click()
  await page.getByRole('link', { name: 'Version 1' }).click()
  await page.getByRole('button', { name: 'Restore this version' }).click()
  await expect(page.getByText(/Start with/)).toBeVisible()
})

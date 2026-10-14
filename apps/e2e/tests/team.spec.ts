import { expect, test, type Browser, type Page } from '@playwright/test'
import { column, createProject, createTask, person, signUp } from './helpers'

/** A second person in a browser of their own, signed up and ready. */
async function secondPerson(browser: Browser, name: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const who = await signUp(page, person(name))
  return { context, page, who }
}

async function addMember(page: Page, projectId: string, email: string) {
  const response = await page.request.post(`/api/projects/${projectId}/members`, {
    data: { email, role: 'member' },
  })
  expect(response.status(), await response.text()).toBe(201)
}

test('a teammate sees changes live, gets mentioned and reads the notification', async ({
  page,
  browser,
}) => {
  await signUp(page)
  const project = await createProject(page.request, 'Shared project')
  const bob = await secondPerson(browser, 'Bob Builder')
  await addMember(page, project.id, bob.who.email)

  // Bob was added while he was looking at his projects: the list catches up by itself.
  await expect(bob.page.getByRole('link', { name: /Shared project/ })).toBeVisible()
  await bob.page.getByRole('link', { name: /Shared project/ }).click()
  await expect(column(bob.page, 'To Do')).toBeVisible()

  // Ann adds a task; it shows up on Bob's board without a reload.
  const task = await createTask(page.request, project.id, 'Fix the login page')
  await expect(column(bob.page, 'To Do').getByText('Fix the login page')).toBeVisible()

  // Ann mentions Bob in a comment, through the task dialog.
  await page.goto(`/projects/${project.id}/tasks/${task.number}`)
  const comment = page.getByLabel('Add a comment')
  await comment.fill('@Bob')
  await page
    .getByRole('listbox')
    .getByRole('option', { name: /Bob Builder/ })
    .click()
  await comment.pressSequentially(' can you take this?')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByText('can you take this?')).toBeVisible()

  // Bob's bell shows it, and the notification leads to the task.
  const bell = bob.page.getByRole('link', { name: /Notifications, 1 unread/ })
  await expect(bell).toBeVisible()
  await bell.click()
  await bob.page
    .getByRole('link', { name: new RegExp(task.key) })
    .first()
    .click()
  await expect(bob.page.getByText('can you take this?')).toBeVisible()

  await bob.context.close()
})

import { expect, test } from '@playwright/test'
import { column, createProject, createTask, signUp } from './helpers'

test('a new person signs up, creates a project and adds tasks on the board', async ({ page }) => {
  await signUp(page)

  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Website relaunch')
  await page.getByLabel('Key').fill('WEB')
  await page.getByRole('button', { name: 'Create project' }).click()

  const todo = column(page, 'To Do')
  await expect(todo).toBeVisible()
  await expect(column(page, 'In Progress')).toBeVisible()
  await expect(column(page, 'Done')).toBeVisible()

  await todo.getByRole('button', { name: 'Add a task to To Do' }).click()
  const title = todo.getByLabel('Title of the new task in To Do')
  await title.fill('Draft the home page')
  await title.press('Enter')
  await title.fill('Pick a font')
  await title.press('Enter')

  await expect(todo.getByRole('listitem')).toHaveCount(2)
  await expect(todo.getByText('Draft the home page')).toBeVisible()

  // Still there after a reload: it was saved, not only shown.
  await page.reload()
  await expect(column(page, 'To Do').getByText('Pick a font')).toBeVisible()
})

test('a card is dragged to another column with the mouse and stays there', async ({ page }) => {
  await signUp(page)
  const project = await createProject(page.request)
  await createTask(page.request, project.id, 'Write the release notes')
  await page.goto(`/projects/${project.id}`)

  const card = column(page, 'To Do').getByText('Write the release notes')
  const target = column(page, 'Done').getByRole('list')
  await card.hover()
  await page.mouse.down()
  const box = await target.boundingBox()
  if (!box) throw new Error('The Done column has no box')
  // In steps, so the drag library sees a real movement past its start distance.
  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 15 })
  await page.mouse.up()

  await expect(column(page, 'Done').getByText('Write the release notes')).toBeVisible()
  await page.reload()
  await expect(column(page, 'Done').getByText('Write the release notes')).toBeVisible()
  await expect(column(page, 'To Do').getByRole('listitem')).toHaveCount(0)
})

test('a card is moved to the next column with the keyboard', async ({ page }) => {
  await signUp(page)
  const project = await createProject(page.request)
  await createTask(page.request, project.id, 'Check the contrast')
  await page.goto(`/projects/${project.id}`)

  const handle = page.getByRole('button', { name: 'Move Check the contrast' })
  await handle.focus()
  // Each step waits for what a screen reader would announce, as a person would.
  const announced = page.locator('[aria-live]').filter({ hasText: /\S/ })
  await page.keyboard.press('Space')
  await expect(announced).toContainText('Picked up')
  await page.keyboard.press('ArrowRight')
  await expect(announced).toContainText('is over the In Progress column')
  await page.keyboard.press('Space')
  await expect(announced).toContainText('was dropped on the In Progress column')

  await expect(column(page, 'In Progress').getByText('Check the contrast')).toBeVisible()
  await page.reload()
  await expect(column(page, 'In Progress').getByText('Check the contrast')).toBeVisible()
})

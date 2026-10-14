import { expect, test } from '@playwright/test'
import { column, createProject, signUp } from './helpers'

test('the interface switches to Russian and remembers it on the account', async ({ page }) => {
  await signUp(page)
  const project = await createProject(page.request)

  await page.getByLabel('Language').selectOption('ru')
  await expect(page.getByRole('heading', { name: 'Проекты' })).toBeVisible()

  // The board of an existing project speaks Russian too, down to its buttons.
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByRole('link', { name: 'Доска' })).toBeVisible()
  await expect(column(page, 'To Do').getByRole('button', { name: /Добавить задачу/ })).toBeVisible()

  // Saved on the account: a fresh browser of the same person opens in Russian.
  const cookies = await page.context().cookies()
  const fresh = await page.context().browser()!.newContext({ locale: 'en-US' })
  await fresh.addCookies(cookies)
  const again = await fresh.newPage()
  await again.goto('/')
  await expect(again.getByRole('heading', { name: 'Проекты' })).toBeVisible()
  await fresh.close()
})

import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { column, createProject, signUp } from './helpers'

test('an owner imports tasks from a CSV file and downloads them again', async ({ page }) => {
  await signUp(page)
  const project = await createProject(page.request)
  await page.goto(`/projects/${project.id}/settings`)

  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'jira.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Summary,Status,Priority\r\nMigrate the database,In Progress,Highest\r\nWrite docs,Ideas,Low\r\n',
    ),
  })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const result = page.getByRole('status').filter({ hasText: 'Imported' })
  await expect(result).toContainText('Imported 2 tasks.')
  await expect(result).toContainText('Added the column "Ideas"')

  await page.getByRole('link', { name: 'Board' }).click()
  await expect(column(page, 'In Progress').getByText('Migrate the database')).toBeVisible()
  await expect(column(page, 'Ideas').getByText('Write docs')).toBeVisible()

  await page.getByRole('link', { name: 'Settings' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Tasks as CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`${project.key}-tasks.csv`)
  const csv = await readFile((await download.path()) ?? '', 'utf8')
  expect(csv).toContain('Migrate the database')
  expect(csv).toContain('urgent')
})

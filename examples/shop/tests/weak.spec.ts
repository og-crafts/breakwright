import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/reset')
  await page.goto('/')
})

test('add a mug (weak)', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Mug' }).click()
  await expect(page).toHaveURL('/')
})

test('order (weak)', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Mug' }).click()
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('heading', { name: 'Demo shop' })).toBeVisible()
})

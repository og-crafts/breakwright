import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/reset')
  await page.goto('/')
})

test('sign in greets the person', async ({ page }) => {
  await page.getByLabel('Email').fill('asha@example.com')
  await page.getByLabel('Password').fill('secret')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('status')).toHaveText('Welcome Asha')
})

test('add a mug', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Mug' }).click()
  await expect(page.getByRole('status')).toHaveText('Mug added')
  await expect(page.locator('#cart li')).toContainText('Mug x1')
  await expect(page.getByTestId('total')).toHaveText('$12')
})

test('order', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Mug' }).click()
  await expect(page.getByTestId('total')).toHaveText('$12')
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page.getByRole('status')).toHaveText('Order 1001 placed')
  await expect(page.locator('#cart li')).toHaveCount(0)
})

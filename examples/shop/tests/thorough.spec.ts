import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/reset')
  await page.goto('/')
})
const status = 'status'

test('lists products with prices and stock', async ({ page }) => {
  await expect(page.getByRole('list', { name: 'Products' }).getByRole('listitem')).toHaveText([/Mug \$12/, /Lamp \$40/, /Chair \$90/])
  await expect(page.getByRole('button', { name: 'Add Chair' })).toBeDisabled()
})
test('search narrows the list', async ({ page }) => {
  await page.getByLabel('Search').fill('lam')
  await expect(page.getByRole('list', { name: 'Products' }).getByRole('listitem')).toHaveText([/Lamp/])
})
test('two mugs and a lamp add up, and a lamp can be removed', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Mug' }).click()
  await expect(page.getByRole(status)).toHaveText('Mug added')
  await expect(page.locator('#cart li')).toContainText(['Mug x1'])
  await page.getByRole('button', { name: 'Add Mug' }).click()
  await expect(page.locator('#cart li')).toContainText(['Mug x2'])
  await page.getByRole('button', { name: 'Add Lamp' }).click()
  await expect(page.getByTestId('total')).toHaveText('$64')
  await page.getByRole('button', { name: 'Remove Lamp' }).click()
  await expect(page.getByTestId('total')).toHaveText('$24')
})
test('a wrong password is refused', async ({ page }) => {
  await page.getByLabel('Password').fill('nope')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole(status)).toHaveText('Wrong email or password')
})
test('coupons', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Mug' }).click()
  await expect(page.getByTestId('total')).toHaveText('$12')
  await page.getByLabel('Coupon').fill('BAD')
  await page.getByRole('button', { name: 'Apply coupon' }).click()
  await expect(page.getByRole(status)).toHaveText('Unknown coupon')
  await page.getByLabel('Coupon').fill('SAVE10')
  await page.getByRole('button', { name: 'Apply coupon' }).click()
  await expect(page.getByTestId('total')).toHaveText('$10.8')
})

import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '../../playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/');

  const logoutBtn = page.locator('.app-nav-link-logout');
  if (await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await logoutBtn.click();
    await page.waitForLoadState('networkidle');
  }

  await page.locator('span.app-nav-link').filter({ hasText: 'Login' }).click();
  await page.getByLabel('Benutzer').fill('e2e-test-user');
  await page.getByRole('textbox', { name: 'Passwort' }).fill('Test1234!');
  await page.getByRole('button', { name: 'Anmelden' }).click();

  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({
    timeout: 15000,
  });

  await page.waitForTimeout(1000);
  await page.context().storageState({ path: authFile });
});

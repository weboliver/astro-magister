import { test, expect } from '@playwright/test';

test('new user can register and auto-login to dashboard', async ({ page }) => {
  const username = 'e2e-reg-' + Date.now();
  const password = 'Test1234!';

  await page.context().clearCookies();
  await page.goto('/');
  await page.waitForSelector('nav.app-nav');

  await page.locator('span.app-nav-link').filter({ hasText: 'Login' }).click();
  await page.getByRole('link', { name: 'Neuen Benutzer erstellen' }).click();

  await page.getByLabel('Benutzer').fill(username);
  await page.getByRole('textbox', { name: /^Passwort$/ }).fill(password);
  await page.getByLabel('Passwort erneut eingeben').fill(password);

  await page.getByRole('button', { name: 'Erstellen' }).click();

  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({
    timeout: 15000,
  });
});

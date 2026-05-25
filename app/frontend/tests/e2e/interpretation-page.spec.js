import { test, expect } from '@playwright/test';

test('InterpretationPage shared layout renders all structural elements', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({ timeout: 10000 });

  await page.locator('span.app-nav-link').filter({ hasText: 'Horoskop' }).click();
  await expect(page.getByRole('heading', { name: 'Horoskop', exact: true })).toBeVisible({ timeout: 5000 });

  await expect(page.getByTestId('person-selector')).toBeVisible({ timeout: 5000 });

  await expect(page.getByText('Klicke auf «Horoskop interpretieren»')).toBeVisible({ timeout: 5000 });

  const interpretBtn = page.getByRole('button', { name: 'Horoskop interpretieren' });
  await expect(interpretBtn).toBeVisible();
  await expect(interpretBtn).not.toBeDisabled();

  const questionArea = page.locator('textarea').first();
  await expect(questionArea).toBeVisible();
  await expect(questionArea).toBeEnabled();

  const chartPanel = page.locator('h4').filter({ hasText: 'Horoskop Diagramm' });
  await expect(chartPanel).toBeVisible();

  const historyDropdown = page.locator('h4').filter({ hasText: 'Bisherige Auswertungen' });
  await expect(historyDropdown).toBeVisible({ timeout: 5000 });
});

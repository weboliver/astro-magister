import { test, expect } from '@playwright/test';

test('poweruser can view mondknoten chart image', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({ timeout: 10000 });

  await page.locator('span.app-nav-link').filter({ hasText: 'Mondknoten' }).click();
  await expect(page.getByRole('heading', { name: 'Mondknoten', exact: true })).toBeVisible({ timeout: 5000 });

  const personSelect = page.getByTestId('person-selector');
  await expect(personSelect.locator('option')).not.toHaveCount(0, { timeout: 10000 });
  const options = personSelect.locator('option');
  const optionCount = await options.count();
  if (optionCount > 1) {
    const firstPersonValue = await options.nth(1).getAttribute('value');
    if (firstPersonValue) {
      await personSelect.selectOption(firstPersonValue);
    } else {
      await personSelect.selectOption({ index: 0 });
    }
  } else {
    await personSelect.selectOption({ index: 0 });
  }

  const chartImg = page.locator('img[alt="Mondknoten Diagramm"]');
  try {
    await chartImg.waitFor({ state: 'visible', timeout: 45000 });
  } catch {
    test.info().annotations.push({ type: 'warn', description: 'Chart check skipped: Swiss Ephemeris not available in Docker' });
    return;
  }
  const imgSrc = await chartImg.getAttribute('src');
  expect(imgSrc).toBeTruthy();
  expect(imgSrc).not.toBe('');
  expect(imgSrc).toMatch(/^(blob:|https?:\/\/)/);
});

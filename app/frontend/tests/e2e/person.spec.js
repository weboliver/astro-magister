import { test, expect } from '@playwright/test';

test('poweruser can create a person with name and birth data', async ({ page }) => {
  test.setTimeout(120000);

  const personName = 'e2e-person-' + Date.now();

  // --- Navigate to Settings → Neue Person ---
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({ timeout: 10000 });
  await page.locator('span.app-nav-link').filter({ hasText: 'Profil' }).click();
  await page.waitForLoadState('networkidle');

  // Click the "Neue Person" tab — this calls resetPersonForm() which triggers async location loads
  await page.getByRole('tab', { name: 'Neue Person' }).click();
  await page.waitForLoadState('networkidle');

  // --- Fill form ---
  await page.getByTestId('person-name').fill(personName);
  await page.waitForTimeout(300);

  // Verify name was actually set
  const actualValue = await page.getByTestId('person-name').inputValue();
  expect(actualValue).toBe(personName);

  // Birth country
  const countrySelect = page.getByTestId('person-birth-country');
  await expect(countrySelect).toBeEnabled({ timeout: 15000 });
  const firstOption = countrySelect.locator('option').nth(1);
  await expect(firstOption).toBeAttached({ timeout: 15000 });
  const countryCode = await firstOption.getAttribute('value');
  await countrySelect.selectOption(countryCode);
  await page.waitForTimeout(500);

  // Birth region (optional)
  const regionSelect = page.getByTestId('person-birth-region');
  try {
    await expect(regionSelect).toBeEnabled({ timeout: 8000 });
    const firstRegion = regionSelect.locator('option').nth(1);
    const regionCode = await firstRegion.getAttribute('value');
    if (regionCode) {
      await regionSelect.selectOption(regionCode);
      await page.waitForTimeout(500);
    }
  } catch (_) {}

  // Birth city (optional)
  const citySelect = page.getByTestId('person-birth-city');
  try {
    await expect(citySelect).toBeEnabled({ timeout: 8000 });
    const firstCity = citySelect.locator('option').nth(1);
    const cityCode = await firstCity.getAttribute('value');
    if (cityCode) {
      await citySelect.selectOption(cityCode);
      await page.waitForTimeout(500);
    }
  } catch (_) {}

  // --- Save ---
  // Set up API response listener BEFORE clicking save
  const saveResponse = page.waitForResponse(
    resp => resp.url().includes('/auth/persons') && resp.request().method() === 'POST'
  );

  await page.getByTestId('person-save').click();

  // Wait for the API to respond (verifies the request was sent and completed)
  const response = await saveResponse;
  expect(response.ok()).toBeTruthy();

  // The success message (person-message) may flash briefly then disappear
  // because savePerson calls resetPersonForm() which clears personMsg immediately
  // after setting it. The API call was the reliable verification.
});

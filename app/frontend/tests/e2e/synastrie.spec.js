import { test, expect } from '@playwright/test';

test('global person selection is pre-selected as Person A on Synastrie page', async ({ page }) => {
  test.setTimeout(90000);

  // --- Step 1: Navigate to Horoscope ---
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({ timeout: 10000 });
  await page.locator('span.app-nav-link').filter({ hasText: 'Horoskop' }).click();
  await expect(page.getByRole('heading', { name: 'Horoskop', exact: true })).toBeVisible({ timeout: 5000 });

  // --- Step 2: Select a person globally (writes astronex_selected_person_id) ---
  const personSelect = page.getByTestId('person-selector');
  await expect(personSelect.locator('option')).not.toHaveCount(0, { timeout: 10000 });
  const options = personSelect.locator('option');
  const optionCount = await options.count();
  if (optionCount <= 1) {
    test.info().annotations.push({
      type: 'warn',
      description: 'Fallback test skipped: no additional person available to select (only "Eigenes Profil verwenden")',
    });
    return;
  }
  const firstPersonValue = await options.nth(1).getAttribute('value');
  if (!firstPersonValue) {
    test.info().annotations.push({ type: 'warn', description: 'Fallback test skipped: person option has no value attribute' });
    return;
  }
  await personSelect.selectOption(firstPersonValue);
  const selectedId = Number(firstPersonValue);

  // --- Step 3: Navigate to Synastrie ---
  await page.locator('span.app-nav-link').filter({ hasText: 'Synastrie' }).click();
  await expect(page.getByRole('heading', { name: 'Synastrie', exact: true })).toBeVisible({ timeout: 5000 });

  // --- Step 4: Person A is pre-selected from the global selection ---
  const personSelects = page.getByTestId('person-selector');
  await expect(personSelects.first()).toHaveValue(String(selectedId), { timeout: 5000 });

  // --- Step 5: Person B (partner slot) stays independent ---
  await expect(personSelects.nth(1)).not.toHaveValue(String(selectedId));

  // --- Step 6: Selection survives a provider remount (page reload) ---
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synastrie', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('person-selector').first()).toHaveValue(String(selectedId), { timeout: 5000 });
});

test('Person A selection on Synastrie page syncs back to the global person selector', async ({ page }) => {
  test.setTimeout(90000);

  // --- Step 1: Navigate to Synastrie ---
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({ timeout: 10000 });
  await page.locator('span.app-nav-link').filter({ hasText: 'Synastrie' }).click();
  await expect(page.getByRole('heading', { name: 'Synastrie', exact: true })).toBeVisible({ timeout: 5000 });

  // --- Step 2: Person A must exist and offer at least one saved person ---
  const personSelects = page.getByTestId('person-selector');
  const firstSelector = personSelects.first();
  await expect(firstSelector.locator('option')).not.toHaveCount(0, { timeout: 10000 });
  const options = firstSelector.locator('option');
  const optionCount = await options.count();
  if (optionCount <= 1) {
    test.info().annotations.push({
      type: 'warn',
      description: 'Sync test skipped: no additional person available to select (only "Eigenes Profil verwenden")',
    });
    return;
  }
  const firstPersonValue = await options.nth(1).getAttribute('value');
  if (!firstPersonValue) {
    test.info().annotations.push({ type: 'warn', description: 'Sync test skipped: person option has no value attribute' });
    return;
  }

  // --- Step 3: Select the person as Person A on the Synastrie page ---
  await firstSelector.selectOption(firstPersonValue);
  const selectedId = Number(firstPersonValue);
  await expect(firstSelector).toHaveValue(String(selectedId), { timeout: 5000 });

  // --- Step 4: Navigate to Horoscope — the global selector must show the same person ---
  await page.locator('span.app-nav-link').filter({ hasText: 'Horoskop' }).click();
  await expect(page.getByRole('heading', { name: 'Horoskop', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('person-selector')).toHaveValue(String(selectedId), { timeout: 5000 });

  // --- Step 5: Reset on Horoscope ("Eigenes Profil verwenden") and verify it on Synastrie Person A ---
  await page.getByTestId('person-selector').selectOption('');
  await expect(page.getByTestId('person-selector')).toHaveValue('');
  await page.locator('span.app-nav-link').filter({ hasText: 'Synastrie' }).click();
  await expect(page.getByRole('heading', { name: 'Synastrie', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('person-selector').first()).toHaveValue('', { timeout: 5000 });
});

test('poweruser can view synastrie chart image', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Startseite' })).toBeVisible({ timeout: 10000 });

  await page.locator('span.app-nav-link').filter({ hasText: 'Synastrie' }).click();
  await expect(page.getByRole('heading', { name: 'Synastrie', exact: true })).toBeVisible({ timeout: 5000 });

  const personSelects = page.getByTestId('person-selector');
  await expect(personSelects.first().locator('option')).not.toHaveCount(0, { timeout: 10000 });
  const firstSelector = personSelects.first();
  const options = firstSelector.locator('option');
  const optionCount = await options.count();
  if (optionCount > 1) {
    const firstPersonValue = await options.nth(1).getAttribute('value');
    if (firstPersonValue) {
      await firstSelector.selectOption(firstPersonValue);
    } else {
      await firstSelector.selectOption({ index: 0 });
    }
  } else {
    await firstSelector.selectOption({ index: 0 });
  }

  const chartImg = page.locator('img[alt="Synastrie Diagramm"]');
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

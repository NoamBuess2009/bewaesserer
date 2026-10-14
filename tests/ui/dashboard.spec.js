import { test, expect } from '@playwright/test';

test('real API: save a schedule, start and automatically stop', async ({ page, request }) => {
  await request.put('http://127.0.0.1:8080/api/settings', { data: { times: ['07:00', '19:00'], duration_seconds: 150 } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Verbunden', exact: true })).toBeVisible();
  await page.getByLabel('Erste Bewässerungszeit').fill('06:15');
  await page.getByLabel('Wie lange darf’s sein?').fill('2');
  await page.getByRole('button', { name: 'Zeitplan speichern' }).click();
  await expect(page.locator('.toast')).toContainText('auf der Anlage gespeichert');
  await expect.poll(async () => (await (await request.get('http://127.0.0.1:8080/api/state')).json()).settings.times[0]).toBe('06:15');
  await page.getByRole('button', { name: 'Jetzt bewässern' }).click();
  await expect(page.getByRole('button', { name: 'Bewässerung stoppen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jetzt bewässern' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Jetzt bewässern' }).click();
  await page.getByRole('button', { name: 'Bewässerung stoppen' }).click();
  await expect(page.locator('.toast')).toContainText('gestoppt');
  const state = await (await request.get('http://127.0.0.1:8080/api/state')).json();
  expect(state.status.watering).toBe(false);
  await request.put('http://127.0.0.1:8080/api/settings', { data: { times: ['07:00', '19:00'], duration_seconds: 150 } });
});

test('polling preserves unsaved edits and handles offline state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Verbunden', exact: true })).toBeVisible();
  await page.getByLabel('Erste Bewässerungszeit').fill('05:30');
  await page.waitForTimeout(3600);
  await expect(page.getByLabel('Erste Bewässerungszeit')).toHaveValue('05:30');
  await page.route('**/api/state', (route) => route.abort());
  await expect(page.getByRole('button', { name: 'Nicht verbunden', exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Anlage verbinden', exact: true })).toBeVisible();
});

test('demo works independently, persists edits and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('gruenzeit-demo', 'true'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Du bist im Demogarten.')).toBeVisible();
  await page.getByLabel('Zweite Bewässerungszeit').fill('21:30');
  await page.getByLabel('Wie lange darf’s sein?').fill('3');
  await page.getByRole('button', { name: 'Zeitplan speichern' }).click();
  await page.reload();
  await expect(page.getByLabel('Zweite Bewässerungszeit')).toHaveValue('21:30');
  await page.getByRole('button', { name: 'Jetzt bewässern' }).click();
  await expect(page.getByRole('button', { name: 'Bewässerung stoppen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jetzt bewässern' })).toBeVisible({ timeout: 7000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Zweite Bewässerungszeit').fill('19:00');
  await page.getByLabel('Wie lange darf’s sein?').fill('150');
  await page.getByRole('button', { name: 'Zeitplan speichern' }).click();
  await page.getByRole('button', { name: 'Hinweis schliessen' }).click();
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Zeitplan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dein täglicher Rhythmus' })).toBeInViewport();
  expect(errors).toEqual([]);
});

test('desktop dashboard and accessible connection dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(() => localStorage.setItem('gruenzeit-demo', 'true'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ein guter Tag für mehr Grün.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Verbindungseinstellungen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Adresse deiner Steuerung')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Verbindungseinstellungen' })).toBeFocused();
});

test('dashboard fits small phones, tablets and compact desktops', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gruenzeit-demo', 'true'));
  await page.goto('/');
  for (const width of [360, 700, 768, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}px`).toBe(true);
    await expect(page.getByRole('button', { name: 'Jetzt bewässern' })).toBeVisible();
    if (width === 768) await page.screenshot({ path: 'test-results/dashboard-tablet.png', fullPage: true });
  }
});

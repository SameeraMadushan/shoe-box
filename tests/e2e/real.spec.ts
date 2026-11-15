// The real (non-mock) services, as far as they can go without an iPhone.
import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { button, newUserData } from './helpers';

const vendor = join(__dirname, '../../vendor', `${process.platform}-${process.arch}`);

test('real mode starts, runs the bundled device tool, and finds no iPhone', async () => {
  test.skip(!existsSync(vendor), 'run "npm run vendor" first');
  const userData = newUserData();
  const app = await electron.launch({
    args: ['.'],
    env: { ...(process.env as Record<string, string>), CHAT_ARCHIVE_MOCK: '', CHAT_ARCHIVE_USER_DATA: userData, CHAT_ARCHIVE_DATA_DIR: join(userData, 'data') },
  });
  const page = await app.firstWindow();
  const state = await page.evaluate(() => window.api.getState());
  expect(state.mock).toBe(false);
  // No OAuth client at build time: Drive sync reports "not configured".
  expect(state.drive.status).toBe('unconfigured');
  // idevicepair 1.4.0 cannot switch Wi-Fi syncing on, so the manual instruction is shown.
  expect(state.wifiManualSetup).toBe(true);

  await button(page, 'Get started').click();
  await expect(page.getByText('Looking for an iPhone…')).toBeVisible();
  // Several polls of the real idevice_id binary: no device, and no error either.
  await page.waitForTimeout(5000);
  await expect(page.getByText('Looking for an iPhone…')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(button(page, 'Continue')).toBeDisabled();
  const stats = await app.evaluate(() => (globalThis as unknown as { __networkGuardStats: { allowedExternal: number } }).__networkGuardStats);
  expect(stats.allowedExternal).toBe(0);
  await app.close();
});

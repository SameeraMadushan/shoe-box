import { expect, test, type ElectronApplication } from '@playwright/test';
import { button, launch, newUserData, onboard, toPasswordStep } from './helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

test('renderer is sandboxed and cannot reach the network', async () => {
  const s = await launch();
  app = s.app;
  expect(await s.page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
  const outcome = await s.page.evaluate(() =>
    fetch('https://example.com/')
      .then(() => 'reached')
      .catch(() => 'blocked'),
  );
  expect(outcome).toBe('blocked');
  // An image request is not covered by connect-src; the network guard must cancel it.
  const image = await s.page.evaluate(
    () =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve('reached');
        img.onerror = () => resolve('blocked');
        img.src = 'https://example.com/pixel.png';
      }),
  );
  expect(image).toBe('blocked');
});

test('full onboarding, then no request has left the app with Drive off', async () => {
  const s = await launch();
  app = s.app;
  const { page } = s;
  await expect(page.getByRole('heading', { name: 'Keep your iPhone chats on your own computer' })).toBeVisible();
  await button(page, 'Get started').click();
  await expect(page.getByText('Step 1 of 6')).toBeVisible();
  await expect(page.getByText(/iPhone found: iPhone 15/)).toBeVisible();
  await button(page, 'Continue').click();
  await expect(page.getByRole('heading', { name: 'Tap Trust on your iPhone' })).toBeVisible();
  await expect(page.getByText('This computer is trusted')).toBeVisible();
  await button(page, 'Continue').click();

  await expect(page.getByRole('heading', { name: 'Set a backup password' })).toBeVisible();
  await page.getByLabel('Backup password').fill('abcd');
  await page.getByLabel('Type it again').fill('abce');
  await expect(page.getByText('The two passwords do not match')).toBeVisible();
  await expect(button(page, 'Save password')).toBeDisabled();
  await page.getByLabel('Type it again').fill('abcd');
  await expect(page.getByText('Passwords match')).toBeVisible();
  await button(page, 'Save password').click();

  await expect(page.getByRole('switch', { name: 'Wi-Fi syncing' })).toHaveAttribute('aria-checked', 'true');
  await button(page, 'Start first backup').click();
  await expect(page.getByRole('heading', { name: 'First backup in progress' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'First backup finished' })).toBeVisible({ timeout: 20_000 });
  await button(page, 'Continue').click();

  await expect(page.getByRole('heading', { name: 'Your chats are saved on this computer' })).toBeVisible();
  await expect(page.locator('.tile').nth(0)).toContainText('5');
  await expect(page.locator('.tile').nth(1)).toContainText('22');
  await expect(page.getByText(/cannot be restored back into the chat app/)).toBeVisible();
  await button(page, 'Open my chats').click();

  await expect(page.getByRole('button', { name: /Nadia Perera/ })).toBeVisible();
  await expect(page.getByText('Love it. See you at 11').last()).toBeVisible();
  await expect(page.getByText('Deleted on phone · kept here')).toBeVisible();
  await expect(page.getByText(/Read-only archive · last updated today/)).toBeVisible();
  // The brand rule: the chat app is never named in the UI.
  expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('whatsapp');

  const stats = await s.app.evaluate(() => (globalThis as unknown as { __networkGuardStats: { allowedExternal: number } }).__networkGuardStats);
  expect(stats.allowedExternal).toBe(0);
});

test('search filters chats, rings matches and shows the empty state', async () => {
  const s = await launch();
  app = s.app;
  const { page } = s;
  await onboard(page);
  await page.getByLabel('Search chats and messages').fill('camera');
  await expect(page.getByRole('button', { name: /Nadia Perera/ })).toContainText('1 matching message');
  await expect(page.getByRole('button', { name: /Weekend Hikers/ })).toContainText('1 matching message');
  await expect(page.getByRole('button', { name: /Ravi/ })).toHaveCount(0);
  await expect(page.locator('[data-hit]')).toHaveText(/Bring the camera/);
  await page.getByLabel('Search chats and messages').fill('zzzz');
  await expect(page.getByText('No chats or messages match your search.')).toBeVisible();
  await page.getByLabel('Search chats and messages').fill('ravi');
  await expect(page.getByRole('button', { name: /Ravi/ })).toBeVisible();
});

test('voice note plays and pauses; a photo opens in the lightbox', async () => {
  const s = await launch();
  app = s.app;
  const { page } = s;
  await onboard(page);
  await button(page, 'Play voice note').click();
  await expect(button(page, 'Pause voice note')).toBeVisible();
  await button(page, 'Pause voice note').click();
  await expect(button(page, 'Play voice note')).toBeVisible();
  await expect(page.getByText('Not available on this iPhone at backup time')).toBeVisible();
  await button(page, 'Open photo').click();
  await expect(page.getByRole('dialog', { name: 'Photo' })).toBeVisible();
  expect(await page.getByAltText('Photo, full size').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(520);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Photo' })).toHaveCount(0);
});

test('a failed backup shows the banner and the dot, and a retry clears them', async () => {
  const s = await launch({ flags: 'fail' });
  app = s.app;
  const { page } = s;
  await onboard(page);
  await button(page, 'Backup and settings').click();
  await button(page, 'Back up now').click();
  await expect(page.getByTestId('status-title')).toHaveText('Last backup failed', { timeout: 15_000 });
  await expect(page.getByTestId('backup-dot')).toBeVisible();
  await expect(page.getByTestId('history-row').first()).toContainText('Failed');
  await button(page, 'Chats').click();
  await expect(page.getByRole('alert')).toContainText('The last backup did not run.');
  await page.getByRole('alert').getByRole('button', { name: 'Retry now' }).click();
  await expect(page.getByTestId('status-title')).toHaveText('Last backup succeeded', { timeout: 15_000 });
  await expect(page.getByTestId('backup-dot')).toHaveCount(0);
  await expect(page.getByTestId('history-row').first()).toContainText('Manual backup · no new messages');
});

test('schedule edits and the last open screen persist across a restart', async () => {
  const userData = newUserData();
  let s = await launch({ userData });
  await onboard(s.page);
  await button(s.page, 'Backup and settings').click();
  await s.page.getByLabel('Backup time').fill('06:30');
  await s.page.getByRole('switch', { name: 'Notify me when a backup fails' }).click();
  await expect(s.page.getByText(/Next backup: .* at 06:30/)).toBeVisible();
  await s.app.close();

  s = await launch({ userData });
  app = s.app;
  await expect(s.page.getByRole('heading', { name: 'Backup and settings' })).toBeVisible();
  await expect(s.page.getByLabel('Backup time')).toHaveValue('06:30');
  await expect(s.page.getByRole('switch', { name: 'Notify me when a backup fails' })).toHaveAttribute('aria-checked', 'false');
  await expect(s.page.getByRole('switch', { name: 'Back up automatically every day' })).toHaveAttribute('aria-checked', 'true');
});

test('Drive toggle walks through connect, recovery key, connected and disconnect', async () => {
  const s = await launch();
  app = s.app;
  const { page } = s;
  await onboard(page);
  await button(page, 'Backup and settings').click();
  const drive = page.getByRole('region', { name: 'Google Drive sync' });
  await expect(drive).toHaveAttribute('data-drive', 'off');
  await page.getByRole('switch', { name: 'Google Drive sync' }).click();
  await expect(drive.getByText('No Google account connected yet')).toBeVisible();
  await button(page, 'Connect Google account').click();
  await expect(page.getByTestId('recovery-key')).toHaveText(/^([A-Z2-7]{4}-){25}[A-Z2-7]{4}$/);
  await button(page, 'I have saved it').click();
  await expect(drive.getByText('Connected · you@example.com')).toBeVisible();
  await expect(drive.getByText(/encrypted · syncs after each backup/)).toBeVisible();

  await button(page, 'Back up now').click();
  await expect(page.getByTestId('history-row')).toHaveCount(2, { timeout: 15_000 });
  await expect(drive).toHaveAttribute('data-drive', 'connected');

  await button(page, 'Disconnect').click();
  await expect(drive.getByText('No Google account connected yet')).toBeVisible();
  await page.getByRole('switch', { name: 'Google Drive sync' }).click();
  await expect(drive).toHaveAttribute('data-drive', 'off');
});

test('Drive shows "not configured" when the build has no OAuth client, and a failed sync does not fail the backup', async () => {
  let s = await launch({ flags: 'nodrive' });
  await onboard(s.page);
  await button(s.page, 'Backup and settings').click();
  await expect(s.page.getByText('Drive sync is not configured in this build.')).toBeVisible();
  await expect(s.page.getByRole('switch', { name: 'Google Drive sync' })).toBeDisabled();
  await s.app.close();

  s = await launch({ flags: 'drivefail' });
  app = s.app;
  await onboard(s.page);
  await button(s.page, 'Backup and settings').click();
  await s.page.getByRole('switch', { name: 'Google Drive sync' }).click();
  await button(s.page, 'Connect Google account').click();
  await button(s.page, 'I have saved it').click();
  await button(s.page, 'Back up now').click();
  await expect(s.page.getByText(/Backup saved on this computer; Drive sync failed/)).toBeVisible({ timeout: 15_000 });
  await expect(s.page.getByTestId('status-title')).toHaveText('Last backup succeeded');
});

test('existing backup password: the second variant appears and a wrong password is rejected', async () => {
  const s = await launch({ flags: 'encrypted' });
  app = s.app;
  const { page } = s;
  await toPasswordStep(page);
  await expect(page.getByRole('heading', { name: 'Enter your iPhone backup password' })).toBeVisible();
  await expect(page.getByLabel('Type it again')).toHaveCount(0);
  await page.getByLabel('Backup password').fill('wrong');
  await button(page, 'Continue').click();
  await button(page, 'Start first backup').click();
  await expect(page.getByRole('alert')).toContainText('The backup password is not correct.', { timeout: 20_000 });
  await button(page, 'Enter password again').click();
  await page.getByLabel('Backup password').fill('right');
  await button(page, 'Continue').click();
  await button(page, 'Start first backup').click();
  await expect(page.getByRole('heading', { name: 'First backup finished' })).toBeVisible({ timeout: 20_000 });
});

test('Windows without Apple drivers blocks onboarding until "Check again" passes', async () => {
  const s = await launch({ flags: 'win,nodrivers' });
  app = s.app;
  const { page } = s;
  await expect(page.getByText(/Apple device drivers were not found/)).toBeVisible();
  await expect(button(page, 'Get started')).toBeDisabled();
  await button(page, 'Check again').click();
  await expect(page.getByText(/Apple device drivers: found/)).toBeVisible();
  await expect(button(page, 'Get started')).toBeEnabled();
});

test('too little disk space blocks the first backup', async () => {
  const s = await launch({ flags: 'lowdisk' });
  app = s.app;
  const { page } = s;
  await toPasswordStep(page);
  await page.getByLabel('Backup password').fill('abcd');
  await page.getByLabel('Type it again').fill('abcd');
  await button(page, 'Save password').click();
  await button(page, 'Start first backup').click();
  await expect(page.getByRole('alert')).toContainText('Not enough free disk space for the first backup.');
  await expect(page.getByRole('heading', { name: 'Back up over Wi-Fi from now on' })).toBeVisible();
});

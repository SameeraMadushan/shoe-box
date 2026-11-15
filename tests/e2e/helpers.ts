import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const newUserData = (): string => mkdtempSync(join(tmpdir(), 'shoebox-e2e-'));

/** Launches the built app in mock mode with its own throwaway profile. */
export async function launch(options: { flags?: string; userData?: string; speed?: number } = {}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = options.userData ?? newUserData();
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...(process.env as Record<string, string>),
      SHOEBOX_MOCK: '1',
      SHOEBOX_MOCK_SPEED: String(options.speed ?? 25),
      SHOEBOX_MOCK_FLAGS: options.flags ?? '',
      SHOEBOX_USER_DATA: userData,
    },
  });
  const page = await app.firstWindow();
  return { app, page, userData };
}

export const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name });

/** Clicks through onboarding up to the password step. */
export async function toPasswordStep(page: Page): Promise<void> {
  await button(page, 'Get started').click();
  await expect(page.getByText(/iPhone found: iPhone 15/)).toBeVisible();
  await button(page, 'Continue').click();
  await expect(page.getByText('This computer is trusted')).toBeVisible();
  await button(page, 'Continue').click();
}

/** Completes the whole onboarding with a new backup password. */
export async function onboard(page: Page): Promise<void> {
  await toPasswordStep(page);
  await page.getByLabel('Backup password').fill('correct horse');
  await page.getByLabel('Type it again').fill('correct horse');
  await button(page, 'Save password').click();
  await button(page, 'Start first backup').click();
  await expect(page.getByRole('heading', { name: 'First backup finished' })).toBeVisible({ timeout: 20_000 });
  await button(page, 'Continue').click();
  await button(page, 'Open my chats').click();
  await expect(page.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
}

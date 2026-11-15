import { create } from 'zustand';
import type { AppState, Screen } from '../../shared/types';

export type Step = 'welcome' | 'connect' | 'trust' | 'password' | 'wifi' | 'sync' | 'done';
export const STEPS: Step[] = ['connect', 'trust', 'password', 'wifi', 'sync', 'done'];

interface UiState {
  app: AppState | null;
  step: Step;
  screen: Screen;
  /** When the onboarding backup was started, to tell its result from older runs. */
  syncStartedAt: number;
  aboutOpen: boolean;
  setApp(app: AppState): void;
  go(step: Step): void;
  setScreen(screen: Screen): void;
  startFirstBackup(): void;
}

export const useUi = create<UiState>((set, get) => ({
  app: null,
  step: 'welcome',
  screen: 'chats',
  syncStartedAt: 0,
  aboutOpen: false,
  setApp: (app) => set(get().app ? { app } : { app, screen: app.settings.lastScreen }),
  go: (step) => set({ step }),
  setScreen: (screen) => {
    set({ screen });
    void window.api.updateSettings({ lastScreen: screen });
  },
  startFirstBackup: () => {
    set({ step: 'sync', syncStartedAt: Date.now() });
    void window.api.backupNow();
  },
}));

/** The loaded app state. Screens only render once it is available. */
export function useApp(): AppState {
  return useUi((s) => s.app)!;
}

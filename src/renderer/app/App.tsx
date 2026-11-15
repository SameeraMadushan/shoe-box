import { useEffect } from 'react';
import { BackupIcon, ChatsIcon } from '../components/Icons';
import { Backup } from '../screens/backup/Backup';
import { Chats } from '../screens/chats/Chats';
import { Onboarding } from '../screens/onboarding/Onboarding';
import { useUi } from './store';

export function App() {
  const { app, screen, setApp, setScreen } = useUi();

  useEffect(() => {
    void window.api.getState().then(setApp);
    const offState = window.api.on('state', setApp);
    const offNav = window.api.on('navigate', (to) => useUi.setState({ screen: to }));
    return () => {
      offState();
      offNav();
    };
  }, [setApp]);

  if (!app) return null;
  if (!app.settings.onboarded) return <Onboarding />;

  const failed = app.history[0]?.status === 'failed';
  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <button aria-label="Chats" aria-current={screen === 'chats' ? 'page' : undefined} onClick={() => setScreen('chats')}>
          <ChatsIcon />
          <span>Chats</span>
        </button>
        <button aria-label="Backup and settings" aria-current={screen === 'backup' ? 'page' : undefined} onClick={() => setScreen('backup')}>
          <BackupIcon />
          <span>Backup</span>
          {failed && <span className="dot" data-testid="backup-dot" />}
        </button>
      </nav>
      {screen === 'chats' ? <Chats /> : <Backup />}
    </div>
  );
}

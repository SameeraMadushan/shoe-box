import { useEffect } from 'react';
import { About } from '../components/About';
import { AppMark, BackupIcon, ChatsIcon } from '../components/Icons';
import { Backup } from '../screens/backup/Backup';
import { Chats } from '../screens/chats/Chats';
import { Onboarding } from '../screens/onboarding/Onboarding';
import { useUi } from './store';

export function App() {
  const { app, screen, aboutOpen, setApp, setScreen } = useUi();

  useEffect(() => {
    void window.api.getState().then(setApp);
    const offState = window.api.on('state', setApp);
    const offNav = window.api.on('navigate', (to) => useUi.setState({ screen: to }));
    const offAbout = window.api.on('about', () => useUi.setState({ aboutOpen: true }));
    return () => {
      offState();
      offNav();
      offAbout();
    };
  }, [setApp]);

  if (!app) return null;
  if (!app.settings.onboarded) {
    return (
      <>
        <Onboarding />
        {aboutOpen && <About />}
      </>
    );
  }

  const failed = app.history[0]?.status === 'failed';
  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <span className="rail-mark">
          <AppMark size={44} alt="Shoebox" />
        </span>
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
      {aboutOpen && <About />}
    </div>
  );
}

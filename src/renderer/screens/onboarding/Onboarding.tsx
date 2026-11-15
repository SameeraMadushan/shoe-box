import { useEffect, useState, type ReactNode } from 'react';
import { ERROR_COPY, type ErrorCode } from '../../../shared/errors';
import type { Preflight } from '../../../shared/types';
import { bytes, count } from '../../app/format';
import { STEPS, useApp, useUi } from '../../app/store';
import { AppMark, Check, Phone, Warning } from '../../components/Icons';
import { Toggle } from '../../components/Toggle';

const PHASES = ['Backing up iPhone', 'Decrypting chat data', 'Reading chats and messages', 'Indexing photos, videos and voice notes'];

function ErrorPanel({ code, children }: { code: ErrorCode; children?: ReactNode }) {
  return (
    <div className="status bad wrap" role="alert">
      <span className="grow">
        <strong>{ERROR_COPY[code].sentence}</strong> {ERROR_COPY[code].action}
      </span>
      {children}
    </div>
  );
}

function Welcome() {
  const app = useApp();
  const go = useUi((s) => s.go);
  const windows = app.platform === 'win32';
  return (
    <>
      <h1 className="big">Keep your iPhone chats on your own computer</h1>
      <p className="text2">
        Shoebox backs up your iPhone to this computer and lets you read your chats here. Nothing is installed on your iPhone, and
        nothing leaves this computer unless you turn on Google Drive sync.
      </p>
      <div className="inset col gap12">
        <div className="small strong muted">What you need</div>
        <div className="check">
          <Check />
          <span>A USB cable, for the first connection only</span>
        </div>
        <div className="check">
          <Check />
          <span>Free disk space about equal to what is used on your iPhone. The backup copies the whole phone, not just chats.</span>
        </div>
        {windows && app.driversOk && (
          <div className="check">
            <Check />
            <span>Apple device drivers: found (installed with the Apple Devices app)</span>
          </div>
        )}
        {windows && !app.driversOk && (
          <div className="warn" role="alert">
            <Warning />
            <span className="col gap8">
              <span>
                Apple device drivers were not found. Install the Apple Devices app from the Microsoft Store, open it once, then check
                again.
              </span>
              <span className="row gap12 wrap">
                <button className="btn2" onClick={() => void window.api.openExternal('appleDevices')}>
                  Get the Apple Devices app
                </button>
                <button className="btn2" onClick={() => void window.api.checkDrivers()}>
                  Check again
                </button>
              </span>
            </span>
          </div>
        )}
      </div>
      <div>
        <button className="btn" disabled={windows && !app.driversOk} onClick={() => go('connect')}>
          Get started
        </button>
      </div>
    </>
  );
}

function Connect() {
  const { device } = useApp();
  const go = useUi((s) => s.go);
  useEffect(() => {
    void window.api.deviceSearch(true);
    return () => void window.api.deviceSearch(false);
  }, []);
  const found = device.status !== 'idle' && device.status !== 'searching';
  return (
    <>
      <h1>Connect your iPhone with a cable</h1>
      <p className="text2">
        Unlock your iPhone and plug it into this computer. The first connection has to be by cable. After that, backups can run over
        Wi-Fi.
      </p>
      {device.error ? (
        <ErrorPanel code={device.error}>
          <button className="btn2" onClick={() => void window.api.deviceSearch(true)}>
            Try again
          </button>
        </ErrorPanel>
      ) : (
        <div className={`status ${found ? 'ok' : ''}`} role="status">
          <Phone />
          <span>
            {found ? `iPhone found: ${device.name}` : 'Looking for an iPhone…'}
            {found && device.iosVersion && <span className="small muted"> · iOS {device.iosVersion}</span>}
          </span>
        </div>
      )}
      <div className="row gap12 wrap">
        <button className="btn2" onClick={() => go('welcome')}>
          Back
        </button>
        <button className="btn" disabled={!found} onClick={() => go('trust')}>
          Continue
        </button>
      </div>
    </>
  );
}

function Trust() {
  const { device } = useApp();
  const go = useUi((s) => s.go);
  useEffect(() => {
    void window.api.pair();
  }, []);
  const trusted = device.status === 'trusted';
  return (
    <>
      <h1>Tap Trust on your iPhone</h1>
      <p className="text2">Your iPhone is asking whether to trust this computer. Tap Trust, then enter your iPhone passcode.</p>
      <div className="trust-illo" aria-hidden="true">
        <div className="trust-dialog">
          <div className="q">
            <span className="strong">Trust This Computer?</span>
            <span className="meta muted">Shown on your iPhone screen</span>
          </div>
          <div className="opts">
            <span>Trust</span>
            <span>Don't Trust</span>
          </div>
        </div>
      </div>
      {device.error ? (
        <ErrorPanel code={device.error}>
          <button className="btn2" onClick={() => void window.api.pair()}>
            Try again
          </button>
        </ErrorPanel>
      ) : (
        <div className={`status ${trusted ? 'ok' : ''}`} role="status">
          <span>{trusted ? 'This computer is trusted' : 'Waiting for you to tap Trust…'}</span>
        </div>
      )}
      <div className="row gap12 wrap">
        <button className="btn2" onClick={() => go('connect')}>
          Back
        </button>
        <button className="btn" disabled={!trusted} onClick={() => go('password')}>
          Continue
        </button>
      </div>
    </>
  );
}

function Password() {
  const app = useApp();
  const go = useUi((s) => s.go);
  const existing = app.device.willEncrypt === true;
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);

  const mismatch = pw2.length > 0 && pw !== pw2;
  const valid = existing ? pw.length > 0 : pw.length >= 4 && pw === pw2;
  const store = !app.secureStorage
    ? 'This computer cannot store the password securely, so you will be asked for it each time the app starts and automatic backups stay off.'
    : `The password is saved ${app.platform === 'win32' ? 'securely for your Windows account' : 'in macOS Keychain'} so daily backups can run without asking you.`;

  async function save() {
    setBusy(true);
    setError(null);
    const result = await window.api.submitPassword(pw);
    setBusy(false);
    if (result.ok) go('wifi');
    else setError(result.error);
  }

  return (
    <form
      className="col gap20"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void save();
      }}
    >
      <h1>{existing ? 'Enter your iPhone backup password' : 'Set a backup password'}</h1>
      <p className="text2">
        {existing
          ? 'This iPhone already has a backup password from an earlier backup made with Finder or iTunes. Enter that password so Shoebox can read the backup.'
          : 'The iPhone backup is encrypted with this password. Your readable chat archive is protected by your computer login. Turn on FileVault or BitLocker for full protection.'}
      </p>
      <div className="col gap6">
        <label htmlFor="pw1" className="small strong">
          Backup password
        </label>
        <input id="pw1" className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={existing ? 'current-password' : 'new-password'} autoFocus />
      </div>
      {!existing && (
        <div className="col gap6">
          <label htmlFor="pw2" className="small strong">
            Type it again
          </label>
          <input id="pw2" className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          <span className={`small ${mismatch ? 'bad-text' : valid ? 'ok-text' : 'muted'}`} role="status">
            {mismatch ? 'The two passwords do not match' : valid ? 'Passwords match' : 'At least 4 characters'}
          </span>
        </div>
      )}
      {existing ? (
        <div className="info">
          Forgotten it? On your iPhone go to Settings, General, Transfer or Reset iPhone, Reset, Reset All Settings. This keeps your data
          but removes the old backup password, so you can set a new one here.{' '}
          <button type="button" className="link" onClick={() => void window.api.openExternal('resetBackupPassword')}>
            Apple's instructions
          </button>
        </div>
      ) : (
        <div className="warn">
          <Warning />
          <span>{store} If it is lost, existing backups cannot be opened and Apple cannot recover it.</span>
        </div>
      )}
      {existing && (
        <p className="small muted">{store}</p>
      )}
      {error && <ErrorPanel code={error} />}
      <div className="row gap12 wrap">
        <button type="button" className="btn2" onClick={() => go('trust')}>
          Back
        </button>
        <button type="submit" className="btn" disabled={!valid || busy}>
          {existing ? 'Continue' : 'Save password'}
        </button>
      </div>
    </form>
  );
}

function Wifi() {
  const app = useApp();
  const { go, startFirstBackup } = useUi();
  const [check, setCheck] = useState<Preflight | null>(null);
  const [busy, setBusy] = useState(false);

  // Measure up front so the space needed is on screen before the backup starts.
  useEffect(() => {
    void window.api.preflight().then(setCheck);
  }, []);

  async function start() {
    setBusy(true);
    const result = await window.api.preflight();
    setBusy(false);
    setCheck(result);
    if (result.ok) startFirstBackup();
  }

  return (
    <>
      <h1>Back up over Wi-Fi from now on</h1>
      <p className="text2">With Wi-Fi syncing on, you will not need the cable again for daily backups.</p>
      <div className="rows">
        <div>
          <span id="wifiLabel" className="strong">
            Wi-Fi syncing
          </span>
          <Toggle on={app.settings.wifiSync} labelledBy="wifiLabel" onChange={(wifiSync) => void window.api.updateSettings({ wifiSync })} />
        </div>
      </div>
      {app.settings.wifiSync && app.wifiManualSetup && (
        <div className="info">
          One step to do by hand: with the cable connected, open {app.platform === 'win32' ? 'the Apple Devices app' : 'Finder'}, select
          your iPhone and tick "Show this iPhone when on Wi-Fi". Shoebox cannot switch this on for you.
        </div>
      )}
      <div className="inset col gap10">
        <div className="small strong muted">A wireless backup only runs when</div>
        <span>This computer is on and awake</span>
        <span>Your iPhone is on the same Wi-Fi network</span>
        <span>Your iPhone is charging (recommended, not required)</span>
      </div>
      {check && check.ok && check.requiredBytes > 0 && (
        <p className="text2" data-testid="space-needed">
          The first backup needs about <strong>{bytes(check.requiredBytes)}</strong> of disk space. <strong>{bytes(check.availableBytes)}</strong> is
          free on this computer.
        </p>
      )}
      {check && !check.ok && (
        <div className="warn" role="alert">
          <Warning />
          <span>
            <strong>Not enough free disk space for the first backup.</strong> About {bytes(check.requiredBytes)} is needed and{' '}
            {bytes(check.availableBytes)} is free. Free up space, then try again.
          </span>
        </div>
      )}
      <div className="row gap12 wrap">
        <button className="btn2" onClick={() => go('password')}>
          Back
        </button>
        <button className="btn" disabled={busy} onClick={() => void start()}>
          Start first backup
        </button>
      </div>
    </>
  );
}

function Sync() {
  const app = useApp();
  const { go, startFirstBackup, syncStartedAt } = useUi();
  const last = app.history[0];
  // Only a run started from this screen counts; older history is ignored.
  const mine = !app.run && last && last.startedAt * 1000 >= syncStartedAt - 2000 ? last : null;
  const done = mine?.status === 'succeeded';
  const failed = mine?.status === 'failed' ? (mine.errorCode ?? 'UNKNOWN') : null;
  const percent = done ? 100 : (app.run?.percent ?? 0);
  const phase = done ? 4 : (app.run?.phase ?? 0);

  return (
    <>
      <h1>{done ? 'First backup finished' : 'First backup in progress'}</h1>
      <p className="text2">
        Keep the cable connected. The first backup copies your whole iPhone and can take a while. Later backups only copy what changed.
        {app.settings.phoneUsedBytes ? ` It needs about ${bytes(app.settings.phoneUsedBytes)} of disk space.` : ''}
      </p>
      <div className="col gap8">
        <div className="row between strong">
          <span>{done ? 'Finished' : PHASES[phase]}</span>
          <span>{percent}%</span>
        </div>
        <div className="progress" role="progressbar" aria-label="First backup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="col gap10">
        {PHASES.map((label, i) => {
          const state = i < phase ? 'done' : i === phase && !failed ? 'active' : '';
          return (
            <div key={label} className={`phase ${state}`}>
              <span>{label}</span>
              <span className="st">{state === 'done' ? 'Done' : state === 'active' ? 'In progress' : 'Waiting'}</span>
            </div>
          );
        })}
      </div>
      {failed && (
        <ErrorPanel code={failed}>
          {failed === 'WRONG_PASSWORD' ? (
            <button className="btn2" onClick={() => go('password')}>
              Enter password again
            </button>
          ) : (
            <button className="btn2" onClick={startFirstBackup}>
              Try again
            </button>
          )}
        </ErrorPanel>
      )}
      <div className="row gap12 wrap">
        {app.run && (
          <button className="btn2" disabled={app.run.phase > 0} onClick={() => void window.api.cancelBackup()}>
            {app.run.phase > 0 ? 'Finishing…' : 'Stop backup'}
          </button>
        )}
        <button className="btn" disabled={!done} onClick={() => go('done')}>
          Continue
        </button>
      </div>
    </>
  );
}

function Done() {
  const app = useApp();
  const { settings, stats } = app;
  const update = window.api.updateSettings;

  async function open() {
    await window.api.finishOnboarding();
    // Turning Drive on here opens its setup on the Backup screen.
    useUi.getState().setScreen(settings.driveEnabled ? 'backup' : 'chats');
    useUi.getState().go('welcome');
  }

  return (
    <>
      <h1>Your chats are saved on this computer</h1>
      <p className="text2">You can unplug the cable now. Here is what was archived.</p>
      <div className="tiles">
        <div className="tile">
          <div className="n">{count(stats.chats)}</div>
          <div className="small muted">chats</div>
        </div>
        <div className="tile">
          <div className="n">{count(stats.messages)}</div>
          <div className="small muted">messages</div>
        </div>
        <div className="tile">
          <div className="n">{count(stats.media)}</div>
          <div className="small muted">photos, videos, voice notes</div>
        </div>
      </div>
      <div className="rows">
        <div className="tall">
          <div className="col">
            <label htmlFor="obTime" className="strong">
              Back up every day at
            </label>
            <span className="small muted">If the computer is asleep then, the backup runs when it next wakes</span>
          </div>
          <input id="obTime" className="field" type="time" value={settings.scheduleTime} onChange={(e) => void update({ scheduleTime: e.target.value })} />
        </div>
        <div>
          <div className="col">
            <span id="obLogin" className="strong">
              Start when I log in
            </span>
            <span className="small muted">Runs quietly in the {app.platform === 'win32' ? 'system tray' : 'menu bar'}</span>
          </div>
          <Toggle on={settings.startAtLogin} labelledBy="obLogin" onChange={(startAtLogin) => void update({ startAtLogin })} />
        </div>
        <div>
          <div className="col grow">
            <span id="obDrive" className="strong">
              Also copy the archive to Google Drive
            </span>
            <span className="small muted">
              {app.drive.status === 'unconfigured'
                ? 'Drive sync is not configured in this build.'
                : 'Optional. Encrypted before upload. You can set this up later in Backup.'}
            </span>
          </div>
          <Toggle on={settings.driveEnabled} labelledBy="obDrive" disabled={app.drive.status === 'unconfigured'} onChange={(driveEnabled) => void update({ driveEnabled })} />
        </div>
      </div>
      <div className="info">
        Good to know: the chat archive is for keeping and reading your chats. It cannot be put back into the chat app on its own. The
        full iPhone backup kept beside it is in Apple's standard format and can restore a whole iPhone; the Backup screen explains how.
      </div>
      <div>
        <button className="btn" onClick={() => void open()}>
          Open my chats
        </button>
      </div>
    </>
  );
}

const SCREENS = { welcome: Welcome, connect: Connect, trust: Trust, password: Password, wifi: Wifi, sync: Sync, done: Done };

export function Onboarding() {
  const step = useUi((s) => s.step);
  const stepNum = STEPS.indexOf(step) + 1;
  const Screen = SCREENS[step];
  return (
    <div className="onb">
      <div className="onb-head">
        <AppMark />
        <div className="col">
          <span className="onb-name">Shoebox</span>
          <span className="small muted">Free and open source</span>
        </div>
      </div>
      <main className="card">
        {stepNum > 0 && (
          <div className="row gap12">
            <span className="small strong muted">Step {stepNum} of 6</span>
            <div className="dots" aria-hidden="true">
              {STEPS.map((s, i) => (
                <span key={s} className={i < stepNum ? 'on' : ''} />
              ))}
            </div>
          </div>
        )}
        <Screen />
      </main>
    </div>
  );
}

import { useState } from 'react';
import { ERROR_COPY } from '../../../shared/errors';
import type { AppState, RunSummary } from '../../../shared/types';
import { bytes, runDetail, runResult, whenAt } from '../../app/format';
import { useApp, useUi } from '../../app/store';
import { Warning } from '../../components/Icons';
import { Modal } from '../../components/Modal';
import { Toggle } from '../../components/Toggle';

const update = (patch: Parameters<typeof window.api.updateSettings>[0]) => void window.api.updateSettings(patch);

function StatusCard({ app }: { app: AppState }) {
  const last: RunSummary | undefined = app.history[0];
  const failed = last?.status === 'failed';
  const running = app.run !== null;
  const [password, setPassword] = useState('');
  const title = !last ? 'No backup yet' : failed ? 'Last backup failed' : 'Last backup succeeded';
  const detail = !last
    ? 'Your first backup has not run yet.'
    : failed
      ? `${whenAt(last.startedAt)} · ${ERROR_COPY[last.errorCode ?? 'UNKNOWN'].sentence} ${ERROR_COPY[last.errorCode ?? 'UNKNOWN'].action}`
      : `${whenAt(last.startedAt)} · ${runDetail(last, app.settings.scheduleTime)}`;
  const capital = detail.charAt(0).toUpperCase() + detail.slice(1);

  async function savePassword() {
    const result = await window.api.submitPassword(password);
    setPassword('');
    if (result.ok) void window.api.backupNow();
  }

  return (
    <section className={`section pad ${failed ? 'failed' : ''}`} aria-label="Backup status">
      <div className="row between gap16 wrap" style={{ alignItems: 'flex-start' }}>
        <div className="col gap4 grow" style={{ flexBasis: 320 }}>
          <h2 className={failed ? 'bad-text' : last ? 'ok-text' : ''} style={{ fontSize: 18 }} data-testid="status-title">
            {title}
          </h2>
          <span className="text2">{capital}</span>
          <span className="muted" style={{ fontSize: 14 }}>
            {app.nextBackupAt ? `Next backup: ${whenAt(app.nextBackupAt / 1000)}` : 'Automatic backups are off'}
          </span>
        </div>
        <div className="row gap12 wrap">
          {running && (
            // Stopping is possible while the iPhone is being copied; extraction afterwards is short and runs to the end.
            <button className="btn2" disabled={app.run!.phase > 0} onClick={() => void window.api.cancelBackup()}>
              {app.run!.phase > 0 ? 'Finishing…' : 'Stop backup'}
            </button>
          )}
          <button className="btn" disabled={running} onClick={() => void window.api.backupNow()}>
            {running ? `Backing up… ${app.run!.percent}%` : failed ? 'Retry now' : 'Back up now'}
          </button>
        </div>
      </div>
      {running && (
        <div className="progress thin" role="progressbar" aria-label="Backup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={app.run!.percent}>
          <div style={{ width: `${app.run!.percent}%` }} />
        </div>
      )}
      {failed && last.errorCode === 'WRONG_PASSWORD' && !running && (
        <form
          className="row gap12 wrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void savePassword();
          }}
        >
          <label htmlFor="rePw" className="small strong">
            iPhone backup password
          </label>
          <input id="rePw" className="field grow" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="btn2" disabled={!password}>
            Save and retry
          </button>
        </form>
      )}
      <div className="tiles">
        <div className="cond">
          <strong>Computer</strong>On and awake at backup time
        </div>
        <div className="cond">
          <strong>iPhone</strong>On the same Wi-Fi network
        </div>
        <div className="cond">
          <strong>Power</strong>Works best while charging
        </div>
      </div>
    </section>
  );
}

function Schedule({ app }: { app: AppState }) {
  const s = app.settings;
  return (
    <section className="section" aria-label="Schedule">
      <h2>Schedule</h2>
      {!app.secureStorage && (
        <div className="srow first">
          <div className="warn grow">
            <Warning />
            <span>
              Automatic backups are off because this computer cannot store the backup password securely. You can still back up by hand;
              you will be asked for the password after each restart.
            </span>
          </div>
        </div>
      )}
      <div className="srow first">
        <span id="sDaily" className="strong">
          Back up automatically every day
        </span>
        <Toggle on={s.scheduleEnabled && app.secureStorage} disabled={!app.secureStorage} labelledBy="sDaily" onChange={(scheduleEnabled) => update({ scheduleEnabled })} />
      </div>
      <div className="srow tall">
        <div className="col">
          <label htmlFor="sTime" className="strong">
            Backup time
          </label>
          <span className="small muted">If the computer is asleep at this time, the backup runs when it next wakes</span>
        </div>
        <input id="sTime" className="field" type="time" value={s.scheduleTime} onChange={(e) => update({ scheduleTime: e.target.value })} />
      </div>
      <div className="srow">
        <span id="sNotify" className="strong">
          Notify me when a backup fails
        </span>
        <Toggle on={s.notifyOnFail} labelledBy="sNotify" onChange={(notifyOnFail) => update({ notifyOnFail })} />
      </div>
      <div className="srow">
        <div className="col">
          <span id="sLogin" className="strong">
            Start when I log in
          </span>
          <span className="small muted">Keeps running in the {app.platform === 'win32' ? 'system tray' : 'menu bar'} after you close the window</span>
        </div>
        <Toggle on={s.startAtLogin} labelledBy="sLogin" onChange={(startAtLogin) => update({ startAtLogin })} />
      </div>
    </section>
  );
}

function Drive({ app }: { app: AppState }) {
  const { status, recoveryKey, syncPercent } = app.drive;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const unconfigured = status === 'unconfigured';
  const linked = status === 'connected' || status === 'syncing' || status === 'syncFailed';

  return (
    <section className="section" aria-label="Google Drive sync" data-drive={status}>
      <div className="srow first tall">
        <div className="col grow" style={{ flexBasis: 300 }}>
          <h2 id="sDrive">Google Drive sync</h2>
          <span className="small muted">
            Uploads a copy of your chat archive to your Drive. It is encrypted on this computer before upload, so it cannot be read from
            Drive directly. This is the only way data leaves this computer.
          </span>
        </div>
        <Toggle on={app.settings.driveEnabled && !unconfigured} disabled={unconfigured} labelledBy="sDrive" onChange={(driveEnabled) => update({ driveEnabled })} />
      </div>
      {unconfigured && (
        <div className="srow">
          <span className="text2">Drive sync is not configured in this build.</span>
        </div>
      )}
      {status === 'needsConnect' && (
        <div className="srow tall">
          <span>No Google account connected yet</span>
          <button className="btn2" onClick={() => void window.api.driveConnect()}>
            Connect Google account
          </button>
        </div>
      )}
      {status === 'connecting' && (
        <div className="srow tall" role="status">
          <span>Waiting for you to sign in in your browser…</span>
        </div>
      )}
      {status === 'recoveryKey' && recoveryKey && (
        <div className="srow tall">
          <div className="col gap12 grow">
            <strong>Save your recovery key</strong>
            <span className="text2 small">
              Everything uploaded to Drive is encrypted with this key. It is shown once. Without it the Drive copy cannot be opened, by you
              or anyone else. Keep it somewhere safe, such as a password manager.
            </span>
            <code className="inset mono" data-testid="recovery-key">
              {recoveryKey}
            </code>
            <div className="row gap12 wrap">
              <button
                className="btn2"
                onClick={() => {
                  void navigator.clipboard.writeText(recoveryKey).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn" onClick={() => void window.api.driveConfirmKey()}>
                I have saved it
              </button>
            </div>
          </div>
        </div>
      )}
      {linked && (
        <div className="srow tall">
          <div className="col grow">
            <span className="strong ok-text">Connected{app.settings.driveEmail ? ` · ${app.settings.driveEmail}` : ''}</span>
            <span className="small muted">
              {status === 'syncing' ? `Syncing to Google Drive… ${Math.round(syncPercent)}%` : 'Folder: My Drive / Shoebox · encrypted · syncs after each backup'}
            </span>
            <span className="small muted">Disconnecting leaves the files already on Drive in place.</span>
          </div>
          <div className="row gap12 wrap">
            <button className="btn2" onClick={() => void window.api.driveRevealKey().then(setShownKey)}>
              Show recovery key
            </button>
            <button className="btn2" onClick={() => void window.api.driveDisconnect()}>
              Disconnect
            </button>
          </div>
        </div>
      )}
      {status === 'syncFailed' && (
        <div className="srow">
          <div className="warn grow" role="alert">
            <Warning />
            <span>Backup saved on this computer; Drive sync failed. It will be tried again after the next backup.</span>
          </div>
        </div>
      )}
      {shownKey && (
        <Modal title="Drive recovery key" onClose={() => setShownKey(null)}>
          <code className="inset mono">{shownKey}</code>
        </Modal>
      )}
    </section>
  );
}

function Storage({ app }: { app: AppState }) {
  const { backupBytes, mediaBytes, dbBytes, freeBytes } = app.storage;
  const phone = app.settings.phoneUsedBytes;
  // A full backup is about the size of what is on the phone; later backups only add what changed.
  const discard = app.settings.deleteBackupAfterExtract;
  // With the backup discarded after each run, every run needs room for the whole phone again.
  const stillNeeded = phone ? Math.max(0, phone - (discard ? 0 : backupBytes)) : 0;
  return (
    <section className="section pad" aria-label="Storage on this computer">
      <div className="row between gap12 wrap" style={{ alignItems: 'baseline' }}>
        <h2>Storage on this computer</h2>
        <span className="strong">{bytes(backupBytes + mediaBytes + dbBytes)} used</span>
      </div>
      <div className="bar" aria-hidden="true">
        <span className="c1" style={{ flex: backupBytes }} />
        <span className="c2" style={{ flex: mediaBytes }} />
        <span className="c3" style={{ flex: dbBytes }} />
      </div>
      <div className="legend">
        <span>
          <span className="sw c1" aria-hidden="true" />
          iPhone backup · {bytes(backupBytes)}
        </span>
        <span>
          <span className="sw c2" aria-hidden="true" />
          Chat photos, videos, voice notes · {bytes(mediaBytes)}
        </span>
        <span>
          <span className="sw c3" aria-hidden="true" />
          Chat archive database · {bytes(dbBytes)}
        </span>
      </div>
      {(freeBytes > 0 || phone) && (
        <div className="tiles" data-testid="space">
          {freeBytes > 0 && (
            <div className="cond">
              <strong>{bytes(freeBytes)}</strong>Free on this disk
            </div>
          )}
          {phone ? (
            <div className="cond">
              <strong>About {bytes(phone)}</strong>Needed for a full iPhone backup
            </div>
          ) : null}
          {phone ? (
            <div className="cond">
              <strong className={freeBytes > 0 && stillNeeded > freeBytes ? 'bad-text' : ''}>
                {stillNeeded > 0 ? `About ${bytes(stillNeeded)}` : 'Nothing more'}
              </strong>
              {discard ? 'Needed again, temporarily, for every backup' : 'Still to copy before the backup is complete'}
            </div>
          ) : null}
        </div>
      )}
      {phone && freeBytes > 0 && stillNeeded > freeBytes ? (
        <div className="warn" role="alert">
          <Warning />
          <span>There is not enough free space to finish the backup. Free up about {bytes(stillNeeded - freeBytes)}, or change the location.</span>
        </div>
      ) : null}
      <div className="row between gap16" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div className="col grow">
          <span id="sDiscard" className="strong">
            Delete the iPhone backup after each run
          </span>
          <span className="small muted">
            Keeps only your chat archive, which saves disk space. Every backup then copies the whole iPhone again, so it takes much
            longer and needs that space free each time. Takes effect after the next backup.
          </span>
        </div>
        <Toggle on={discard} labelledBy="sDiscard" onChange={(deleteBackupAfterExtract) => update({ deleteBackupAfterExtract })} />
      </div>
      <div className="row between gap12 wrap" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <span className="text2" style={{ fontSize: 14 }}>
          Location: {app.settings.dataDir}
        </span>
        <button className="btn2" disabled={app.run !== null} onClick={() => void window.api.changeLocation()}>
          Change location
        </button>
      </div>
    </section>
  );
}

function History({ app }: { app: AppState }) {
  return (
    <section className="section pad" aria-label="Recent backups" style={{ gap: 4 }}>
      <h2 style={{ marginBottom: 8 }}>Recent backups</h2>
      {app.history.length === 0 && <span className="muted">No backups yet.</span>}
      {app.history.map((r) => {
        const result = runResult(r);
        return (
          <div className="hist" key={r.id} data-testid="history-row">
            <span className="d">{whenAt(r.startedAt)}</span>
            <span className={`r ${result.className}`}>{result.label}</span>
            <span className="t">{runDetail(r, app.settings.scheduleTime)}</span>
          </div>
        );
      })}
    </section>
  );
}

export function Backup() {
  const app = useApp();
  const [licences, setLicences] = useState<string | null>(null);
  function restart() {
    useUi.getState().go('welcome');
    void window.api.restartOnboarding();
  }

  return (
    <main className="backup">
      <div className="backup-col">
        <h1>Backup and settings</h1>
        <StatusCard app={app} />
        <Schedule app={app} />
        <Drive app={app} />
        <Storage app={app} />
        <History app={app} />
        <div className="info">
          This archive is for keeping and reading your chats. It cannot be restored back into the chat app on an iPhone. All data stays on
          this computer unless Google Drive sync is on.
        </div>
        <div className="row gap16 wrap">
          <button className="btn2" onClick={restart}>
            Set up a different iPhone
          </button>
          <button className="link" onClick={() => void window.api.getLicences().then(setLicences)}>
            Open-source licences
          </button>
        </div>
      </div>
      {licences !== null && (
        <Modal title="Open-source licences" onClose={() => setLicences(null)}>
          <pre>{licences}</pre>
        </Modal>
      )}
    </main>
  );
}

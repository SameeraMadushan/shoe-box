import { useState } from 'react';
import { useApp, useUi } from '../app/store';
import { AppMark } from './Icons';
import { Modal } from './Modal';

/** About dialog: version, licence, source code and the third-party licences. */
export function About() {
  const app = useApp();
  const [licences, setLicences] = useState<string | null>(null);
  const close = () => useUi.setState({ aboutOpen: false });

  if (licences !== null) {
    return (
      <Modal title="Open-source licences" onClose={close}>
        <div>
          <button className="btn2" onClick={() => setLicences(null)}>
            Back
          </button>
        </div>
        <pre>{licences}</pre>
      </Modal>
    );
  }
  return (
    <Modal title="About Shoebox" onClose={close}>
      <div className="col gap16" style={{ overflow: 'auto' }}>
        <div className="row gap16">
          <AppMark size={64} />
          <div className="col">
            <span className="head strong" style={{ fontSize: 22 }}>
              Shoebox
            </span>
            <span className="text2">Version {app.version}</span>
            <span className="small muted">Free and open source</span>
          </div>
        </div>
        <p className="text2">
          Shoebox keeps your iPhone chats on your own computer. It works offline: nothing leaves this computer unless you turn on Google
          Drive sync.
        </p>
        <div className="inset col gap8" style={{ fontSize: 14 }}>
          <span>
            <strong>Licence:</strong> MIT. Copyright © 2026 Shoebox contributors. You may use, copy, change and share it freely; it comes
            with no warranty.
          </span>
          <span>
            <strong>Source code:</strong> <span className="mono">github.com/SameeraMadushan/shoe-box</span>
          </span>
          <span>
            Shoebox is an independent project. It is not affiliated with or endorsed by Apple, Google, or the maker of any chat app.
          </span>
        </div>
        <div className="row gap16 wrap">
          <button className="btn2" onClick={() => void window.api.openExternal('source')}>
            Open the source code page
          </button>
          <button className="link" onClick={() => void window.api.getLicences().then(setLicences)}>
            Open-source licences
          </button>
        </div>
      </div>
    </Modal>
  );
}

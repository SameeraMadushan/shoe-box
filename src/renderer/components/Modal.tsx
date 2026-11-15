import { useEffect, type ReactNode } from 'react';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** Full-window photo viewer. */
export function Lightbox({ src, onClose }: { src: string; onClose(): void }) {
  useEscape(onClose);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      <img src={src} alt="Photo, full size" />
      <button className="btn2 close" autoFocus onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div>
        <div className="row between gap12">
          <h2 className="head">{title}</h2>
          <button className="btn2" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

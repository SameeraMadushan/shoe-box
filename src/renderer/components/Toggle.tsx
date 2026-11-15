/** Accessible switch. `labelledBy` points at the visible label's id. */
export function Toggle({ on, onChange, labelledBy, disabled }: { on: boolean; onChange(on: boolean): void; labelledBy: string; disabled?: boolean }) {
  return (
    <button className="tog" role="switch" aria-checked={on} aria-labelledby={labelledBy} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="tog-track">
        <span className="tog-knob" />
      </span>
    </button>
  );
}

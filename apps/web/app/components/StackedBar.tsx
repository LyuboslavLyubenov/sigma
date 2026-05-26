import type { ProcedureSlice } from '@sigma/api-contract';
import { pct } from '@sigma/shared';

// Procedure-mix bar („Как купува / Как печели") — CSS flex segments + a legend, no chart library.
// Colours are the @sigma/config group tokens (ink ramp; accent red marks the non-competitive bucket).
export function StackedBar({ slices }: { slices: ProcedureSlice[] }) {
  if (slices.length === 0) return null;
  return (
    <>
      <div className="hbar" aria-hidden="true">
        {slices.map((s) => (
          <span
            key={s.key}
            style={{ width: `${(s.sharePct * 100).toFixed(1)}%`, background: s.color }}
            title={`${s.label} — ${pct(s.sharePct)}`}
          />
        ))}
      </div>
      <div className="hbar-legend">
        {slices.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label} · {pct(s.sharePct)}
          </span>
        ))}
      </div>
    </>
  );
}

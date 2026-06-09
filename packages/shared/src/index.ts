export * from './format';

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Float-scaling rounding; display/threshold-only and keeps the classic 1.005 edge. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const BANDS: ReadonlyArray<{ band: RiskBand; min: number }> = [
  { band: 'critical', min: 75 },
  { band: 'high', min: 50 },
  { band: 'medium', min: 25 },
  { band: 'low', min: 0 },
];

export function riskBand(score: number): RiskBand {
  const clamped = clamp(score, 0, 100);
  for (const { band, min } of BANDS) {
    if (clamped >= min) return band;
  }
  return 'low';
}

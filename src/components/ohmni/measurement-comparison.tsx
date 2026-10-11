"use client";

export function MeasurementComparison({ expected, measured, node }: { expected: number; measured: number; node: string }) {
  const low = Math.min(0, expected, measured);
  const high = Math.max(0, expected, measured);
  const span = high - low || 1;
  const x = (value: number) => 14 + ((value - low) / span) * 252;
  const delta = measured - expected;
  const mismatch = Math.abs(delta) > Math.max(0.05, Math.abs(expected) * 0.05);
  const signed = (value: number, digits: number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${Math.abs(value).toFixed(digits)}`;
  const percent = expected === 0 ? null : (delta / Math.abs(expected)) * 100;
  return <div className="measurement-comparison">
    <div className="comparison-heading"><span>At {node} · prediction vs observation</span></div>
    <div className="comparison-moment">
      <dl className="comparison-value"><dt>Expected</dt><dd className="voltage-result">{expected.toFixed(3)}<small> V</small></dd></dl>
      <p className={`comparison-delta ${mismatch ? "is-mismatch" : "is-match"}`}>Δ {signed(delta, 3)} V{percent !== null && <span> ({signed(percent, 0)}%)</span>}</p>
      <dl className="comparison-value observed"><dt>Measured</dt><dd>{measured.toFixed(3)}<small> V</small></dd></dl>
    </div>
    <svg viewBox="0 0 280 26" preserveAspectRatio="none" aria-hidden="true">
      <rect className="comparison-track" x="14" y="1" width="252" height="8" rx="4" />
      <rect className="comparison-expected" style={{ transformOrigin: `${x(0)}px 5px` }} x={Math.min(x(0), x(expected))} y="1" width={Math.abs(x(expected) - x(0))} height="8" rx="4" />
      <rect className="comparison-track" x="14" y="16" width="252" height="8" rx="4" />
      <rect className="comparison-observed" style={{ transformOrigin: `${x(0)}px 20px` }} x={Math.min(x(0), x(measured))} y="16" width={Math.abs(x(measured) - x(0))} height="8" rx="4" />
      <path className="comparison-zero" d={`M${x(0)} 0 V26`} />
    </svg>
    <p className="comparison-scale">{low.toFixed(2)} to {high.toFixed(2)} V · shared scale · measured value entered by you</p>
  </div>;
}

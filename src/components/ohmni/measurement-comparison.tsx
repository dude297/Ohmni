"use client";

export function MeasurementComparison({ expected, measured, node }: { expected: number; measured: number; node: string }) {
  const low = Math.min(0, expected, measured);
  const high = Math.max(0, expected, measured);
  const span = high - low || 1;
  const x = (value: number) => 14 + ((value - low) / span) * 252;
  return <div className="measurement-comparison">
    <div className="comparison-heading"><span>At {node}</span><strong>Prediction vs observation</strong></div>
    <svg viewBox="0 0 280 108" role="img" aria-label={`At ${node}, predicted ${expected.toFixed(3)} volts and observed ${measured.toFixed(3)} volts.`}>
      <text x="14" y="15">PREDICTED</text><text x="266" y="15" textAnchor="end">{expected.toFixed(3)} V</text>
      <rect className="comparison-track" x="14" y="23" width="252" height="12" rx="4" />
      <rect className="comparison-expected" x={Math.min(x(0), x(expected))} y="23" width={Math.abs(x(expected) - x(0))} height="12" rx="4" />
      <text x="14" y="57">OBSERVED</text><text x="266" y="57" textAnchor="end">{measured.toFixed(3)} V</text>
      <rect className="comparison-track" x="14" y="65" width="252" height="12" rx="4" />
      <rect className="comparison-observed" x={Math.min(x(0), x(measured))} y="65" width={Math.abs(x(measured) - x(0))} height="12" rx="4" />
      <path className="comparison-zero" d={`M${x(0)} 20 V80`} />
      <text className="comparison-scale" x="14" y="99">{low.toFixed(2)} V</text><text className="comparison-scale" x="266" y="99" textAnchor="end">{high.toFixed(2)} V · shared scale</text>
    </svg>
    <p>Observed values are entered by you. Predictions come from the selected solver.</p>
  </div>;
}

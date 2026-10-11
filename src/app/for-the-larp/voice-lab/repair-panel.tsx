import { Wrench } from "lucide-react";
import { fmtNum } from "./parser";
import { nodeDiffs, verifyBadge, type Badge, type RepairProposal, type VerifyResult } from "./repair";
import type { Obs } from "./machine";

const V = (x: number) => `${fmtNum(+x.toPrecision(3))} V`;
const fmtOhm = (r: number) => (r >= 1e6 ? `${+(r / 1e6).toPrecision(3)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toPrecision(3)} kΩ` : `${+r.toPrecision(3)} Ω`);

export function BadgeTag({ kind }: { kind: Badge }) {
  return <span className={`vl-tag vl-tag${kind}`} data-badge={kind}>{kind}</span>;
}

export function RepairPanel(props: {
  proposal: RepairProposal;
  observations: Obs[];
  approved: boolean;
  verifyResult: VerifyResult | null;
  verifyBusy: boolean;
  onApprove: () => void;
}) {
  const { proposal: p, observations, approved, verifyResult, verifyBusy, onApprove } = props;
  const badge = verifyBadge(verifyResult);
  const rows = nodeDiffs(p, observations);
  const vf = p.verification;
  return (
    <section className="vl-repair" aria-labelledby="vl-repair-h" data-testid="repair-panel">
      <div className="vl-repairTop">
        <h3 id="vl-repair-h" className="vl-h2 vl-onDark"><Wrench size={14} aria-hidden /> Repair Studio</h3>
        <BadgeTag kind={badge} />
      </div>
      <p className="vl-repairTitle">
        {p.title} <b>{Math.round(p.probability * 100)}%</b>
      </p>
      <p className="vl-muted2">Hypothesis within the tested fault set, not a confirmed fault.{p.uncertainty ? ` ${p.uncertainty}` : ""}</p>
      <p className="vl-patch">
        Proposed patch: restore <b>{p.patch.componentId}</b> from {fmtOhm(p.patch.faultedValue)} (faulted) to {fmtOhm(p.patch.designValue)} (design).
      </p>

      <div className="vl-diffs" role="list" aria-label="Node voltages before and after the simulated fix">
        {rows.map((r) => (
          <div key={r.node} className={`vl-diff ${r.node === vf.node ? "vl-diffKey" : ""}`} role="listitem" data-node-row={r.node}>
            <span className="vl-diffNode">{r.node}</span>
            <span className="vl-diffNum">
              <small>{r.measured !== null ? "Measured" : "Simulated now"}</small> {V(r.measured ?? r.before)}
              <BadgeTag kind={r.measured !== null ? "MEASURED" : "SIMULATED"} />
            </span>
            <span aria-hidden className="vl-arrow">→</span>
            <span className="vl-diffNum">
              <small>Simulated after fix</small> {V(r.after)}
              <BadgeTag kind="SIMULATED" />
            </span>
          </div>
        ))}
      </div>

      {p.actions.length > 0 && (
        <>
          <span className="vl-k">PLAN · OHMNI CHANGES NOTHING; YOU DO</span>
          <ol className="vl-actions">{p.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
        </>
      )}

      {!approved ? (
        <button type="button" className="button primary vl-approve" onClick={onApprove}>
          Approve plan (no physical change is made by Ohmni)
        </button>
      ) : (
        <div className="vl-verify" aria-live="polite">
          <span className="vl-k">VERIFY · THIRD READING</span>
          <p>{vf.instruction}</p>
          <p className="vl-muted2">Say or type, e.g. “{vf.node} reads …”, then confirm. Expected about {V(vf.expectVolts)} ± {V(vf.toleranceVolts)} (simulated).</p>
          {verifyBusy && <p className="vl-muted2">Checking against the repaired circuit…</p>}
          {verifyResult && (
            <p className={verifyResult.verified ? "vl-vOk" : "vl-vNo"} role="status" data-testid="verify-result">
              <BadgeTag kind={badge} /> {verifyResult.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

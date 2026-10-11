"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  FileImage,
  FlaskConical,
  LoaderCircle,
  Network,
  RotateCcw,
  ScanLine,
  Upload,
  Zap,
} from "lucide-react";
import { Brand } from "./brand";
import { CircuitView } from "./circuit-view";
import {
  Extraction,
  Graph,
  Result,
  Route,
  Trace,
  isGraph,
  parseExtraction,
  parseResult,
  request,
  sampleGraph,
  solveSample,
} from "./api";

type Mode = "empty" | "sample" | "manual" | "upload";
type Phase = "review" | "extracting" | "solving";

export function LabWorkspace() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    params.has("sample") ? "sample" : "empty",
  );
  const [graph, setGraph] = useState<Graph | null>(
    params.has("sample") ? sampleGraph() : null,
  );
  const [selected, setSelected] = useState("R2");
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<Phase>("review");
  const [measurement, setMeasurement] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [resultSource, setResultSource] = useState<"local" | "backend">(
    "local",
  );
  const [useBackend, setUseBackend] = useState(true);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [trace, setTrace] = useState<Trace[]>([]);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [json, setJson] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const pending = phase !== "review";
  const measured = measurement.trim() ? Number(measurement) : undefined;
  const validMeasured = measured === undefined || Number.isFinite(measured);
  const issues = [
    ...(extraction?.unresolvedConnections ?? []),
    ...(route === "ask_user"
      ? [
          "Answer the extraction questions and verify every terminal in the editor.",
        ]
      : []),
  ];
  const reviewReady =
    graph !== null &&
    isGraph(graph) &&
    issues.every((_, i) => acknowledged.includes(String(i)));
  const expected =
    result && graph ? result.voltages[graph.measureNode] : undefined;
  const delta =
    measured !== undefined && expected !== undefined
      ? measured - expected
      : undefined;
  const mismatch =
    delta !== undefined &&
    Math.abs(delta) > Math.max(0.05, Math.abs(expected!) * 0.05);

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );
  useEffect(() => {
    if (params.has("upload")) inputRef.current?.focus();
  }, [params]);

  function reset(kind: "sample" | "manual") {
    setMode(kind);
    setGraph(sampleGraph());
    setSelected("R2");
    setConfirmed(false);
    setResult(null);
    setMeasurement("");
    setError("");
    setExtraction(null);
    setRoute(null);
    setTrace([]);
    setAcknowledged([]);
    setImageUrl("");
    setFileName("");
    setJson("");
    setUseBackend(true);
    if (inputRef.current) inputRef.current.value = "";
  }
  function editGraph(next: Graph) {
    setGraph(next);
    setConfirmed(false);
    setResult(null);
    setError("");
    setAcknowledged([]);
  }
  function editComponent(
    id: string,
    key: "value" | "positiveNode" | "negativeNode",
    value: number | string,
  ) {
    if (!graph) return;
    editGraph({
      ...graph,
      components: graph.components.map((c) =>
        c.id === id ? { ...c, [key]: value } : c,
      ),
    });
  }
  async function upload(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024 ||
      file.size === 0
    ) {
      setError("Choose a PNG, JPEG or WebP image, up to 5 MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setMode("upload");
    setGraph(null);
    setConfirmed(false);
    setResult(null);
    setError("");
    setExtraction(null);
    setRoute(null);
    setTrace([]);
    setAcknowledged([]);
    setMeasurement("");
    setJson("");
    setFileName(file.name);
    setImageUrl(URL.createObjectURL(file));
    setUseBackend(true);
    setPhase("extracting");
    const body = new FormData();
    body.append("image", file);
    try {
      const response = parseExtraction(await request("/api/extract", body));
      setExtraction(response.extraction);
      setRoute(response.route);
      setTrace(response.trace);
      setGraph(response.extraction.graph);
      if (response.extraction.graph)
        setSelected(response.extraction.graph.components[0].id);
      else
        setError(
          `${response.extraction.warnings.join(" ")} No supported graph was extracted. Use a manual divider, or paste a reviewed circuit graph below.`.trim(),
        );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Image extraction failed. Try manual entry.",
      );
    } finally {
      setPhase("review");
    }
  }
  async function solve() {
    if (!confirmed || !graph || !reviewReady || !validMeasured) return;
    setPhase("solving");
    setError("");
    setResult(null);
    try {
      const next = useBackend
        ? parseResult(
            await request("/api/solve", {
              graph,
              userConfirmed: true,
              ...(measured !== undefined ? { measuredVoltage: measured } : {}),
            }),
          )
        : solveSample(graph, measured);
      if (next.voltages[graph.measureNode] === undefined)
        throw new Error(
          "Solver response is missing the selected measurement node.",
        );
      setResult(next);
      setResultSource(useBackend ? "backend" : "local");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Circuit analysis failed.");
    } finally {
      setPhase("review");
      statusRef.current?.focus();
    }
  }
  function importGraph() {
    try {
      const next: unknown = JSON.parse(json);
      if (!isGraph(next))
        throw new Error(
          "Use schema version 1, GND, a measureNode, and unique resistor/DC-source components with finite SI values and distinct terminals.",
        );
      editGraph(next);
      setMode("upload");
      setUseBackend(true);
      setSelected(next.components[0].id);
      setExtraction(null);
      setRoute(null);
      setTrace([]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid circuit JSON.");
    }
  }

  return (
    <div className="ohmni lab-page">
      <header className="site-header lab-header">
        <Brand />
        <nav aria-label="Workspace navigation">
          <Link href="/" className="back-link">
            <ArrowLeft size={15} /> Back to overview
          </Link>
          <span className="workspace-tag">
            <span className="tiny-dot" /> CIRCUIT WORKSPACE
          </span>
        </nav>
      </header>
      <main className="lab-main">
        <div className="lab-title">
          <div>
            <div className="eyebrow">FOLLOW THE EVIDENCE</div>
            <h1>A clearer picture.</h1>
            <p>Capture, confirm, then compare your circuit with the math.</p>
          </div>
          <button
            className="button secondary small"
            disabled={pending}
            onClick={() => reset("sample")}
          >
            <FlaskConical size={16} /> Load sample
          </button>
        </div>
        <div
          className={`session-banner ${mode === "upload" ? "backend-banner" : ""}`}
        >
          <div>
            <span className="tiny-dot" />
            <strong>
              {mode === "sample"
                ? "SAMPLE / DEMO"
                : mode === "manual"
                  ? "MANUAL DIVIDER"
                  : mode === "upload"
                    ? "BACKEND ANALYSIS"
                    : "READY WHEN YOU ARE"}
            </strong>
            <span>
              {mode === "upload"
                ? "Candidate extraction requires your review. Provider steps appear only when returned by the backend."
                : mode === "empty"
                  ? "Try the sample without signing up, or upload a schematic."
                  : useBackend
                    ? "Server solve selected. No simulated provider events."
                    : "Local divider calculation. No AI providers have run."}
            </span>
          </div>
          {mode !== "empty" && (
            <button
              className="icon-button"
              disabled={pending}
              onClick={() => reset(mode === "manual" ? "manual" : "sample")}
              aria-label="Reset to divider"
            >
              <RotateCcw size={16} />
            </button>
          )}
        </div>
        <div className="workspace-grid">
          <section
            className="workspace-panel capture-panel"
            aria-labelledby="capture-title"
          >
            <PanelHeader
              number="01"
              icon={<ScanLine size={17} />}
              title="Capture"
              id="capture-title"
              subtitle="Start with what you can see."
            />
            <label className={`upload-zone ${pending ? "disabled" : ""}`}>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={pending}
                onChange={(e) => void upload(e.target.files?.[0])}
                aria-label="Upload your schematic"
              />
              <Upload size={23} />
              <strong>
                {phase === "extracting"
                  ? "Reading your circuit…"
                  : "Upload a schematic"}
              </strong>
              <span>PNG, JPEG or WebP · up to 5 MB</span>
              <span className="upload-prompt">
                Choose image <ArrowRight size={13} />
              </span>
            </label>
            {imageUrl ? (
              <div className="image-preview">
                {/* Browser-local preview without server upload or optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={`Uploaded circuit: ${fileName}`} />
                <span>
                  <FileImage size={14} />
                  {fileName}
                </span>
              </div>
            ) : (
              <div className="sample-card">
                <div className="eyebrow">
                  A SIMPLE CIRCUIT. A REAL QUESTION.
                </div>
                <div className="mini-netlist">
                  <span>5 V</span>
                  <i />
                  <span>R1</span>
                  <i />
                  <span>VOUT</span>
                  <i />
                  <span>R2</span>
                  <i />
                  <span>GND</span>
                </div>
                <h3>Why am I reading 0.45 V?</h3>
                <p>
                  A two-resistor divider should give you 2.50 V. Follow the
                  discrepancy to a testable hypothesis.
                </p>
                <button
                  className="text-button"
                  disabled={pending}
                  onClick={() => reset("sample")}
                >
                  Try this sample <ArrowRight size={15} />
                </button>
              </div>
            )}
            <div className="capture-help">
              <Network size={16} />
              <p>
                Supported graph: resistors and DC voltage sources. Breadboards
                need clear, confirmed connections.
              </p>
            </div>
            <button
              className="manual-button"
              disabled={pending}
              onClick={() => reset("manual")}
            >
              Build a manual divider <ArrowRight size={14} />
            </button>
            <details className="json-editor">
              <summary>Paste a reviewed circuit graph</summary>
              <label htmlFor="graph-json">
                Canonical graph JSON · SI units
              </label>
              <textarea
                id="graph-json"
                value={json}
                disabled={pending}
                onChange={(e) => setJson(e.target.value)}
                placeholder='{"schemaVersion":1,"components":[...],"groundNode":"GND","measureNode":"VOUT"}'
                rows={6}
                spellCheck={false}
              />
              <button
                className="button secondary small"
                disabled={pending || !json.trim()}
                onClick={importGraph}
              >
                Load graph for review
              </button>
            </details>
          </section>
          <section
            className="workspace-panel review-panel"
            aria-labelledby="review-title"
          >
            <PanelHeader
              number="02"
              icon={<Network size={17} />}
              title="Review"
              id="review-title"
              subtitle="Your connections. Your confirmation."
            />
            {graph ? (
              <>
                <div className="diagram-toolbar">
                  <span>
                    {graph.components.length} COMPONENTS ·{" "}
                    {
                      new Set(
                        graph.components.flatMap((c) => [
                          c.positiveNode,
                          c.negativeNode,
                        ]),
                      ).size
                    }{" "}
                    NODES
                  </span>
                  <span className="sample-tag">
                    {extraction ? "CANDIDATE" : "EDITABLE"}
                  </span>
                </div>
                <CircuitView
                  graph={graph}
                  selected={selected}
                  onSelect={pending ? undefined : setSelected}
                  result={result}
                  uncertain={!!extraction && !confirmed}
                />
                <div className="component-editor">
                  <div className="editor-heading">
                    <span className="eyebrow">COMPONENTS</span>
                    <span>Values in Ω / V</span>
                  </div>
                  <div className="component-list">
                    {graph.components.map((c) => (
                      <div
                        key={c.id}
                        className={`component-row ${selected === c.id ? "active" : ""}`}
                      >
                        <button
                          disabled={pending}
                          onClick={() => setSelected(c.id)}
                          aria-label={`Select ${c.id}`}
                          aria-pressed={selected === c.id}
                        >
                          <span className="component-glyph">
                            {c.kind === "resistor" ? "R" : "+"}
                          </span>
                          <strong>{c.id}</strong>
                          <span>
                            {c.kind === "resistor" ? "Resistor" : "DC source"}
                          </span>
                        </button>
                        <label className="value-input">
                          <span className="sr-only">
                            {c.id} value in{" "}
                            {c.kind === "resistor" ? "ohms" : "volts"}
                          </span>
                          <input
                            type="number"
                            value={Number.isFinite(c.value) ? c.value : ""}
                            min={c.kind === "resistor" ? 0.000001 : undefined}
                            step="any"
                            disabled={pending}
                            onFocus={() => setSelected(c.id)}
                            onChange={(e) =>
                              editComponent(
                                c.id,
                                "value",
                                e.target.value === ""
                                  ? NaN
                                  : Number(e.target.value),
                              )
                            }
                          />
                          <span>{c.kind === "resistor" ? "Ω" : "V"}</span>
                        </label>
                        {selected === c.id ? (
                          <div className="terminal-inputs">
                            <label>
                              <span>
                                {c.kind === "dc_voltage"
                                  ? "+ terminal"
                                  : "Terminal A"}
                              </span>
                              <input
                                aria-label={`${c.id} positive node`}
                                value={c.positiveNode}
                                disabled={pending}
                                onChange={(e) =>
                                  editComponent(
                                    c.id,
                                    "positiveNode",
                                    e.target.value.trim(),
                                  )
                                }
                              />
                            </label>
                            <span>→</span>
                            <label>
                              <span>
                                {c.kind === "dc_voltage"
                                  ? "− terminal"
                                  : "Terminal B"}
                              </span>
                              <input
                                aria-label={`${c.id} negative node`}
                                value={c.negativeNode}
                                disabled={pending}
                                onChange={(e) =>
                                  editComponent(
                                    c.id,
                                    "negativeNode",
                                    e.target.value.trim(),
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="terminal-summary">
                            {c.positiveNode} → {c.negativeNode}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <label className="measure-node">
                  Measure node{" "}
                  <input
                    value={graph.measureNode}
                    disabled={pending}
                    onChange={(e) =>
                      editGraph({
                        ...graph,
                        measureNode: e.target.value.trim(),
                      })
                    }
                  />
                </label>
                {extraction && (
                  <div className="review-warnings">
                    <strong>Image interpretation needs review</strong>
                    {extraction.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                    {route === "verify_topology" && (
                      <p>
                        Verification was requested. Inspect the returned trace
                        for whether a specialist actually ran.
                      </p>
                    )}
                    {issues.map((issue, i) => (
                      <label key={i}>
                        <input
                          type="checkbox"
                          disabled={pending}
                          checked={acknowledged.includes(String(i))}
                          onChange={(e) => {
                            setAcknowledged((a) =>
                              e.target.checked
                                ? [...a, String(i)]
                                : a.filter((k) => k !== String(i)),
                            );
                            setConfirmed(false);
                            setResult(null);
                          }}
                        />
                        <span>I corrected or verified: {issue}</span>
                      </label>
                    ))}
                  </div>
                )}
                {!isGraph(graph) && (
                  <p className="inline-error">
                    Enter valid values, unique IDs and distinct nonempty
                    terminals.
                  </p>
                )}
                <label
                  className={`confirmation ${confirmed ? "confirmed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={pending || !reviewReady}
                    onChange={(e) => {
                      setConfirmed(e.target.checked);
                      setResult(null);
                    }}
                  />
                  <span>
                    <strong>
                      {confirmed
                        ? "Circuit confirmed"
                        : "I verified values, terminals and ground"}
                    </strong>
                    <small>
                      Edits clear your confirmation and previous results.
                    </small>
                  </span>
                  <Check size={17} />
                </label>
              </>
            ) : (
              <div className="panel-empty">
                {phase === "extracting" ? (
                  <LoaderCircle size={30} className="spinner" />
                ) : (
                  <Network size={34} />
                )}
                <h3>
                  {phase === "extracting"
                    ? "Extracting a candidate graph"
                    : "Make the connections visible."}
                </h3>
                <p>
                  {phase === "extracting"
                    ? "Waiting for the backend. You will review the image interpretation before solving."
                    : "Upload an image or load the sample to inspect its components and nodes."}
                </p>
                <button
                  className="button secondary small"
                  disabled={pending}
                  onClick={() => reset("sample")}
                >
                  Start with the sample <ArrowRight size={15} />
                </button>
              </div>
            )}
          </section>
          <section
            className="workspace-panel analyze-panel"
            aria-labelledby="analyze-title"
          >
            <PanelHeader
              number="03"
              icon={<Activity size={17} />}
              title="Understand"
              id="analyze-title"
              subtitle="Turn a reading into a next step."
            />
            <div className="measurement-block">
              <label htmlFor="measured-vout">
                Your measured {graph?.measureNode || "VOUT"}{" "}
                <span>optional</span>
              </label>
              <div className="measurement-input">
                <input
                  id="measured-vout"
                  type="number"
                  step="any"
                  placeholder="e.g. 0.45"
                  value={measurement}
                  disabled={pending}
                  onChange={(e) => {
                    setMeasurement(e.target.value);
                    setResult(null);
                  }}
                />
                <span>V</span>
              </div>
              <button
                className="text-button"
                disabled={pending || !graph}
                onClick={() => {
                  setMeasurement("0.45");
                  setResult(null);
                }}
              >
                Use demo reading: 0.45 V
              </button>
              {!validMeasured && (
                <p className="inline-error">Enter a finite voltage.</p>
              )}
            </div>
            {mode !== "upload" && graph && (
              <label className="backend-switch">
                <input
                  type="checkbox"
                  disabled={pending}
                  checked={useBackend}
                  onChange={(e) => {
                    setUseBackend(e.target.checked);
                    setResult(null);
                  }}
                />
                <span>Use backend solver</span>
              </label>
            )}
            <button
              className="button primary solve-button"
              disabled={pending || !confirmed || !reviewReady || !validMeasured}
              onClick={() => void solve()}
            >
              {phase === "solving" ? (
                <>
                  <LoaderCircle size={17} className="spinner" /> Solving
                  circuit…
                </>
              ) : (
                <>
                  <Zap size={17} />{" "}
                  {measurement.trim() ? "Analyze & compare" : "Solve circuit"}{" "}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            <p className="solve-hint">
              {!graph
                ? "Load a circuit to begin."
                : !confirmed
                  ? "Confirm the circuit in step 02 to continue."
                  : useBackend
                    ? "Reviewed graph → backend deterministic solve."
                    : "Reviewed divider → local sample calculation."}
            </p>
            <div
              ref={statusRef}
              tabIndex={-1}
              className="analysis-status"
              aria-live="polite"
              aria-atomic="true"
            >
              {error && (
                <div className="error-card" role="alert">
                  <CircleAlert size={18} />
                  <div>
                    <strong>Analysis needs attention</strong>
                    <p>{error}</p>
                    <span>
                      Your image and edits remain available for review.
                    </span>
                  </div>
                </div>
              )}
              {result ? (
                <>
                  <div className="result-card">
                    <div className="eyebrow">EXPECTED {graph?.measureNode}</div>
                    <div className="voltage-result">
                      {expected?.toFixed(3)}
                      <small> V</small>
                    </div>
                    <span className="result-origin">
                      {resultSource === "local"
                        ? "LOCAL SAMPLE CALCULATION"
                        : "BACKEND SOLVER RESULT"}
                    </span>
                    <div className="result-readings">
                      {Object.entries(result.voltages).map(([n, v]) => (
                        <div key={n}>
                          <span>{n}</span>
                          <strong>{v.toFixed(3)} V</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  {delta !== undefined && (
                    <div
                      className={`mismatch-card ${mismatch ? "" : "matched"}`}
                    >
                      <div className="insight-icon">
                        {mismatch ? (
                          <CircleAlert size={19} />
                        ) : (
                          <Check size={19} />
                        )}
                      </div>
                      <div>
                        <strong>
                          {mismatch
                            ? "That reading tells a different story."
                            : "Your reading is close to the prediction."}
                        </strong>
                        <p>
                          Measured {measured!.toFixed(3)} V · difference{" "}
                          {delta > 0 ? "+" : ""}
                          {delta.toFixed(3)} V.
                        </p>
                        <span>
                          Comparison threshold: greater of 0.05 V or 5% of
                          expected. This is a demo heuristic, not a component
                          tolerance test.
                        </span>
                      </div>
                    </div>
                  )}
                  {(result.hypotheses ?? []).slice(0, 1).map((h, i) => (
                    <HypothesisCard key={i} hypothesis={h} />
                  ))}
                  {(result.hypotheses?.length ?? 0) > 1 && (
                    <details className="other-hypotheses">
                      <summary>
                        {result.hypotheses!.length - 1} other testable
                        hypotheses <ChevronDown size={14} />
                      </summary>
                      {result.hypotheses!.slice(1).map((h, i) => (
                        <HypothesisCard key={i} hypothesis={h} />
                      ))}
                    </details>
                  )}
                  {mismatch && !result.hypotheses?.length && (
                    <div className="hypothesis-card">
                      <h3>Check the circuit before drawing a conclusion.</h3>
                      <p>
                        Verify supply voltage and node labels. Disconnect power
                        before checking wiring or resistance. No fault
                        hypothesis was returned.
                      </p>
                    </div>
                  )}
                  <details className="current-details">
                    <summary>
                      Component currents <ChevronDown size={14} />
                    </summary>
                    {Object.entries(result.currents).map(([id, a]) => (
                      <div key={id}>
                        <span>{id}</span>
                        <strong>{(a * 1000).toFixed(4)} mA</strong>
                      </div>
                    ))}
                    <p>
                      Positive current flows from the positive terminal to the
                      negative terminal in the graph.
                    </p>
                  </details>
                </>
              ) : (
                !error && (
                  <div className="analysis-empty">
                    <Activity size={27} />
                    <p>The answer starts with a confirmed circuit.</p>
                    <span>
                      Expected voltages, currents and measurement insights will
                      appear here.
                    </span>
                  </div>
                )
              )}
            </div>
          </section>
        </div>
        <details className="trace-panel">
          <summary>
            <div>
              <Network size={18} />
              <strong>Model Orchestration</strong>
              <span>
                {trace.length + (result?.trace.length ?? 0)
                  ? `${trace.length + (result?.trace.length ?? 0)} backend events`
                  : "No provider events"}
              </span>
            </div>
            <ChevronDown size={17} />
          </summary>
          <div className="trace-content">
            <p>
              Gemini extraction → Jev routing → optional specialist → human
              review → deterministic solve. Only events returned by the backend
              are shown below.
            </p>
            {route && (
              <div className="route-choice">
                Returned route <code>{route}</code>
              </div>
            )}
            {trace.length + (result?.trace.length ?? 0) ? (
              <ol>
                {[...trace, ...(result?.trace ?? [])].map((t, i) => (
                  <TraceRow key={`${i}-${t.step}`} event={t} />
                ))}
              </ol>
            ) : (
              <div className="trace-empty">
                {mode === "sample" || mode === "manual"
                  ? useBackend
                    ? "No model providers have run. Confirm the sample to use the backend MNA solver. Uncheck Use backend solver for a labeled local fallback."
                    : "Sample / manual mode uses a local divider formula. Gemini, Jev and specialist verification have not run."
                  : "Upload a circuit to request backend extraction. No model calls or confidence scores are simulated."}
              </div>
            )}
          </div>
        </details>
        <div className="lab-bottom">
          <span>
            <FlaskConical size={15} /> Learning & low-voltage prototyping
          </span>
          <p>
            Disconnect power before checking resistance. Never troubleshoot
            energized mains or hazardous circuits.
          </p>
        </div>
      </main>
    </div>
  );
}

function PanelHeader({
  number,
  icon,
  title,
  id,
  subtitle,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  id: string;
  subtitle: string;
}) {
  return (
    <div className="panel-header">
      <div className="panel-title">
        <span className="panel-number">{number}</span>
        {icon}
        <h2 id={id}>{title}</h2>
      </div>
      <p>{subtitle}</p>
    </div>
  );
}
function TraceRow({ event: t }: { event: Trace }) {
  return (
    <li className={`trace-event trace-${t.status}`}>
      <span className="trace-marker">
        {t.status === "ok" ? (
          <Check size={14} />
        ) : t.status === "error" ? (
          <CircleAlert size={14} />
        ) : (
          "—"
        )}
      </span>
      <div>
        <strong>{t.step}</strong>
        <span>
          {t.provider}
          {t.model ? ` / ${t.model}` : ""}
        </span>
        {t.chosenRoute && (
          <code>
            {t.chosenRoute}
            {t.confidence !== undefined
              ? ` · ${(t.confidence * 100).toFixed(1)}% confidence`
              : ""}
          </code>
        )}
        {t.note && <p>{t.note}</p>}
        {t.usage && (
          <small>
            {t.usage.inputTokens !== undefined
              ? `${t.usage.inputTokens} input tokens`
              : ""}
            {t.usage.outputTokens !== undefined
              ? ` · ${t.usage.outputTokens} output tokens`
              : ""}
          </small>
        )}
      </div>
      <span className="trace-duration">
        {t.durationMs} ms <small>{t.status}</small>
      </span>
    </li>
  );
}

function HypothesisCard({
  hypothesis: h,
}: {
  hypothesis: NonNullable<Result["hypotheses"]>[number];
}) {
  return (
    <article className="hypothesis-card">
      <span className="eyebrow">HYPOTHESIS · VERIFY PHYSICALLY</span>
      <h3>{h.title}</h3>
      <p>{h.rationale}</p>
      <div className="next-measurement">
        <Activity size={17} />
        <div>
          <strong>Next measurement</strong>
          <p>{h.nextMeasurement}</p>
        </div>
      </div>
    </article>
  );
}

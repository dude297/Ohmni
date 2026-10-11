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
  ScanLine,
  Upload,
  Zap,
  Download,
} from "lucide-react";
import { Brand } from "./brand";
import { CircuitView } from "./circuit-view";
import { ProbeGuide } from "./probe-guide";
import { MeasurementComparison } from "./measurement-comparison";
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
  isDivider,
  solveSample,
  type SampleKind,
} from "./api";

type Mode = "empty" | "sample" | "manual" | "upload";
type Phase = "review" | "extracting" | "solving";
type Stage = "capture" | "review" | "compare" | "investigate";
const stages: Stage[] = ["capture", "review", "compare", "investigate"];

export function LabWorkspace() {
  const params = useSearchParams();
  const [stage, setStage] = useState<Stage>(params.has("sample") ? "review" : "capture");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const frameRef = useRef<HTMLDivElement>(null);
  const stagesRef = useRef<HTMLElement>(null);
  const moveFocus = useRef(false);
  const initialSample: SampleKind = params.get("sample") === "advanced" ? "advanced" : params.get("sample") === "network" ? "network" : params.get("sample") === "ladder" ? "ladder" : "divider";
  const [probeTarget, setProbeTarget] = useState<string>();
  const [mode, setMode] = useState<Mode>(
    params.has("sample") ? "sample" : "empty",
  );
  const [sampleKind, setSampleKind] = useState<SampleKind>(
    initialSample,
  );
  const [graph, setGraph] = useState<Graph | null>(
    params.has("sample")
      ? sampleGraph(initialSample)
      : null,
  );
  const [selected, setSelected] = useState("R2");
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<Phase>("review");
  const [measurement, setMeasurement] = useState("");
  const [investigateReading, setInvestigateReading] = useState("");
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
  const investigationStatusRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const revealedResult = useRef<Result | null>(null);
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
  const events = [...trace, ...(result?.trace ?? [])];
  const stageIndex = stages.indexOf(stage);
  const sourceLabel = mode === "sample"
    ? "Prepared circuit · no image AI call"
    : mode === "manual"
      ? "Manual circuit · no image AI call"
      : imageUrl
        ? "Uploaded schematic · review the returned extraction evidence"
        : graph ? "Imported circuit graph · no image AI call" : null;
  const canEnter = {
    capture: true,
    review: !!graph,
    compare: confirmed && reviewReady,
    investigate: confirmed && reviewReady && !!result,
  };
  const status = phase === "extracting"
    ? "Reading schematic"
    : phase === "solving"
      ? "Analyzing circuit"
      : result
        ? "Analysis complete"
        : confirmed
          ? "Circuit confirmed"
          : graph
            ? "Review required"
            : imageUrl ? "Review needs attention" : null;
  function goTo(next: Stage) {
    if (pending || !canEnter[next]) return;
    setDirection(stages.indexOf(next) < stageIndex ? "back" : "forward");
    if (next === "investigate") setInvestigateReading(measurement);
    moveFocus.current = true;
    setStage(next);
  }
  useEffect(() => {
    if (!moveFocus.current) return;
    frameRef.current
      ?.querySelector<HTMLElement>("section:not([hidden]) h2")
      ?.focus({ preventScroll: true });
    stagesRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    moveFocus.current = false;
  }, [stage]);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [error]);
  useEffect(() => {
    if (!result || pending || revealedResult.current === result) return;
    revealedResult.current = result;
    const answer = stage === "investigate" ? investigationStatusRef.current : statusRef.current;
    answer?.focus({ preventScroll: true });
    answer?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [result, pending, stage]);
  const allNodes = graph ? [...new Set(graph.components.flatMap((c) => [c.positiveNode, c.negativeNode]))] : [];

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );
  useEffect(() => {
    if (params.has("upload")) inputRef.current?.focus();
  }, [params]);

  function reset(kind: "sample" | "manual", variant: SampleKind = "divider") {
    setStage("capture");
    setMode(kind);
    setSampleKind(variant);
    setGraph(sampleGraph(variant));
    setSelected("R2");
    setConfirmed(false);
    setResult(null); setProbeTarget(undefined);
    setMeasurement("");
    setInvestigateReading("");
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
    setStage("review");
    setGraph(next);
    if (!isDivider(next)) setUseBackend(true);
    setConfirmed(false);
    setResult(null); setProbeTarget(undefined);
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
    setStage("capture");
    setMode("upload");
    setGraph(null);
    setConfirmed(false);
    setResult(null); setProbeTarget(undefined);
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
      if (response.extraction.graph) {
        setSelected(response.extraction.graph.components[0].id);
        moveFocus.current = true;
        setStage("review");
      }
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
  async function loadDemoImage(name: string) {
    setPhase("extracting");
    setError("");
    try {
      const response = await fetch(`/samples/${name}.png`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("The demo image could not load. Upload your own schematic instead.");
      await upload(new File([await response.blob()], `${name}.png`, { type: "image/png" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The demo image could not load.");
    } finally {
      setPhase("review");
    }
  }
  function exportEvidence() {
    if (!graph || !result) return;
    const file = new Blob([JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), graph, userConfirmed: confirmed, measuredVoltage: measured ?? null, resultSource, extraction, route, extractionTrace: trace, result, note: "User-entered measurement; predictions and hypotheses are not a verified physical diagnosis. Original image bytes are not included." }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ohmni-investigation.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function solve(voltage = measured, destination: "compare" | "investigate" = "compare") {
    if (!confirmed || !graph || !reviewReady || (voltage !== undefined && !Number.isFinite(voltage))) return;
    setStage(destination);
    setPhase("solving");
    setError("");
    setResult(null); setProbeTarget(undefined);
    try {
      const next = useBackend
        ? parseResult(
            await request("/api/solve", {
              graph,
              userConfirmed: true,
              ...(voltage !== undefined ? { measuredVoltage: voltage } : {}),
            }),
          )
        : solveSample(graph, voltage);
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
      (destination === "investigate" ? investigationStatusRef : statusRef).current?.focus();
    }
  }
  function importGraph() {
    try {
      const next: unknown = JSON.parse(json);
      if (!isGraph(next))
        throw new Error(
          "Use schema version 1, GND, a measureNode, and unique resistor/DC-source components with finite SI values and distinct terminals.",
        );
      moveFocus.current = true;
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
    <div className="ohmni lab-page living-lab" data-sample={sampleKind} data-stage={stage}>
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
            <h1>Circuit investigation</h1>
            <p>One circuit. Four steps from a schematic to your next useful measurement.</p>
          </div>
          <button
            className="button secondary small"
            disabled={pending}
            onClick={() => reset("sample", sampleKind)}
          >
            <FlaskConical size={16} /> Load sample
          </button>
        </div>
        <div className="guided-status"><span>Step {stageIndex + 1} of 4</span>{status && <span className="investigation-status" role="status">{pending && <LoaderCircle size={13} className="spinner" />}{status}</span>}</div>
        <nav className="guided-steps" ref={stagesRef} aria-label="Investigation stages">
          {stages.map((item, i) => <button key={item} type="button" disabled={pending || !canEnter[item]} aria-current={stage === item ? "step" : undefined} onClick={() => goTo(item)}>
            <span>{i + 1}</span><strong>{item[0].toUpperCase() + item.slice(1)}</strong>
          </button>)}
        </nav>
        {sourceLabel && <p className="investigation-context"><span>{sourceLabel}</span>{result && <span>{resultSource === "local" ? "Local divider calculation" : "Backend circuit solver"}</span>}</p>}
        {error && <div className="error-card guided-error" role="alert" ref={errorRef}><CircleAlert size={18} /><div><strong>The investigation needs attention</strong><p>{error}</p><span>{stage === "capture" ? "Your source remains available. Try another image or a manual graph." : "Your circuit edits remain available. Retry this step or review its connections."}</span></div></div>}
        <div className="guided-layout">
        <div className="workspace-grid guided-frames" ref={frameRef} data-direction={direction}>
          <section
            className="workspace-panel capture-panel guided-frame"
            hidden={stage !== "capture"}
            aria-labelledby="capture-title"
          >
            <PanelHeader
              number="01"
              icon={<ScanLine size={17} />}
              title="Start with a circuit."
              id="capture-title"
              subtitle="Upload a schematic to analyze its connections, or try a sample to see how Ohmni works."
            />
            <p className="stage-intro">Choose a readable schematic, a prepared example, or a manual graph. You will review the connections before any calculation.</p>
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
            <div className="demo-image-picker">
              <span className="eyebrow">OR SEND A DEMO IMAGE</span>
              <p>These images use the real extraction endpoint. Model responses and limits apply.</p>
              <div>{[{ id: "clear-divider", label: "Clear divider" }, { id: "ambiguous-junction", label: "Unclear junction" }, { id: "ambiguous-smudged", label: "Smudged value" }].map((demo) => <button key={demo.id} disabled={pending} onClick={() => void loadDemoImage(demo.id)}><ScanLine size={13} />{demo.label}</button>)}</div>
            </div>
            {imageUrl ? (
              <div className="image-preview">
                {/* Browser-local preview without server upload or optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={`Uploaded circuit: ${fileName}`} />
                <a className="source-open" href={imageUrl} target="_blank" rel="noopener noreferrer">Inspect original image ↗</a>
                <span>
                  <FileImage size={14} />
                  {fileName}
                </span>
              </div>
            ) : (
              <div className="sample-card">
                <div className="eyebrow">
                  SCHEMATIC-FIRST · REVIEW BEFORE SOLVING
                </div>
                <div className="mini-netlist">
                  <span>{graph?.components.find(c => c.kind === "dc_voltage")?.value ?? 5} V source</span><i />
                  <span>{graph?.components.filter(c => c.kind === "resistor").length ?? 2} resistors</span><i />
                  <span>Measure {graph?.measureNode ?? "VOUT"}</span>
                </div>
                <h3>{sampleKind === "advanced" ? "Seven resistors. Three coupled nodes." : sampleKind === "network" ? "What should MID read?" : sampleKind === "ladder" ? "Where did the connection fail?" : "Why am I reading 0.45 V?"}</h3>
                <p>
                  {sampleKind === "advanced" ? "Prepared 12 V bridge. Confirm every connection, then use the server MNA solver. A demo C = 0 V reading is not a live meter observation." : sampleKind === "network"
                    ? "A 12 V series/parallel network should give 6.545 V at MID. Use the server solver to verify."
                    : sampleKind === "ladder" ? "Node B should read 1.667 V. Try a 0 V observation, then let the guide choose your next measurement." : "A two-resistor divider should give 2.50 V. Follow a mismatch to a testable hypothesis."}
                </p>
                <div className="sample-choices"><button className="text-button" disabled={pending} onClick={() => reset("sample", "advanced")}>Advanced bridge <ArrowRight size={15} /></button><button className="text-button" disabled={pending} onClick={() => reset("sample", "ladder")}>Try probe ladder <ArrowRight size={15} /></button>
                  <button className="text-button" disabled={pending} onClick={() => reset("sample", "divider")}>Try divider <ArrowRight size={15} /></button>
                  <button className="text-button" disabled={pending} onClick={() => reset("sample", "network")}>Try network <ArrowRight size={15} /></button>
                </div>
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
            <div className="stage-actions"><span>{graph ? "Circuit loaded. Next, review its values and terminals." : "Load a circuit to continue."}</span><button className="button primary small" disabled={pending || !graph} onClick={() => goTo("review")}>Next step <ArrowRight size={16} /></button></div>
          </section>
          <section
            className="workspace-panel review-panel guided-frame"
            hidden={stage !== "review"}
            aria-labelledby="review-title"
          >
            <PanelHeader
              number="02"
              icon={<Network size={17} />}
              title="Check the connections."
              id="review-title"
              subtitle="Your connections. Your confirmation."
            />
            {graph ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {imageUrl && <details className="review-source"><summary>Review the original schematic</summary><img src={imageUrl} alt={`Original schematic: ${fileName}`} /><a href={imageUrl} target="_blank" rel="noopener noreferrer">Inspect original image ↗</a></details>}
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
                  controls
                  highlightedNode={result ? probeTarget : undefined}
                  onMeasureNode={pending ? undefined : (node) => {
                    if (node !== graph.measureNode) {
                      editGraph({ ...graph, measureNode: node });
                      setMeasurement("");
                    }
                  }}
                />
                <details className="review-values" open={sampleKind !== "advanced"}><summary>Values & connections · {graph.components.length} components</summary><div className="component-editor">
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
                  <select
                    aria-label="Measurement node"
                    value={graph.measureNode}
                    disabled={pending}
                    onChange={(e) =>
                      { editGraph({
                        ...graph,
                        measureNode: e.target.value,
                      }); setMeasurement(""); }
                    }
                  >{!allNodes.includes(graph.measureNode) && <option value={graph.measureNode}>{graph.measureNode || "Select a valid node"}</option>}{allNodes.map((node) => <option key={node} value={node}>{node}</option>)}</select>
                </label>
                </details>
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
                            setResult(null); setProbeTarget(undefined);
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
                      setResult(null); setProbeTarget(undefined);
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
            <div className="stage-actions"><button className="button secondary small" disabled={pending} onClick={() => goTo("capture")}><ArrowLeft size={16} /> Back</button><button className="button primary small" disabled={pending || !confirmed || !reviewReady} onClick={() => goTo("compare")}>Next step <ArrowRight size={16} /></button></div>
          </section>
          <section
            className="workspace-panel analyze-panel guided-frame"
            hidden={stage !== "compare"}
            aria-labelledby="analyze-title"
          >
            <PanelHeader
              number="03"
              icon={<Activity size={17} />}
              title="Compare prediction and observation."
              id="analyze-title"
              subtitle="Run the reviewed circuit, then compare it with your meter reading."
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
                    setResult(null); setProbeTarget(undefined);
                  }}
                />
                <span>V</span>
              </div>
              <button
                className="text-button"
                disabled={pending || !graph}
                onClick={() => {
                  setMeasurement(mode === "sample" && sampleKind === "network" ? "4.8" : mode === "sample" && (sampleKind === "ladder" || sampleKind === "advanced") ? "0" : "0.45");
                  setResult(null); setProbeTarget(undefined);
                }}
              >
                Use demo reading: {mode === "sample" && sampleKind === "network" ? "4.8 V" : mode === "sample" && (sampleKind === "ladder" || sampleKind === "advanced") ? "0 V" : "0.45 V"}
              </button>
              {!validMeasured && (
                <p className="inline-error">Enter a finite voltage.</p>
              )}
            </div>
            {mode !== "upload" && graph && (
              <label className="backend-switch">
                <input
                  type="checkbox"
                  disabled={pending || !isDivider(graph)}
                  checked={useBackend}
                  onChange={(e) => {
                    setUseBackend(e.target.checked);
                    setResult(null); setProbeTarget(undefined);
                  }}
                />
                <span>{isDivider(graph) ? "Use backend solver" : "Backend MNA required for this network"}</span>
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
              {result ? (
                <>
                  <div className="comparison-scene"><div className="comparison-evidence"><div className="result-card">
                    {delta !== undefined ? <MeasurementComparison expected={expected!} measured={measured!} node={graph!.measureNode} /> : <>
                    <div className="eyebrow">EXPECTED {graph?.measureNode}</div>
                    <div className="voltage-result">
                      {expected?.toFixed(3)}
                      <small> V</small>
                    </div>
                    </>}
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
                  </div>{sampleKind === "advanced" && graph && <div className="evidence-schematic"><CircuitView graph={graph} result={result} selected={selected} onSelect={setSelected} highlightedNode={graph.measureNode}/></div>}</div>
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
            <div className="stage-actions"><button className="button secondary small" disabled={pending} onClick={() => goTo("review")}><ArrowLeft size={16} /> Back</button><button className="button primary small" disabled={pending || !result} onClick={() => goTo("investigate")}>Next step <ArrowRight size={16} /></button></div>
          </section>
          <section className="workspace-panel investigate-panel guided-frame" hidden={stage !== "investigate"} aria-labelledby="investigate-title">
            <PanelHeader number="04" icon={<FlaskConical size={17} />} title="Choose your next measurement." id="investigate-title" subtitle="Use the evidence to narrow the possibilities. A hypothesis is a starting point, not a confirmed fault." />
            <div className="investigate-content">
              <form className="investigation-reading" onSubmit={(e) => {
                e.preventDefault();
                if (!investigateReading.trim() || !Number.isFinite(Number(investigateReading)) || pending) return;
                setMeasurement(investigateReading);
                void solve(Number(investigateReading), "investigate");
              }}>
                <label htmlFor="investigate-reading">{measured === undefined ? "Add" : "Update"} your measured {graph?.measureNode} (V)</label>
                <p>Compare this reading to update the investigation.</p>
                <div>
                  <input id="investigate-reading" type="number" step="any" value={investigateReading} disabled={pending} onChange={(e) => setInvestigateReading(e.target.value)} placeholder="Enter your meter reading" />
                  <button className="button primary small" disabled={pending || !investigateReading.trim() || !Number.isFinite(Number(investigateReading))}>{pending ? <LoaderCircle size={15} className="spinner" /> : <Activity size={15} />} Compare reading</button>
                </div>
              </form>
              <div ref={investigationStatusRef} tabIndex={-1} role="status" className="investigation-reading-status">{pending ? "Comparing your reading…" : result ? measured !== undefined ? `Comparison updated: ${measured} V observed, ${expected?.toFixed(3)} V expected.` : "Circuit calculated. Add a meter reading here to investigate a discrepancy." : error ? "Comparison could not complete. Your reading is preserved; retry when ready." : ""}</div>
              {result && <>
                {delta !== undefined && !mismatch && <div className="investigation-notice"><strong>Your reading agrees with the prediction.</strong><p>This observation shows no discrepancy within the displayed comparison threshold. It does not prove that every part is correct.</p></div>}
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
                  {useBackend && mismatch && graph && measured !== undefined && Number.isFinite(measured) && <div className={`living-probe-scene ${sampleKind === "advanced" ? "has-circuit" : ""}`}>{sampleKind === "advanced" && <CircuitView graph={graph} result={result} highlightedNode={probeTarget} selected={selected} onSelect={setSelected}/>}<ProbeGuide key={JSON.stringify(graph) + measured} graph={graph} initialVoltage={measured} onTarget={setProbeTarget} /></div>}
                  <button className="evidence-export" onClick={exportEvidence}><Download size={15} /> Download investigation evidence</button>
              </>}
            </div>
            <div className="stage-actions"><button className="button secondary small" disabled={pending} onClick={() => goTo("compare")}><ArrowLeft size={16} /> Back</button><button className="button secondary small" disabled={pending} onClick={() => goTo("review")}>Review circuit <ArrowRight size={16} /></button></div>
          </section>
        </div>
        <aside className={`circuit-preview ${sampleKind === "advanced" ? "advanced-preview" : ""}`} aria-label="Circuit preview">
          <div className="preview-heading"><span className="eyebrow">YOUR CIRCUIT</span><span>{graph ? `${graph.components.length} components` : "No circuit loaded"}</span></div>
          {graph ? <><CircuitView graph={graph} selected={selected} result={result} uncertain={!!extraction && !confirmed} highlightedNode={result ? probeTarget : undefined} /><div className="preview-summary"><span>Measurement target</span><strong>{graph.measureNode}</strong><span>{confirmed ? "Confirmed by you" : "Review required"}</span></div><button className="text-button" disabled={pending} onClick={() => goTo("review")}>Review values and connections <ArrowRight size={14} /></button></> : <div className="preview-empty"><Network size={32} /><p>Your circuit will stay here while you work through the investigation.</p></div>}
        </aside>
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
        {events.length > 0 && <div className="evidence-strip" aria-label="Returned execution evidence"><span><Activity size={14} /> {events.length} returned events</span><span>{events.filter((event) => event.status === "ok").length} succeeded</span><span>{events.reduce((sum, event) => sum + event.durationMs, 0).toLocaleString()} ms reported step time</span>{events.some((event) => event.status !== "ok") && <strong>Review errors / skipped steps below</strong>}</div>}
            <p>
              Vision extraction → Jev routing → optional specialist → human
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
                    : "Sample / manual mode uses a local divider formula. AI extraction, Jev and specialist verification have not run."
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
        <h2 id={id} tabIndex={-1}>{title}</h2>
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

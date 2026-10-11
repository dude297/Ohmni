"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { resistorBands } from "./_bands";
import { BOARD_BOUNDS, VIEW_PRESETS, holePos } from "./_geometry";
import { allHoles, type HoleId } from "./_model";
import { occupant } from "./_state";
import type { BoardProps } from "./_view";

const COPPER = "#F2B45A";
const FAULT = "#943E2C";
const holes = allHoles();
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const P = (h: HoleId) => holePos(h)!;
const clickOK = (e: ThreeEvent<MouseEvent>) => e.delta < 5;

function Tube({ curve, radius, color, ...rest }: { curve: THREE.Curve<THREE.Vector3>; radius: number; color: string; emissive?: string; side?: THREE.Side } & Omit<React.ComponentProps<"mesh">, "color">) {
  const { emissive, side, ...mesh } = rest;
  return (
    <mesh {...mesh}>
      <tubeGeometry args={[curve, 28, radius, 8, false]} />
      <meshStandardMaterial color={color} emissive={emissive ?? "#000"} roughness={0.5} side={side} />
    </mesh>
  );
}

function polyline(points: THREE.Vector3[]) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) path.add(new THREE.LineCurve3(points[i], points[i + 1]));
  return path;
}

function Resistor({ id, value, a, b, selected, onSelect }: { id: string; value: number; a: HoleId; b: HoleId; selected: boolean; onSelect: () => void }) {
  const pa = P(a);
  const pb = P(b);
  const A = V(pa.x, 0, pa.z);
  const B = V(pb.x, 0, pb.z);
  const dir = B.clone().sub(A);
  const dist = dir.length();
  dir.normalize();
  const L = Math.min(Math.max(dist - 1.4, 1.5), 3.4);
  const mid = A.clone().add(B).multiplyScalar(0.5).setY(1.6);
  const quat = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
  const e1 = mid.clone().addScaledVector(dir, -L / 2);
  const e2 = mid.clone().addScaledVector(dir, L / 2);
  const bands = resistorBands(value);
  const lead = (p: THREE.Vector3, e: THREE.Vector3) => polyline([p.clone().setY(-0.4), p.clone().setY(1.6), e]);
  const tap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (clickOK(e)) onSelect();
  };
  return (
    <group name={`comp-${id}`} onClick={tap}>
      <Tube curve={lead(A, e1)} radius={0.1} color="#b9b9b9" />
      <Tube curve={lead(B, e2)} radius={0.1} color="#b9b9b9" />
      <group position={mid} quaternion={quat}>
        <mesh>
          <cylinderGeometry args={[0.85, 0.85, L, 20]} />
          <meshStandardMaterial color="#d8c9a3" roughness={0.7} />
        </mesh>
        {bands?.hex.map((c, i) => (
          <mesh key={i} position={[0, i < 3 ? L / 2 - 0.5 - i * 0.45 : -L / 2 + 0.4, 0]}>
            <cylinderGeometry args={[0.89, 0.89, 0.26, 20]} />
            <meshStandardMaterial color={c} roughness={0.6} />
          </mesh>
        ))}
        {selected && (
          <mesh scale={[1.22, 1.06, 1.22]}>
            <cylinderGeometry args={[0.85, 0.85, L, 20]} />
            <meshBasicMaterial color={COPPER} side={THREE.BackSide} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function Supply({ id, a, b, selected, onSelect }: { id: string; a: HoleId; b: HoleId; selected: boolean; onSelect: () => void }) {
  const pa = P(a);
  const pb = P(b);
  const box = V(1.5, 1.5, -11.2);
  const curve = (p: { x: number; z: number }, off: number) =>
    new THREE.CubicBezierCurve3(V(p.x, -0.4, p.z), V(p.x, 2, p.z), V(box.x + off, 3, box.z + 1.4), V(box.x + off, 2, box.z + 1.2));
  return (
    <group
      name={`comp-${id}`}
      onClick={(e) => {
        e.stopPropagation();
        if (clickOK(e)) onSelect();
      }}
    >
      <Tube curve={curve(pa, -1.5)} radius={0.14} color="#c0392b" />
      <Tube curve={curve(pb, 1.5)} radius={0.14} color="#222222" />
      <mesh position={box}>
        <boxGeometry args={[6, 3, 2.6]} />
        <meshStandardMaterial color="#142C32" roughness={0.6} />
      </mesh>
      {selected && (
        <mesh position={box} scale={[1.08, 1.14, 1.12]}>
          <boxGeometry args={[6, 3, 2.6]} />
          <meshBasicMaterial color={COPPER} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  );
}

function Jumper({ id, a, b, color, selected, moving, onSelect, onBeginMove }: { id: string; a: HoleId; b: HoleId; color: string; selected: boolean; moving?: "a" | "b"; onSelect: () => void; onBeginMove: (end: "a" | "b") => void }) {
  const pa = P(a);
  const pb = P(b);
  const d = Math.hypot(pb.x - pa.x, pb.z - pa.z);
  const h = 1.3 + d * 0.28;
  const curve = useMemo(() => new THREE.CubicBezierCurve3(V(pa.x, 0, pa.z), V(pa.x, h, pa.z), V(pb.x, h, pb.z), V(pb.x, 0, pb.z)), [pa.x, pa.z, pb.x, pb.z, h]);
  const tap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (clickOK(e)) onSelect();
  };
  return (
    <group name={`jumper-${id}`}>
      <group onClick={tap}>
        <Tube curve={curve} radius={0.15} color={color} />
        {selected && <Tube curve={curve} radius={0.3} color={COPPER} side={THREE.BackSide} />}
      </group>
      {(["a", "b"] as const).map((end) => {
        const p = end === "a" ? pa : pb;
        return (
          <mesh
            key={end}
            position={[p.x, 0.12, p.z]}
            onClick={(e) => {
              e.stopPropagation();
              if (!clickOK(e)) return;
              if (selected) onBeginMove(end);
              else onSelect();
            }}
          >
            <sphereGeometry args={[selected ? 0.42 : 0.25, 14, 10]} />
            <meshStandardMaterial color={moving === end ? COPPER : color} emissive={selected ? COPPER : "#000"} emissiveIntensity={selected ? 0.6 : 0} />
          </mesh>
        );
      })}
    </group>
  );
}

function Holes({ netHoles, faultHoles, build, onHole, faultMat }: { netHoles: Set<HoleId>; faultHoles: Set<HoleId>; build: BoardProps["state"]["build"]; onHole: (h: HoleId) => void; faultMat: THREE.MeshStandardMaterial }) {
  const geo = useMemo(() => new THREE.CylinderGeometry(0.34, 0.34, 0.1, 10), []);
  const stud = useMemo(() => new THREE.CylinderGeometry(0.26, 0.26, 0.5, 10), []);
  const mats = useMemo(
    () => ({
      plain: new THREE.MeshStandardMaterial({ color: "#8d8f86" }),
      used: new THREE.MeshStandardMaterial({ color: "#142C32" }),
      net: new THREE.MeshStandardMaterial({ color: COPPER, emissive: COPPER, emissiveIntensity: 0.5 }),
    }),
    [],
  );
  return (
    <group>
      {holes.map((h) => {
        const p = P(h);
        const isFault = faultHoles.has(h);
        const isNet = netHoles.has(h);
        const mat = isFault ? faultMat : isNet ? mats.net : occupant(build, h) ? mats.used : mats.plain;
        return (
          <group key={h} position={[p.x, 0.02, p.z]} name={`hole-${h}`}>
            <mesh
              geometry={geo}
              material={mat}
              onClick={(e) => {
                e.stopPropagation();
                if (clickOK(e)) onHole(h);
              }}
            />
            {(isFault || isNet) && <mesh geometry={stud} material={mat} position={[0, 0.25, 0]} onClick={(e) => { e.stopPropagation(); if (clickOK(e)) onHole(h); }} />}
          </group>
        );
      })}
    </group>
  );
}

function Rig({ view, reduced }: { view?: BoardProps["view"]; reduced: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const ctl = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = false; // no inertia tween: deterministic and reduced-motion safe
    c.maxPolarAngle = Math.PI * 0.49;
    c.minDistance = 8;
    c.maxDistance = 90;
    c.target.set(...VIEW_PRESETS.iso.target);
    c.addEventListener("change", () => invalidate());
    ctl.current = c;
    return () => c.dispose();
  }, [camera, gl, invalidate]);
  useEffect(() => {
    const c = ctl.current;
    if (!c || !view) return;
    const v = VIEW_PRESETS[view.name];
    camera.position.set(...v.pos); // jump cut: never tweened
    c.target.set(...v.target);
    c.update();
    invalidate();
  }, [view, camera, invalidate]);
  void reduced;
  return null;
}

function DebugHook() {
  const { camera, size } = useThree();
  useEffect(() => {
    // Test/diagnostic helper: screen coordinates (CSS px, relative to the canvas) of a hole.
    (window as unknown as { __studio3d?: unknown }).__studio3d = {
      holeScreen: (h: HoleId) => {
        const p = P(h);
        const v = V(p.x, 0.05, p.z).project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      },
    };
  }, [camera, size]);
  return null;
}

function setPulse(m: THREE.MeshStandardMaterial, v: number) {
  m.emissiveIntensity = v;
}

function Scene({ state, dispatch, netHoles, faultHoles, reduced, view }: BoardProps) {
  const { invalidate } = useThree();
  const { build, selection: sel, tool } = state;
  const faultMat = useMemo(() => new THREE.MeshStandardMaterial({ color: FAULT, emissive: FAULT, emissiveIntensity: 0.9 }), []);
  const netSet = useMemo(() => new Set(netHoles), [netHoles]);
  const faultSet = useMemo(() => new Set(faultHoles), [faultHoles]);
  const cx = (BOARD_BOUNDS.minX + BOARD_BOUNDS.maxX) / 2;
  const cz = (BOARD_BOUNDS.minZ + BOARD_BOUNDS.maxZ) / 2;
  useFrame(({ clock }) => {
    setPulse(faultMat, reduced ? 1 : 0.55 + 0.45 * Math.sin(clock.elapsedTime * 5));
  });
  useEffect(() => {
    if (reduced || !faultHoles.length) {
      invalidate();
      return;
    }
    const t = setInterval(invalidate, 50); // demand loop; pulse only while a fault exists
    return () => clearInterval(t);
  }, [reduced, faultHoles.length, invalidate]);

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[10, 30, 14]} intensity={1.6} />
      <directionalLight position={[-14, 12, -8]} intensity={0.5} />
      <mesh position={[cx, -0.45, cz]} onClick={(e) => clickOK(e) && tool.kind === "none" && dispatch({ type: "select", sel: null })}>
        <boxGeometry args={[BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX, 0.9, BOARD_BOUNDS.maxZ - BOARD_BOUNDS.minZ]} />
        <meshStandardMaterial color="#e6e2d4" roughness={0.8} />
      </mesh>
      <mesh position={[cx, 0.005, 1.5]}>
        <boxGeometry args={[BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX - 0.4, 0.02, 1.6]} />
        <meshStandardMaterial color="#c9c4b2" />
      </mesh>
      {(["L+", "L-", "R+", "R-"] as const).map((r) => (
        <mesh key={r} position={[14.5, 0.01, P(`${r}1`).z]}>
          <boxGeometry args={[30, 0.02, 0.12]} />
          <meshBasicMaterial color={r.endsWith("+") ? "#c0392b" : "#2f6db5"} />
        </mesh>
      ))}
      <Holes netHoles={netSet} faultHoles={faultSet} build={build} faultMat={faultMat} onHole={(h) => dispatch({ type: "clickHole", hole: h })} />
      {build.placements.map((p) =>
        p.kind === "resistor" ? (
          <Resistor key={p.id} id={p.id} value={p.value} a={p.pins.positive} b={p.pins.negative} selected={sel?.kind === "component" && sel.id === p.id} onSelect={() => dispatch({ type: "select", sel: { kind: "component", id: p.id } })} />
        ) : (
          <Supply key={p.id} id={p.id} a={p.pins.positive} b={p.pins.negative} selected={sel?.kind === "component" && sel.id === p.id} onSelect={() => dispatch({ type: "select", sel: { kind: "component", id: p.id } })} />
        ),
      )}
      {build.jumpers.map((j) => (
        <Jumper
          key={j.id}
          id={j.id}
          a={j.a}
          b={j.b}
          color={j.color ?? "#2f6db5"}
          selected={sel?.kind === "jumper" && sel.id === j.id}
          moving={tool.kind === "move" && tool.jumperId === j.id ? tool.end : undefined}
          onSelect={() => dispatch({ type: "select", sel: { kind: "jumper", id: j.id } })}
          onBeginMove={(end) => dispatch({ type: "beginMove", jumperId: j.id, end })}
        />
      ))}
      <Rig view={view} reduced={reduced} />
      <DebugHook />
    </>
  );
}

export default function Scene3D(props: BoardProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: VIEW_PRESETS.iso.pos, fov: 38, near: 0.5, far: 300 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      aria-label="3D breadboard. Drag to orbit, scroll to zoom, right-drag to pan. Use the 2D toggle for keyboard control."
      data-testid="canvas3d"
    >
      <color attach="background" args={["#e9e7de"]} />
      <Scene {...props} />
    </Canvas>
  );
}

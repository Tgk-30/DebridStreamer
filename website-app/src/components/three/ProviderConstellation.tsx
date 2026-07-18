import { useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import theme, { THEME_PRESETS } from '@/theme.config';
import { cn } from '@/lib/utils';

/** Mutable driver written by GSAP / pointer handlers, read every frame. */
export interface ConstellationDriver {
  /** entrance 0→1 (core scale-up + node stagger-pop) */
  intro: number;
  /** chapter-scrubbed orbit speed multiplier 0.5→1.5 */
  scrollSpeed: number;
  /** normalized pointer -1..1 */
  pointerX: number;
  pointerY: number;
}
export type ConstellationDriverRef = MutableRefObject<ConstellationDriver>;

interface SceneColors {
  brand: THREE.Color;
  accent: THREE.Color;
  warm: THREE.Color;
}

interface NodeSpec {
  name: string;
  note: string;
  angle: number;
  radius: number;
  y: number;
  /** "your sources" node renders in warm amber */
  warm?: boolean;
}

const NODES: NodeSpec[] = [
  { name: 'Real-Debrid', note: 'cached torrents & hosters', angle: 0.1, radius: 2.7, y: 0.12 },
  { name: 'AllDebrid', note: 'torrents + hoster links', angle: 1.42, radius: 2.5, y: -0.18 },
  { name: 'Premiumize', note: 'cloud storage & usenet', angle: 2.62, radius: 2.85, y: 0.22 },
  { name: 'TorBox', note: 'budget-friendly caching', angle: 3.9, radius: 2.55, y: -0.06 },
  { name: 'Your sources', note: 'indexers you plug in', angle: 5.15, radius: 2.9, y: 0.02, warm: true },
];

const BURST_POOL = 6;
const PACKETS_PER_BEAM = 2;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function cssColor(varName: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(v || fallback);
}

/** Soft round sprite texture (radial gradient) for glows + bursts. */
function makeSoftSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function backOut(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function nodeLocal(n: NodeSpec): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(n.angle) * n.radius, n.y, Math.sin(n.angle) * n.radius);
}

/* ── Shared transient fx (core flash + cyan burst pool) ──────────────── */

interface Burst {
  start: number;
  x: number;
  y: number;
}
interface FxState {
  flash: number;
  seq: number;
  bursts: (Burst | null)[];
}
type FxRef = MutableRefObject<FxState>;

/* ── Cache core - glowing brand sphere, flashes on packet arrival ────── */

function CacheCore({ driver, fx, colors, sprite }: { driver: ConstellationDriverRef; fx: FxRef; colors: SceneColors; sprite: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const coreMat = useRef<THREE.MeshBasicMaterial>(null);
  const shellMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMat = useRef<THREE.SpriteMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const white = useMemo(() => new THREE.Color('#ffffff'), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const d = driver.current;
    fx.current.flash = Math.max(0, fx.current.flash - delta * 2.4);
    const flash = fx.current.flash;
    const breathe = 0.5 + 0.5 * Math.sin(t * 2.1);
    const introScale = backOut(Math.min(1, d.intro));

    if (group.current) group.current.scale.setScalar(Math.max(0.0001, introScale * (1 + flash * 0.16)));
    if (coreMat.current) {
      coreMat.current.opacity = Math.min(1, d.intro * 1.6);
      coreMat.current.color.copy(colors.brand).lerp(white, flash * 0.85);
    }
    if (shellMat.current) shellMat.current.opacity = (0.28 + flash * 0.5) * d.intro;
    if (glowMat.current) glowMat.current.opacity = (0.42 + breathe * 0.16 + flash * 0.5) * d.intro;
    if (light.current) light.current.intensity = (2.4 + breathe * 0.8 + flash * 9) * d.intro;
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.4, 32, 32]} />
        <meshBasicMaterial ref={coreMat} color={colors.brand} transparent opacity={0} toneMapped={false} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.58, 1]} />
        <meshBasicMaterial ref={shellMat} color={colors.brand} wireframe transparent opacity={0} toneMapped={false} />
      </mesh>
      <sprite scale={[2.7, 2.7, 1]}>
        <spriteMaterial ref={glowMat} map={sprite} color={colors.brand} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <pointLight ref={light} color={colors.brand} intensity={0} distance={8} decay={2} />
    </group>
  );
}

/* ── Provider nodes - labeled wireframe icosahedra, click to focus ───── */

interface ProviderNodesProps {
  driver: ConstellationDriverRef;
  colors: SceneColors;
  focus: number;
  onFocus: (i: number) => void;
}

function ProviderNodes({ driver, colors, focus, onFocus }: ProviderNodesProps) {
  const groups = useRef<Array<THREE.Group | null>>([]);
  const mats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const positions = useMemo(() => NODES.map(nodeLocal), []);

  useFrame(() => {
    const d = driver.current;
    NODES.forEach((_, i) => {
      const pop = backOut(THREE.MathUtils.clamp(d.intro * 1.7 - i * 0.14, 0, 1));
      const g = groups.current[i];
      if (g) g.scale.setScalar(Math.max(0.0001, pop));
      const dim = focus === -1 || focus === i ? 1 : 0.3;
      const m = mats.current[i];
      if (m) m.opacity = 0.9 * dim * Math.min(1, d.intro * 2);
    });
  });

  return (
    <group>
      {NODES.map((n, i) => {
        const dimmed = focus !== -1 && focus !== i;
        return (
          <group
            key={n.name}
            position={positions[i]}
            ref={(el) => {
              groups.current[i] = el;
            }}
          >
            <mesh>
              <icosahedronGeometry args={[0.3, 0]} />
              <meshBasicMaterial
                ref={(el) => {
                  mats.current[i] = el;
                }}
                color={n.warm ? colors.warm : colors.brand}
                wireframe
                transparent
                opacity={0}
                toneMapped={false}
              />
            </mesh>
            {/* inner signal dot */}
            <mesh>
              <sphereGeometry args={[0.07, 12, 12]} />
              <meshBasicMaterial color={n.warm ? colors.warm : colors.accent} transparent opacity={0.95} toneMapped={false} />
            </mesh>
            {/* generous invisible click target */}
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onFocus(focus === i ? -1 : i);
              }}
            >
              <sphereGeometry args={[0.62, 8, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <Html center position={[0, 0.56, 0]} zIndexRange={[20, 0]} className="pointer-events-none select-none">
              <div
                className={cn('whitespace-nowrap text-center font-mono transition-opacity duration-300')}
                style={{ opacity: dimmed ? 0.3 : 1 }}
              >
                <p
                  className={cn(
                    'text-[10px] uppercase tracking-[0.18em]',
                    focus === i ? 'text-brand' : 'text-ink-2',
                  )}
                >
                  {n.name}
                </p>
                {focus === i && (
                  <p className="mt-1 whitespace-nowrap text-[9px] normal-case tracking-[0.04em] text-ink-3">
                    {n.note}
                  </p>
                )}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/* ── Beam curves node → core, with traveling amber packets ───────────── */

function useBeamCurves(): THREE.QuadraticBezierCurve3[] {
  return useMemo(
    () =>
      NODES.map((n) => {
        const from = nodeLocal(n);
        const mid = from.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.6 + n.radius * 0.1, 0));
        return new THREE.QuadraticBezierCurve3(from, mid, new THREE.Vector3(0, 0, 0));
      }),
    [],
  );
}

function Beams({ colors, focus }: { colors: SceneColors; focus: number }) {
  const curves = useBeamCurves();
  const points = useMemo(() => curves.map((c) => c.getPoints(42)), [curves]);
  return (
    <group>
      {points.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          color={colors.brand}
          transparent
          opacity={focus === -1 || focus === i ? 0.42 : 0.1}
          lineWidth={1}
        />
      ))}
    </group>
  );
}

function Packets({ driver, fx, colors, focus }: { driver: ConstellationDriverRef; fx: FxRef; colors: SceneColors; focus: number }) {
  const curves = useBeamCurves();
  const meshes = useRef<Array<THREE.Mesh | null>>([]);
  const progress = useRef<Float32Array>(
    (() => {
      const arr = new Float32Array(NODES.length * PACKETS_PER_BEAM);
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 0.37) % 1;
      return arr;
    })(),
  );

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const d = driver.current;
    for (let bi = 0; bi < NODES.length; bi++) {
      for (let k = 0; k < PACKETS_PER_BEAM; k++) {
        const idx = bi * PACKETS_PER_BEAM + k;
        let t = progress.current[idx] + delta * (0.16 + 0.05 * ((bi + k) % 3)) * d.scrollSpeed;
        if (t >= 1) {
          t %= 1;
          /* arrival - core flash + one brighter cyan packet toward camera */
          fx.current.flash = 1;
          fx.current.seq += 1;
          fx.current.bursts[fx.current.seq % BURST_POOL] = {
            start: time,
            x: (Math.random() - 0.5) * 0.7,
            y: (Math.random() - 0.5) * 0.7,
          };
        }
        progress.current[idx] = t;
        const m = meshes.current[idx];
        if (!m) continue;
        curves[bi].getPoint(t, m.position);
        const mat = m.material as THREE.MeshBasicMaterial;
        const fade = Math.sin(Math.PI * Math.min(1, t * 1.12));
        const dim = focus === -1 || focus === bi ? 1 : 0.25;
        mat.opacity = fade * 0.95 * dim * d.intro;
        m.scale.setScalar(0.8 + 0.3 * Math.sin(t * Math.PI));
      }
    }
  });

  return (
    <group>
      {Array.from({ length: NODES.length * PACKETS_PER_BEAM }, (_, idx) => (
        <mesh
          key={idx}
          ref={(el) => {
            meshes.current[idx] = el;
          }}
        >
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color={colors.warm} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ── Cyan bursts - "cached, playing instantly" packets toward camera ─── */

function CyanBursts({ driver, fx, colors, sprite }: { driver: ConstellationDriverRef; fx: FxRef; colors: SceneColors; sprite: THREE.Texture }) {
  const sprites = useRef<Array<THREE.Sprite | null>>([]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    for (let i = 0; i < BURST_POOL; i++) {
      const sp = sprites.current[i];
      if (!sp) continue;
      const b = fx.current.bursts[i];
      const mat = sp.material as THREE.SpriteMaterial;
      if (!b) {
        mat.opacity = 0;
        continue;
      }
      const p = (time - b.start) / 0.85;
      if (p >= 1) {
        mat.opacity = 0;
        continue;
      }
      sp.position.set(b.x * p * 2.2, b.y * p * 2.2 + p * 0.3, p * 6.2);
      mat.opacity = (1 - p) * 0.9 * driver.current.intro;
      const s = 0.3 + p * 0.55;
      sp.scale.set(s, s, 1);
    }
  });

  return (
    <group>
      {Array.from({ length: BURST_POOL }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            sprites.current[i] = el;
          }}
        >
          <spriteMaterial map={sprite} color={colors.accent} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/* ── Rig - orbital drift, cursor parallax ±4°, focus camera ──────────── */

interface RigProps {
  driver: ConstellationDriverRef;
  fx: FxRef;
  colors: SceneColors;
  sprite: THREE.Texture;
  focus: number;
  onFocus: (i: number) => void;
}

function ConstellationRig({ driver, fx, colors, sprite, focus, onFocus }: RigProps) {
  const tiltRef = useRef<THREE.Group>(null);
  const orbitRef = useRef<THREE.Group>(null);
  const lookTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  useFrame((state, delta) => {
    const d = driver.current;
    const dt = Math.min(delta, 0.05);

    /* slow orbital drift, chapter-scrubbed 0.5×→1.5× */
    if (orbitRef.current) orbitRef.current.rotation.y += dt * 0.14 * d.scrollSpeed;

    /* cursor parallax ±4° (lerped) */
    if (tiltRef.current) {
      tiltRef.current.rotation.x = THREE.MathUtils.damp(tiltRef.current.rotation.x, -d.pointerY * 0.07, 4, dt);
      tiltRef.current.rotation.y = THREE.MathUtils.damp(tiltRef.current.rotation.y, d.pointerX * 0.07, 4, dt);
    }

    /* camera - default wide, or eased into the focused node */
    const cam = state.camera;
    _v1.set(0, 0.55, 7.6);
    _v2.set(0, 0, 0);
    if (focus >= 0 && orbitRef.current) {
      const n = NODES[focus];
      const a = n.angle + orbitRef.current.rotation.y;
      _v3.set(Math.cos(a) * n.radius, n.y, Math.sin(a) * n.radius);
      _v1.set(_v3.x * 0.42, _v3.y * 0.4 + 0.55, 4.9);
      _v2.copy(_v3).multiplyScalar(0.75);
    }
    cam.position.x = THREE.MathUtils.damp(cam.position.x, _v1.x, 3.4, dt);
    cam.position.y = THREE.MathUtils.damp(cam.position.y, _v1.y, 3.4, dt);
    cam.position.z = THREE.MathUtils.damp(cam.position.z, _v1.z, 3.4, dt);
    lookTarget.lerp(_v2, 1 - Math.exp(-3.4 * dt));
    cam.lookAt(lookTarget);
  });

  return (
    <group ref={tiltRef}>
      <group ref={orbitRef}>
        {/* faint mean orbit ring */}
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[2.68, 0.005, 6, 128]} />
          <meshBasicMaterial color={colors.brand} transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <Beams colors={colors} focus={focus} />
        <Packets driver={driver} fx={fx} colors={colors} focus={focus} />
        <ProviderNodes driver={driver} colors={colors} focus={focus} onFocus={onFocus} />
      </group>
      <CacheCore driver={driver} fx={fx} colors={colors} sprite={sprite} />
      <CyanBursts driver={driver} fx={fx} colors={colors} sprite={sprite} />
    </group>
  );
}

/* ── Scene B - Provider Constellation (Features → Playback chapter) ──── */

export default function ProviderConstellation({ driver }: { driver: ConstellationDriverRef }) {
  const colors = useMemo<SceneColors>(
    () => ({
      brand: cssColor('--brand', THEME_PRESETS[theme.preset].brand),
      accent: cssColor('--accent', THEME_PRESETS[theme.preset].accent),
      warm: cssColor('--warm', THEME_PRESETS[theme.preset].warm),
    }),
    [],
  );
  const sprite = useMemo(() => makeSoftSprite(), []);
  const fx = useRef<FxState>({ flash: 0, seq: 0, bursts: Array<Burst | null>(BURST_POOL).fill(null) });
  const [focus, setFocus] = useState(-1);

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.55, 7.6], fov: 42, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
      onPointerMissed={() => setFocus(-1)}
    >
      <ConstellationRig driver={driver} fx={fx} colors={colors} sprite={sprite} focus={focus} onFocus={setFocus} />
    </Canvas>
  );
}

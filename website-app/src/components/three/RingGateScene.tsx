import { useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import theme, { THEME_PRESETS } from '@/theme.config';

/** Mutable driver written by GSAP / pointer handlers, read every frame. */
export interface RingGateDriver {
  /** hero pin progress 0→1 (camera dolly, ring expand, particle accel) */
  scroll: number;
  /** normalized pointer -1..1 */
  pointerX: number;
  pointerY: number;
  /** load intro 0→1 (rings scale in, particle flow ramps up) */
  intro: number;
}
export type RingGateDriverRef = MutableRefObject<RingGateDriver>;

const RING_RADII = [1.0, 1.3, 1.6, 1.9, 2.2];
const PARTICLE_COUNT = 2400;
const TRAIL_COUNT = 300;

const _v = new THREE.Vector3();

function cssColor(varName: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(v || fallback);
}

/** Soft round sprite texture (radial gradient) for points / glow. */
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

/* ── Five concentric emissive torus rings ─────────────────────────────── */

function Rings({ driver, color }: { driver: RingGateDriverRef; color: THREE.Color }) {
  const groups = useRef<Array<THREE.Group | null>>([]);
  const mats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const haloMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const d = driver.current;
    const dt = Math.min(delta, 0.05);
    const scrollFade = 1 - THREE.MathUtils.smoothstep(d.scroll, 0.45, 1);

    RING_RADII.forEach((_, i) => {
      const g = groups.current[i];
      const dir = i % 2 === 0 ? 1 : -1;
      const speed = 0.05 + (i / (RING_RADII.length - 1)) * 0.15; // 0.05–0.2 rad/s
      if (g) {
        g.rotation.z += dir * speed * dt;
        g.scale.setScalar((0.85 + 0.15 * d.intro) * (1 + d.scroll * 0.35));
      }
      const pulse = 1 + 0.6 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 3.2 + i * 1.1));
      const m = mats.current[i];
      if (m) m.opacity = 0.8 * pulse * d.intro * scrollFade;
      const hm = haloMats.current[i];
      if (hm) hm.opacity = 0.05 * pulse * d.intro * scrollFade;
    });
  });

  return (
    <group>
      {RING_RADII.map((r, i) => (
        <group
          key={r}
          ref={(el) => {
            groups.current[i] = el;
          }}
        >
          <mesh>
            <torusGeometry args={[r, 0.012, 8, 160]} />
            <meshBasicMaterial
              ref={(el) => {
                mats.current[i] = el;
              }}
              color={color}
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh>
            <torusGeometry args={[r, 0.055, 8, 160]} />
            <meshBasicMaterial
              ref={(el) => {
                haloMats.current[i] = el;
              }}
              color={color}
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── Particle stream through the gate (2,400 points + 300 trail segments) ── */

interface Lane {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  p3: THREE.Vector3;
}

function cubic(lane: Lane, t: number, out: THREE.Vector3): THREE.Vector3 {
  const it = 1 - t;
  const a = it * it * it;
  const b = 3 * it * it * t;
  const c = 3 * it * t * t;
  const d = t * t * t;
  out.set(
    a * lane.p0.x + b * lane.p1.x + c * lane.p2.x + d * lane.p3.x,
    a * lane.p0.y + b * lane.p1.y + c * lane.p2.y + d * lane.p3.y,
    a * lane.p0.z + b * lane.p1.z + c * lane.p2.z + d * lane.p3.z,
  );
  return out;
}

interface StreamColors {
  brand: THREE.Color;
  accent: THREE.Color;
  warm: THREE.Color;
}

interface StreamData {
  lanes: Lane[];
  speeds: Float32Array;
  offsets: Float32Array;
  positions: Float32Array;
  colorArr: Float32Array;
  trailPositions: Float32Array;
  trailColors: Float32Array;
}

/** Module-level factory (impure by design) - builds stable per-mount stream data. */
function createStreamData(colors: StreamColors): StreamData {
  const lanes: Lane[] = [];
  const speeds = new Float32Array(PARTICLE_COUNT);
  const offsets = new Float32Array(PARTICLE_COUNT);
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colorArr = new Float32Array(PARTICLE_COUNT * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const x0 = (Math.random() - 0.5) * 11;
    const y0 = (Math.random() - 0.5) * 11;
    const x3 = (Math.random() - 0.5) * 7;
    const y3 = (Math.random() - 0.5) * 7;
    lanes.push({
      p0: new THREE.Vector3(x0, y0, -26 - Math.random() * 8),
      p1: new THREE.Vector3(x0 * 0.25 + (Math.random() - 0.5) * 1.4, y0 * 0.25 + (Math.random() - 0.5) * 1.4, -14),
      p2: new THREE.Vector3(x3 * 0.22 + (Math.random() - 0.5) * 0.9, y3 * 0.22 + (Math.random() - 0.5) * 0.9, -4),
      p3: new THREE.Vector3(x3, y3, 8 + Math.random() * 4),
    });
    speeds[i] = 0.028 + Math.random() * 0.038;
    offsets[i] = Math.random();

    if (Math.random() < 0.08) tmp.copy(colors.warm);
    else tmp.copy(colors.brand).lerp(colors.accent, Math.random());
    colorArr[i * 3] = tmp.r;
    colorArr[i * 3 + 1] = tmp.g;
    colorArr[i * 3 + 2] = tmp.b;
  }

  const trailPositions = new Float32Array(TRAIL_COUNT * 6);
  const trailColors = new Float32Array(TRAIL_COUNT * 6);
  for (let k = 0; k < TRAIL_COUNT; k++) {
    const i = (k * 8) % PARTICLE_COUNT;
    trailColors[k * 6] = colorArr[i * 3];
    trailColors[k * 6 + 1] = colorArr[i * 3 + 1];
    trailColors[k * 6 + 2] = colorArr[i * 3 + 2];
    // tail vertex ~black → fades the segment
    trailColors[k * 6 + 3] = colorArr[i * 3] * 0.04;
    trailColors[k * 6 + 4] = colorArr[i * 3 + 1] * 0.04;
    trailColors[k * 6 + 5] = colorArr[i * 3 + 2] * 0.04;
  }

  return { lanes, speeds, offsets, positions, colorArr, trailPositions, trailColors };
}

/** Stable per-colors-instance stream data (mutable GPU buffers by design). */
const streamCache = new WeakMap<StreamColors, StreamData>();
function getStreamData(colors: StreamColors): StreamData {
  let d = streamCache.get(colors);
  if (!d) {
    d = createStreamData(colors);
    streamCache.set(colors, d);
  }
  return d;
}

function ParticleStream({ driver, colors, sprite }: { driver: RingGateDriverRef; colors: StreamColors; sprite: THREE.Texture }) {
  const pointsRef = useRef<THREE.Points>(null);
  const pointsMat = useRef<THREE.PointsMaterial>(null);
  const trailsRef = useRef<THREE.LineSegments>(null);
  const trailsMat = useRef<THREE.LineBasicMaterial>(null);

  const data = getStreamData(colors);

  /* eslint-disable react-hooks/immutability -- R3F: positions are intentionally
     mutable GPU buffers; useFrame writes them every frame by design. */
  useFrame((state) => {
    const d = driver.current;
    const time = state.clock.elapsedTime;
    const speedMul = (0.35 + 0.65 * d.intro) * (1 + d.scroll * 1.2); // ×1 → ×2.2

    const pos = data.positions;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = (data.offsets[i] + time * data.speeds[i] * speedMul) % 1;
      cubic(data.lanes[i], t, _v);
      pos[i * 3] = _v.x;
      pos[i * 3 + 1] = _v.y;
      pos[i * 3 + 2] = _v.z;
    }
    if (pointsRef.current) pointsRef.current.geometry.attributes.position.needsUpdate = true;
    if (pointsMat.current) pointsMat.current.opacity = 0.9 * d.intro;

    const tp = data.trailPositions;
    for (let k = 0; k < TRAIL_COUNT; k++) {
      const i = (k * 8) % PARTICLE_COUNT;
      const t = (data.offsets[i] + time * data.speeds[i] * speedMul) % 1;
      cubic(data.lanes[i], t, _v);
      tp[k * 6] = _v.x;
      tp[k * 6 + 1] = _v.y;
      tp[k * 6 + 2] = _v.z;
      cubic(data.lanes[i], Math.max(0, t - 0.022), _v);
      tp[k * 6 + 3] = _v.x;
      tp[k * 6 + 4] = _v.y;
      tp[k * 6 + 5] = _v.z;
    }
    if (trailsRef.current) trailsRef.current.geometry.attributes.position.needsUpdate = true;
    if (trailsMat.current) trailsMat.current.opacity = 0.5 * d.intro;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group>
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.colorArr, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={pointsMat}
          size={0.075}
          map={sprite}
          vertexColors
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <lineSegments ref={trailsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.trailPositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.trailColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={trailsMat}
          vertexColors
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}

/* ── Warm core glow + rig (tilt / parallax / dolly) ────────────────────── */

function CoreGlow({ driver, color, sprite }: { driver: RingGateDriverRef; color: THREE.Color; sprite: THREE.Texture }) {
  const mat = useRef<THREE.SpriteMaterial>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (mat.current) {
      mat.current.opacity = (0.32 + 0.14 * Math.sin((t * Math.PI * 2) / 3.2)) * driver.current.intro;
    }
  });
  return (
    <sprite scale={[2.8, 2.8, 1]}>
      <spriteMaterial ref={mat} map={sprite} color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
    </sprite>
  );
}

function Rig({ driver, children }: { driver: RingGateDriverRef; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    const d = driver.current;
    const cam = state.camera;
    cam.position.z = 6 - d.scroll * 3.6; // dolly 6 → 2.4
    cam.position.x = THREE.MathUtils.lerp(cam.position.x, d.pointerX * 0.3, 0.06);
    cam.position.y = THREE.MathUtils.lerp(cam.position.y, d.pointerY * 0.3, 0.06);
    cam.lookAt(0, 0, 0);
    if (group.current) {
      group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, d.pointerY * 0.105, 0.06); // ±6°
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, d.pointerX * 0.105, 0.06);
    }
  });

  return <group ref={group}>{children}</group>;
}

/* ── Scene A - Ring Gate (Home hero) ───────────────────────────────────── */

export default function RingGateScene({ driver }: { driver: RingGateDriverRef }) {
  const colors = useMemo<StreamColors>(
    () => ({
      brand: cssColor('--brand', THEME_PRESETS[theme.preset].brand),
      accent: cssColor('--accent', THEME_PRESETS[theme.preset].accent),
      warm: cssColor('--warm', THEME_PRESETS[theme.preset].warm),
    }),
    [],
  );
  const sprite = useMemo(() => makeSoftSprite(), []);

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6], fov: 42, near: 0.1, far: 80 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Rig driver={driver}>
        <Rings driver={driver} color={colors.brand} />
        <ParticleStream driver={driver} colors={colors} sprite={sprite} />
        <CoreGlow driver={driver} color={colors.warm} sprite={sprite} />
      </Rig>
    </Canvas>
  );
}

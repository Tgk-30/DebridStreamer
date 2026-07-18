import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { gsap } from '@/lib/gsap';
import theme, { THEME_PRESETS } from '@/theme.config';

/**
 * Scene C - Server Core (Self-host page).
 *
 * A floating glass cube (transmission material) containing a smaller emissive
 * brand cube - "the server". Five device glyphs (TV / desktop / laptop /
 * tablet / phone) ride three inclined elliptical orbits; thin cyan beam
 * splines connect each glyph to the core with traveling light dashes.
 *
 * Motion: slow rotation (0.08 rad/s) + scroll-scrubbed 180° turn + cursor
 * parallax ±5°. Mount flash on the core, glyph pop-in stagger, beam draw-on.
 */

/** Mutable driver written by the section (scroll/pointer/hover), read per frame. */
export interface ServerCoreDriver {
  /** scroll progress through the section 0→1 (rig rotates 0→π) */
  scroll: number;
  /** normalized pointer -1..1 */
  pointerX: number;
  pointerY: number;
  /** mount intro 0→1 (core scale + flash, glyph pop-in, beam draw) */
  intro: number;
  /** highlighted glyph index from the DOM list (-1 = none) */
  highlight: number;
}
export type ServerCoreDriverRef = MutableRefObject<ServerCoreDriver>;

const PARALLAX = THREE.MathUtils.degToRad(5); // ±5° cursor parallax
const SEG = 24; // points per beam spline
const PACKETS_PER_BEAM = 2;

const _ctrl = new THREE.Vector3();
const _glyph = new THREE.Vector3();

function cssColor(varName: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(v || fallback);
}

/** Soft round sprite texture (radial gradient) for packets / bloom. */
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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/* ── Orbits + glyphs ───────────────────────────────────────────────────── */

type GlyphKind = 'tv' | 'desktop' | 'laptop' | 'tablet' | 'phone';

const ORBITS = [
  { a: 2.35, b: 1.5, rotX: THREE.MathUtils.degToRad(64), rotZ: THREE.MathUtils.degToRad(-10), speed: 0.1 },
  { a: 2.85, b: 1.85, rotX: THREE.MathUtils.degToRad(73), rotZ: THREE.MathUtils.degToRad(16), speed: -0.072 },
  { a: 3.35, b: 2.15, rotX: THREE.MathUtils.degToRad(57), rotZ: THREE.MathUtils.degToRad(34), speed: 0.055 },
];

const GLYPHS: { kind: GlyphKind; orbit: number; angle: number }[] = [
  { kind: 'tv', orbit: 0, angle: 0.4 },
  { kind: 'desktop', orbit: 0, angle: Math.PI + 0.9 },
  { kind: 'laptop', orbit: 1, angle: 1.3 },
  { kind: 'tablet', orbit: 1, angle: 4.2 },
  { kind: 'phone', orbit: 2, angle: 2.6 },
];

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function extrudedPanel(w: number, h: number, r: number, depth: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 1,
    curveSegments: 6,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

interface GlyphMeshes {
  body: THREE.BufferGeometry[];
  /** [width, height, zOffset, yOffset] of the emissive screen plane */
  screen: [number, number, number, number] | null;
  hitbox: [number, number, number];
}

/** Builds the geometry set for a device glyph (body parts + emissive screen). */
function buildGlyph(kind: GlyphKind): GlyphMeshes {
  switch (kind) {
    case 'tv': {
      const panel = extrudedPanel(0.68, 0.44, 0.06, 0.05);
      const stand = new THREE.BoxGeometry(0.06, 0.1, 0.04);
      stand.translate(0, -0.26, 0);
      const foot = new THREE.BoxGeometry(0.3, 0.035, 0.06);
      foot.translate(0, -0.31, 0);
      return { body: [panel, stand, foot], screen: [0.58, 0.34, 0.034, 0.015], hitbox: [0.85, 0.8, 0.3] };
    }
    case 'desktop': {
      const panel = extrudedPanel(0.54, 0.38, 0.05, 0.05);
      const neck = new THREE.BoxGeometry(0.06, 0.1, 0.04);
      neck.translate(0, -0.23, 0);
      const foot = new THREE.BoxGeometry(0.26, 0.035, 0.06);
      foot.translate(0, -0.28, 0);
      return { body: [panel, neck, foot], screen: [0.44, 0.28, 0.034, 0.015], hitbox: [0.7, 0.72, 0.3] };
    }
    case 'laptop': {
      const lid = extrudedPanel(0.52, 0.36, 0.04, 0.035);
      lid.rotateX(THREE.MathUtils.degToRad(-12));
      lid.translate(0, 0.1, -0.06);
      const base = new THREE.BoxGeometry(0.56, 0.035, 0.36);
      base.translate(0, -0.1, 0.05);
      return { body: [lid, base], screen: [0.44, 0.28, 0.068, 0.115], hitbox: [0.7, 0.6, 0.5] };
    }
    case 'tablet': {
      const panel = extrudedPanel(0.38, 0.52, 0.07, 0.045);
      return { body: [panel], screen: [0.29, 0.42, 0.031, 0], hitbox: [0.55, 0.7, 0.3] };
    }
    case 'phone': {
      const panel = extrudedPanel(0.27, 0.52, 0.07, 0.045);
      return { body: [panel], screen: [0.19, 0.42, 0.031, 0], hitbox: [0.45, 0.7, 0.3] };
    }
  }
}

interface SceneColors {
  brand: THREE.Color;
  accent: THREE.Color;
  warm: THREE.Color;
  ink2: THREE.Color;
}

type GlyphRefs = MutableRefObject<Array<THREE.Group | null>>;

/* ── Single orbit ring + its glyphs ────────────────────────────────────── */

interface OrbitProps {
  orbitIndex: number;
  driver: ServerCoreDriverRef;
  colors: SceneColors;
  glyphAngles: MutableRefObject<number[]>;
  glyphRefs: GlyphRefs;
  beamGlow: MutableRefObject<number[]>;
  onGlyphHover?: (index: number | null) => void;
}

function Orbit({ orbitIndex, driver, colors, glyphAngles, glyphRefs, beamGlow, onGlyphHover }: OrbitProps) {
  const orbit = ORBITS[orbitIndex];
  const trailMat = useRef<THREE.LineBasicMaterial>(null);
  const trailGeo = useRef<THREE.BufferGeometry>(null);

  const trailPositions = useMemo(() => {
    const pts = new Float32Array(129 * 3);
    for (let i = 0; i <= 128; i++) {
      const t = (i / 128) * Math.PI * 2;
      pts[i * 3] = orbit.a * Math.cos(t);
      pts[i * 3 + 1] = 0;
      pts[i * 3 + 2] = orbit.b * Math.sin(t);
    }
    return pts;
  }, [orbit.a, orbit.b]);

  const glyphsHere = useMemo(() => GLYPHS.map((g, i) => ({ ...g, index: i })).filter((g) => g.orbit === orbitIndex), [orbitIndex]);
  const glyphData = useMemo(() => glyphsHere.map((g) => buildGlyph(g.kind)), [glyphsHere]);

  useFrame((state, delta) => {
    const d = driver.current;
    const dt = Math.min(delta, 0.05);
    const introP = THREE.MathUtils.clamp(d.intro * 1.3 - orbitIndex * 0.15, 0, 1);

    // ring reveal + opacity
    if (trailGeo.current) trailGeo.current.setDrawRange(0, Math.floor(introP * 129));
    if (trailMat.current) trailMat.current.opacity = 0.24 * introP;

    glyphsHere.forEach((g) => {
      glyphAngles.current[g.index] += orbit.speed * dt * d.intro;
      const grp = glyphRefs.current[g.index];
      if (!grp) return;
      const a = glyphAngles.current[g.index];
      grp.position.set(orbit.a * Math.cos(a), 0, orbit.b * Math.sin(a));

      // pop-in stagger (120ms apart) + hover scale 1.15
      const pop = easeOutCubic(THREE.MathUtils.clamp(d.intro * 1.6 - g.index * 0.12, 0, 1));
      const hovered = d.highlight === g.index;
      const current = grp.userData.scaleLerp ?? 1;
      const next = THREE.MathUtils.lerp(current, hovered ? 1.15 : 1, 0.15);
      grp.userData.scaleLerp = next;
      grp.scale.setScalar(pop * next);

      beamGlow.current[g.index] = THREE.MathUtils.lerp(beamGlow.current[g.index], hovered ? 1 : 0, 0.12);

      // billboard toward the camera + emissive lift on highlight
      grp.lookAt(state.camera.position);
      const glow = beamGlow.current[g.index];
      grp.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material.emissiveIntensity = glow * 0.45;
        }
      });
    });
  });

  return (
    <group rotation={[orbit.rotX, 0, orbit.rotZ]}>
      <lineLoop>
        <bufferGeometry ref={trailGeo}>
          <bufferAttribute attach="attributes-position" args={[trailPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={trailMat}
          color={colors.brand}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineLoop>

      {glyphsHere.map((g, k) => {
        const data = glyphData[k];
        return (
          <group
            key={g.kind}
            ref={(el) => {
              glyphRefs.current[g.index] = el;
            }}
            scale={0}
          >
            {data.body.map((geo, gi) => (
              <mesh key={gi} geometry={geo}>
                <meshStandardMaterial
                  color={colors.ink2}
                  roughness={0.5}
                  metalness={0.3}
                  emissive={colors.brand}
                  emissiveIntensity={0}
                />
              </mesh>
            ))}
            {data.screen && (
              <mesh position={[0, data.screen[3], data.screen[2]]}>
                <planeGeometry args={[data.screen[0], data.screen[1]]} />
                <meshBasicMaterial
                  color={colors.accent}
                  transparent
                  opacity={0.5}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            )}
            {/* generous invisible hitbox for bi-directional hover */}
            <mesh
              visible={false}
              onPointerOver={(e) => {
                e.stopPropagation();
                onGlyphHover?.(g.index);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                onGlyphHover?.(null);
                document.body.style.cursor = '';
              }}
            >
              <boxGeometry args={data.hitbox} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ── One beam spline (imperative THREE.Line, preallocated buffer) ───────── */

interface BeamLineProps {
  positions: Float32Array;
  color: THREE.Color;
  bind: (line: THREE.Line, geo: THREE.BufferGeometry, mat: THREE.LineBasicMaterial) => void;
}

function BeamLine({ positions, color, bind }: BeamLineProps) {
  const line = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const l = new THREE.Line(geo, mat);
    l.frustumCulled = false;
    bind(l, geo, mat);
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one line per positions buffer
  }, [positions]);
  return <primitive object={line} />;
}

/* ── Beam splines + traveling light dashes ─────────────────────────────── */

interface BeamsProps {
  driver: ServerCoreDriverRef;
  colors: SceneColors;
  rig: MutableRefObject<THREE.Group | null>;
  glyphRefs: GlyphRefs;
  beamGlow: MutableRefObject<number[]>;
  sprite: THREE.Texture;
}

function Beams({ driver, colors, rig, glyphRefs, beamGlow, sprite }: BeamsProps) {
  const lineRefs = useRef<Array<THREE.Line | null>>(GLYPHS.map(() => null));
  const pointsRef = useRef<THREE.Points>(null);
  const pointsMat = useRef<THREE.PointsMaterial>(null);

  const beamPositions = useMemo(() => GLYPHS.map(() => new Float32Array(SEG * 3)), []);
  const packetPositions = useMemo(() => new Float32Array(GLYPHS.length * PACKETS_PER_BEAM * 3), []);
  // deterministic pseudo-random phases/speeds (stable across re-renders)
  const packetMeta = useMemo(
    () =>
      GLYPHS.flatMap((_, b) => [
        { beam: b, phase: (b * 0.37 + 0.11) % 1, speed: 0.34 + ((b * 7) % 5) * 0.045 },
        { beam: b, phase: (b * 0.37 + 0.58) % 1, speed: 0.34 + ((b * 3 + 2) % 5) * 0.045 },
      ]),
    [],
  );

  /* eslint-disable react-hooks/immutability -- R3F: GPU buffers are mutated per frame by design. */
  useFrame((state) => {
    const d = driver.current;
    const time = state.clock.elapsedTime;
    const r = rig.current;
    if (!r) return;

    for (let b = 0; b < GLYPHS.length; b++) {
      const grp = glyphRefs.current[b];
      const line = lineRefs.current[b];
      if (!grp || !line) continue;
      const geo = line.geometry as THREE.BufferGeometry;
      const mat = line.material as THREE.LineBasicMaterial;

      // glyph position in rig-local space (beams live inside the rig)
      grp.getWorldPosition(_glyph);
      r.worldToLocal(_glyph);

      // arc control point: pushed toward the core + slightly up
      _ctrl.copy(_glyph).multiplyScalar(0.55);
      _ctrl.y += 0.35;

      const pop = easeOutCubic(THREE.MathUtils.clamp(d.intro * 1.6 - b * 0.12, 0, 1));
      const pos = beamPositions[b];
      for (let i = 0; i < SEG; i++) {
        const t = i / (SEG - 1);
        const it = 1 - t;
        pos[i * 3] = it * it * _glyph.x + 2 * it * t * _ctrl.x;
        pos[i * 3 + 1] = it * it * _glyph.y + 2 * it * t * _ctrl.y;
        pos[i * 3 + 2] = it * it * _glyph.z + 2 * it * t * _ctrl.z;
      }
      geo.attributes.position.needsUpdate = true;
      // beam draws on after its glyph pops
      geo.setDrawRange(0, Math.floor(pop * SEG));
      mat.opacity = pop * (0.32 + beamGlow.current[b] * 0.55);

      // traveling light dashes (packets ride the spline toward the core)
      for (let p = 0; p < PACKETS_PER_BEAM; p++) {
        const meta = packetMeta[b * PACKETS_PER_BEAM + p];
        const t = (meta.phase + time * meta.speed) % 1;
        const it = 1 - t;
        const idx = (b * PACKETS_PER_BEAM + p) * 3;
        packetPositions[idx] = it * it * _glyph.x + 2 * it * t * _ctrl.x;
        packetPositions[idx + 1] = it * it * _glyph.y + 2 * it * t * _ctrl.y;
        packetPositions[idx + 2] = it * it * _glyph.z + 2 * it * t * _ctrl.z;
      }
    }
    if (pointsRef.current) pointsRef.current.geometry.attributes.position.needsUpdate = true;
    if (pointsMat.current) pointsMat.current.opacity = 0.9 * d.intro;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group>
      {GLYPHS.map((g, b) => (
        <BeamLine
          key={g.kind}
          positions={beamPositions[b]}
          color={colors.accent}
          bind={(line) => {
            lineRefs.current[b] = line;
          }}
        />
      ))}
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[packetPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={pointsMat}
          size={0.14}
          map={sprite}
          color={colors.accent}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
          toneMapped={false}
        />
      </points>
    </group>
  );
}

/* ── Core: glass cube + emissive brand cube + warm bloom ───────────────── */

function Core({ driver, colors, sprite }: { driver: ServerCoreDriverRef; colors: SceneColors; sprite: THREE.Texture }) {
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const coreMesh = useRef<THREE.Mesh>(null);
  const glass = useRef<THREE.Mesh>(null);
  const bloomMat = useRef<THREE.SpriteMaterial>(null);
  const light = useRef<THREE.PointLight>(null);

  useFrame((state, delta) => {
    const d = driver.current;
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const p = Math.min(d.intro, 1);

    // mount: scale 0.6 → 1, emissive flash 1 → 2.2 → 1.4, then slow idle pulse
    const flash = Math.sin(p * Math.PI) * 0.8;
    const idle = p >= 1 ? 0.25 * Math.sin((t * Math.PI * 2) / 3.2) : 0;
    if (coreMat.current) coreMat.current.emissiveIntensity = 1.4 + flash + idle;
    if (coreMesh.current) {
      const s = 0.6 + 0.4 * easeOutCubic(p);
      coreMesh.current.scale.setScalar(s);
      coreMesh.current.rotation.y += 0.25 * dt;
      coreMesh.current.rotation.x = Math.sin(t * 0.4) * 0.12;
    }
    if (glass.current) {
      glass.current.rotation.y -= 0.06 * dt;
      glass.current.rotation.x = Math.sin(t * 0.3) * 0.08;
    }
    if (bloomMat.current) bloomMat.current.opacity = (0.4 + 0.12 * Math.sin((t * Math.PI * 2) / 3.2)) * p;
    if (light.current) light.current.intensity = (10 + flash * 14 + idle * 4) * p;
  });

  return (
    <group>
      {/* warm projector bloom behind the cube */}
      <sprite position={[0, 0, -1.4]} scale={[4.6, 4.6, 1]}>
        <spriteMaterial
          ref={bloomMat}
          map={sprite}
          color={colors.warm}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>

      <pointLight ref={light} color={colors.brand} intensity={0} distance={9} decay={2} />

      {/* glass shell */}
      <mesh ref={glass}>
        <boxGeometry args={[1.7, 1.7, 1.7]} />
        <MeshTransmissionMaterial
          transmission={1}
          thickness={0.45}
          roughness={0.15}
          ior={1.42}
          chromaticAberration={0.06}
          anisotropicBlur={0.35}
          resolution={512}
          samples={4}
        />
      </mesh>

      {/* the server - emissive brand cube */}
      <mesh ref={coreMesh} scale={0.6}>
        <boxGeometry args={[0.72, 0.72, 0.72]} />
        <meshStandardMaterial
          ref={coreMat}
          color={colors.brand}
          emissive={colors.brand}
          emissiveIntensity={1.4}
          roughness={0.3}
          metalness={0.1}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* ── Rig: slow rotation + scroll-scrubbed 180° + cursor parallax ────────── */

function Rig({
  driver,
  rigRef,
  children,
}: {
  driver: ServerCoreDriverRef;
  rigRef: MutableRefObject<THREE.Group | null>;
  children: ReactNode;
}) {
  const baseRot = useRef(0);

  useFrame((state, delta) => {
    const d = driver.current;
    const dt = Math.min(delta, 0.05);
    baseRot.current += 0.08 * dt * d.intro; // 0.08 rad/s idle spin
    const cam = state.camera;
    cam.position.x = THREE.MathUtils.lerp(cam.position.x, d.pointerX * 0.25, 0.06);
    cam.position.y = THREE.MathUtils.lerp(cam.position.y, 0.4 + d.pointerY * 0.2, 0.06);
    cam.lookAt(0, 0, 0);
    if (rigRef.current) {
      const targetY = baseRot.current + d.scroll * Math.PI + d.pointerX * PARALLAX;
      rigRef.current.rotation.y = THREE.MathUtils.lerp(rigRef.current.rotation.y, targetY, 0.08);
      rigRef.current.rotation.x = THREE.MathUtils.lerp(rigRef.current.rotation.x, d.pointerY * -PARALLAX * 0.6, 0.06);
    }
  });

  return <group ref={rigRef}>{children}</group>;
}

/* ── Scene root ────────────────────────────────────────────────────────── */

interface ServerCoreSceneProps {
  driver: ServerCoreDriverRef;
  /** bi-directional hover: glyph → DOM list */
  onGlyphHover?: (index: number | null) => void;
}

export default function ServerCoreScene({ driver, onGlyphHover }: ServerCoreSceneProps) {
  const colors = useMemo<SceneColors>(() => {
    const preset = THEME_PRESETS[theme.preset];
    return {
      brand: cssColor('--brand', preset.brand),
      accent: cssColor('--accent', preset.accent),
      warm: cssColor('--warm', preset.warm),
      ink2: cssColor('--ink-2', '#9AB2BC'),
    };
  }, []);
  const sprite = useMemo(() => makeSoftSprite(), []);

  const rigRef = useRef<THREE.Group | null>(null);
  const glyphRefs = useRef<Array<THREE.Group | null>>(GLYPHS.map(() => null));
  const beamGlow = useRef<number[]>(GLYPHS.map(() => 0));
  const glyphAngles = useRef<number[]>(GLYPHS.map((g) => g.angle));

  // mount flash / pop-in choreography
  useEffect(() => {
    const d = driver.current;
    const tw = gsap.fromTo(d, { intro: 0 }, { intro: 1, duration: 1.6, ease: 'power2.out' });
    return () => {
      tw.kill();
      d.intro = 0;
    };
  }, [driver]);

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.4, 8.4], fov: 40, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 6]} intensity={0.7} />

      <Rig driver={driver} rigRef={rigRef}>
        <Core driver={driver} colors={colors} sprite={sprite} />
        {[0, 1, 2].map((o) => (
          <Orbit
            key={o}
            orbitIndex={o}
            driver={driver}
            colors={colors}
            glyphAngles={glyphAngles}
            glyphRefs={glyphRefs}
            beamGlow={beamGlow}
            onGlyphHover={onGlyphHover}
          />
        ))}
        <Beams driver={driver} colors={colors} rig={rigRef} glyphRefs={glyphRefs} beamGlow={beamGlow} sprite={sprite} />
      </Rig>
    </Canvas>
  );
}

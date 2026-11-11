// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The 3D preview: draws a Layout3 with three.js. Orbit with the mouse or one finger, zoom with the wheel or two.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Layout3 } from './layout3d';

const BAND_COLOURS = [0x6fb6c9, 0x9ccf7a, 0xd9a6e0, 0xf08a6c];
const colour = (band: number): number => BAND_COLOURS[band % BAND_COLOURS.length]!;

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  framed: boolean;
}

/** Everything in the group is disposed when the scene is rebuilt. */
function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
  g.clear();
}

function build(rig: Rig, layout: Layout3, explode: number, transparent: boolean): void {
  disposeGroup(rig.group);
  const [w, h, d] = layout.extent;
  const centre = new THREE.Vector3(w / 2, h / 2, -d / 2);
  const edge = new THREE.LineBasicMaterial({ color: 0x1a1a19 });
  const addMesh = (geo: THREE.BufferGeometry, col: number, opacity: number, at: THREE.Vector3): void => {
    const mat = new THREE.MeshStandardMaterial({ color: col, transparent: opacity < 1, opacity, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at);
    rig.group.add(mesh);
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge.clone());
    lines.position.copy(at);
    rig.group.add(lines);
  };
  const opacity = transparent ? 0.35 : 1;

  for (const b of layout.boxes) {
    const o = new THREE.Vector3(...b.origin);
    const c = new THREE.Vector3(...b.center);
    c.add(c.clone().sub(o).multiplyScalar(explode));
    if (b.kind !== 'panel' && !transparent && explode === 0) continue; // inside a solid box: nothing to see
    addMesh(new THREE.BoxGeometry(...b.size), colour(b.band), b.kind === 'panel' ? opacity : 0.9, c);
  }
  for (const q of layout.prisms) {
    // eight corners: the throat quad then the mouth quad, each in order bottom-left, bottom-right, top-right, top-left
    const p = q.points.flat();
    const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    addMesh(geo, colour(q.band), opacity, new THREE.Vector3(0, 0, 0));
  }
  for (const t of layout.tubes) {
    const geo = new THREE.CylinderGeometry(t.radius, t.radius, t.length, 24, 1, true);
    geo.rotateX(Math.PI / 2); // along z
    addMesh(geo, 0xd8d6d0, 0.9, new THREE.Vector3(t.center[0], t.center[1], t.center[2] - t.length / 2));
  }
  for (const dsc of layout.discs) {
    const geo = new THREE.CircleGeometry(dsc.radius, 48);
    const mat = new THREE.MeshBasicMaterial({ color: dsc.kind === 'port' ? 0x6fb6c9 : 0xffb040, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...dsc.center);
    mesh.rotation.x = dsc.tilt ?? 0;
    rig.group.add(mesh);
    const dark = new THREE.Mesh(new THREE.CircleGeometry(dsc.radius * 0.92, 48), new THREE.MeshBasicMaterial({ color: 0x0c0d0c }));
    dark.rotation.x = dsc.tilt ?? 0;
    dark.position.set(dsc.center[0], dsc.center[1] + 0.0005 * Math.sin(-(dsc.tilt ?? 0)), dsc.center[2] + 0.0005 * Math.cos(dsc.tilt ?? 0));
    rig.group.add(dark);
  }
  edge.dispose();
  if (!rig.framed) {
    const r = Math.max(w, h, d, 0.3);
    rig.camera.position.set(centre.x + r * 1.3, centre.y + r * 0.9, r * 1.9 + 0.2);
    rig.controls.target.set(centre.x, centre.y, -d / 2);
    rig.controls.update();
    rig.framed = true;
  }
}

export function Scene3D({ layout, explode, transparent }: { layout: Layout3; explode: number; transparent: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      el.textContent = 'This browser cannot show the 3D view (WebGL is unavailable).';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0c0d0c);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const group = new THREE.Group();
    scene.add(group);
    const r: Rig = { renderer, scene, camera, controls, group, framed: false };
    rig.current = r;

    const resize = (): void => {
      const w = Math.max(el.clientWidth, 1);
      const h = Math.max(el.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let frame = 0;
    const loop = (): void => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      disposeGroup(group);
      renderer.dispose();
      renderer.domElement.remove();
      rig.current = null;
    };
  }, []);

  useEffect(() => {
    if (rig.current) build(rig.current, layout, explode, transparent);
  }, [layout, explode, transparent]);

  return <div ref={host} className="scene3d" role="img" aria-label="3D preview of the cabinets. Drag to orbit, scroll to zoom." />;
}

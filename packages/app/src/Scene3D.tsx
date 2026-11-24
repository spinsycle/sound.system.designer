// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The 3D preview: draws a Layout3 with three.js. Orbit with the mouse or one finger, zoom with the wheel or two.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Hole3, Layout3 } from './layout3d';

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

/** A plate w x h x t centred on the origin (thin along z) with the holes cut through it. */
function plate(w: number, h: number, t: number, holes: Hole3[]): THREE.BufferGeometry {
  return outlinePlate([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], t, holes);
}

/** A plate of any outline (corners in order, relative to the centre of its bounding rectangle), t thick, with the holes cut through it. */
function outlinePlate(outline: [number, number][], t: number, holes: Hole3[]): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  outline.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  for (const o of holes) {
    const p = new THREE.Path();
    if (o.shape === 'rect') {
      const a = o.w! / 2;
      const b = o.h! / 2;
      p.moveTo(o.u - a, o.v - b);
      p.lineTo(o.u + a, o.v - b);
      p.lineTo(o.u + a, o.v + b);
      p.lineTo(o.u - a, o.v + b);
      p.closePath();
    } else p.absarc(o.u, o.v, o.radius, 0, Math.PI * 2, false);
    shape.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 32 });
  geo.translate(0, 0, -t / 2);
  return geo;
}

function build(rig: Rig, layout: Layout3, explode: number, transparent: boolean, speakers: boolean): void {
  disposeGroup(rig.group);
  const [w, h, d] = layout.extent;
  const centre = new THREE.Vector3(w / 2, h / 2, -d / 2);
  const edge = new THREE.LineBasicMaterial({ color: 0x1a1a19 });
  const addMesh = (geo: THREE.BufferGeometry, col: number, opacity: number, at: THREE.Vector3, tilt = 0): void => {
    const mat = new THREE.MeshStandardMaterial({ color: col, transparent: opacity < 1, opacity, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at);
    mesh.rotation.x = tilt;
    rig.group.add(mesh);
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge.clone());
    lines.position.copy(at);
    lines.rotation.x = tilt;
    rig.group.add(lines);
  };
  const opacity = transparent ? 0.35 : 1;

  for (const b of layout.boxes) {
    const o = new THREE.Vector3(...b.origin);
    const c = new THREE.Vector3(...b.center);
    c.add(c.clone().sub(o).multiplyScalar(explode));
    if (b.kind !== 'panel' && !transparent && explode === 0) continue; // inside a solid box: nothing to see
    let geo: THREE.BufferGeometry;
    if (b.holes?.length && b.holeAxis === 'y') {
      // the baffle is the bottom panel: draw the plate in x-y with v running along -z, then lay it flat
      geo = plate(b.size[0], b.size[2], b.size[1], b.holes.map((o) => ({ ...o, v: -o.v })));
      geo.rotateX(-Math.PI / 2);
    } else if (b.holes?.length) geo = plate(b.size[0], b.size[1], b.size[2], b.holes);
    else geo = new THREE.BoxGeometry(...b.size);
    addMesh(geo, b.kind === 'brace' ? 0xc9a36b : colour(b.band), b.kind === 'panel' ? opacity : 0.9, c, b.tilt ?? 0);
  }
  for (const q of layout.prisms) {
    // a brace is inside a solid box: nothing to see until it is see-through or exploded
    if (q.kind === 'brace' && !transparent && explode === 0) continue;
    const colourOf = q.kind === 'brace' ? 0xc9a36b : colour(q.band);
    const opacityOf = q.kind === 'brace' ? 0.9 : opacity;
    // eight corners: the throat quad then the mouth quad, each in order bottom-left, bottom-right, top-right, top-left
    const p = q.points.flat();
    const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
    // the exploded view moves a prism away from the centre of its cabinet, by the way its own centre lies from it (as the boxes do)
    const off = new THREE.Vector3();
    if (q.origin) {
      const mid = new THREE.Vector3();
      for (const pt of q.points) mid.add(new THREE.Vector3(...pt));
      mid.divideScalar(q.points.length);
      off.copy(mid.sub(new THREE.Vector3(...q.origin)).multiplyScalar(explode));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    if (q.holes?.length) {
      // a holed plate on the face's own axes (x along the bottom edge, y up, z out of the face): the wedge's sloping baffle, a tower's trapezoid
      // front, a tower's trapezoid brace. The outline is the face's four corners; u and v of a hole run from the face's bottom left corner.
      const [a0, a1, a2, a3, b0] = q.points.map((pt) => new THREE.Vector3(...pt)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
      const exn = a1.clone().sub(a0).normalize();
      const ezn = exn.clone().cross(a3.clone().sub(a0).normalize()).normalize();
      const eyn = ezn.clone().cross(exn);
      const thick = b0.clone().sub(a0).length();
      const corner = [a0, a1, a2, a3].map((pt) => [pt.clone().sub(a0).dot(exn), pt.clone().sub(a0).dot(eyn)] as [number, number]);
      const bw = Math.max(...corner.map((c) => c[0]));
      const bh = Math.max(...corner.map((c) => c[1]));
      const pg = outlinePlate(corner.map(([x, y]) => [x - bw / 2, y - bh / 2] as [number, number]), thick, q.holes.map((o) => ({ ...o, u: o.u - bw / 2, v: o.v - bh / 2 })));
      const mid = a0.clone().addScaledVector(exn, bw / 2).addScaledVector(eyn, bh / 2).addScaledVector(ezn, -thick / 2);
      pg.applyMatrix4(new THREE.Matrix4().makeBasis(exn, eyn, ezn).setPosition(mid));
      addMesh(pg, colourOf, opacityOf, off.clone());
      continue;
    }
    addMesh(geo, colourOf, opacityOf, off.clone());
  }
  for (const t of layout.tubes) {
    const up = t.axis === 'y';
    let geo: THREE.BufferGeometry;
    if (t.rect) {
      // a slot port: an open box along its length (z, or y when the baffle faces down)
      geo = up ? new THREE.BoxGeometry(t.rect.w, t.length, t.rect.h) : new THREE.BoxGeometry(t.rect.w, t.rect.h, t.length);
    } else {
      geo = new THREE.CylinderGeometry(t.radius, t.radius, t.length, 24, 1, true);
      if (!up) geo.rotateX(Math.PI / 2); // along z
    }
    const at = up ? new THREE.Vector3(t.center[0], t.center[1] + t.length / 2, t.center[2]) : new THREE.Vector3(t.center[0], t.center[1], t.center[2] - t.length / 2);
    addMesh(geo, 0xd8d6d0, 0.9, at);
  }
  if (speakers) {
    // each driver: a flange ring, a cone dish narrowing away from the flange and a motor behind it, along the driver's direction
    const flange = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.6 });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1b, roughness: 0.9, side: THREE.DoubleSide });
    const motorMat = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.5, metalness: 0.4 });
    for (const dr of layout.drivers) {
      const r = dr.radius;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, r * 0.06, 8, 40), flange));
      const coneGeo = new THREE.CylinderGeometry(r * 0.28, r * 0.9, r * 0.5, 32, 1, true);
      coneGeo.rotateX(-Math.PI / 2); // wide end at the flange, narrow end away from it (towards local -z)
      coneGeo.translate(0, 0, -r * 0.25);
      g.add(new THREE.Mesh(coneGeo, coneMat));
      const motorGeo = new THREE.CylinderGeometry(r * 0.5, r * 0.5, r * 0.55, 24);
      motorGeo.rotateX(-Math.PI / 2);
      motorGeo.translate(0, 0, -r * 0.5 - r * 0.275);
      g.add(new THREE.Mesh(motorGeo, motorMat));
      g.position.set(...dr.flange);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...dr.dir).normalize());
      rig.group.add(g);
    }
  }
  for (const dsc of layout.discs) {
    if (speakers && dsc.kind === 'driver') continue; // the installed driver stands in for the hole marker
    // the holes are cut in the plates now: mark each with an amber (driver) or blue (port) rim round it
    const rim = new THREE.Shape();
    const hole = new THREE.Path();
    if (dsc.shape === 'rect') {
      const a = dsc.w! / 2;
      const b = dsc.h! / 2;
      const m = 0.012;
      rim.moveTo(-a - m, -b - m); rim.lineTo(a + m, -b - m); rim.lineTo(a + m, b + m); rim.lineTo(-a - m, b + m); rim.closePath();
      hole.moveTo(-a, -b); hole.lineTo(a, -b); hole.lineTo(a, b); hole.lineTo(-a, b); hole.closePath();
    } else {
      rim.absarc(0, 0, dsc.radius * 1.08, 0, Math.PI * 2, false);
      hole.absarc(0, 0, dsc.radius, 0, Math.PI * 2, false);
    }
    rim.holes.push(hole);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(rim, 48), new THREE.MeshBasicMaterial({ color: dsc.kind === 'port' ? 0x6fb6c9 : 0xffb040, side: THREE.DoubleSide }));
    mesh.position.set(...dsc.center);
    mesh.rotation.x = dsc.tilt ?? 0;
    mesh.rotation.y = dsc.rotY ?? 0;
    rig.group.add(mesh);
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

export function Scene3D({ layout, explode, transparent, speakers }: { layout: Layout3; explode: number; transparent: boolean; speakers: boolean }) {
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
    if (rig.current) build(rig.current, layout, explode, transparent, speakers);
  }, [layout, explode, transparent, speakers]);

  return <div ref={host} className="scene3d" role="img" aria-label="3D preview of the cabinets. Drag to orbit, scroll to zoom." />;
}

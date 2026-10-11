/**
 * 3D view (Stellarium Mobile Plus): the Sun, Moon and planets as globes, lit
 * by the Sun from where it really is and seen from where you are (so the
 * phase and tilt match the sky), with their main moons in their true places,
 * plus 3D models of the ISS and Hubble. Drag to turn, pinch to zoom; a switch
 * lights up the night side.
 *
 * Planet maps: Solar System Scope (CC BY 4.0). Models: NASA (public domain).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { $, app, haptic, toast } from "../state";
import { abs, displayName, type SweObj } from "../engine";
import { icon, MDI } from "../icons";

const D2R = Math.PI / 180;
const AU_KM = 149597870.7;

/** Radius (km), pole (ICRF RA/Dec, degrees) and map file, from the engine's planets.ini. */
const BODIES: Record<string, { r: number; poleRa: number; poleDe: number; map: string; rings?: [number, number]; moons?: string[] }> = {
  Sun: { r: 695700, poleRa: 286.13, poleDe: 63.87, map: "sun" },
  Mercury: { r: 2439.7, poleRa: 281.01, poleDe: 61.45, map: "mercury" },
  Venus: { r: 6051.8, poleRa: 272.76, poleDe: 67.16, map: "venus" },
  Moon: { r: 1737.4, poleRa: 266.86, poleDe: 65.64, map: "moon" },
  Mars: { r: 3389.5, poleRa: 317.68, poleDe: 52.89, map: "mars", moons: ["Phobos", "Deimos"] },
  Jupiter: { r: 69911, poleRa: 268.06, poleDe: 64.5, map: "jupiter", moons: ["Io", "Europa", "Ganymede", "Callisto"] },
  Saturn: { r: 58232, poleRa: 40.59, poleDe: 83.54, map: "saturn", rings: [74500, 140220], moons: ["Titan", "Rhea", "Iapetus", "Dione", "Tethys", "Enceladus", "Mimas"] },
  Uranus: { r: 25362, poleRa: 257.31, poleDe: -15.18, map: "uranus", moons: ["Titania", "Oberon", "Umbriel", "Ariel", "Miranda"] },
  Neptune: { r: 24622, poleRa: 299.36, poleDe: 43.46, map: "neptune", moons: ["Triton"] },
};
const MOON_KM: Record<string, number> = {
  Phobos: 11.3, Deimos: 6.2, Io: 1821.6, Europa: 1560.8, Ganymede: 2634.1, Callisto: 2410.3, Titan: 2574.7, Rhea: 763.8,
  Iapetus: 734.5, Dione: 561.4, Tethys: 531.1, Enceladus: 252.1, Mimas: 198.2, Titania: 788.4, Oberon: 761.4,
  Umbriel: 584.7, Ariel: 578.9, Miranda: 235.8, Triton: 1353.4,
};
const MODELS: Record<string, string> = { "NORAD 25544": "iss", "NORAD 20580": "hubble" };
const MODEL_TITLES: Record<string, string> = { iss: "International Space Station", hubble: "Hubble Space Telescope" };

function modelFor(obj: SweObj): string | null {
  for (const d of obj.designations()) if (MODELS[d]) return MODELS[d];
  return null;
}

export function can3D(obj: SweObj): boolean {
  return !!BODIES[displayName(obj)] || !!modelFor(obj);
}

/** XHR (fetch can't read file:// in the app's WebView). */
function getBuffer(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", url);
    x.responseType = "arraybuffer";
    x.onload = () => (x.response ? resolve(x.response) : reject(new Error(`GET ${url}`)));
    x.onerror = () => reject(new Error(`GET ${url}`));
    x.send();
  });
}

const toV3 = (v: number[]) => new THREE.Vector3(v[0], v[1], v[2]);
const pos = (o: SweObj) => toV3((o.getInfo("pvo") as number[][])[0]);

let state: { raf: number; dispose: () => void } | null = null;
/** Bumped on every open/close, so a slow model load can tell it's stale. */
let session = 0;

export function close3D() {
  session++;
  if (!state) {
    $("view3d").hidden = true;
    (app.stel as any).paused = false;
    return;
  }
  state.dispose();
  state = null;
  $("view3d").hidden = true;
  (app.stel as any).paused = false;
}

export async function open3D(obj: SweObj) {
  close3D();
  const name = displayName(obj);
  const body = BODIES[name];
  const model = modelFor(obj);
  if (!body && !model) return;
  haptic("light");

  const box = $("view3d");
  box.hidden = false;
  $("view3d-title").textContent = model ? MODEL_TITLES[model] : name;
  $("view3d-close").innerHTML = icon(MDI.mdiClose);
  const mine = session;
  // A fresh canvas each time: the previous one's context was force-lost.
  const canvas = document.createElement("canvas");
  canvas.className = "view3d-canvas";
  box.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The sky engine doesn't need to draw underneath.
  (app.stel as any).paused = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.01, 2000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.rotateSpeed = 0.6;

  // Background stars.
  {
    const g = new THREE.BufferGeometry();
    const n = 2500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(900);
      p.set([v.x, v.y, v.z], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
  }

  // Geometry in ICRF: the object at the origin, the Sun and the observer
  // where they really are relative to it.
  const here = pos(obj);
  const sunObj = app.stel.getObj("NAME Sun");
  const toSun = sunObj ? pos(sunObj).sub(here).normalize() : new THREE.Vector3(1, 0, 0);
  const toUs = here.clone().multiplyScalar(-1).normalize();
  const ambient = new THREE.AmbientLight(0xffffff, 0.06);
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
  sunLight.position.copy(toSun.clone().multiplyScalar(100));
  scene.add(ambient, sunLight);

  const disposers: (() => void)[] = [];
  const loader = new THREE.TextureLoader();
  const tex = (file: string) => {
    const t = loader.load(abs(`textures3d/${file}`));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    disposers.push(() => t.dispose());
    return t;
  };

  let spin: THREE.Object3D | null = null;
  const labels: { el: HTMLElement; obj: THREE.Object3D }[] = [];
  const labelBox = $("view3d-labels");
  labelBox.innerHTML = "";

  if (body) {
    const R = 1; // scene units: one body radius
    const globe = new THREE.Group();
    // Spin axis: three.js spheres have their poles on +Y.
    const pole = toV3(app.stel.s2c(body.poleRa * D2R, body.poleDe * D2R));
    globe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole.normalize());
    const mat =
      name === "Sun"
        ? new THREE.MeshBasicMaterial({ map: tex("sun.jpg") })
        : new THREE.MeshStandardMaterial({ map: tex(`${body.map}.jpg`), roughness: 1, metalness: 0 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), mat);
    globe.add(sphere);
    spin = sphere;
    if (body.rings) {
      const [r0, r1] = body.rings.map((k) => k / body.r);
      // Enough radial segments for the ring texture's bands to show.
      const g = new THREE.RingGeometry(r0, r1, 160, 48);
      // Map the ring texture radially (u from inner to outer edge).
      const uv = g.attributes.uv, p = g.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const d = Math.hypot(p.getX(i), p.getY(i));
        uv.setXY(i, (d - r0) / (r1 - r0), 0.5);
      }
      const ringTex = tex("saturn_ring_alpha.png");
      // Unlit: the rings scatter sunlight brightly even when the Sun is
      // close to their plane, which a plain diffuse material can't show.
      const ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; // ring plane = equator (XZ)
      globe.add(ring);
      disposers.push(() => g.dispose());
    }
    scene.add(globe);
    disposers.push(() => (sphere.geometry.dispose(), mat.dispose()));

    // Moons where they really are (in units of the planet's radius).
    const kmPerUnit = body.r;
    for (const m of body.moons ?? []) {
      const mo = app.stel.getObj(`NAME ${m}`);
      if (!mo) continue;
      const off = pos(mo).sub(pos(obj)).multiplyScalar(AU_KM / kmPerUnit);
      if (off.length() > 400) continue;
      const r = Math.max(0.04, (MOON_KM[m] ?? 500) / kmPerUnit);
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshStandardMaterial({ color: 0xbdb7aa, roughness: 1 }));
      s.position.copy(off);
      scene.add(s);
      disposers.push(() => (s.geometry.dispose(), (s.material as THREE.Material).dispose()));
      const el = document.createElement("div");
      el.className = "v3-label";
      el.textContent = m;
      labelBox.appendChild(el);
      labels.push({ el, obj: s });
    }
    // Fill about half the screen width with the globe (portrait screens are narrow).
    const hfov = 2 * Math.atan(Math.tan((camera.fov * D2R) / 2) * camera.aspect);
    camera.position.copy(toUs.clone().multiplyScalar(1 / (0.5 * Math.tan(hfov / 2))));
    controls.minDistance = 1.3;
    controls.maxDistance = body.moons ? 400 : 30;
  } else if (model) {
    const status = $("view3d-status");
    status.textContent = "Loading model…";
    try {
      const gltf = await new GLTFLoader().parseAsync(await getBuffer(abs(`models3d/${model}.glb`)), "");
      if (mine !== session) {
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
        return; // closed while loading
      }
      const root = gltf.scene;
      // NASA's ISS (B) file has a stray little dish ("bendedtru*",
      // "pCylinder*") floating 25 m off the station; drop it.
      const stray: THREE.Object3D[] = [];
      root.traverse((n) => {
        if (/^(bendedtru|pCylinder)/.test(n.name)) stray.push(n);
      });
      stray.forEach((n) => n.removeFromParent());
      // The ISS model is untextured: give it metal modules and gold-brown
      // solar arrays. (Hubble ships its own textures; keep those.)
      root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh || (mesh.material as THREE.MeshStandardMaterial).map) return;
        mesh.geometry.computeBoundingBox();
        const s = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
        const dims = [s.x, s.y, s.z].sort((a, b) => a - b);
        const flat = dims[0] < dims[1] * 0.06 && dims[2] > dims[1] * 1.5;
        mesh.material = flat
          ? new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.6, roughness: 0.35 })
          : new THREE.MeshStandardMaterial({ color: 0xd8d8d2, metalness: 0.35, roughness: 0.55 });
      });
      const bb = new THREE.Box3().setFromObject(root);
      const size = bb.getSize(new THREE.Vector3()).length();
      root.position.sub(bb.getCenter(new THREE.Vector3()));
      const wrap = new THREE.Group();
      wrap.add(root);
      wrap.scale.setScalar(4 / size);
      scene.add(wrap);
      ambient.intensity = 0.35;
      // Fit the model (radius 2 after scaling) across the narrow side.
      const hfov = 2 * Math.atan(Math.tan((camera.fov * D2R) / 2) * Math.min(1, camera.aspect));
      camera.position.set(2.5, 1.6, 3.2).setLength((2 / Math.tan(hfov / 2)) * 1.05);
      controls.minDistance = 1;
      controls.maxDistance = 60;
      status.textContent = "";
    } catch {
      status.textContent = "";
      toast("Couldn't load the 3D model");
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      close3D();
      return;
    }
  }
  camera.up.set(0, 0, 1); // celestial north up
  camera.lookAt(0, 0, 0);
  controls.update();

  // Night side switch (Plus: "see the darker side").
  const lightBtn = $("view3d-light");
  lightBtn.innerHTML = icon(MDI.mdiWhiteBalanceSunny);
  lightBtn.setAttribute("aria-pressed", "false");
  const onLight = () => {
    const on = lightBtn.getAttribute("aria-pressed") !== "true";
    lightBtn.setAttribute("aria-pressed", String(on));
    ambient.intensity = on ? 1.6 : model ? 0.35 : 0.06;
    haptic("light");
  };
  lightBtn.addEventListener("click", onLight);

  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  const tmp = new THREE.Vector3();
  let last = performance.now();
  const loop = (now: number) => {
    if (!state || mine !== session) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (spin && name !== "Sun") spin.rotation.y += dt * 0.08;
    controls.update();
    renderer.render(scene, camera);
    for (const l of labels) {
      // Hidden behind the globe? (farther than it and inside its disc)
      const toMoon = l.obj.position.clone().sub(camera.position);
      const toGlobe = camera.position.clone().multiplyScalar(-1);
      const behind = toMoon.length() > toGlobe.length() && toMoon.angleTo(toGlobe) < Math.asin(Math.min(1, 1 / toGlobe.length()));
      tmp.copy(l.obj.position).project(camera);
      const visible = !behind && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      l.el.style.display = visible ? "block" : "none";
      if (visible) l.el.style.transform = `translate(${((tmp.x + 1) / 2) * window.innerWidth}px, ${((1 - tmp.y) / 2) * window.innerHeight}px)`;
    }
    state.raf = requestAnimationFrame(loop);
  };

  state = {
    raf: requestAnimationFrame(loop),
    dispose: () => {
      cancelAnimationFrame(state!.raf);
      lightBtn.removeEventListener("click", onLight);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      disposers.forEach((d) => d());
      scene.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x?.dispose());
        }
      });
      renderer.dispose();
      // Free the GPU context now rather than whenever GC runs (iOS limits them).
      renderer.forceContextLoss();
      canvas.remove();
      labelBox.innerHTML = "";
    },
  };
}

export function init3D() {
  $("view3d-close").addEventListener("click", () => {
    haptic("light");
    close3D();
  });
}

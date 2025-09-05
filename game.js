import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

/* ===================== OPTIONAL MODULES (loaded dynamically) ===================== */
const Mods = {
  EffectComposer: null,
  RenderPass: null,
  UnrealBloomPass: null,
  SSAOPass: null,
  RGBELoader: null,
  readyPP: false,
  triedPP: false,
  triedHDR: false,
};

async function ensurePostModules() {
  if (Mods.readyPP || Mods.triedPP) return;
  Mods.triedPP = true;
  try {
    const [ec, rp, ub, sa] = await Promise.all([
      import("https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js"),
      import("https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js"),
      import("https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js"),
      import("https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/SSAOPass.js"),
    ]);
    Mods.EffectComposer = ec.EffectComposer;
    Mods.RenderPass = rp.RenderPass;
    Mods.UnrealBloomPass = ub.UnrealBloomPass;
    Mods.SSAOPass = sa.SSAOPass;
    Mods.readyPP = true;
  } catch (e) {
    console.warn("[Snake3D] Post-processing modules unavailable. Falling back gracefully.", e);
  }
}

async function ensureHDRLoader() {
  if (Mods.RGBELoader || Mods.triedHDR) return;
  Mods.triedHDR = true;
  try {
    const { RGBELoader } = await import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js");
    Mods.RGBELoader = RGBELoader;
  } catch (e) {
    console.warn("[Snake3D] RGBELoader unavailable. Skipping HDR environment.", e);
  }
}

/* ===================== UTIL / STORAGE ===================== */
class Timer {
  constructor(el) { this.el = el; this.elapsed = 0; this.running = false; this._raf = null; }
  start() {
    if (this.running) return;
    this.running = true;
    this._t0 = performance.now() - this.elapsed;
    const tick = () => {
      if (!this.running) return;
      this.elapsed = performance.now() - this._t0;
      this.el.textContent = this.read();
      this._raf = requestAnimationFrame(tick);
    }; tick();
  }
  stop() { this.running = false; if (this._raf) cancelAnimationFrame(this._raf); }
  reset() { this.stop(); this.elapsed = 0; this.el.textContent = "00:00"; }
  seconds() { return Math.round(this.elapsed / 1000); }
  read() { const s = Math.floor(this.elapsed / 1000); const mm = String(Math.floor(s / 60)).padStart(2, "0"); const ss = String(s % 60).padStart(2, "0"); return `${mm}:${ss}`; }
}
class Storage {
  constructor(key) { this.key = key; }
  _load() { try { return JSON.parse(localStorage.getItem(this.key) || "[]") } catch { return [] } }
  _save(d) { localStorage.setItem(this.key, JSON.stringify(d)); }
  add(row) { const all = this._load(); all.push({ ...row, at: Date.now() }); all.sort((a, b) => (a.seconds - b.seconds) || (b.level - a.level)); this._save(all.slice(0, 50)); }
  top(n = 10) { return this._load().slice(0, n); }
}
const Save = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback } },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

/* ===================== SETTINGS ===================== */
const defaultSettings = {
  graphics: { bloom: true, ssao: false, hdr: true, perf: false, shadows: "med", fps: 60 },
  audio: { muted: false, master: 0.8, music: 0.5, sfx: 0.9 },
  gameplay: { difficulty: "classic", invert: false, wrap: false, followCam: true },
  accessibility: { reduceMotion: false, cb: "none" }
};
const settings = Save.get("snake3d-settings", defaultSettings);

/* ===================== CAMERA / VFX ===================== */
const camPos = new THREE.Vector3(18, 20, 24);
const camTarget = new THREE.Vector3(0, 0, 0);
let shakeTime = 0, shakeAmp = 0;

// Follow camera config & state (smooth)
let followCam = settings.gameplay.followCam ?? true;
const camCfg = {
  back: 10,
  height: 11,
  side: 0.6,
  dirSmooth: 8,
  posSmooth: 6,
  lookSmooth: 10,
  lookAhead: 0.6
};
const camDir = new THREE.Vector3(1, 0, 0);
const up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const lookPoint = new THREE.Vector3();

/* ===================== INPUT HELPERS (camera-relative) ===================== */
const CARDINALS = [
  { x: 1, z: 0, v: new THREE.Vector3(1, 0, 0) }, // +X
  { x: -1, z: 0, v: new THREE.Vector3(-1, 0, 0) }, // -X
  { x: 0, z: -1, v: new THREE.Vector3(0, 0, -1) }, // -Z
  { x: 0, z: 1, v: new THREE.Vector3(0, 0, 1) }, // +Z
];
function nearestCardinalFrom(vec) {
  let best = CARDINALS[0], bestDot = -Infinity;
  for (const c of CARDINALS) {
    const d = vec.dot(c.v);
    if (d > bestDot) { bestDot = d; best = c; }
  }
  return { x: best.x, z: best.z };
}
function isTypingInField(evt) {
  const el = evt?.target || document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
function screenDirToWorld(screenDir) {
  // Classic absolute mapping when followCam is off
  if (!followCam) {
    const base = {
      up: { x: 0, z: -1 },
      down: { x: 0, z: 1 },
      left: { x: -1, z: 0 },
      right: { x: 1, z: 0 },
    }[screenDir];
    if (!base) return { x: 0, z: 0 };
    if (settings.gameplay.invert) return { x: -base.x, z: -base.z };
    return base;
  }

  // Camera-relative mapping when followCam is on
  const fwd = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

  let wish = new THREE.Vector3();
  if (screenDir === "up") wish.copy(fwd);
  if (screenDir === "down") wish.copy(fwd).negate();
  if (screenDir === "right") wish.copy(right);
  if (screenDir === "left") wish.copy(right).negate();

  if (settings.gameplay.invert) wish.negate();

  return nearestCardinalFrom(wish);
}

/* ===================== INPUT ===================== */
function makeInput(onPauseToggle, onNextLevelHotkey) {
  const listeners = new Set();
  const emit = (dir) => listeners.forEach(fn => fn(dir));

  function handleKey(e) {
    const k = e.key.toLowerCase();

    // don't steal keys while typing a name or any input field
    if (isTypingInField(e)) return;

    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "n", "p", "c", " "].includes(k)) {
      e.preventDefault();
    }

    if (k === "arrowup" || k === "w") emit(screenDirToWorld("up"));
    if (k === "arrowdown" || k === "s") emit(screenDirToWorld("down"));
    if (k === "arrowleft" || k === "a") emit(screenDirToWorld("left"));
    if (k === "arrowright" || k === "d") emit(screenDirToWorld("right"));

    if (k === "p") onPauseToggle?.();
    if (k === "n") onNextLevelHotkey?.();

    // quick toggle camera mode with 'c'
    if (k === "c") {
      followCam = !followCam;
      settings.gameplay.followCam = followCam;
      Save.set("snake3d-settings", settings);
    }
  }

  window.addEventListener("keydown", handleKey);

  // touch swipe (camera-relative)
  let sx = 0, sy = 0, act = false;
  window.addEventListener("touchstart", e => { act = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  window.addEventListener("touchend", e => {
    if (!act) return; act = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    const horiz = Math.abs(dx) > Math.abs(dy);
    const screenDir = horiz ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    emit(screenDirToWorld(screenDir));
  });

  return { onDirection(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}

/* ===================== AUDIO ===================== */
const sfx = {
  music: document.getElementById("bgm"),
  eat: document.getElementById("sfxEat"),
  eatGolden: document.getElementById("sfxEatGolden"),
  eatPoison: document.getElementById("sfxEatPoison"),
  level: document.getElementById("sfxLevel"),
  over: document.getElementById("sfxOver"),
};
[sfx.eat, sfx.eatGolden, sfx.eatPoison, sfx.level, sfx.over, sfx.music].forEach(a => { a.volume = .45; });
sfx.music.volume = .3; sfx.music.loop = true;

function effectiveVol(type = "sfx") {
  if (settings.audio.muted) return 0;
  const m = settings.audio.master ?? 0.8;
  return m * (type === "music" ? (settings.audio.music ?? .5) : (settings.audio.sfx ?? .9));
}
function playSound(el, { rate = 1, volume = null } = {}) {
  try {
    const n = el.cloneNode(true);
    n.playbackRate = rate;
    n.volume = volume !== null ? volume : effectiveVol("sfx");
    n.play().catch(() => { });
  } catch { }
}

/* ===================== VFX ===================== */
class VFX {
  constructor(scene) { this.scene = scene; this.items = []; }
  spawnRing(pos, color = 0xffffff) {
    const geo = new THREE.RingGeometry(0.1, 0.12, 24);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2; m.position.copy(pos).setY(0.91);
    this.scene.add(m);
    this.items.push({ type: "ring", m, t: 0, life: .6 });
  }
  spawnSparkles(pos, color = 0xffffff) {
    const g = new THREE.BufferGeometry();
    const N = 18;
    const verts = new Float32Array(N * 3), vels = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.02 + Math.random() * 0.07;
      verts[i * 3 + 0] = pos.x; verts[i * 3 + 1] = 1.0; verts[i * 3 + 2] = pos.z;
      vels[i * 3 + 0] = Math.cos(a) * r; vels[i * 3 + 1] = 0.02 + Math.random() * 0.03; vels[i * 3 + 2] = Math.sin(a) * r;
    }
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.setAttribute("velocity", new THREE.BufferAttribute(vels, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.05, color, transparent: true, opacity: .95 }));
    this.scene.add(m);
    this.items.push({ type: "spark", m, t: 0, life: .6 });
  }
  update(dt) {
    const left = [];
    for (const it of this.items) {
      it.t += dt;
      const k = Math.min(1, it.t / it.life);
      if (it.type === "ring") {
        it.m.scale.setScalar(1 + 1.8 * k);
        it.m.material.opacity = .9 * (1 - k);
        if (it.t >= it.life) { this.scene.remove(it.m); it.m.geometry.dispose(); }
        else left.push(it);
      } else {
        const pos = it.m.geometry.attributes.position;
        const vel = it.m.geometry.attributes.velocity;
        for (let i = 0; i < pos.count; i++) {
          pos.array[i * 3 + 0] += vel.array[i * 3 + 0];
          pos.array[i * 3 + 1] += vel.array[i * 3 + 1];
          pos.array[i * 3 + 2] += vel.array[i * 3 + 2];
          vel.array[i * 3 + 1] -= 0.002;
        }
        pos.needsUpdate = true; it.m.material.opacity = .95 * (1 - k);
        if (it.t >= it.life) { this.scene.remove(it.m); it.m.geometry.dispose(); }
        else left.push(it);
      }
    }
    this.items = left;
  }
}

/* ===================== REALISTIC SNAKE (Spline Tube) ===================== */
class Snake {
  constructor(scene, { gridSize, cellSize }) {
    this.scene = scene; this.gridSize = gridSize; this.cellSize = cellSize;
    this.group = new THREE.Group(); scene.add(this.group);

    this.radius = .40; this.radialSegments = 10; this.tubularPerSeg = 7;

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: .05, roughness: .55,
      emissive: 0x1a2a20, emissiveIntensity: .18, clearcoat: .25, clearcoatRoughness: .6, envMapIntensity: .9
    });

    this.geometry = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), 8, this.radius, this.radialSegments, false);
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.castShadow = this.mesh.receiveShadow = true; this.group.add(this.mesh);

    // head
    this.head = new THREE.Group();
    const headGeo = new THREE.SphereGeometry(this.radius * 1.15, 20, 16);
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .05, roughness: .55, clearcoat: .25, clearcoatRoughness: .6, envMapIntensity: .9 });
    const headMesh = new THREE.Mesh(headGeo, this.headMat); headMesh.castShadow = headMesh.receiveShadow = true; this.head.add(headMesh);
    const eyeGeo = new THREE.SphereGeometry(this.radius * .18, 12, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, metalness: 0, roughness: .3 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat), eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    const eox = this.radius * .5, eoz = this.radius * .6, eoy = this.radius * .05;
    eyeL.position.set(-eox, eoy, eoz); eyeR.position.set(eox, eoy, eoz);
    this.head.add(eyeL); this.head.add(eyeR); this.group.add(this.head);

    this.curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(0, 0, 0.01)]);
    this.curve.curveType = 'catmullrom'; this.curve.tension = .5;

    this._v = new THREE.Vector3(); this.headWorld = new THREE.Vector3();
    this.levelInfo = null;

    this.reset({ x: 0, z: 0, dir: { x: 1, z: 0 } });
  }
  setLevelInfo(info) { this.levelInfo = info ? { bounds: info.bounds, wrap: !!info.wrap } : null; }

  reset(spawn) {
    this.body = [{ x: spawn.x, z: spawn.z }, { x: spawn.x - 1, z: spawn.z }, { x: spawn.x - 2, z: spawn.z }];
    this.dir = { ...spawn.dir }; this.nextDir = { ...spawn.dir };
    this.prevPositions = this.body.map(p => ({ ...p }));
  }
  queueDirection(dir) {
    if (this.dir.x + dir.x === 0 && this.dir.z + dir.z === 0) return; // no 180s
    this.nextDir = { ...dir };
  }
  step(level) {
    this.prevPositions = this.body.map(p => ({ ...p }));
    this.dir = { ...this.nextDir };
    const head = { ...this.body[0] }; head.x += this.dir.x; head.z += this.dir.z;
    const half = level.bounds;
    if (head.x < -half || head.x > half || head.z < -half || head.z > half) {
      if (level.wrap) { if (head.x < -half) head.x = half; if (head.x > half) head.x = -half; if (head.z < -half) head.z = half; if (head.z > half) head.z = -half; }
      else return { ok: false, reason: "oob" };
    }
    if (level.isWall(head.x, head.z)) return { ok: false, reason: "wall" };
    for (let i = 0; i < this.body.length; i++) { const s = this.body[i]; if (s.x === head.x && s.z === head.z) return { ok: false, reason: "self" }; }
    this.body.unshift(head); this.body.pop();
    return { ok: true };
  }
  headEquals(cell) { const h = this.body[0]; return h.x === cell.x && h.z === cell.z; }
  grow() { const t = this.body[this.body.length - 1]; this.body.push({ ...t }); this.updateSkinTiling?.(); }
  shrink() { if (this.body.length > 4) { this.body.pop(); this.updateSkinTiling?.(); } }

  static easeInOut(t) { return t * t * (3 - 2 * t); }

  _interpolatedBodyPoints(alpha) {
    const e = Snake.easeInOut(Math.min(Math.max(alpha, 0), 1)), pts = [];
    const wrap = this.levelInfo?.wrap;
    const B = this.levelInfo?.bounds ?? 0;
    const sizeCells = (B > 0) ? (2 * B + 1) : 0;
    const period = sizeCells * this.cellSize;

    for (let i = 0; i < this.body.length; i++) {
      const a = this.prevPositions[i] || this.body[i];
      const b = this.body[i];

      let dx = b.x - a.x;
      let dz = b.z - a.z;

      if (wrap && B > 0) {
        if (dx > B) dx -= sizeCells;
        else if (dx < -B) dx += sizeCells;
        if (dz > B) dz -= sizeCells;
        else if (dz < -B) dz += sizeCells;
      }

      const x = (a.x + dx * e) * this.cellSize;
      const z = (a.z + dz * e) * this.cellSize;
      pts.push(new THREE.Vector3(x, .45, z));
    }

    if (wrap && B > 0 && pts.length > 1) {
      const limit = B * this.cellSize;
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], p = pts[i];
        let dx = p.x - prev.x, dz = p.z - prev.z;
        if (dx > limit) p.x -= period;
        if (dx < -limit) p.x += period;
        if (dz > limit) p.z -= period;
        if (dz < -limit) p.z += period;
      }
    }

    return pts;
  }

  _applyUndulation(basePts, t) {
    const out = basePts.map(p => p.clone()), n = out.length;
    if (n < 3) return out;
    const speed = 2.4, waves = 2.2;
    for (let i = 0; i < n; i++) {
      const prev = out[Math.max(0, i - 1)], next = out[Math.min(n - 1, i + 1)];
      const tan = this._v.copy(next).sub(prev).setY(0); if (tan.lengthSq() === 0) continue; tan.normalize();
      const perp = new THREE.Vector3(-tan.z, 0, tan.x);
      const s = i / (n - 1); const amp = (0.06 + 0.10 * Math.sin(Math.PI * s)) * (1 - .15 * s);
      const phase = (s * Math.PI * 2 * waves) + t * speed;
      out[i].addScaledVector(perp, Math.sin(phase) * amp);
    } return out;
  }
  _ensureGeometry(sampleCount) {
    const tubes = Math.max(24, sampleCount - 1);
    if (!this.mesh.geometry || this._lastTubular !== tubes) {
      this.mesh.geometry.dispose?.();
      this.mesh.geometry = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), tubes, this.radius, this.radialSegments, false);
      this._lastTubular = tubes;
    }
  }
  updateSmooth(alpha, waveTime) {
    const raw = this._interpolatedBodyPoints(alpha);
    this.curve.points = raw;
    const samples = Math.max(32, this.body.length * this.tubularPerSeg);
    const basePts = this.curve.getPoints(samples);
    const slither = this._applyUndulation(basePts, waveTime);
    const path = new THREE.CatmullRomCurve3(slither, false, 'catmullrom', .5);
    this._ensureGeometry(slither.length);
    const newGeo = new THREE.TubeGeometry(path, this._lastTubular, this.radius, this.radialSegments, false);
    this.mesh.geometry.dispose(); this.mesh.geometry = newGeo;

    const headPos = path.getPoint(0), headTan = path.getTangent(0).normalize();
    this.head.position.copy(headPos); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), headTan); this.head.setRotationFromQuaternion(q);
    this.headWorld.copy(headPos);
  }

  updateSkinTiling() {
    const lenFactor = Math.max(1, this.body.length / 10);
    const mat = this.material;
    if (mat && mat.map) {
      mat.map.repeat.x = 3.0 * lenFactor;
      mat.map.needsUpdate = true;
    }
    if (mat && mat.normalMap) { mat.normalMap.repeat.x = mat.map.repeat.x; mat.normalMap.needsUpdate = true; }
    if (mat && mat.roughnessMap) { mat.roughnessMap.repeat.x = mat.map.repeat.x; mat.roughnessMap.needsUpdate = true; }
    if (mat && mat.aoMap) { mat.aoMap.repeat.x = mat.map.repeat.x; mat.aoMap.needsUpdate = true; }
  }
}

/* ===================== FOOD ===================== */
class Food {
  constructor(scene, { gridSize, cellSize }) {
    this.scene = scene; this.gridSize = gridSize; this.cellSize = cellSize;
    this.Y = 0.9;
    this.geo = new THREE.SphereGeometry(.42, 24, 16);
    this.matNormal = new THREE.MeshStandardMaterial({ color: 0xff3048, emissive: 0x66000f, emissiveIntensity: 1.0, metalness: .1, roughness: .35 });
    this.matGolden = new THREE.MeshStandardMaterial({ color: 0xffc300, emissive: 0x553300, emissiveIntensity: 1.0, metalness: .6, roughness: .2 });
    this.matPoison = new THREE.MeshStandardMaterial({ color: 0x5cff5c, emissive: 0x003300, emissiveIntensity: .8, metalness: .1, roughness: .55 });
    this.mesh = new THREE.Mesh(this.geo, this.matNormal); this.mesh.castShadow = true; this.mesh.position.y = this.Y; scene.add(this.mesh);
    this.type = "normal"; this.expiresAt = 0; this.lastPos = new THREE.Vector3();
  }
  _pickType(level) {
    const t = Math.min(level.index, 9) / 9;
    const golden = Math.max(0.08, 0.12 - 0.05 * t);
    const poison = Math.min(0.10, 0.06 + 0.03 * t);
    const r = Math.random(); if (r < golden) return "golden"; if (r < golden + poison) return "poison"; return "normal";
  }
  _nearWall(level, x, z, r = 1) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (level.isWall(x + dx, z + dz)) return true;
    }
    return false;
  }
  _isReachable(snake, level, tx, tz) {
    const B = level.bounds;
    const wrap = !!level.wrap;
    const start = { x: snake.body[0].x, z: snake.body[0].z };
    const bodySet = new Set(snake.body.map(s => `${s.x},${s.z}`));

    const q = [start];
    const seen = new Set([`${start.x},${start.z}`]);

    function push(nx, nz) {
      if (wrap) {
        if (nx < -B) nx = B; if (nx > B) nx = -B;
        if (nz < -B) nz = B; if (nz > B) nz = -B;
      }
      if (nx < -B || nx > B || nz < -B || nz > B) return;
      const k = `${nx},${nz}`;
      if (seen.has(k)) return;
      if (level.isWall(nx, nz)) return;
      if (bodySet.has(k)) return;
      seen.add(k);
      q.push({ x: nx, z: nz });
    }

    let steps = 0, limit = (2 * B + 1) * (2 * B + 1);
    while (q.length && steps++ < limit) {
      const { x, z } = q.shift();
      if (x === tx && z === tz) return true;
      push(x + 1, z);
      push(x - 1, z);
      push(x, z + 1);
      push(x, z - 1);
    }
    return false;
  }
  respawn(snake, level, force = null) {
    const half = level.bounds; let x, z, bad, tries = 0;
    do {
      x = Math.floor(Math.random() * (2 * half + 1)) - half;
      z = Math.floor(Math.random() * (2 * half + 1)) - half;
      bad = level.isWall(x, z)
        || this._nearWall(level, x, z, 1)
        || snake.body.some(s => s.x === x && s.z === z)
        || !this._isReachable(snake, level, x, z);

      tries++;
      if (tries > 500) bad = level.isWall(x, z)
        || snake.body.some(s => s.x === x && s.z === z)
        || !this._isReachable(snake, level, x, z);

    } while (bad);
    this.lastCell = this.cell;
    this.cell = { x, z }; this.type = force || this._pickType(level);
    this.mesh.material = this.type === "golden" ? this.matGolden : this.type === "poison" ? this.matPoison : this.matNormal;
    this.mesh.scale.setScalar(this.type === "golden" ? 1.1 : (this.type === "poison" ? 0.95 : 1));

    // >>> ADDED: expiry per type (golden 8s, poison 4s, normal none)
    if (this.type === "golden") {
      this.expiresAt = performance.now() + 8000;
    } else if (this.type === "poison") {
      this.expiresAt = performance.now() + 4000;
    } else {
      this.expiresAt = 0;
    }
    // <<<

    this.mesh.position.set(x * this.cellSize, this.Y, z * this.cellSize);
    this.mesh.visible = true;
    this.lastPos.copy(this.mesh.position);
  }
  update(now, snake, level) {
    // >>> CHANGED: expire any timed food (golden/poison) and respawn as normal
    if (this.expiresAt && now > this.expiresAt) {
      this.respawn(snake, level, "normal");
    }
    // <<<
  }
}

/* ===================== LEVELS + WALLS (Instanced) ===================== */
class LevelManager {
  constructor({ gridSize, cellSize, wallsGroup }) {
    this.gridSize = gridSize; this.cellSize = cellSize; this.wallsGroup = wallsGroup;
    const L = (idx, name, { wrap, bounds, target, tickMs, spawn, walls }) => ({ index: idx, name, wrap, bounds, targetScore: target, tickMs, spawn, walls });
    const B = Math.floor(gridSize / 2);

    this.levels = [
      L(0, "Open Field", { wrap: true, bounds: B, target: 5, tickMs: 300, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: () => [] }),
      L(1, "The Box", { wrap: false, bounds: B, target: 7, tickMs: 290, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: (b) => this._boxPerimeter(b) }),
      L(2, "Cross", { wrap: false, bounds: B, target: 9, tickMs: 280, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: (b) => this._plus(b, Math.floor(b * .8), 1) }),
      L(3, "Simple Maze", {
        wrap: false, bounds: B, target: 6, tickMs: 360, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: (b) => this._simpleMaze(b)
      }),
      L(4, "Speed Run", { wrap: true, bounds: B, target: 12, tickMs: 300, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: () => [] }),
      L(5, "Four Pillars", { wrap: false, bounds: B, target: 10, tickMs: 300, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: (b) => this._fourPillars(b) }),
      L(6, "Ring w/ Gates", { wrap: false, bounds: B, target: 14, tickMs: 270, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: (b) => this._ringWithGates(b) }),
      L(7, "Corridors", { wrap: false, bounds: B, target: 22, tickMs: 230, spawn: { x: -Math.floor(B * .5), z: 0, dir: { x: 1, z: 0 } }, walls: (b) => this._corridors(b, 3) }),
      L(8, "Small & Fast", { wrap: false, bounds: Math.max(6, Math.floor(B * .7)), target: 25, tickMs: 220, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } }, walls: (b) => this._boxPerimeter(b) }),
      L(9, "Gauntlet", {
        wrap: false, bounds: Math.max(5, Math.floor(B * .65)), target: 30, tickMs: 210, spawn: { x: 0, z: 0, dir: { x: 1, z: 0 } },
        walls: (b) => { const a = this._boxPerimeter(b); const c = this._plus(b - 1, Math.floor((b - 1) * .9), 1); const s = this._corridors(b - 1, 4); return [...a, ...c, ...s]; }
      }),
    ];
  }
  get(i) { return this.levels[i] } count() { return this.levels.length }
  build(i) {
    if (this.inst) { this.wallsGroup.remove(this.inst); this.inst.geometry.dispose(); }
    this.wallSet = new Set();
    const lvl = this.levels[i]; const blocks = lvl.walls(lvl.bounds) || [];

    const wallHeight = 0.8;
    const mat = new THREE.MeshStandardMaterial({ color: 0x333b44, roughness: .8, metalness: .1 });
    const geom = new THREE.BoxGeometry(this.cellSize, wallHeight, this.cellSize);
    const inst = new THREE.InstancedMesh(geom, mat, blocks.length || 1); let n = 0;
    const m4 = new THREE.Matrix4();
    blocks.forEach(({ x, z }) => {
      m4.setPosition(x * this.cellSize, wallHeight / 2, z * this.cellSize);
      inst.setMatrixAt(n++, m4); this.wallSet.add(`${x},${z}`);
    });
    inst.instanceMatrix.needsUpdate = true; this.wallsGroup.add(inst); this.inst = inst;
    const self = this;
    lvl.isWall = (x, z) => self.wallSet.has(`${x},${z}`);
  }
  _boxPerimeter(b) {
    const arr = []; for (let x = -b; x <= b; x++) { arr.push({ x, z: -b }, { x, z: b }); }
    for (let z = -b + 1; z <= b - 1; z++) { arr.push({ x: -b, z }, { x: b, z }); } return arr;
  }
  _plus(b, arm, gap = 1) {
    const a = [];
    for (let d = -arm; d <= arm; d++) {
      if (d === 0) continue;
      if (Math.abs(d) <= gap) continue;
      a.push({ x: d, z: 0 }, { x: 0, z: d });
    }
    return a;
  }
  _spiral(b) {
    const arr = [];
    let minX = -b, maxX = b, minZ = -b, maxZ = b;

    while (minX <= maxX && minZ <= maxZ) {
      for (let x = minX; x <= maxX; x++) arr.push({ x, z: minZ }); minZ++;
      for (let z = minZ; z <= maxZ; z++) arr.push({ x: maxX, z }); maxX--;
      if (minZ <= maxZ) { for (let x = maxX; x >= minX; x--) arr.push({ x, z: maxZ }); maxZ--; }
      if (minX <= maxX) { for (let z = maxZ; z >= minZ; z--) arr.push({ x: minX, z }); minX++; }
    }

    const seen = new Set(), out = [];
    for (const c of arr) {
      const k = `${c.x},${c.z}`;
      if (!seen.has(k)) { out.push(c); seen.add(k); }
    }
    const safe = new Set();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        safe.add(`${dx},${dz}`);
      }
    }
    return out.filter(c => !safe.has(`${c.x},${c.z}`));
  }

  _simpleMaze(b) {
    const a = [];
    const gap = 2;
    const offset = Math.max(3, Math.floor(b * 0.5));

    const isSafe = (x, z) => (Math.abs(x) <= 1 && Math.abs(z) <= 1);

    function addVertical(x) {
      for (let z = -b; z <= b; z++) {
        if (Math.abs(z) <= gap) continue;
        if (isSafe(x, z)) continue;
        a.push({ x, z });
      }
    }
    function addHorizontal(z) {
      for (let x = -b; x <= b; x++) {
        if (Math.abs(x) <= gap) continue;
        if (isSafe(x, z)) continue;
        a.push({ x, z });
      }
    }

    addVertical(-offset);
    addVertical(+offset);
    addHorizontal(-offset);
    addHorizontal(+offset);

    return a;
  }

  _fourPillars(b) {
    const a = [], off = Math.max(3, Math.floor(b * 0.5)), r = 1;
    const centers = [
      { x: -off, z: -off }, { x: off, z: -off },
      { x: -off, z: off }, { x: off, z: off }
    ];
    for (const c of centers) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const x = c.x + dx, z = c.z + dz;
        if (Math.abs(x) <= 1 && Math.abs(z) <= 1) continue;
        a.push({ x, z });
      }
    }
    return a;
  }

  _ringWithGates(b, inner = Math.floor(b * 0.5), gateHalf = 2) {
    const a = [];
    for (let x = -b; x <= b; x++) { a.push({ x, z: -b }, { x, z: b }); }
    for (let z = -b + 1; z <= b - 1; z++) { a.push({ x: -b, z }, { x: b, z }); }

    const gates = new Set();
    for (let d = -gateHalf; d <= gateHalf; d++) {
      gates.add(`${d},${-inner}`);
      gates.add(`${d},${inner}`);
      gates.add(`${-inner},${d}`);
      gates.add(`${inner},${d}`);
    }

    for (let x = -inner; x <= inner; x++) {
      const k1 = `${x},${-inner}`, k2 = `${x},${inner}`;
      if (!gates.has(k1)) a.push({ x, z: -inner });
      if (!gates.has(k2)) a.push({ x, z: inner });
    }
    for (let z = -inner + 1; z <= inner - 1; z++) {
      const k1 = `${-inner},${z}`, k2 = `${inner},${z}`;
      if (!gates.has(k1)) a.push({ x: -inner, z });
      if (!gates.has(k2)) a.push({ x: inner, z });
    }

    return a.filter(c => !(Math.abs(c.x) <= 1 && Math.abs(c.z) <= 1));
  }

  _checker(b, step = 2) { const a = []; for (let x = -b; x <= b; x++) { for (let z = -b; z <= b; z++) { if ((x + z) % step === 0 && !(x === 0 && z === 0)) a.push({ x, z }); } } return a; }
  _doubleBox(b, inner) { return [...this._boxPerimeter(b), ...this._boxPerimeter(inner)]; }
  _corridors(b, lanes = 3) {
    const a = []; const spacing = Math.max(2, Math.floor((2 * b + 1) / lanes));
    for (let i = -b + spacing; i <= b - spacing; i += spacing) { for (let z = -b; z <= b; z++) { if (z % 4 === 0) continue; a.push({ x: i, z }); } } return a;
  }
}

/* ===================== DOM REFS ===================== */
const elScore = document.getElementById("score");
const elLevel = document.getElementById("level");
const elTime = document.getElementById("time");
const btnRestart = document.getElementById("restart");
const btnNext = document.getElementById("nextLevel");
const btnPause = document.getElementById("btnPause");
const btnAudio = document.getElementById("btnAudio");
const iconVolume = document.getElementById("iconVolume");

const countdownOverlay = document.getElementById("countdownOverlay");
const countdownNum = document.getElementById("countdownNum");

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayMsg = document.getElementById("overlayMsg");
const boardList = document.getElementById("board");
const saveForm = document.getElementById("saveForm");
const playerName = document.getElementById("playerName");
const btnSave = document.getElementById("saveScore");
const btnPlayAgain = document.getElementById("playAgain");
const btnToMenu = document.getElementById("toMenu");
const btnNextOverlay = document.getElementById("nextOverlay");

const startOverlay = document.getElementById("startOverlay");
const pauseOverlay = document.getElementById("pauseOverlay");
const btnStart = document.getElementById("btnStart");
const btnOpenSettings = document.getElementById("btnOpenSettings");
const btnResume = document.getElementById("btnResume");
const btnPauseRestart = document.getElementById("btnPauseRestart");
const btnPauseMenu = document.getElementById("btnPauseMenu");

/* tabs */
const tabBtns = [...document.querySelectorAll(".tab-btn")];
const tabs = { playTab: document.getElementById("playTab"), howTab: document.getElementById("howTab"), scoreTab: document.getElementById("scoreTab"), settingsTab: document.getElementById("settingsTab") };
tabBtns.forEach(b => b.addEventListener("click", () => {
  tabBtns.forEach(x => x.classList.remove("active"));
  Object.values(tabs).forEach(x => x.classList.remove("active"));
  b.classList.add("active"); tabs[b.dataset.tab].classList.add("active");
}));

/* Settings controls */
const optBloom = document.getElementById("optBloom");
const optSSAO = document.getElementById("optSSAO");
const optHDR = document.getElementById("optHDR");
const optPerf = document.getElementById("optPerf");
const optShadows = document.getElementById("optShadows");
const optFPS = document.getElementById("optFPS");
const optMute = document.getElementById("optMute");
const volMaster = document.getElementById("volMaster");
const volMusic = document.getElementById("volMusic");
const volSfx = document.getElementById("volSfx");
const optDifficulty = document.getElementById("optDifficulty");
const optInvert = document.getElementById("optInvert");
const optWrap = document.getElementById("optWrap");
const optFollowCam = document.getElementById("optFollowCam"); // <-- NEW (present in your HTML)
const optReduceMotion = document.getElementById("optReduceMotion");
const optCB = document.getElementById("optCB");
const btnSaveSettings = document.getElementById("btnSaveSettings");

/* ===================== RENDERER / SCENE ===================== */
const texLoader = new THREE.TextureLoader();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x122300);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, .1, 1000);
camera.position.copy(camPos);
camera.lookAt(0, 0, 0);

/* Lights */
const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.45);
scene.add(hemi);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(14, 24, 12);
dirLight.castShadow = true;
scene.add(dirLight);
const amb = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(amb);

/* GROUND WITH TEXTURE */
const gridSize = 20, cellSize = 1;
const groundTex = texLoader.load("./textures/bg.jpg");
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.repeat.set(8, 8);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(gridSize, gridSize),
  new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.9, metalness: 0.1 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

/* Post-processing (created only if modules loaded) */
let composer = null, renderPass = null, bloomPass = null, ssaoPass = null;

async function setupPost() {
  composer = null; renderPass = null; bloomPass = null; ssaoPass = null;
  if (!settings.graphics.bloom && !settings.graphics.ssao) return;
  await ensurePostModules();
  if (!Mods.readyPP) return;

  composer = new Mods.EffectComposer(renderer);
  renderPass = new Mods.RenderPass(scene, camera);
  composer.addPass(renderPass);

  if (settings.graphics.bloom && Mods.UnrealBloomPass) {
    bloomPass = new Mods.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.25, 0.4, 1.1);
    composer.addPass(bloomPass);
  }
  if (settings.graphics.ssao && Mods.SSAOPass) {
    ssaoPass = new Mods.SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ssaoPass.kernelRadius = 8; ssaoPass.minDistance = .0001; ssaoPass.maxDistance = .2;
    if (Mods.SSAOPass.OUTPUT) ssaoPass.output = Mods.SSAOPass.OUTPUT.Default;
    composer.addPass(ssaoPass);
  }
}
setupPost();

/* Optional HDRI environment */
async function loadHDR() {
  if (!settings.graphics.hdr) return;
  await ensureHDRLoader();
  if (!Mods.RGBELoader) return;
  new Mods.RGBELoader().setPath("./textures/").load("env.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
  }, undefined, () => { });
}
loadHDR();

/* === Snake skin loader/apply === */
function loadSnakeSkin() {
  const tl = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const repeatU = 3.0, repeatV = 2.0;

  function prep(tex) {
    if (!tex) return null;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = maxAniso;
    tex.repeat.set(repeatU, repeatV);
    tex.needsUpdate = true;
    return tex;
  }

  const maps = {};
  try { maps.map = prep(tl.load("./textures/snake_diffuse.jpg")); } catch { }
  try { maps.normalMap = prep(tl.load("./textures/snake_normal.jpg")); } catch { }
  try { maps.roughnessMap = prep(tl.load("./textures/snake_rough.jpg")); } catch { }
  try { maps.aoMap = prep(tl.load("./textures/snake_ao.jpg")); } catch { }
  return maps;
}
function applySnakeSkinToSnake(snake, maps) {
  if (!maps || !maps.map) return;
  const mat = snake.material;
  mat.color.set(0xffffff);
  mat.map = maps.map || null;
  mat.normalMap = maps.normalMap || null;
  mat.roughnessMap = maps.roughnessMap || null;
  mat.aoMap = maps.aoMap || null;
  mat.metalness = 0.05;
  mat.roughness = 0.55;
  mat.clearcoat = 0.25;
  mat.clearcoatRoughness = 0.6;
  if (mat.normalMap) mat.normalScale.set(0.5, 0.5);
  mat.envMapIntensity = 1.0;
  mat.needsUpdate = true;

  const headMat = snake.headMat;
  if (headMat) {
    headMat.color.set(0xffffff);
    headMat.map = maps.map?.clone() || null;
    if (headMat.map) { headMat.map.wrapS = headMat.map.wrapT = THREE.RepeatWrapping; headMat.map.repeat.set(1.2, 1.2); }
    if (maps.normalMap) { headMat.normalMap = maps.normalMap.clone(); headMat.normalMap.wrapS = headMat.normalMap.wrapT = THREE.RepeatWrapping; headMat.normalMap.repeat.set(1.2, 1.2); headMat.normalScale.set(0.35, 0.35); }
    headMat.metalness = 0.05; headMat.roughness = 0.55; headMat.clearcoat = 0.25; headMat.clearcoatRoughness = 0.6; headMat.envMapIntensity = 1.0;
    headMat.needsUpdate = true;
  }

  snake.updateSkinTiling?.();
}

/* Containers & game objects */
const wallsGroup = new THREE.Group(); scene.add(wallsGroup);
const snake = new Snake(scene, { gridSize, cellSize });
const food = new Food(scene, { gridSize, cellSize });
const levels = new LevelManager({ gridSize, cellSize, wallsGroup });
const timer = new Timer(document.getElementById("time"));
const store = new Storage("snake3d-leaderboard");
const vfx = new VFX(scene);

/* Apply skin maps */
const snakeMaps = loadSnakeSkin();
applySnakeSkinToSnake(snake, snakeMaps);

/* State */
let levelIndex = 0, score = 0, targetScore = levels.get(levelIndex).targetScore;
let isPlaying = false, isPaused = false;
let snakeWaveTime = 0;

/* tick time (difficulty scaling) */
function speedMul() {
  return settings.gameplay.difficulty === "casual" ? 1.25
    : settings.gameplay.difficulty === "pro" ? 0.85
      : 1.0;
}
function getTickMs() { return Math.round(levels.get(levelIndex).tickMs * speedMul()); }
function updateHUD() { elScore.textContent = `${score}/${targetScore}`; elLevel.textContent = (levelIndex + 1); }

/* Show/Hide helpers */
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

/* Overlays */
function showOverlay(title, msg) { overlayTitle.textContent = title; overlayMsg.textContent = msg || ""; show(overlay); }
function hideOverlay() { hide(overlay); saveForm.classList.add("hidden"); btnNextOverlay.classList.add("hidden"); }

/* Countdown */
function runCountdown(seconds = 3, onDone) {
  isPlaying = false;
  let n = seconds;
  countdownNum.textContent = String(n);
  show(countdownOverlay);

  const tick = () => {
    n -= 1;
    if (n > 0) {
      countdownNum.textContent = String(n);
      setTimeout(tick, 1000);
    } else {
      countdownNum.textContent = "GO!";
      setTimeout(() => {
        hide(countdownOverlay);
        onDone?.();
      }, 500);
    }
  };

  setTimeout(tick, 1000);
}

/* Start/Pause/Game flow */
function openStartMenu() {
  isPlaying = false; isPaused = false; timer.reset(); sfx.music.pause();
  renderStartBoard(); show(startOverlay); hide(pauseOverlay); hideOverlay();
}
function startLevel(i) {
  const lvl = levels.get(i);
  levels.build(i);
  score = 0; targetScore = lvl.targetScore;

  if (settings.gameplay.wrap) lvl.wrap = true;

  snake.setLevelInfo({ bounds: lvl.bounds, wrap: lvl.wrap });
  snake.reset(lvl.spawn);
  food.respawn(snake, lvl);
  updateHUD(); timer.reset();
  btnNext.disabled = true; hideOverlay();

  hide(startOverlay); hide(pauseOverlay);

  // Initialize camera and smoothed look point
  const tdir = new THREE.Vector3(snake.dir.x, 0, snake.dir.z);
  if (tdir.lengthSq() === 0) tdir.set(1, 0, 0);
  camDir.copy(tdir.normalize());
  _desiredPos
    .copy(snake.headWorld)
    .addScaledVector(camDir, -camCfg.back)
    .addScaledVector(up, camCfg.height)
    .addScaledVector(_right.crossVectors(camDir, up).normalize(), camCfg.side);
  camera.position.copy(_desiredPos);
  lookPoint.copy(snake.headWorld);

  // reset smoothers
  acc = 0; interpAlpha = 0; snakeWaveTime = 0;

  runCountdown(3, () => {
    isPlaying = true;
    isPaused = false;
    try { sfx.music.volume = effectiveVol("music"); sfx.music.currentTime = 0; sfx.music.play().catch(() => { }); } catch { }
    timer.start();
  });
}

function togglePause() {
  if (!isPlaying) return;
  isPaused = !isPaused;
  if (isPaused) { timer.stop(); sfx.music.pause(); show(pauseOverlay); }
  else { timer.start(); try { sfx.music.play().catch(() => { }); } catch { } hide(pauseOverlay); }
}

/* Leaderboard */
function renderBoard(listEl = boardList) {
  const best = store.top(10); listEl.innerHTML = "";
  best.forEach(row => { const li = document.createElement("li"); li.textContent = `${row.name} — L${row.level} — ${row.time}`; listEl.appendChild(li); });
}
function renderStartBoard() { renderBoard(document.getElementById("startBoard")); }

/* Game Over / Level Complete */
function gameOver(reason) {
  timer.stop(); btnNext.disabled = true; isPlaying = false;
  playSound(sfx.over);
  showOverlay("Game Over", reason === "wall" ? "You hit a wall!" : reason === "self" ? "You bit yourself!" : "Out of bounds!");
  saveForm.classList.remove("hidden"); renderBoard(); sfx.music.pause();
  if (!settings.accessibility.reduceMotion) { shakeTime = .4; shakeAmp = .25; }
}
function levelComplete() {
  timer.stop(); isPlaying = false;
  const last = (levelIndex >= levels.count() - 1); btnNext.disabled = last;
  playSound(sfx.level);
  showOverlay(last ? "🎉 You Beat the Game!" : "Level Complete!", `You reached ${score} points in ${timer.read()} on "${levels.get(levelIndex).name}".`);
  saveForm.classList.remove("hidden"); renderBoard(); sfx.music.pause();
  if (!last) btnNextOverlay.classList.remove("hidden");
  if (!settings.accessibility.reduceMotion) { shakeTime = .6; shakeAmp = -.15; }
}

/* Input */
const input = makeInput(togglePause, () => {
  const last = (levelIndex >= levels.count() - 1);
  if (!isPlaying && !last && !overlay.classList.contains("hidden")) goToNextLevel();
});
input.onDirection((dir) => { if (isPlaying && !isPaused) snake.queueDirection(dir); });

/* MAIN LOOP (smooth) + FPS cap */
let acc = 0, last = performance.now(), interpAlpha = 0, lastRender = 0;
function loop(now) {
  const dt = now - last; last = now;
  const dtSec = dt / 1000;
  const fpsCap = Number(settings.graphics.fps || 0);
  const minRenderDelta = fpsCap > 0 ? (1000 / fpsCap) : 0;

  food.update(now, snake, levels.get(levelIndex));
  vfx.update(dtSec);

  if (isPlaying && !isPaused) {
    acc += dt;
    snakeWaveTime += dtSec;
    const tickMs = getTickMs();

    while (acc >= tickMs) {
      acc -= tickMs;
      const next = snake.step(levels.get(levelIndex));
      if (!next.ok) { gameOver(next.reason); break; }
      if (snake.headEquals(food.cell)) {
        const type = food.type;
        if (type === "golden") { score += 3; snake.grow(); playSound(sfx.eatGolden, { rate: 1.05 }); }
        else if (type === "poison") { score = Math.max(0, score - 1); if (snake.body.length > 5) snake.shrink(); playSound(sfx.eatPoison, { rate: .9 }); }
        else { score += 1; snake.grow(); playSound(sfx.eat); }

        const pos = food.mesh.position.clone();
        vfx.spawnRing(pos, type === "golden" ? 0xffd783 : type === "poison" ? 0x6aff6a : 0xff4d6d);
        if (type !== "poison") vfx.spawnSparkles(pos, type === "golden" ? 0xfff0b0 : 0xff9aa5);

        food.respawn(snake, levels.get(levelIndex));
        updateHUD();
        elScore.classList.remove("pulse"); void elScore.offsetWidth; elScore.classList.add("pulse");

        if (score >= targetScore) levelComplete();
      }
    }
    const alpha = Math.min(acc / getTickMs(), 1); interpAlpha = alpha; snake.updateSmooth(alpha, snakeWaveTime);
  } else {
    snake.updateSmooth(interpAlpha, snakeWaveTime);
  }

  // Follow camera (smooth) or fixed
  if (followCam) {
    const lookAhead = settings.accessibility.reduceMotion ? 0.2 : camCfg.lookAhead;

    // Smooth heading toward snake's direction
    _targetDir.set(snake.dir.x, 0, snake.dir.z);
    if (_targetDir.lengthSq() === 0) _targetDir.set(1, 0, 0);
    const dirK = 1 - Math.exp(-camCfg.dirSmooth * dtSec);
    camDir.lerp(_targetDir.normalize(), dirK);

    // Desired cam position
    _right.crossVectors(camDir, up).normalize();
    _desiredPos
      .copy(snake.headWorld)
      .addScaledVector(camDir, -camCfg.back)
      .addScaledVector(up, camCfg.height)
      .addScaledVector(_right, camCfg.side);

    // Smooth camera position
    const posK = 1 - Math.exp(-camCfg.posSmooth * dtSec);
    camera.position.lerp(_desiredPos, posK);

    // Smooth look target
    _tgt.copy(snake.headWorld).addScaledVector(camDir, lookAhead);
    const lookK = 1 - Math.exp(-camCfg.lookSmooth * dtSec);
    lookPoint.lerp(_tgt, lookK);

    if (shakeTime > 0) {
      shakeTime -= dtSec;
      const s = shakeAmp * (shakeTime * shakeTime);
      camera.position.x += (Math.random() - .5) * s;
      camera.position.y += (Math.random() - .5) * s * 0.5;
      camera.position.z += (Math.random() - .5) * s;
    }
    camera.lookAt(lookPoint);
  } else {
    const lookAhead = settings.accessibility.reduceMotion ? 0.2 : 0.6;
    camTarget.lerp(snake.headWorld, 0.12);
    const desiredPos = snake.headWorld.clone().add(camPos);
    camera.position.lerp(desiredPos, 0.08);
    const tgt = snake.headWorld.clone();
    tgt.x += snake.dir.x * lookAhead; tgt.z += snake.dir.z * lookAhead;
    if (shakeTime > 0) {
      shakeTime -= dtSec;
      const s = shakeAmp * (shakeTime * shakeTime);
      camera.position.x += (Math.random() - .5) * s;
      camera.position.y += (Math.random() - .5) * s * 0.5;
      camera.position.z += (Math.random() - .5) * s;
    }
    camera.lookAt(tgt);
  }

  const useComposer = !!composer && (settings.graphics.bloom || settings.graphics.ssao);
  if (!useComposer) {
    if (fpsCap === 0 || now - lastRender >= minRenderDelta) { renderer.render(scene, camera); lastRender = now; }
  } else {
    if (fpsCap === 0 || now - lastRender >= minRenderDelta) { composer.render(); lastRender = now; }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* UI Actions */
function goToNextLevel() {
  if (levelIndex < levels.count() - 1) { levelIndex++; elLevel.textContent = (levelIndex + 1); hideOverlay(); startLevel(levelIndex); }
}
btnRestart.onclick = () => { timer.stop(); startLevel(levelIndex); };
btnNext.onclick = goToNextLevel;
btnNextOverlay.onclick = goToNextLevel;

btnPlayAgain.onclick = () => { hideOverlay(); startLevel(levelIndex); };
btnToMenu.onclick = () => { hideOverlay(); openStartMenu(); };
btnSave.onclick = () => {
  const name = (playerName.value || "Player"); // don't trim: allow full names with spaces
  store.add({ name, level: levelIndex + 1, time: timer.read(), seconds: timer.seconds() });
  playerName.value = "";
  renderBoard();
};

btnStart.onclick = () => startLevel(levelIndex);
btnResume.onclick = () => togglePause();
btnPauseRestart.onclick = () => { hide(pauseOverlay); isPaused = false; startLevel(levelIndex); };
btnPauseMenu.onclick = () => { openStartMenu(); };

btnPause.onclick = () => togglePause();
btnAudio.onclick = () => {
  settings.audio.muted = !settings.audio.muted;
  applyAudioSettings();
  Save.set("snake3d-settings", settings);
};

/* Settings apply & persistence */
function applyGraphics() {
  const q = optShadows.value || settings.graphics.shadows;
  settings.graphics.shadows = q;
  dirLight.shadow.mapSize.width = dirLight.shadow.mapSize.height = (q === "high" ? 2048 : q === "med" ? 1024 : 512);
  renderer.shadowMap.needsUpdate = true;

  settings.graphics.perf = optPerf.checked;
  if (settings.graphics.perf) {
    renderer.setPixelRatio(1.25);
    if (ssaoPass) ssaoPass.enabled = false;
    if (bloomPass) bloomPass.strength = .18;
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (ssaoPass) ssaoPass.enabled = settings.graphics.ssao;
    if (bloomPass) bloomPass.strength = .25;
  }

  settings.graphics.bloom = optBloom.checked;
  settings.graphics.ssao = optSSAO.checked;
  settings.graphics.hdr = optHDR.checked;

  setupPost();
  loadHDR();

  settings.graphics.fps = Number(optFPS.value || 60);
}
function applyAudioSettings() {
  sfx.music.muted = settings.audio.muted;
  [sfx.eat, sfx.eatGolden, sfx.eatPoison, sfx.level, sfx.over].forEach(a => { a.muted = settings.audio.muted; });
  sfx.music.volume = effectiveVol("music");
  iconVolume.innerHTML = settings.audio.muted
    ? '<path d="M4 9v6h4l5 5V4L8 9H4zM19 5l-3 3M16 5l3 3" />'
    : '<path d="M4 9v6h4l5 5V4L8 9H4z"/>';
}
function applyGameplay() {
  settings.gameplay.difficulty = optDifficulty.value || "classic";
  settings.gameplay.invert = optInvert.checked;
  settings.gameplay.wrap = optWrap.checked;
  // NEW: follow cam from checkbox
  if (optFollowCam) {
    settings.gameplay.followCam = optFollowCam.checked;
    followCam = settings.gameplay.followCam;
  }
}
function applyAccessibility() {
  settings.accessibility.reduceMotion = optReduceMotion.checked;
  settings.accessibility.cb = optCB.value || "none";
  const mode = settings.accessibility.cb;
  if (mode === "deutan" || "protan") {
    // keep values as-is (note: the if above always true, but we keep the intended logic below)
  }
  if (mode === "deutan" || mode === "protan") {
    food.matNormal.color.set(0x5aa7ff);
    food.matGolden.color.set(0xffd783);
    food.matPoison.color.set(0x000080);
  } else if (mode === "tritan") {
    food.matNormal.color.set(0xff7f50);
    food.matGolden.color.set(0xc3ff5a);
    food.matPoison.color.set(0x000080);
  } else {
    food.matNormal.color.set(0xff3048);
    food.matGolden.color.set(0xffc300);
    food.matPoison.color.set(0x000080);
  }
}

/* hydrate settings UI */
function loadSettingsIntoUI() {
  optBloom.checked = settings.graphics.bloom;
  optSSAO.checked = settings.graphics.ssao;
  optHDR.checked = settings.graphics.hdr;
  optPerf.checked = settings.graphics.perf;
  optShadows.value = settings.graphics.shadows;
  optFPS.value = String(settings.graphics.fps);

  optMute.checked = settings.audio.muted;
  volMaster.value = settings.audio.master;
  volMusic.value = settings.audio.music;
  volSfx.value = settings.audio.sfx;

  optDifficulty.value = settings.gameplay.difficulty;
  optInvert.checked = settings.gameplay.invert;
  optWrap.checked = settings.gameplay.wrap;
  if (optFollowCam) optFollowCam.checked = settings.gameplay.followCam;

  optReduceMotion.checked = settings.accessibility.reduceMotion;
  optCB.value = settings.accessibility.cb;
}
loadSettingsIntoUI();
applyAudioSettings();
applyGraphics();
applyGameplay();
applyAccessibility();

/* Save settings */
btnSaveSettings.onclick = () => {
  settings.graphics.bloom = optBloom.checked;
  settings.graphics.ssao = optSSAO.checked;
  settings.graphics.hdr = optHDR.checked;
  settings.graphics.perf = optPerf.checked;
  settings.graphics.shadows = optShadows.value;
  settings.graphics.fps = Number(optFPS.value || 60);

  settings.audio.muted = optMute.checked;
  settings.audio.master = Number(volMaster.value);
  settings.audio.music = Number(volMusic.value);
  settings.audio.sfx = Number(volSfx.value);

  settings.gameplay.difficulty = optDifficulty.value;
  settings.gameplay.invert = optInvert.checked;
  settings.gameplay.wrap = optWrap.checked;
  if (optFollowCam) settings.gameplay.followCam = optFollowCam.checked;
  followCam = settings.gameplay.followCam;

  settings.accessibility.reduceMotion = optReduceMotion.checked;
  settings.accessibility.cb = optCB.value;

  Save.set("snake3d-settings", settings);
  applyAudioSettings(); applyGraphics(); applyGameplay(); applyAccessibility();
  btnSaveSettings.textContent = "Saved ✓"; setTimeout(() => btnSaveSettings.textContent = "Save Settings", 900);
};

/* Begin in menu */
openStartMenu();

/* Resize */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

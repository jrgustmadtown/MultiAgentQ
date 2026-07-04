import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

// Match style.css agent colors and paper palette.
const P1_COLOR = 0xa93226;
const P2_COLOR = 0x2471a3;
const P1_TRAIL = 0xc0392b;
const P2_TRAIL = 0x5dade2;
const P1_ACTIVE = 0xff2d2d;
const P2_ACTIVE = 0x0088ff;
const BG_COLOR = 0xffffff;
const GRID_LINE = 0xcccccc;
const GRID_BORDER = 0x999999;
const TRAIL_OPACITY = 0.68;
const ACTIVE_OPACITY = 0.84;
const ACTIVE_HEAD_LENGTH_SCALE = 1.12;
const ACTIVE_HEAD_WIDTH_SCALE = 2.2;
const THICK_SHAFT_RADIUS = 0.018;
const HEAD_LENGTH = 0.14;
const HEAD_WIDTH = 0.08;
const OFFSET = 0.12;
const DRIFT_START = 0.4;

function lerpAngle(from, to, t) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
const STREAMLINER_DIR = new URL("./Streamliner/", import.meta.url).href;
const STANDARD_MR_DIR = new URL("./Standard MR/Standard MR/", import.meta.url).href;
const KART_TARGET_WIDTH = 0.54;

function cellCenter(x, y, gridSize) {
  return new THREE.Vector3(gridSize - x - 0.5, 0, y + 0.5);
}

function configureKartTexture(tex) {
  if (!tex) {
    return;
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
}

function isEmblemMaterial(mat) {
  if (mat.name === "kart_emblem") {
    return true;
  }
  const src = mat.map?.image?.currentSrc ?? mat.map?.image?.src ?? "";
  return src.includes("emblem");
}

function matteKartMaterial(mat) {
  const emblem = isEmblemMaterial(mat);
  const next = new THREE.MeshLambertMaterial({
    map: mat.map ?? null,
    alphaMap: emblem ? (mat.alphaMap ?? mat.map ?? null) : null,
    transparent: emblem,
    alphaTest: emblem ? 0.35 : 0,
    depthWrite: true,
    side: THREE.DoubleSide,
    color: 0xffffff,
    opacity: 1,
  });
  configureKartTexture(next.map);
  configureKartTexture(next.alphaMap);
  return next;
}

function fixMeshMaterials(object) {
  object.traverse((child) => {
    if (!child.isMesh || !child.material) {
      return;
    }
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    child.material = mats.length === 1
      ? matteKartMaterial(mats[0])
      : mats.map((mat) => matteKartMaterial(mat));
  });
}

function prepareKartPrototype(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const scale = KART_TARGET_WIDTH / Math.max(size.x, size.z);
  object.scale.setScalar(scale);
  box.setFromObject(object);
  object.position.y -= box.min.y;
  return object;
}

function loadKartModel(dir, objFile, mtlFile) {
  return new Promise((resolve, reject) => {
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath(dir);
    mtlLoader.setResourcePath(dir);
    mtlLoader.load(
      mtlFile,
      (materials) => {
        for (const info of Object.values(materials.materialsInfo)) {
          info.d = 1;
        }
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.setPath(dir);
        objLoader.load(
          objFile,
          (object) => {
            fixMeshMaterials(object);
            resolve(prepareKartPrototype(object));
          },
          undefined,
          reject,
        );
      },
      undefined,
      reject,
    );
  });
}

function loadStandardMrKart() {
  return loadKartModel(STANDARD_MR_DIR, "kart_MR_a.obj", "kart_MR_a.mtl");
}

function loadStreamlinerKart() {
  return loadKartModel(STREAMLINER_DIR, "kart_LG_c.obj", "kart_LG_c.mtl");
}

export class Car3DReplayRenderer {
  constructor(container, gridSize = 5) {
    this.gridSize = gridSize;
    this.container = container;
    this.trailGroup = new THREE.Group();
    this.trailSteps = [];
    this.renderLoopId = null;
    this.playToken = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    this.gridCenter = gridSize / 2;

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.camera.position.set(this.gridCenter - 2.5, 7.5, this.gridCenter + 6.5);
    this.camera.lookAt(this.gridCenter, 0, this.gridCenter);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.target.set(this.gridCenter, 0, this.gridCenter);
    this.controls.minDistance = 5;
    this.controls.maxDistance = 18;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 1.05);
    const sun = new THREE.DirectionalLight(0xffffff, 0.38);
    sun.position.set(this.gridCenter + 5, 11, this.gridCenter + 3);
    const fill = new THREE.DirectionalLight(0xffffff, 0.28);
    fill.position.set(this.gridCenter - 4, 6, this.gridCenter - 2);
    this.scene.add(ambient, sun, fill);

    this._buildGrid();
    this.scene.add(this.trailGroup);
    this.labelOverlay = null;
    this.gridLabelEntries = null;
    this._labelProject = new THREE.Vector3();

    this.car1 = new THREE.Group();
    this.car2 = new THREE.Group();
    this.scene.add(this.car1);
    this.scene.add(this.car2);

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    requestAnimationFrame(() => this.resize());
    this._startRenderLoop();
    this.ready = this._loadKarts();
  }

  async _loadKarts() {
    const [p1Proto, p2Proto] = await Promise.all([
      loadStandardMrKart(),
      loadStreamlinerKart(),
    ]);
    this.car1.add(this._makeKart(p1Proto));
    this.car2.add(this._makeKart(p2Proto));
  }

  _makeKart(proto) {
    return proto.clone(true);
  }

  _playerOffset(player) {
    const s = player === 1 ? OFFSET : -OFFSET;
    return new THREE.Vector3(s, 0, s);
  }

  _headingFromStates(fromState, toState, xIdx, yIdx) {
    const n = this.gridSize;
    const offset = this._playerOffset(xIdx === 0 ? 1 : 2);
    const from = cellCenter(fromState[xIdx], fromState[yIdx], n).add(offset);
    const to = cellCenter(toState[xIdx], toState[yIdx], n).add(offset);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.hypot(dx, dz) < 1e-6) {
      return null;
    }
    return Math.atan2(dx, dz);
  }

  _initCarHeadings(fromState, toState) {
    const p1 = this._headingFromStates(fromState, toState, 0, 1);
    const p2 = this._headingFromStates(fromState, toState, 2, 3);
    if (p1 !== null) {
      this.car1.rotation.y = p1;
    }
    if (p2 !== null) {
      this.car2.rotation.y = p2;
    }
  }

  _setCarRotation(group, curHeading, nextHeading, driftT) {
    let target = null;
    if (curHeading !== null && nextHeading !== null && driftT > 0) {
      target = lerpAngle(curHeading, nextHeading, smoothstep(driftT));
    } else if (curHeading === null && nextHeading !== null && driftT > 0) {
      target = lerpAngle(group.rotation.y, nextHeading, smoothstep(driftT));
    } else if (curHeading !== null) {
      target = curHeading;
    } else {
      return;
    }

    const delta = Math.atan2(
      Math.sin(target - group.rotation.y),
      Math.cos(target - group.rotation.y),
    );
    if (Math.abs(delta) < 0.002) {
      group.rotation.y = target;
      return;
    }
    // During drift the target moves smoothly each frame; before drift, ease in gently.
    if (driftT > 0) {
      group.rotation.y = target;
    } else {
      group.rotation.y = lerpAngle(group.rotation.y, target, 0.22);
    }
  }

  _buildGrid() {
    const group = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: GRID_LINE });
    const borderMat = new THREE.LineBasicMaterial({ color: GRID_BORDER });

    for (let i = 0; i <= this.gridSize; i++) {
      const xi = this.gridSize - i;
      const a = new THREE.Vector3(xi, 0.01, 0);
      const b = new THREE.Vector3(xi, 0.01, this.gridSize);
      const c = new THREE.Vector3(0, 0.01, i);
      const d = new THREE.Vector3(this.gridSize, 0.01, i);
      const mat = i === 0 || i === this.gridSize ? borderMat : lineMat;
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([c, d]), mat));
    }

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.gridSize, this.gridSize),
      new THREE.MeshBasicMaterial({ color: BG_COLOR }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.gridSize / 2, 0, this.gridSize / 2);
    group.add(floor);
    this.scene.add(group);
  }

  setGridRewards(gridReward) {
    if (this.labelOverlay) {
      this.container.removeChild(this.labelOverlay);
      this.labelOverlay = null;
    }
    this.gridLabelEntries = null;
    if (!gridReward) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "grid-reward-labels grid-reward-labels--3d";
    overlay.hidden = true;

    const entries = [];
    for (let x = 0; x < this.gridSize; x++) {
      for (let y = 0; y < this.gridSize; y++) {
        const label = document.createElement("span");
        label.className = "grid-reward-label";
        label.textContent = gridReward[x][y].toFixed(2);
        overlay.appendChild(label);
        entries.push({ el: label, x, y });
      }
    }

    this.container.appendChild(overlay);
    this.labelOverlay = overlay;
    this.gridLabelEntries = entries;
  }

  setShowGridRewards(show) {
    if (this.labelOverlay) {
      this.labelOverlay.hidden = !show;
    }
  }

  _updateGridLabelPositions() {
    if (!this.labelOverlay || this.labelOverlay.hidden || !this.gridLabelEntries?.length) {
      return;
    }
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) {
      return;
    }

    const v = this._labelProject;
    const n = this.gridSize;
    for (const { el, x, y } of this.gridLabelEntries) {
      v.copy(cellCenter(x, y, n));
      v.y = 0.06;
      v.project(this.camera);
      if (v.z > 1) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    }
  }

  _carPositions(state) {
    const n = this.gridSize;
    const p1 = cellCenter(state[0], state[1], n).add(new THREE.Vector3(OFFSET, 0, OFFSET));
    const p2 = cellCenter(state[2], state[3], n).add(new THREE.Vector3(-OFFSET, 0, -OFFSET));
    return { p1, p2 };
  }

  setCars(state) {
    const { p1, p2 } = this._carPositions(state);
    this.car1.position.copy(p1);
    this.car2.position.copy(p2);
  }

  setCarHeadingsForStep(traj, stepIndex) {
    if (!traj?.length) {
      return;
    }
    if (stepIndex < traj.length - 1) {
      this._initCarHeadings(traj[stepIndex], traj[stepIndex + 1]);
    } else if (stepIndex > 0) {
      this._initCarHeadings(traj[stepIndex - 1], traj[stepIndex]);
    }
  }

  clearTrail() {
    this.trailSteps = [];
    while (this.trailGroup.children.length) {
      this._disposeArrow(this.trailGroup.children.pop());
    }
  }

  _disposeArrow(helper) {
    if (!helper?.isArrowHelper) {
      return;
    }
    helper.traverse((child) => {
      child.geometry?.dispose();
      child.material?.dispose();
    });
  }

  drawTrail(traj, activeStep = null) {
    this.clearTrail();
    const total = traj.length - 1;
    if (total <= 0) {
      return;
    }

    for (let i = 0; i < total; i++) {
      const s = traj[i];
      const sn = traj[i + 1];
      const n = this.gridSize;
      const arrowY = 0.08;
      const p1 = this._addArrow(
        cellCenter(s[0], s[1], n).add(new THREE.Vector3(OFFSET, arrowY, OFFSET)),
        cellCenter(sn[0], sn[1], n).add(new THREE.Vector3(OFFSET, arrowY, OFFSET)),
        P1_TRAIL,
        TRAIL_OPACITY,
      );
      const p2 = this._addArrow(
        cellCenter(s[2], s[3], n).add(new THREE.Vector3(-OFFSET, arrowY, -OFFSET)),
        cellCenter(sn[2], sn[3], n).add(new THREE.Vector3(-OFFSET, arrowY, -OFFSET)),
        P2_TRAIL,
        TRAIL_OPACITY,
      );
      this.trailSteps.push({ p1, p2, index: i });
    }

    this.setActiveStep(activeStep);
  }

  _createThickShaft(shaftLen) {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(THICK_SHAFT_RADIUS, THICK_SHAFT_RADIUS, shaftLen, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }),
    );
    shaft.position.y = shaftLen / 2;
    return shaft;
  }

  _syncThickShaft(arrow, shaftLen, color, opacity) {
    const { helper } = arrow;
    if (arrow.thickShaft) {
      helper.remove(arrow.thickShaft);
      arrow.thickShaft.geometry.dispose();
      arrow.thickShaft.material.dispose();
      arrow.thickShaft = null;
    }
    arrow.thickShaft = this._createThickShaft(shaftLen);
    arrow.thickShaft.material.color.setHex(color);
    arrow.thickShaft.material.opacity = opacity;
    arrow.thickShaft.material.transparent = opacity < 1;
    helper.add(arrow.thickShaft);
  }

  _applyArrowStyle(arrow, color, opacity, highlighted) {
    if (!arrow) {
      return;
    }
    const { helper } = arrow;

    const headLen = highlighted ? HEAD_LENGTH * ACTIVE_HEAD_LENGTH_SCALE : HEAD_LENGTH;
    const headW = highlighted ? HEAD_WIDTH * ACTIVE_HEAD_WIDTH_SCALE : HEAD_WIDTH;
    helper.setLength(arrow.totalLen, headLen, headW);

    helper.line.material.color.setHex(color);
    helper.line.material.opacity = opacity;
    helper.line.material.transparent = opacity < 1;
    helper.line.visible = !highlighted;

    helper.cone.material.color.setHex(color);
    helper.cone.material.opacity = opacity;
    helper.cone.material.transparent = opacity < 1;
    helper.renderOrder = highlighted ? 1 : 0;

    const shaftLen = Math.max(arrow.totalLen - headLen, 0.001);
    if (highlighted) {
      this._syncThickShaft(arrow, shaftLen, color, opacity);
      arrow.thickShaft.visible = true;
    } else if (arrow.thickShaft) {
      arrow.thickShaft.visible = false;
    }
  }

  setActiveStep(stepIndex) {
    this.activeStep = stepIndex;
    for (const { p1, p2, index } of this.trailSteps) {
      const highlighted = stepIndex !== null && index === stepIndex;
      this._applyArrowStyle(
        p1,
        highlighted ? P1_ACTIVE : P1_TRAIL,
        highlighted ? ACTIVE_OPACITY : TRAIL_OPACITY,
        highlighted,
      );
      this._applyArrowStyle(
        p2,
        highlighted ? P2_ACTIVE : P2_TRAIL,
        highlighted ? ACTIVE_OPACITY : TRAIL_OPACITY,
        highlighted,
      );
    }
  }

  _addArrow(from, to, color, opacity) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-6) {
      return null;
    }

    const helper = new THREE.ArrowHelper(
      dir.normalize(),
      from,
      len,
      color,
      HEAD_LENGTH,
      HEAD_WIDTH,
    );
    helper.line.material.opacity = opacity;
    helper.line.material.transparent = true;
    helper.cone.material.opacity = opacity;
    helper.cone.material.transparent = true;
    this.trailGroup.add(helper);

    return {
      helper,
      thickShaft: null,
      totalLen: len,
    };
  }

  stopPlayback() {
    this.playToken += 1;
  }

  async _animateSegment(fromState, toState, stepMs, nextState = null) {
    const token = this.playToken;
    const start = this._actorPositions(fromState);
    const end = this._actorPositions(toState);
    const p1Cur = this._headingFromStates(fromState, toState, 0, 1);
    const p2Cur = this._headingFromStates(fromState, toState, 2, 3);
    const p1Next = nextState ? this._headingFromStates(toState, nextState, 0, 1) : null;
    const p2Next = nextState ? this._headingFromStates(toState, nextState, 2, 3) : null;
    const t0 = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        if (token !== this.playToken) {
          resolve();
          return;
        }
        try {
          const t = Math.min(1, (now - t0) / stepMs);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          this.car1.position.lerpVectors(start.p1, end.p1, ease);
          this.car2.position.lerpVectors(start.p2, end.p2, ease);

          const driftT = t <= DRIFT_START
            ? 0
            : (t - DRIFT_START) / (1 - DRIFT_START);
          this._setCarRotation(this.car1, p1Cur, p1Next, smoothstep(driftT));
          this._setCarRotation(this.car2, p2Cur, p2Next, smoothstep(driftT));

          if (t < 1) {
            requestAnimationFrame(tick);
            return;
          }
        } catch (err) {
          console.error("Car 3D animation tick failed:", err);
        }
        resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  _actorPositions(state) {
    return this._carPositions(state);
  }

  async animateStep(fromState, toState, stepIndex, stepMs = 495, nextState = null) {
    this.stopPlayback();
    this.setActiveStep(stepIndex);
    this._initCarHeadings(fromState, toState);
    await this._animateSegment(fromState, toState, stepMs, nextState);
  }

  async playTrajectory(traj, stepMs = 495, onStep) {
    this.stopPlayback();
    const token = this.playToken;
    this.drawTrail(traj, null);
    this.setCars(traj[0]);
    if (traj.length > 1) {
      this._initCarHeadings(traj[0], traj[1]);
    }

    try {
      for (let i = 0; i < traj.length - 1; i++) {
        if (token !== this.playToken) {
          return;
        }

        this.setActiveStep(i);
        await this._animateSegment(traj[i], traj[i + 1], stepMs, traj[i + 2] ?? null);
        if (token !== this.playToken) {
          return;
        }
        onStep?.(i + 1, traj[i + 1]);
        this.setActiveStep(null);
      }
    } finally {
      if (token === this.playToken) {
        this.setCars(traj[traj.length - 1]);
        if (traj.length > 1) {
          this.setCarHeadingsForStep(traj, traj.length - 1);
        }
        this.drawTrail(traj, null);
      }
    }
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _startRenderLoop() {
    const loop = () => {
      this.controls.update();
      this._updateGridLabelPositions();
      this.renderer.render(this.scene, this.camera);
      this.renderLoopId = requestAnimationFrame(loop);
    };
    loop();
  }

  dispose() {
    this.stopPlayback();
    if (this.renderLoopId !== null) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }
    window.removeEventListener("resize", this._onResize);
    this._resizeObserver?.disconnect();
    if (this.labelOverlay) {
      this.container.removeChild(this.labelOverlay);
      this.labelOverlay = null;
    }
    this.gridLabelEntries = null;
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

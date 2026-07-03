import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { dogPosition, DEFAULT_HOUSE1, DEFAULT_HOUSE2, clampPosition } from "./environment.js";

const P1_COLOR = 0xa93226;
const P2_COLOR = 0x2471a3;
const DOG_COLOR = 0x008000;
const DOG_TRAIL = DOG_COLOR;
const DOG_TRAIL_OPACITY = 0.85;
const HOUSE_OPACITY = 0.45;
const HOUSE1_COLOR = 0xc0392b;
const HOUSE2_COLOR = 0x2471a3;
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
const THICK_SHAFT_RADIUS = 0.0025;
const HEAD_LENGTH = 0.028;
const HEAD_WIDTH = 0.015;
const DOG_HEAD_LENGTH = 0.024;
const DOG_HEAD_WIDTH = 0.013;
const ARENA = 1;
const VIEW_PADDING = 1.12;

/** Map state (x,y) in [0,1]² to world XZ — matches matplotlib doggame/visualization.py (y up). */
function stateToWorldXZ(sx, sy) {
  return [sx, 1 - sy];
}

function worldPos(sx, sy, y = 0.1) {
  const [wx, wz] = stateToWorldXZ(sx, sy);
  return new THREE.Vector3(wx, y, wz);
}

export class DogReplayRenderer {
  constructor(container, options = {}) {
    this.container = container;
    this.house1 = options.house1 ?? DEFAULT_HOUSE1;
    this.house2 = options.house2 ?? DEFAULT_HOUSE2;
    this.trailGroup = new THREE.Group();
    this.trailSteps = [];
    this.renderLoopId = null;
    this.playToken = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    this.halfArena = ARENA / 2;
    this.arenaCenter = ARENA / 2;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(this.arenaCenter, 10, this.arenaCenter);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.arenaCenter, 0, this.arenaCenter);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
    this.controls.enableZoom = false;
    this.controls.target.set(this.arenaCenter, 0, this.arenaCenter);
    this.controls.update();

    this.renderer.domElement.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    this._updateCamera(w / h);
    this._buildArena();
    this.scene.add(this.trailGroup);

    const playerGeo = new THREE.BoxGeometry(0.026, 0.026, 0.026);
    this.player1 = new THREE.Mesh(playerGeo, new THREE.MeshBasicMaterial({ color: P1_COLOR }));
    this.player2 = new THREE.Mesh(playerGeo, new THREE.MeshBasicMaterial({ color: P2_COLOR }));
    this.dog = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 12, 12),
      new THREE.MeshBasicMaterial({ color: DOG_COLOR }),
    );

    const hitGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.hit1 = new THREE.Mesh(hitGeo, hitMat);
    this.hit2 = new THREE.Mesh(hitGeo, hitMat.clone());
    this.hit1.userData.playerId = 1;
    this.hit2.userData.playerId = 2;

    this.scene.add(this.hit1);
    this.scene.add(this.hit2);
    this.scene.add(this.player1);
    this.scene.add(this.player2);
    this.scene.add(this.dog);

    this._raycaster = new THREE.Raycaster();
    this._pointerNdc = new THREE.Vector2();
    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._planeHit = new THREE.Vector3();

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    requestAnimationFrame(() => this.resize());
    this._startRenderLoop();
  }

  get domElement() {
    return this.renderer.domElement;
  }

  _buildArena() {
    const group = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: GRID_LINE });
    const borderMat = new THREE.LineBasicMaterial({ color: GRID_BORDER });

    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const a = new THREE.Vector3(t, 0.01, 0);
      const b = new THREE.Vector3(t, 0.01, ARENA);
      const c = new THREE.Vector3(0, 0.01, t);
      const d = new THREE.Vector3(ARENA, 0.01, t);
      const mat = i === 0 || i === 4 ? borderMat : lineMat;
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([c, d]), mat));
    }

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA, ARENA),
      new THREE.MeshBasicMaterial({ color: BG_COLOR }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ARENA / 2, 0, ARENA / 2);
    group.add(floor);

    group.add(this._houseMarker(this.house1, HOUSE1_COLOR));
    group.add(this._houseMarker(this.house2, HOUSE2_COLOR));
    this.scene.add(group);
  }

  _houseMarker([sx, sy], color) {
    const [x, z] = stateToWorldXZ(sx, sy);
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.026, 4),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: HOUSE_OPACITY,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    g.add(ring);
    return g;
  }

  _actorPositions(state) {
    const p1 = worldPos(state[0], state[1]);
    const p2 = worldPos(state[2], state[3]);
    const dog = worldPos(...dogPosition(state), 0.08);
    return { p1, p2, dog };
  }

  setActors(state) {
    const { p1, p2, dog } = this._actorPositions(state);
    this.player1.position.copy(p1);
    this.player2.position.copy(p2);
    this.hit1.position.copy(p1);
    this.hit2.position.copy(p2);
    this.dog.position.copy(dog);
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
      const dog0 = dogPosition(s);
      const dog1 = dogPosition(sn);
      const p1 = this._addArrow(
        worldPos(s[0], s[1], 0.05),
        worldPos(sn[0], sn[1], 0.05),
        P1_TRAIL,
        TRAIL_OPACITY,
      );
      const p2 = this._addArrow(
        worldPos(s[2], s[3], 0.05),
        worldPos(sn[2], sn[3], 0.05),
        P2_TRAIL,
        TRAIL_OPACITY,
      );
      const dog = this._addArrow(
        worldPos(dog0[0], dog0[1], 0.06),
        worldPos(dog1[0], dog1[1], 0.06),
        DOG_TRAIL,
        DOG_TRAIL_OPACITY,
        DOG_HEAD_LENGTH,
        DOG_HEAD_WIDTH,
      );
      this.trailSteps.push({ p1, p2, dog, index: i });
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

  _addArrow(from, to, color, opacity, headLength = HEAD_LENGTH, headWidth = HEAD_WIDTH) {
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
      headLength,
      headWidth,
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

  async _animateSegment(fromState, toState, stepMs) {
    const token = this.playToken;
    const start = this._actorPositions(fromState);
    const end = this._actorPositions(toState);
    const t0 = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        if (token !== this.playToken) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - t0) / stepMs);
        this.player1.position.lerpVectors(start.p1, end.p1, t);
        this.player2.position.lerpVectors(start.p2, end.p2, t);
        this.dog.position.lerpVectors(start.dog, end.dog, t);
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async animateStep(fromState, toState, stepIndex, stepMs = 450) {
    this.stopPlayback();
    this.setActiveStep(stepIndex);
    await this._animateSegment(fromState, toState, stepMs);
  }

  async playTrajectory(traj, stepMs = 400, onStep) {
    const token = ++this.playToken;
    const segments = traj.length - 1;
    this.drawTrail(traj, null);
    this.setActors(traj[0]);

    if (segments <= 0) {
      return;
    }

    for (let i = 0; i < segments; i++) {
      if (token !== this.playToken) {
        return;
      }
      await this._animateSegment(traj[i], traj[i + 1], stepMs);
      if (token !== this.playToken) {
        return;
      }
      onStep?.(i + 1, traj[i + 1]);
    }

    if (token === this.playToken) {
      this.setActors(traj[traj.length - 1]);
    }
  }

  _updateCamera(aspect) {
    const half = this.halfArena * VIEW_PADDING;
    if (aspect >= 1) {
      this.camera.top = half;
      this.camera.bottom = -half;
      this.camera.left = -half * aspect;
      this.camera.right = half * aspect;
    } else {
      this.camera.left = -half;
      this.camera.right = half;
      this.camera.top = half / aspect;
      this.camera.bottom = -half / aspect;
    }
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this._updateCamera(w / h);
    this.renderer.setSize(w, h);
  }

  /** Map a pointer event on the canvas to state coordinates in [0, 1]². */
  pickStateFromPointer(event) {
    this._setPointerNdc(event);
    this._raycaster.setFromCamera(this._pointerNdc, this.camera);
    if (!this._raycaster.ray.intersectPlane(this._dragPlane, this._planeHit)) {
      return [0, 0];
    }
    return clampPosition(this._planeHit.x, 1 - this._planeHit.z);
  }

  _setPointerNdc(event) {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    this._pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Return 1 or 2 if pointer hits a player drag target; otherwise null. */
  pickPlayerFromPointer(event) {
    this._setPointerNdc(event);
    this._raycaster.setFromCamera(this._pointerNdc, this.camera);
    const hits = this._raycaster.intersectObjects([this.hit1, this.hit2], false);
    if (!hits.length) {
      return null;
    }
    return hits[0].object.userData.playerId;
  }

  _startRenderLoop() {
    const loop = () => {
      this.controls.update();
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
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

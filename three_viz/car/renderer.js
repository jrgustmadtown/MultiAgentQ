import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

function cellCenter(x, y) {
  return new THREE.Vector3(x + 0.5, 0, y + 0.5);
}

export class CarReplayRenderer {
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
    this.halfGrid = gridSize / 2;
    this.gridCenter = gridSize / 2;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(this.gridCenter, 10, this.gridCenter);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.gridCenter, 0, this.gridCenter);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
    this.controls.enableZoom = false;
    this.controls.target.set(this.gridCenter, 0, this.gridCenter);
    this.controls.update();

    this._updateCamera(w / h);

    this._buildGrid();
    this.scene.add(this.trailGroup);

    const carGeo = new THREE.BoxGeometry(0.4, 0.12, 0.4);
    this.car1 = new THREE.Mesh(carGeo, new THREE.MeshBasicMaterial({ color: P1_COLOR }));
    this.car2 = new THREE.Mesh(carGeo, new THREE.MeshBasicMaterial({ color: P2_COLOR }));
    this.scene.add(this.car1);
    this.scene.add(this.car2);

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    requestAnimationFrame(() => this.resize());
    this._startRenderLoop();
  }

  _buildGrid() {
    const group = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: GRID_LINE });
    const borderMat = new THREE.LineBasicMaterial({ color: GRID_BORDER });

    for (let i = 0; i <= this.gridSize; i++) {
      const a = new THREE.Vector3(i, 0.01, 0);
      const b = new THREE.Vector3(i, 0.01, this.gridSize);
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

  _carPositions(state) {
    const p1 = cellCenter(state[0], state[1]).add(new THREE.Vector3(OFFSET, 0.1, OFFSET));
    const p2 = cellCenter(state[2], state[3]).add(new THREE.Vector3(-OFFSET, 0.1, -OFFSET));
    return { p1, p2 };
  }

  setCars(state) {
    const { p1, p2 } = this._carPositions(state);
    this.car1.position.copy(p1);
    this.car2.position.copy(p2);
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
      const p1 = this._addArrow(
        cellCenter(s[0], s[1]).add(new THREE.Vector3(OFFSET, 0.05, OFFSET)),
        cellCenter(sn[0], sn[1]).add(new THREE.Vector3(OFFSET, 0.05, OFFSET)),
        P1_TRAIL,
        TRAIL_OPACITY,
      );
      const p2 = this._addArrow(
        cellCenter(s[2], s[3]).add(new THREE.Vector3(-OFFSET, 0.05, -OFFSET)),
        cellCenter(sn[2], sn[3]).add(new THREE.Vector3(-OFFSET, 0.05, -OFFSET)),
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
    // ArrowHelper line runs along local +Y (three@0.160).
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

  /** Highlight the arrow for step index (move traj[i] → traj[i+1]). null = none. */
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

  async _animateSegment(fromState, toState, stepMs) {
    const token = this.playToken;
    const start1 = this.car1.position.clone();
    const start2 = this.car2.position.clone();
    const end = this._carPositions(toState);
    const t0 = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        if (token !== this.playToken) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - t0) / stepMs);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.car1.position.lerpVectors(start1, end.p1, ease);
        this.car2.position.lerpVectors(start2, end.p2, ease);
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  /** Animate one step between two states (used by forward/back controls). */
  async animateStep(fromState, toState, stepIndex, stepMs = 450) {
    this.stopPlayback();
    this.setActiveStep(stepIndex);
    await this._animateSegment(fromState, toState, stepMs);
  }

  async playTrajectory(traj, stepMs = 450, onStep) {
    this.stopPlayback();
    const token = this.playToken;
    this.drawTrail(traj, null);
    this.setCars(traj[0]);

    try {
      for (let i = 0; i < traj.length - 1; i++) {
        if (token !== this.playToken) {
          return;
        }

        this.setActiveStep(i);
        await this._animateSegment(traj[i], traj[i + 1], stepMs);
        if (token !== this.playToken) {
          return;
        }
        onStep?.(i + 1, traj[i + 1]);
        this.setActiveStep(null);
      }
    } finally {
      if (token === this.playToken) {
        this.setCars(traj[traj.length - 1]);
        this.drawTrail(traj, null);
      }
    }
  }

  _updateCamera(aspect) {
    const half = this.halfGrid;
    // Fit square grid [0, gridSize] edge-to-edge; equal scale on X and Z.
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

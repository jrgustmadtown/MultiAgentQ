import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const P1_COLOR = 0xe74c3c;
const P2_COLOR = 0x3498db;
const OFFSET = 0.12;

function cellCenter(x, y) {
  return new THREE.Vector3(x + 0.5, 0, y + 0.5);
}

export class CarReplayRenderer {
  constructor(container, gridSize = 5) {
    this.gridSize = gridSize;
    this.container = container;
    this.trailGroup = new THREE.Group();
    this.renderLoopId = null;
    this.playToken = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf7f7f7);

    const w = Math.max(container.clientWidth, 400);
    const h = Math.max(container.clientHeight, 400);
    const aspect = w / h;
    const frustum = gridSize * 0.75;
    this.camera = new THREE.OrthographicCamera(
      -frustum * aspect,
      frustum * aspect,
      frustum,
      -frustum,
      0.1,
      100,
    );
    this.camera.position.set(gridSize / 2, gridSize * 1.2, gridSize * 1.2);
    this.camera.lookAt(gridSize / 2, 0, gridSize / 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.target.set(gridSize / 2, 0, gridSize / 2);
    this.controls.update();

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(gridSize, gridSize * 2, gridSize);
    this.scene.add(sun);

    this._buildGrid();
    this.scene.add(this.trailGroup);

    const carGeo = new THREE.BoxGeometry(0.42, 0.18, 0.42);
    this.car1 = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ color: P1_COLOR }));
    this.car2 = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ color: P2_COLOR }));
    this.scene.add(this.car1);
    this.scene.add(this.car2);

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    requestAnimationFrame(() => this.resize());
    this._startRenderLoop();
  }

  _buildGrid() {
    const group = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0xbbbbbb });
    const borderMat = new THREE.LineBasicMaterial({ color: 0x666666 });

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
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
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
    while (this.trailGroup.children.length) {
      const child = this.trailGroup.children.pop();
      if (child.isArrowHelper) {
        child.line.geometry.dispose();
        child.line.material.dispose();
        child.cone.geometry.dispose();
        child.cone.material.dispose();
      } else {
        child.geometry?.dispose();
        child.material?.dispose();
      }
    }
  }

  drawTrail(traj) {
    this.clearTrail();
    const total = traj.length - 1;
    if (total <= 0) {
      return;
    }

    for (let i = 0; i < total; i++) {
      const s = traj[i];
      const sn = traj[i + 1];
      const alpha = 0.2 + 0.6 * (i / total);
      this._addArrow(
        cellCenter(s[0], s[1]).add(new THREE.Vector3(OFFSET, 0.05, OFFSET)),
        cellCenter(sn[0], sn[1]).add(new THREE.Vector3(OFFSET, 0.05, OFFSET)),
        P1_COLOR,
        alpha,
      );
      this._addArrow(
        cellCenter(s[2], s[3]).add(new THREE.Vector3(-OFFSET, 0.05, -OFFSET)),
        cellCenter(sn[2], sn[3]).add(new THREE.Vector3(-OFFSET, 0.05, -OFFSET)),
        P2_COLOR,
        alpha,
      );
    }
  }

  _addArrow(from, to, color, opacity) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-6) {
      return;
    }
    const arrow = new THREE.ArrowHelper(
      dir.normalize(),
      from,
      len,
      color,
      0.18,
      0.1,
    );
    arrow.line.material.opacity = opacity;
    arrow.line.material.transparent = true;
    arrow.cone.material.opacity = opacity;
    arrow.cone.material.transparent = true;
    this.trailGroup.add(arrow);
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
  async animateStep(fromState, toState, stepMs = 450) {
    this.stopPlayback();
    await this._animateSegment(fromState, toState, stepMs);
  }

  async playTrajectory(traj, stepMs = 450, onStep) {
    this.stopPlayback();
    const token = this.playToken;
    this.drawTrail(traj);
    this.setCars(traj[0]);

    for (let i = 0; i < traj.length - 1; i++) {
      if (token !== this.playToken) {
        return;
      }

      await this._animateSegment(traj[i], traj[i + 1], stepMs);
      if (token !== this.playToken) {
        return;
      }
      onStep?.(i + 1, traj[i + 1]);
    }
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 400);
    const aspect = w / h;
    const frustum = this.gridSize * 0.75;
    this.camera.left = -frustum * aspect;
    this.camera.right = frustum * aspect;
    this.camera.top = frustum;
    this.camera.bottom = -frustum;
    this.camera.updateProjectionMatrix();
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
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

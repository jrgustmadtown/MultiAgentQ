import * as THREE from "three";
import { dogPosition, DEFAULT_HOUSE1, DEFAULT_HOUSE2 } from "./environment.js";

const ARENA = 1;
const VIEW_PADDING = 1.12;
const WORLD = 1.22;
const VIEW_CENTER = ARENA / 2;

// Snowdin Forest palette (Undertale)
const PATH = "#687890";
const EDGE = "#283848";
const OUTSIDE = "#141820";
const OUTLINE = "#141820";

const P1_TRAIL = 0xd84848;
const P2_TRAIL = 0x48b0d0;
const DOG_TRAIL = 0xe8e8f0;

const INTERNAL_DRAW_TARGET = 768;
const SPRITE_TEXEL_SCALE = 2;
const FRISK_FRAME_MS = 120;
const TEMMIE_FRAME_MS = 140;

const FRISK_P1_ANIMS = {
  down: ["frisk_p1_down_0.png", "frisk_p1_down_1.png", "frisk_p1_down_2.png", "frisk_p1_down_3.png"],
  up: ["frisk_p1_up_0.png", "frisk_p1_up_1.png", "frisk_p1_up_2.png", "frisk_p1_up_3.png"],
  left: ["frisk_p1_left_0.png", "frisk_p1_left_1.png"],
  right: ["frisk_p1_right_0.png", "frisk_p1_right_1.png"],
};
const FRISK_P2_ANIMS = {
  down: ["frisk_p2_down_0.png", "frisk_p2_down_1.png", "frisk_p2_down_2.png", "frisk_p2_down_3.png"],
  up: ["frisk_p2_up_0.png", "frisk_p2_up_1.png", "frisk_p2_up_2.png", "frisk_p2_up_3.png"],
  left: ["frisk_p2_left_0.png", "frisk_p2_left_1.png"],
  right: ["frisk_p2_right_0.png", "frisk_p2_right_1.png"],
};
const FRISK_MAX = [19, 29];

const TEMMIE_ANIMS = {
  down: ["temmie_down_0.png", "temmie_down_1.png", "temmie_down_2.png", "temmie_down_3.png", "temmie_down_4.png"],
  up: ["temmie_down_0.png", "temmie_down_1.png", "temmie_down_2.png", "temmie_down_3.png", "temmie_down_4.png"],
  left: ["temmie_left_0.png", "temmie_left_1.png", "temmie_left_2.png", "temmie_left_3.png"],
  right: ["temmie_right_0.png", "temmie_right_1.png", "temmie_right_2.png", "temmie_right_3.png"],
};
const TEMMIE_MAX = [29, 26];

function spriteWorldSize(texW, texH, texelScale) {
  const unit = (texelScale * (ARENA * VIEW_PADDING)) / INTERNAL_DRAW_TARGET;
  return [texW * unit, texH * unit];
}

function loadPixelTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

async function loadSpriteAnims(filesByDir) {
  const anims = {};
  for (const [dir, files] of Object.entries(filesByDir)) {
    anims[dir] = await Promise.all(
      files.map((file) => loadPixelTexture(new URL(`./${file}`, import.meta.url).href)),
    );
  }
  return anims;
}

function initAllTextures(renderer, animsList) {
  for (const anims of animsList) {
    for (const tex of Object.values(anims).flat()) {
      renderer.initTexture(tex);
    }
  }
}

function movementDirection(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 1e-6) {
    return "down";
  }
  if (Math.abs(dx) >= Math.abs(dz)) {
    return dx >= 0 ? "right" : "left";
  }
  return dz <= 0 ? "up" : "down";
}

function walkFrameIndex(anims, direction, frameIndex, walking) {
  const frames = anims[direction];
  if (!walking) {
    return 0;
  }
  if (direction === "down" || direction === "up") {
    const walkFrames = frames.length - 1;
    return 1 + (frameIndex % Math.max(1, walkFrames));
  }
  return frameIndex % frames.length;
}

function applySpriteFrame(mesh, direction, frameIndex, walking) {
  const state = mesh.userData.spriteState;
  if (!state) {
    return;
  }
  const { anims, maxW, maxH, texelScale, verticalIdleOnly } = state;
  let dir = direction;
  let isWalking = walking;
  // Temmie hive walk (up/down) is the bouncy pink shop animation — keep idle instead.
  if (verticalIdleOnly && (direction === "up" || direction === "down")) {
    dir = "down";
    isWalking = false;
  }
  const frames = anims[dir] ?? anims.down;
  const idx = walkFrameIndex(anims, dir, frameIndex, isWalking);
  const key = `${dir}:${idx}`;
  if (state.key === key) {
    return;
  }
  state.key = key;

  const tex = frames[idx];
  if (!tex?.image?.width) {
    return;
  }
  mesh.material.map = tex;
  mesh.material.map.needsUpdate = true;

  const [fullW, fullH] = spriteWorldSize(maxW, maxH, texelScale);
  const [frameW, frameH] = spriteWorldSize(tex.image.width, tex.image.height, texelScale);
  mesh.scale.set(frameW / fullW, frameH / fullH, 1);
}

function makeAnimatedSprite(anims, maxW, maxH, texelScale, options = {}) {
  const [ww, wh] = spriteWorldSize(maxW, maxH, texelScale);
  const mesh = makeFlatSprite(anims.down[0], ww, wh);
  mesh.userData.spriteState = {
    anims,
    maxW,
    maxH,
    texelScale,
    key: "",
    verticalIdleOnly: options.verticalIdleOnly ?? false,
  };
  mesh.scale.set(1, 1, 1);
  return mesh;
}

function setSpriteIdle(mesh) {
  if (mesh.userData.spriteState) {
    mesh.userData.spriteState.key = "";
  }
  applySpriteFrame(mesh, "down", 0, false);
}

function stateToWorldXZ(sx, sy) {
  return [sx, 1 - sy];
}

function worldPos(sx, sy) {
  const [wx, wz] = stateToWorldXZ(sx, sy);
  return new THREE.Vector3(wx, 0, wz);
}

function uvToWorldXZ(nx, ny) {
  return [
    VIEW_CENTER + (nx - 0.5) * WORLD,
    VIEW_CENTER + (ny - 0.5) * WORLD,
  ];
}

function inArena(wx, wz) {
  return wx >= 0 && wx <= ARENA && wz >= 0 && wz <= ARENA;
}

function makeOutlinedTexture(w, h, painter, outlineColor = OUTLINE) {
  const grid = new Array(w * h).fill("");
  const set = (x, y, color) => {
    if (x >= 0 && x < w && y >= 0 && y < h && color) {
      grid[y * w + x] = color;
    }
  };
  painter(set);

  const outlineMask = new Array(w * h).fill(false);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x]) {
        continue;
      }
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || !grid[ny * w + nx]) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && !grid[ny * w + nx]) {
            outlineMask[ny * w + nx] = true;
          }
        }
      }
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < outlineMask.length; i++) {
    if (outlineMask[i]) {
      ctx.fillStyle = outlineColor;
      ctx.fillRect(i % w, (i / w) | 0, 1, 1);
    }
  }
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) {
      ctx.fillStyle = grid[i];
      ctx.fillRect(i % w, (i / w) | 0, 1, 1);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const P1_SIGN = "#d84848";
const P1_SIGN_ACCENT = "#902838";
const P2_SIGN = "#48b0d0";
const P2_SIGN_ACCENT = "#d040a0";

function drawThinSign(set, board, accent) {
  const post = "#503828";
  for (let y = 0; y <= 4; y++) {
    set(2, y, board);
    set(3, y, board);
  }
  set(2, 1, accent);
  set(3, 1, accent);
  set(2, 3, accent);
  set(3, 3, accent);
  for (let y = 5; y <= 10; y++) {
    set(3, y, post);
  }
}

function nudgeHex(hex, delta) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + delta);
  const g = clamp(((n >> 8) & 255) + delta);
  const b = clamp((n & 255) + delta);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function splotchDelta(px, py, salt) {
  const size = 160;
  const count = 22;
  for (let i = 0; i < count; i++) {
    const h = (i * 1597334677 + salt * 1013904223) >>> 0;
    const cx = h % size;
    const cy = ((h / size) | 0) % size;
    const r = 5 + ((h >> 10) % 10);
    const dx = px - cx;
    const dy = py - cy;
    const wobble = ((px * 37 + py * 23 + i * 19 + salt) & 15) - 7;
    const limit = (r + wobble) * (r + wobble);
    if (dx * dx + dy * dy <= limit) {
      return (h & 1) ? 5 : -5;
    }
  }
  return 0;
}

function groundShade(base, px, py) {
  if (base === EDGE) {
    return EDGE;
  }
  const salt = base === PATH ? 2 : 3;
  const delta = splotchDelta(px, py, salt);
  return delta === 0 ? base : nudgeHex(base, delta);
}

function buildSnowdinTexture() {
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const ground = new Array(size * size).fill(OUTSIDE);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const [wx, wz] = uvToWorldXZ((px + 0.5) / size, (py + 0.5) / size);
      if (inArena(wx, wz)) {
        ground[py * size + px] = PATH;
      }
    }
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const [wx, wz] = uvToWorldXZ((px + 0.5) / size, (py + 0.5) / size);
      const here = inArena(wx, wz);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
          continue;
        }
        const [nwx, nwz] = uvToWorldXZ((nx + 0.5) / size, (ny + 0.5) / size);
        if (inArena(nwx, nwz) !== here) {
          ground[py * size + px] = EDGE;
          break;
        }
      }
    }
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      ctx.fillStyle = groundShade(ground[py * size + px], px, py);
      ctx.fillRect(px, py, 1, 1);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function snapWorldPos(pos, drawW, drawH, halfView) {
  if (!drawW || !drawH) {
    return pos;
  }
  const aspect = drawW / drawH;
  let left;
  let right;
  let top;
  let bottom;
  if (aspect >= 1) {
    top = halfView;
    bottom = -halfView;
    left = -halfView * aspect;
    right = halfView * aspect;
  } else {
    left = -halfView;
    right = halfView;
    top = halfView / aspect;
    bottom = -halfView / aspect;
  }

  const worldW = right - left;
  const worldH = top - bottom;
  const sx = Math.round(((pos.x - left) / worldW) * drawW);
  const sy = Math.round(((top - pos.z) / worldH) * drawH);
  pos.x = left + (sx / drawW) * worldW;
  pos.z = top - (sy / drawH) * worldH;
  return pos;
}

function makeFlatSprite(texture, width, height, renderOrder = 10) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.5,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = renderOrder;
  return mesh;
}

export class DogPixelRenderer {
  constructor(container, options = {}) {
    this.container = container;
    this.house1 = options.house1 ?? DEFAULT_HOUSE1;
    this.house2 = options.house2 ?? DEFAULT_HOUSE2;
    this.trailGroup = new THREE.Group();
    this.trailGroup.renderOrder = 0;
    this.playToken = 0;
    this.renderLoopId = null;
    this.halfView = (ARENA / 2) * VIEW_PADDING;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(OUTSIDE);

    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.set(VIEW_CENTER, 5, VIEW_CENTER);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(VIEW_CENTER, 0, VIEW_CENTER);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    requestAnimationFrame(() => this.resize());
    this.ready = this._buildScene().then(() => this._startRenderLoop());
  }

  async _buildScene() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.MeshBasicMaterial({ map: buildSnowdinTexture() }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(VIEW_CENTER, 0, VIEW_CENTER);
    this.scene.add(ground);

    const [friskP1, friskP2, temmieAnims] = await Promise.all([
      loadSpriteAnims(FRISK_P1_ANIMS),
      loadSpriteAnims(FRISK_P2_ANIMS),
      loadSpriteAnims(TEMMIE_ANIMS),
    ]);
    initAllTextures(this.renderer, [friskP1, friskP2, temmieAnims]);

    this.player1 = makeAnimatedSprite(friskP1, ...FRISK_MAX, SPRITE_TEXEL_SCALE);
    this.player2 = makeAnimatedSprite(friskP2, ...FRISK_MAX, SPRITE_TEXEL_SCALE);
    this.dog = makeAnimatedSprite(temmieAnims, ...TEMMIE_MAX, SPRITE_TEXEL_SCALE, {
      verticalIdleOnly: true,
    });
    this.marker1 = makeFlatSprite(
      makeOutlinedTexture(6, 11, (set) => drawThinSign(set, P1_SIGN, P1_SIGN_ACCENT)),
      0.028,
      0.052,
    );
    this.marker2 = makeFlatSprite(
      makeOutlinedTexture(6, 11, (set) => drawThinSign(set, P2_SIGN, P2_SIGN_ACCENT)),
      0.028,
      0.052,
    );

    for (const actor of [this.player1, this.player2, this.dog, this.marker1, this.marker2]) {
      actor.position.y = 0.03;
      actor.renderOrder = 10;
      this.scene.add(actor);
    }

    setSpriteIdle(this.player1);
    setSpriteIdle(this.player2);
    setSpriteIdle(this.dog);

    const [t1x, t1z] = stateToWorldXZ(this.house1[0], this.house1[1]);
    const [t2x, t2z] = stateToWorldXZ(this.house2[0], this.house2[1]);
    this.marker1.position.set(t1x, 0.02, t1z);
    this.marker2.position.set(t2x, 0.02, t2z);

    this.scene.add(this.trailGroup);
  }

  _actorPositions(state) {
    return {
      p1: worldPos(state[0], state[1]),
      p2: worldPos(state[2], state[3]),
      dog: worldPos(...dogPosition(state)),
    };
  }

  _snapActor(pos) {
    const canvas = this.renderer.domElement;
    return snapWorldPos(pos, canvas.width, canvas.height, this.halfView);
  }

  setActors(state) {
    const { p1, p2, dog } = this._actorPositions(state);
    this._snapActor(p1);
    this._snapActor(p2);
    this._snapActor(dog);
    this.player1.position.set(p1.x, 0.03, p1.z);
    this.player2.position.set(p2.x, 0.03, p2.z);
    this.dog.position.set(dog.x, 0.03, dog.z);
    setSpriteIdle(this.player1);
    setSpriteIdle(this.player2);
    setSpriteIdle(this.dog);
  }

  clearTrail() {
    while (this.trailGroup.children.length) {
      const child = this.trailGroup.children.pop();
      child.material?.dispose();
    }
  }

  drawTrail(traj) {
    this.clearTrail();
    if (!this._trailDotGeo) {
      this._trailDotGeo = new THREE.PlaneGeometry(0.01, 0.01);
    }
    for (let i = 0; i < traj.length - 1; i++) {
      const s = traj[i];
      const sn = traj[i + 1];
      const dog0 = dogPosition(s);
      const dog1 = dogPosition(sn);
      this._addTrailDots(worldPos(s[0], s[1]), worldPos(sn[0], sn[1]), P1_TRAIL);
      this._addTrailDots(worldPos(s[2], s[3]), worldPos(sn[2], sn[3]), P2_TRAIL);
      this._addTrailDots(worldPos(dog0[0], dog0[1]), worldPos(dog1[0], dog1[1]), DOG_TRAIL);
    }
  }

  _addTrailDots(from, to, color) {
    const len = from.distanceTo(to);
    if (len < 1e-5) {
      return;
    }
    const steps = Math.max(2, Math.ceil(len / 0.035));
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    for (let i = 1; i <= steps; i++) {
      const dot = new THREE.Mesh(this._trailDotGeo, mat);
      dot.rotation.x = -Math.PI / 2;
      dot.renderOrder = 0;
      dot.position.lerpVectors(from, to, i / steps);
      dot.position.y = 0.01;
      this.trailGroup.add(dot);
    }
  }

  stopPlayback() {
    this.playToken += 1;
  }

  async _animateSegment(fromState, toState, stepMs) {
    const token = this.playToken;
    const start = this._actorPositions(fromState);
    const end = this._actorPositions(toState);
    snapWorldPos(start.p1, this.renderer.domElement.width, this.renderer.domElement.height, this.halfView);
    snapWorldPos(start.p2, this.renderer.domElement.width, this.renderer.domElement.height, this.halfView);
    snapWorldPos(start.dog, this.renderer.domElement.width, this.renderer.domElement.height, this.halfView);
    snapWorldPos(end.p1, this.renderer.domElement.width, this.renderer.domElement.height, this.halfView);
    snapWorldPos(end.p2, this.renderer.domElement.width, this.renderer.domElement.height, this.halfView);
    snapWorldPos(end.dog, this.renderer.domElement.width, this.renderer.domElement.height, this.halfView);

    const p1Dir = movementDirection(start.p1, end.p1);
    const p2Dir = movementDirection(start.p2, end.p2);
    const dogDir = movementDirection(start.dog, end.dog);
    const p1Walk = Math.hypot(end.p1.x - start.p1.x, end.p1.z - start.p1.z) > 1e-6;
    const p2Walk = Math.hypot(end.p2.x - start.p2.x, end.p2.z - start.p2.z) > 1e-6;
    const dogWalk = Math.hypot(end.dog.x - start.dog.x, end.dog.z - start.dog.z) > 1e-6;
    if (!p1Walk) {
      setSpriteIdle(this.player1);
    }
    if (!p2Walk) {
      setSpriteIdle(this.player2);
    }
    if (!dogWalk) {
      setSpriteIdle(this.dog);
    }

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
        this._snapActor(this.player1.position);
        this._snapActor(this.player2.position);
        this._snapActor(this.dog.position);
        this.player1.position.y = 0.03;
        this.player2.position.y = 0.03;
        this.dog.position.y = 0.03;

        const friskFrame = Math.floor((now - t0) / FRISK_FRAME_MS);
        const temmieFrame = Math.floor((now - t0) / TEMMIE_FRAME_MS);
        if (p1Walk) {
          applySpriteFrame(this.player1, p1Dir, friskFrame, true);
        }
        if (p2Walk) {
          applySpriteFrame(this.player2, p2Dir, friskFrame, true);
        }
        if (dogWalk) {
          applySpriteFrame(this.dog, dogDir, temmieFrame, true);
        }

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async playTrajectory(traj, stepMs = 400) {
    const token = ++this.playToken;
    this.drawTrail(traj);
    this.setActors(traj[0]);
    for (let i = 0; i < traj.length - 1; i++) {
      if (token !== this.playToken) {
        return;
      }
      await this._animateSegment(traj[i], traj[i + 1], stepMs);
    }
    if (token === this.playToken) {
      this.setActors(traj[traj.length - 1]);
    }
  }

  _updateCamera(aspect) {
    const half = this.halfView;
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
    const base = INTERNAL_DRAW_TARGET;
    let drawW;
    let drawH;
    if (w >= h) {
      drawW = base;
      drawH = Math.max(1, Math.round(base * h / w));
    } else {
      drawH = base;
      drawW = Math.max(1, Math.round(base * w / h));
    }
    this.renderer.setSize(drawW, drawH, false);
    const canvas = this.renderer.domElement;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  _startRenderLoop() {
    const loop = () => {
      this.renderer.render(this.scene, this.camera);
      this.renderLoopId = requestAnimationFrame(loop);
    };
    loop();
  }

  dispose() {
    this.stopPlayback();
    if (this.renderLoopId !== null) {
      cancelAnimationFrame(this.renderLoopId);
    }
    window.removeEventListener("resize", this._onResize);
    this._resizeObserver?.disconnect();
    this.clearTrail();
    this._trailDotGeo?.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

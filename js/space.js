/**
 * WebGL 星空背景：Three.js 分层星点 + 星云 + 流星 + UnrealBloom 泛光。
 * 只负责背景，星图本身仍由 force-graph 的 2D canvas 绘制、叠加在上层。
 */
import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/examples/jsm/postprocessing/OutputPass.js';
import { reduceMotion, isMobile } from './util.js';

const BG_COLOR = 0x000000;
const STAR_COUNT = isMobile ? 900 : 2200;
const METEOR_COUNT = 3;
const FRAME_INTERVAL = 1000 / 30;

let renderer = null;
let scene = null;
let camera = null;
let composer = null;
let starMaterial = null;
let meteors = [];
let rafId = 0;
let running = false;
let elapsed = 0;
let lastFrame = 0;
let camOffset = { x: 0, y: 0 };
let pointerTarget = { x: 0, y: 0 };
let nextMeteorAt = 2.5;

/* ============ 纹理（程序生成，避免额外资源） ============ */
function streakTexture() {
  const w = 256;
  const h = 32;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.72, 'rgba(210,230,255,0.55)');
  grad.addColorStop(0.94, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ============ 星点 ============ */
function buildStars() {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const phases = new Float32Array(STAR_COUNT);
  const speeds = new Float32Array(STAR_COUNT);
  const color = new THREE.Color();

  for (let i = 0; i < STAR_COUNT; i++) {
    const spreadX = 2600;
    const spreadY = 1500;
    positions[i * 3] = (Math.random() - 0.5) * spreadX;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spreadY;
    positions[i * 3 + 2] = -1400 + Math.random() * 1150;

    const warm = Math.random() < 0.12;
    const roll = Math.random();
    color.setHex(warm ? 0xffe0b8 : 0xdfeaff);
    if (Math.random() < 0.18) color.lerp(new THREE.Color(0x9dc7ff), 0.45);
    const factor = roll < 0.07 ? 1 : 0.6 + Math.random() * 0.3;
    colors[i * 3] = color.r * factor;
    colors[i * 3 + 1] = color.g * factor;
    colors[i * 3 + 2] = color.b * factor;

    // 三档尺寸，少量亮星、部分中等星、多数小星，拉开大小对比更自然
    if (roll < 0.07) sizes[i] = 6 + Math.random() * 5;
    else if (roll < 0.32) sizes[i] = 3 + Math.random() * 2.4;
    else sizes[i] = 1.2 + Math.random() * 1.6;
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.4 + Math.random() * 1.6;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkle: { value: reduceMotion ? 0 : 1 }
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      attribute float aSpeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uTwinkle;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vColor = aColor;
        vTwinkle = mix(0.85, 0.55 + 0.45 * sin(uTime * aSpeed + aPhase), uTwinkle);
        gl_PointSize = aSize * uPixelRatio * (385.0 / -mv.z);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float core = smoothstep(0.5, 0.0, d);
        float halo = pow(core, 4.0);
        float alpha = (core * 0.32 + halo) * vTwinkle;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.75 + halo), alpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geo, starMaterial);
  points.frustumCulled = false;
  scene.add(points);
}

/* ============ 流星 ============ */
function buildMeteors() {
  const tex = streakTexture();
  for (let i = 0; i < METEOR_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xdcecff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.scale.set(150, 2.2, 1);
    scene.add(sprite);
    meteors.push({ sprite, mat, life: 0, duration: 0, active: false });
  }
}

function spawnMeteor() {
  const m = meteors.find(item => !item.active);
  if (!m) return;
  m.active = true;
  m.life = 0;
  m.duration = 0.9 + Math.random() * 0.7;
  const angle = Math.PI * (0.18 + Math.random() * 0.12);
  m.dir = { x: Math.cos(angle), y: -Math.sin(angle) };
  m.start = {
    x: (Math.random() - 0.5) * 2200,
    y: 300 + Math.random() * 380,
    z: -520
  };
  m.sprite.position.set(m.start.x, m.start.y, m.start.z);
  m.sprite.material.rotation = -angle + Math.PI;
  m.sprite.visible = true;
}

function updateMeteors(dt) {
  if (reduceMotion) return;
  nextMeteorAt -= dt;
  if (nextMeteorAt <= 0) {
    spawnMeteor();
    nextMeteorAt = 5 + Math.random() * 8;
  }
  meteors.forEach(m => {
    if (!m.active) return;
    m.life += dt;
    const p = m.life / m.duration;
    if (p >= 1) {
      m.active = false;
      m.sprite.visible = false;
      m.mat.opacity = 0;
      return;
    }
    const dist = p * 1150;
    m.sprite.position.x = m.start.x + m.dir.x * dist;
    m.sprite.position.y = m.start.y + m.dir.y * dist;
    m.mat.opacity = Math.sin(p * Math.PI) * 0.9;
  });
}

/* ============ 渲染循环 ============ */
function resize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  if (starMaterial) starMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
}

function frame() {
  if (!running) {
    rafId = 0;
    return;
  }
  rafId = requestAnimationFrame(frame);
  const now = performance.now();
  if (now - lastFrame < FRAME_INTERVAL) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  elapsed += dt;

  if (starMaterial) starMaterial.uniforms.uTime.value = elapsed;

  // 鼠标视差（幅度小，避免干扰星图操作）
  camOffset.x += (pointerTarget.x * 42 - camOffset.x) * 0.035;
  camOffset.y += (pointerTarget.y * 26 - camOffset.y) * 0.035;
  camera.position.x = camOffset.x;
  camera.position.y = camOffset.y;
  camera.lookAt(camOffset.x * 0.25, camOffset.y * 0.25, -600);

  updateMeteors(dt);
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

/* ============ 对外接口 ============ */
export function initSpace(canvas) {
  if (!canvas) return false;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    console.warn('WebGL 不可用', err);
    return false;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(BG_COLOR, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 1, 5000);
  camera.position.set(0, 0, 600);

  buildStars();
  buildMeteors();

  // 移动端跳过全屏泛光：多趟模糊是星空层最大的开销，关闭后星星依旧可见
  if (!isMobile) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.85,
      0.75,
      0.62
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', e => {
    pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  running = true;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
  return true;
}

export function setSpaceActive(active) {
  if (!renderer) return;
  if (active === running) return;
  running = active;
  if (active) {
    lastFrame = performance.now();
    if (!rafId) rafId = requestAnimationFrame(frame);
  } else if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

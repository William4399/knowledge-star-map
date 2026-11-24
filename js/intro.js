/**
 * 启动动画：粒子从屏幕四周涌入，在中心汇成双旋臂星旋，收束成应用图标。
 * 结束后由 #boot 内的静态 SVG 图标接管，视觉上无缝衔接。
 */
import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/examples/jsm/postprocessing/OutputPass.js';
import { reduceMotion } from './util.js';

const FLY = 1.5;           // 从四周飞入
const FORM = 1.45;         // 旋臂收紧、停止自转
const HOLD = 0.9;          // 停留
const FADE = 0.5;          // 与原图标交叉淡出
const TOTAL = FLY + FORM + HOLD;

// 拖尾：每个粒子额外渲染 3 个时间滞后的副本，形成流线
const TRAILS = [0, 0.05, 0.1, 0.16];
const TRAIL_SIZE = [1, 0.82, 0.62, 0.44];
const TRAIL_ALPHA = [1, 0.58, 0.34, 0.18];

const TURNS = 0.95;
const R0 = 0.1;
const R1 = 0.94;

function spiralTargets(count, radius) {
  const list = [];
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < count; i++) {
      const u = (i + Math.random() * 0.9) / count;
      const t = Math.pow(u, 0.72);
      const theta = arm * Math.PI + t * TURNS * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
      const r = (R0 + (R1 - R0) * t + (Math.random() - 0.5) * 0.02 * (0.5 + t)) * radius;
      list.push({
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        z: (Math.random() - 0.5) * 10,
        t
      });
    }
  }
  return list;
}

function makeGeometry(width, height, markSize) {
  const small = width * height < 1.6e6;
  const armCount = small ? 900 : 1500;
  const dustCount = small ? 260 : 420;
  const coreCount = small ? 150 : 260;
  const targets = spiralTargets(armCount, markSize * 0.46);

  const base = targets.length + dustCount + coreCount;
  const total = base * TRAILS.length;
  const pos = new Float32Array(total * 3);
  const target = new Float32Array(total * 3);
  const from = new Float32Array(total * 3);
  const delay = new Float32Array(total);
  const size = new Float32Array(total);
  const color = new Float32Array(total * 3);
  const seed = new Float32Array(total);
  const trail = new Float32Array(total);
  const trailSize = new Float32Array(total);
  const trailAlpha = new Float32Array(total);

  const maxR = Math.hypot(width, height) * 0.62;
  const c = new THREE.Color();

  for (let b = 0; b < base; b++) {
    const isCore = b >= targets.length + dustCount;
    const isDust = b >= targets.length && !isCore;
    let tx, ty, tz, tone;
    if (isCore) {
      const a = Math.random() * Math.PI * 2;
      const r = markSize * 0.46 * Math.pow(Math.random(), 1.6) * 0.42;
      tx = Math.cos(a) * r;
      ty = Math.sin(a) * r;
      tz = (Math.random() - 0.5) * 6;
      tone = -1;
    } else if (isDust) {
      const a = Math.random() * Math.PI * 2;
      const r = markSize * (0.5 + Math.random() * 0.75);
      tx = Math.cos(a) * r;
      ty = Math.sin(a) * r;
      tz = (Math.random() - 0.5) * 14;
      tone = 2;
    } else {
      const p = targets[b];
      tx = p.x;
      ty = p.y;
      tz = p.z;
      tone = p.t;
    }

    const a = Math.random() * Math.PI * 2;
    const r = maxR * (0.72 + Math.random() * 0.55);
    const fx = Math.cos(a) * r;
    const fy = Math.sin(a) * r;
    const fz = (Math.random() - 0.5) * 260;

    const d = Math.random() * 0.4;
    const s = isCore ? 2.4 + Math.random() * 1.6
      : isDust ? 1 + Math.random()
        : 1.5 + (1 - tone) * 2.2 + Math.random() * 0.9;

    if (isCore) c.setHex(0xffffff);
    else if (Math.random() < 0.06) c.setHex(0xffc79a);
    else if (tone < 0.3) c.setHex(0xeaf4ff);
    else if (tone < 0.66) c.setHex(0xb0d4ff);
    else c.setHex(0x96c2ff);

    const sd = Math.random() * 6.283;

    for (let k = 0; k < TRAILS.length; k++) {
      const i = b * TRAILS.length + k;
      target[i * 3] = tx;
      target[i * 3 + 1] = ty;
      target[i * 3 + 2] = tz;
      from[i * 3] = fx;
      from[i * 3 + 1] = fy;
      from[i * 3 + 2] = fz;
      delay[i] = d;
      size[i] = s;
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
      seed[i] = sd;
      trail[i] = TRAILS[k];
      trailSize[i] = TRAIL_SIZE[k];
      trailAlpha[i] = TRAIL_ALPHA[k];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aTarget', new THREE.BufferAttribute(target, 3));
  geo.setAttribute('aFrom', new THREE.BufferAttribute(from, 3));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aTrail', new THREE.BufferAttribute(trail, 1));
  geo.setAttribute('aTrailSize', new THREE.BufferAttribute(trailSize, 1));
  geo.setAttribute('aTrailAlpha', new THREE.BufferAttribute(trailAlpha, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxR * 1.6);
  return geo;
}

const VERT = `
attribute vec3 aTarget;
attribute vec3 aFrom;
attribute float aDelay;
attribute float aSize;
attribute vec3 aColor;
attribute float aSeed;
attribute float aTrail;
attribute float aTrailSize;
attribute float aTrailAlpha;

uniform float uForm;
uniform float uSpin;
uniform float uScale;
uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float span = max(0.001, 1.0 - aDelay);
  // 拖尾副本滞后 aTrail 时间，因而停留在粒子刚才经过的位置
  float p = clamp((uForm - aDelay - aTrail) / span, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - p, 3.0);

  float cs = cos(uSpin);
  float sn = sin(uSpin);
  vec3 tgt = vec3(aTarget.x * cs - aTarget.y * sn, aTarget.x * sn + aTarget.y * cs, aTarget.z) * uScale;

  vec3 pos = mix(aFrom, tgt, e);
  vec2 delta = tgt.xy - aFrom.xy;
  float dist = max(0.001, length(delta));
  vec2 dir = delta / dist;
  float arc = sin(p * 3.1415926) * 0.13 * dist;
  pos.xy += vec2(-dir.y, dir.x) * arc;

  vAlpha = mix(0.35, 1.0, e) * (0.62 + 0.38 * sin(uTime * 2.2 + aSeed * 6.283)) * aTrailAlpha;
  vColor = aColor;
  gl_PointSize = aSize * aTrailSize * uPixelRatio * mix(1.45, 1.0, e);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FRAG = `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
}
`;

/**
 * @param {{host: HTMLElement, emblem: HTMLElement}} opts
 * @returns {Promise<void>} 动画结束（或跳过）后 resolve
 */
export function playIntro({ host, emblem } = {}) {
  if (!host) return Promise.resolve();
  const finishStage = () => {
    host.classList.add('stage-on');
    host.classList.remove('intro-armed');
  };
  if (reduceMotion) {
    finishStage();
    return Promise.resolve();
  }

  const rect = emblem ? emblem.getBoundingClientRect() : null;
  const markSize = rect && rect.width ? rect.width : 104;
  const center = rect && rect.width
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('webgl unavailable');
  } catch (err) {
    if (renderer) renderer.dispose();
    finishStage();
    return Promise.resolve();
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);

  const canvas = renderer.domElement;
  canvas.className = 'boot-intro-canvas';
  host.classList.add('intro-armed');
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -400, 400);
  camera.position.set(0, 0, 300);
  camera.lookAt(0, 0, 0);

  const geometry = makeGeometry(width, height, markSize);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uForm: { value: 0 },
      uSpin: { value: 2.9 },
      uScale: { value: 2.4 },
      uTime: { value: 0 },
      uPixelRatio: { value: dpr },
      uOpacity: { value: 1 }
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // 世界原点对齐到图标中心（屏幕坐标 y 向下，世界 y 向上）
  points.position.set(center.x - width / 2, height / 2 - center.y, 0);
  scene.add(points);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.9, 0.62, 0.08);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const ease = v => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
  const start = performance.now();
  let raf = 0;
  let done = false;
  let cleanupTimer = 0;

  function beginFade() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    material.uniforms.uForm.value = 1;
    material.uniforms.uSpin.value = 0;
    composer.render();
    canvas.classList.add('is-out');
    finishStage();
    cleanupTimer = window.setTimeout(cleanup, FADE * 1000);
  }

  function cleanup() {
    window.clearTimeout(cleanupTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointerdown', onSkip, true);
    window.removeEventListener('keydown', onSkip, true);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    geometry.dispose();
    material.dispose();
    composer.dispose();
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
  }

  function onSkip() {
    beginFade();
  }

  function onResize() {
    /* 启动动画时长很短，忽略窗口尺寸变化 */
  }

  window.addEventListener('pointerdown', onSkip, true);
  window.addEventListener('keydown', onSkip, true);

  function frame(now) {
    if (done) return;
    const t = (now - start) / 1000;
    material.uniforms.uTime.value = t;
    material.uniforms.uForm.value = Math.min(1, t / FLY);

    if (t <= FLY) {
      material.uniforms.uSpin.value = 2.9;
      material.uniforms.uScale.value = 2.4 - 0.85 * (t / FLY);
    } else {
      const k = Math.min(1, (t - FLY) / FORM);
      material.uniforms.uSpin.value = 2.9 * (1 - ease(k));
      material.uniforms.uScale.value = 1.55 - 0.55 * ease(k);
    }

    composer.render();

    if (t >= TOTAL) {
      beginFade();
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return new Promise(resolve => {
    const check = () => {
      if (done) resolve();
      else window.setTimeout(check, 60);
    };
    check();
  });
}

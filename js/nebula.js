import * as THREE from 'three';

/* 程序化星云：全屏 shader，任意分辨率不糊，可缓慢流动 */
const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uRes;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

/* 星云内闪电：短暂、局部、被云层遮挡的柔和脉冲 */
float bolt(vec2 uv, vec2 c, float rx, float ry, float period, float offset, float t) {
  float phase = fract(t / period + offset);
  float env = smoothstep(0.01, 0.035, phase) * (1.0 - smoothstep(0.05, 0.14, phase));
  vec2 q = (uv - c) / vec2(rx, ry);
  float d = dot(q, q);
  float shape = exp(-d * 2.4) + 0.38 * exp(-d * 0.9);
  return env * shape;
}

void main() {
  vec2 uv = vUv;
  // 按屏幕宽高比修正采样：横向固定 3.0 个单位，纵向随宽高比换算。
  // 这样横屏时与原效果完全一致，竖屏(手机)时星云不会被横向压扁。
  float aspect = max(uRes.x / max(uRes.y, 1.0), 0.0001);
  vec2 p = uv * vec2(3.0, 3.0 / aspect);
  float t = uTime * 0.015;

  float warp = fbm(p * 0.65 + vec2(t, -t * 0.7));
  float clouds = fbm(p * 1.15 + warp * 1.8 + vec2(-t * 1.2, t * 0.9));
  float fine = fbm(p * 3.4 - warp * 1.3 + vec2(t * 1.8, 0.0));
  float dust = smoothstep(0.44, 0.9, clouds * 0.72 + fine * 0.36);

  vec3 col = vec3(0.010, 0.013, 0.028);

  // 左侧冷色星云（左强右弱）
  float coolMask = smoothstep(0.72, 0.05, uv.x);
  float cool = smoothstep(0.34, 0.88, fbm(p * 0.85 + 7.0 + vec2(t * 0.4, 0.0)));
  col += vec3(0.07, 0.22, 0.36) * cool * coolMask * 1.0;
  col += vec3(0.10, 0.30, 0.34) * pow(cool, 3.0) * coolMask * 0.9;

  // 左下蓝紫云气
  float violet = smoothstep(0.38, 0.9, fbm(p * 1.25 + 21.0));
  col += vec3(0.16, 0.10, 0.34) * violet * smoothstep(0.8, 0.05, uv.x) * 0.55;

  // 右侧红色星云带
  float band = smoothstep(0.32, 0.96, uv.x + (clouds - 0.5) * 0.55);
  float body = smoothstep(0.4, 0.92, clouds);
  vec3 red = mix(vec3(0.30, 0.05, 0.08), vec3(0.78, 0.24, 0.15), clouds);
  col += red * band * (0.4 + 0.8 * body);
  col += vec3(0.55, 0.2, 0.16) * pow(dust, 2.6) * band * 0.9;

  // 冷色细丝
  col += vec3(0.20, 0.30, 0.46) * pow(fine, 3.0) * 0.4;

  // 脊状亮丝：让星云有纤维感，而不是一团雾
  float ridge = 1.0 - abs(2.0 * fbm(p * 2.4 + warp + vec2(t * 1.4, -t)) - 1.0);
  col += vec3(0.62, 0.26, 0.18) * pow(ridge, 4.0) * band * 1.2;
  col += vec3(0.22, 0.34, 0.46) * pow(ridge, 5.0) * coolMask * 0.8;

  // 左下银河辉光
  float haze = smoothstep(0.55, 1.0, fbm(p * 0.55 + 33.0 + vec2(-t * 0.3, t * 0.4)));
  col += vec3(0.12, 0.18, 0.26) * haze * smoothstep(0.65, 0.05, uv.x) * 0.9;
  col += vec3(0.09, 0.13, 0.20) * smoothstep(0.85, 0.25, distance(uv, vec2(0.16, 0.8))) * 0.8;

  // 暗尘埃带，拉开明暗层次
  col *= 0.72 + 0.5 * smoothstep(0.22, 0.62, clouds);

  // 星云内闪电：像光被云层遮住，只在局部短暂亮起
  float veil = smoothstep(0.15, 0.58, clouds) * (0.5 + 0.5 * body);
  float strike = 0.55 + 0.45 * noise(vec2(uTime * 26.0, 7.0));
  col += vec3(0.55, 0.40, 0.30) * bolt(uv, vec2(0.80, 0.44), 0.30, 0.20, 9.0, 0.12, uTime) * veil * 0.75 * strike;
  col += vec3(0.35, 0.42, 0.55) * bolt(uv, vec2(0.20, 0.30), 0.27, 0.18, 13.0, 0.55, uTime) * veil * 0.6 * strike;
  col += vec3(0.30, 0.36, 0.48) * bolt(uv, vec2(0.32, 0.82), 0.23, 0.16, 11.0, 0.78, uTime) * veil * 0.45 * strike;

  // 中心压暗，保证星图与文字可读
  float d = distance(uv, vec2(0.5, 0.48));
  col *= mix(0.74, 1.0, smoothstep(0.06, 0.7, d));

  // 暗角
  col *= 1.0 - smoothstep(0.55, 0.98, distance(uv, vec2(0.5, 0.5))) * 0.42;

  // 抖动去色带
  float dither = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col + dither, 1.0);
}`;

let renderer = null;
let material = null;
let raf = 0;
let running = false;
let lastFrame = 0;
let time = 0;
const FRAME_INTERVAL = 1000 / 30;

function resize() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  if (material) material.uniforms.uRes.value.set(w, h);
}

function loop(now) {
  if (!running) return;
  raf = requestAnimationFrame(loop);
  if (now - lastFrame < FRAME_INTERVAL) return;
  const delta = Math.min(now - lastFrame || 16, 100);
  lastFrame = now;
  time += delta / 1000;
  material.uniforms.uTime.value = time;
  renderer.render(scene, camera);
}

let scene = null;
let camera = null;

export function initNebulaFx(canvas) {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    resize();
    window.addEventListener('resize', resize);
    return { setNebulaFxActive };
  } catch (err) {
    console.warn('程序化星云初始化失败', err);
    return null;
  }
}

export function setNebulaFxActive(active) {
  if (!renderer) return;
  if (active === running) return;
  running = active;
  if (active) {
    lastFrame = 0;
    raf = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

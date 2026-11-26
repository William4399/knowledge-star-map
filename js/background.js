import { TAU, reduceMotion } from './util.js';

const canvas = document.getElementById('starfield');
const ctx = canvas.getContext('2d');
let bgStars = [];
let running = false;

function build() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;

  const count = Math.round((w * h) / 7200);
  bgStars = [];
  for (let i = 0; i < count; i++) {
    const bright = Math.random() < 0.04;
    bgStars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: bright ? 0.9 + Math.random() * 0.8 : 0.22 + Math.random() * 0.65,
      base: bright ? 0.4 + Math.random() * 0.25 : 0.07 + Math.random() * 0.24,
      phase: Math.random() * TAU,
      speed: 0.3 + Math.random() * 1.2,
      hue: Math.random() < 0.1 ? 'warm' : 'cool',
      bright
    });
  }
}

function draw(t) {
  if (!running) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const time = (t || 0) / 1000;
  for (const s of bgStars) {
    const tw = reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(time * s.speed + s.phase);
    const a = s.base * tw;
    if (s.bright) {
      ctx.shadowColor = 'rgba(200,220,255,0.9)';
      ctx.shadowBlur = 7;
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fillStyle = s.hue === 'warm' ? `rgba(255,228,198,${a})` : `rgba(208,224,255,${a})`;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  requestAnimationFrame(draw);
}

export function setBackgroundActive(active) {
  if (active === running) return;
  running = active;
  if (active) requestAnimationFrame(draw);
}

export function initBackground() {
  build();
  window.addEventListener('resize', build);
  running = true;
  requestAnimationFrame(draw);
}

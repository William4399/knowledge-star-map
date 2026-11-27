import { Data, galaxyOf } from './data.js';
import { isLit, isClaimed } from './store.js';
import { TAU, hexToRgba, clamp01, reduceMotion, nowSec, escapeHtml } from './util.js';

let graph = null;
let container = null;
let hoveredNode = null;
let highlight = new Set();
let initZoom = 0.85;
let handlers = {};
let tipEl = null;
let pointer = { x: 0, y: 0 };
let graphActive = true;
let clamping = false;

function starRadius(node) {
  return 2.6 + node.importance * 1.7;
}
function labelThreshold(node) {
  if (node.core || node.importance >= 5) return 0.74;
  if (node.importance >= 4) return 0.96;
  return 1.16;
}
function nodeLabelAlpha(z, node) {
  return clamp01((z - labelThreshold(node)) / 0.42);
}
function galaxyLabelAlpha(z) {
  return clamp01(1 - (z - 0.85) / 0.5);
}

export function initGraph(el, options = {}) {
  if (typeof ForceGraph === 'undefined') {
    throw new Error('ForceGraph 库未加载');
  }
  container = el;
  handlers = options;

  container.addEventListener('pointermove', e => {
    const rect = container.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    if (hoveredNode) placeTip();
  });
  container.addEventListener('pointerleave', hideTip);

  const nodes = Data.nodes.map(n => {
    const g = Data.galaxyById[n.galaxy];
    const angle = Math.random() * TAU;
    const dist = 16 + Math.random() * 52;
    return {
      ...n,
      x: (g ? g.ax : 0) + Math.cos(angle) * dist,
      y: (g ? g.ay : 0) + Math.sin(angle) * dist,
      phase: Math.random() * TAU,
      tSpeed: 0.5 + Math.random() * 1.3
    };
  });

  graph = ForceGraph()(container)
    .graphData({
      nodes,
      links: Data.edges.map((e, i) => ({
        source: e.from,
        target: e.to,
        type: e.type,
        weight: e.weight,
        seed: (i * 137.5) % 180,
        speed: 0.6 + Math.random() * 1.1
      }))
    })
    .nodeId('id')
    .nodeVal(n => n.importance)
    .linkColor(() => 'transparent')
    .backgroundColor('transparent')
    .onNodeClick(n => {
      if (handlers.onSelectNode) handlers.onSelectNode(n.id);
    })
    .onNodeHover(n => {
      hoveredNode = n || null;
      container.style.cursor = n ? 'pointer' : 'grab';
      if (n) showTip(n);
      else hideTip();
    })
    .onBackgroundClick(() => {
      if (handlers.onBackgroundClick) handlers.onBackgroundClick();
    })
    // 力导向引擎约 15 秒后冷却停转，库默认会跳过重绘，导致闪烁/流光/关卡脉冲全部静止
    .autoPauseRedraw(false)
    // 限制平移范围，避免把星图拖到空白区域
    .onZoom(handleViewChange);

  // ForceGraph 初始化时会清空容器，浮层必须在其后挂载
  tipEl = document.createElement('div');
  tipEl.className = 'node-tip';
  tipEl.hidden = true;
  container.appendChild(tipEl);

  graph.d3Force('link').distance(l => (l.type === 'prerequisite' ? 72 : 108));
  graph.d3Force('charge').strength(-185);

  // 弱星系引力：同类自然靠拢，但不强行定位
  graph.d3Force('cluster', alpha => {
    graph.graphData().nodes.forEach(n => {
      const g = Data.galaxyById[n.galaxy];
      if (!g || n.x == null) return;
      n.vx += (g.ax - n.x) * alpha * 0.075;
      n.vy += (g.ay - n.y) * alpha * 0.075;
    });
  });

  graph.linkCanvasObject(drawLink);
  graph.nodeCanvasObject(drawStarNode);
  graph.nodePointerAreaPaint(drawPointerArea);
  graph.onRenderFramePre(drawNebulae);

  resize();

  // 缩放极限：刚好能看全所有星星，放大到 3.2 倍
  const EXTENT = 780;
  const fit = Math.min(container.clientWidth / (2 * EXTENT), container.clientHeight / (2 * EXTENT));
  const minZ = Math.max(0.35, fit * 0.98);
  initZoom = Math.min(0.95, Math.max(minZ * 1.1, 0.62));
  graph.minZoom(minZ).maxZoom(3.2);

  graph.centerAt(0, 0, 0);
  graph.zoom(initZoom, 0);
  if (moveListener) moveListener({ cx: 0, cy: 0, k: initZoom });
}

/* 视角变化（平移/缩放）时通知外部，用于背景视差 */
let moveListener = null;

export function onGraphMove(fn) {
  moveListener = fn;
}

function handleViewChange(t) {
  clampPan();
  if (!moveListener || !graph) return;
  const c = graph.centerAt();
  if (!c) return;
  const k = t && typeof t.k === 'number' && t.k > 0 ? t.k : graph.zoom();
  moveListener({ cx: c.x, cy: c.y, k });
}

export function resize() {
  if (!graph || !container) return;
  graph.width(container.clientWidth);
  graph.height(container.clientHeight);
}

/* 平移边界：视野中心限制在节点包围盒 + 少量余量内，避免拖到空白区域 */
function clampPan() {
  if (!graph || clamping || !container) return;
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (!W || !H) return;

  const nodes = graph.graphData().nodes;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    if (n.x == null || n.y == null) return;
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });
  if (minX > maxX) return;

  const margin = 30;
  const c = graph.centerAt();
  if (!c) return;
  const nx = Math.max(minX - margin, Math.min(maxX + margin, c.x));
  const ny = Math.max(minY - margin, Math.min(maxY + margin, c.y));
  if (nx === c.x && ny === c.y) return;

  clamping = true;
  graph.centerAt(nx, ny, 0);
  clamping = false;
}

export function resetView() {
  if (graph) {
    graph.centerAt(0, 0, 600);
    graph.zoom(initZoom, 600);
  }
}

export function focusNode(id) {
  if (!graph) return;
  const node = graph.graphData().nodes.find(n => n.id === id);
  if (!node || node.x == null) return;
  graph.centerAt(node.x, node.y, 700);
  graph.zoom(Math.max(graph.zoom(), 1.7), 700);
}

export function setHighlight(ids) {
  highlight = new Set(ids || []);
}

/* 离开星图或页面隐藏时暂停渲染，回来再恢复 */
export function setGraphActive(active) {
  if (!graph || active === graphActive) return;
  graphActive = active;
  if (active) {
    resize();
    graph.resumeAnimation();
  } else {
    hideTip();
    hoveredNode = null;
    graph.pauseAnimation();
  }
}

function showTip(node) {
  if (!tipEl) return;
  const g = galaxyOf(node);
  const lit = isLit(node.id);
  const claimed = isClaimed(node.id);
  const status = lit ? '已点亮' : claimed ? '待验证' : '未点亮';
  tipEl.innerHTML = `
    <b>${escapeHtml(node.name)}</b>
    <span class="tip-meta"><i style="background:${g ? g.color : '#9dc7ff'}"></i>${escapeHtml(g ? g.name : '未分类')}<em class="${lit ? 'lit' : claimed ? 'claimed' : ''}">${status}</em></span>
    <span class="tip-hint">重要度 ${node.importance}/5 · 点击查看详情</span>`;
  tipEl.hidden = false;
  placeTip();
}

function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

function placeTip() {
  if (!tipEl || !hoveredNode) return;
  const W = container.clientWidth;
  const H = container.clientHeight;
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let x = pointer.x + 16;
  let y = pointer.y + 18;
  if (x + w > W - 10) x = pointer.x - w - 16;
  if (y + h > H - 10) y = pointer.y - h - 14;
  tipEl.style.transform = `translate(${Math.max(10, x)}px, ${Math.max(10, y)}px)`;
}

export function getHighlight() {
  return [...highlight];
}

/* ============ 辉光精灵缓存：每帧直接贴图，避免反复创建径向渐变 ============ */
/* 预渲染的径向渐变与每帧 createRadialGradient 的像素结果一致，仅做 alpha 整体缩放 */
const spriteCache = new Map();

function glowSprite(color, stops) {
  const key = color + '|' + stops.map(s => s.join(':')).join(',');
  let c = spriteCache.get(key);
  if (!c) {
    const S = 128;
    c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    stops.forEach(([o, a]) => g.addColorStop(o, hexToRgba(color, a)));
    x.fillStyle = g;
    x.beginPath();
    x.arc(S / 2, S / 2, S / 2, 0, TAU);
    x.fill();
    spriteCache.set(key, c);
  }
  return c;
}

/* ============ 星云（替代虚线圆圈） ============ */
function drawNebulae(ctx, globalScale) {
  if (!graph) return;
  const groups = {};
  graph.graphData().nodes.forEach(n => {
    if (n.x == null || !n.galaxy) return;
    (groups[n.galaxy] = groups[n.galaxy] || []).push(n);
  });

  const labelAlpha = galaxyLabelAlpha(globalScale);
  ctx.globalCompositeOperation = 'lighter';

  Object.keys(groups).forEach(gid => {
    const g = Data.galaxyById[gid];
    if (!g) return;
    const ns = groups[gid];
    let cx = 0, cy = 0;
    ns.forEach(n => { cx += n.x; cy += n.y; });
    cx /= ns.length;
    cy /= ns.length;

    let spread = 0;
    ns.forEach(n => { spread = Math.max(spread, Math.hypot(n.x - cx, n.y - cy)); });
    const R = Math.min(spread + 105, 230);

    ctx.drawImage(
      glowSprite(g.color, [[0, 0.085], [0.45, 0.045], [1, 0]]),
      cx - R, cy - R, R * 2, R * 2
    );
  });

  ctx.globalCompositeOperation = 'source-over';

  // 星系名（缩小时显现，无边框）
  if (labelAlpha > 0.02) {
    Object.keys(groups).forEach(gid => {
      const g = Data.galaxyById[gid];
      if (!g) return;
      const ns = groups[gid];
      let cx = 0, cy = 0, spread = 0;
      ns.forEach(n => { cx += n.x; cy += n.y; });
      cx /= ns.length;
      cy /= ns.length;
      ns.forEach(n => { spread = Math.max(spread, Math.hypot(n.x - cx, n.y - cy)); });
      const R = Math.min(spread + 105, 230);
      drawGalaxyTitle(ctx, g, cx, cy, R, globalScale, labelAlpha, hash01(gid));
    });
    ctx.globalAlpha = 1;
  }
}

/* ============ 星系名：正文观感 + 流萤 + 规线 ============ */
const TITLE_CJK_STACK = '"Noto Sans SC Local", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// 流萤：标题四周极淡的漂浮光点，只添气氛，不压字
function drawTitleMotes(ctx, g, x, y, w, h, scale, alpha, seed) {
  const t = nowSec();
  const drift = reduceMotion ? 0 : 0.4;
  for (let i = 0; i < 4; i++) {
    const a = seed * TAU + i * 1.73;
    const px = x + Math.sin(t * drift + a) * (w * 0.5);
    const py = y + Math.cos(t * drift * 0.78 + a * 1.31) * (h * 0.8);
    const twinkle = reduceMotion ? 0.18 : 0.18 + 0.14 * Math.sin(t * 1.25 + a * 2.1);
    const r = (1 + (i % 3) * 0.35) / scale;
    ctx.fillStyle = g.color;
    ctx.globalAlpha = Math.max(0, alpha * twinkle * 0.26);
    ctx.beginPath();
    ctx.arc(px, py, r * 3.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = Math.max(0, alpha * twinkle);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();
  }
}

function drawGalaxyTitle(ctx, g, cx, cy, R, scale, alpha, seed) {
  const t = nowSec();
  const supported = 'letterSpacing' in ctx;
  const size = 14 / scale;
  const track = supported ? size * 0.06 : 0;
  const off = g.labelOff || [0, -0.72];
  const x = cx + R * off[0];
  const y = cy + R * off[1];
  const breathe = reduceMotion ? 1 : 1 - 0.06 * (0.5 + 0.5 * Math.sin(t * 0.6 + seed * TAU));

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${size}px ${TITLE_CJK_STACK}`;
  if (supported) ctx.letterSpacing = `${track}px`;
  const w = ctx.measureText(g.name).width - track;
  const yRule = y + size * 0.34 + 5.5 / scale;

  // 流萤先画，避免盖在字上
  drawTitleMotes(ctx, g, x, (y + yRule) / 2, w + 26 / scale, size + 14 / scale, scale, alpha, seed);

  ctx.globalAlpha = alpha * 0.9 * breathe;
  ctx.fillStyle = hexToRgba(g.color, 0.95);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 7 / scale;
  ctx.fillText(g.name, x - w / 2, y);
  ctx.shadowBlur = 0;
  if (supported) ctx.letterSpacing = '0px';

  // 规线：1px，两端渐隐，长度随标题宽度
  const half = w / 2 + 6 / scale;
  const grad = ctx.createLinearGradient(x - half, 0, x + half, 0);
  grad.addColorStop(0, hexToRgba(g.color, 0));
  grad.addColorStop(0.5, hexToRgba(g.color, alpha * 0.5));
  grad.addColorStop(1, hexToRgba(g.color, 0));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.moveTo(x - half, yRule);
  ctx.lineTo(x + half, yRule);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* ============ 星星（柔光 + 弧光 + 星核） ============ */
const UNLIT_COLOR = '#74839b';

function drawStarNode(node, ctx, globalScale) {
  const r = starRadius(node);
  const g = galaxyOf(node);
  const galaxyColor = g ? g.color : '#9dc7ff';
  const lit = isLit(node.id);
  const claimed = isClaimed(node.id);
  const recommended = highlight.has(node.id) && !lit;
  const unlit = !lit && !claimed;

  const t = nowSec();
  const hovered = hoveredNode && hoveredNode.id === node.id;

  // 未点亮：灰色微光，缓慢呼吸；已点亮为有色强光
  let drawColor, intensity, twinkle;
  if (unlit) {
    drawColor = UNLIT_COLOR;
    twinkle = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.75 + node.phase);
    intensity = (0.3 + 0.22 * twinkle) * (hovered ? 1.5 : 1);
  } else {
    drawColor = galaxyColor;
    twinkle = reduceMotion ? 0.92 : 0.74 + 0.26 * Math.sin(t * node.tSpeed + node.phase);
    const baseIntensity = lit ? 1.15 : claimed ? 0.52 : 0.42;
    intensity = twinkle * baseIntensity * (hovered ? 1.7 : 1);
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 大范围柔光（未点亮时大幅减弱）
  const glowR = r * (hovered ? 7 : unlit ? 3.2 : 5.6);
  ctx.globalAlpha = Math.max(0, intensity);
  ctx.drawImage(
    glowSprite(drawColor, unlit
      ? [[0, 0.18], [0.22, 0.06], [0.55, 0.015], [1, 0]]
      : [[0, 0.62], [0.22, 0.24], [0.55, 0.07], [1, 0]]),
    node.x - glowR, node.y - glowR, glowR * 2, glowR * 2
  );
  ctx.globalAlpha = 1;

  // 弧光：未点亮时不画
  if (!unlit) {
    drawFlare(ctx, node.x, node.y, r * 7.5, 0, drawColor, 0.5 * intensity);
    drawFlare(ctx, node.x, node.y, r * 6.2, Math.PI / 2, drawColor, 0.3 * intensity);
  }

  // 星核：已点亮为实心亮核；待点亮为空心环，避免与已点亮混淆
  ctx.beginPath();
  ctx.arc(node.x, node.y, r * 1.25, 0, TAU);
  ctx.fillStyle = hexToRgba(drawColor, (unlit ? 0.24 : 0.55) * intensity);
  ctx.fill();

  if (claimed && !lit) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 0.62, 0, TAU);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.85);
    ctx.lineWidth = 1.3 / globalScale;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 0.6, 0, TAU);
    if (unlit) {
      ctx.fillStyle = `rgba(190,205,225,${0.16 + 0.3 * twinkle})`;
    } else {
      ctx.fillStyle = `rgba(255,255,255,${(lit ? 0.92 : 0.5) * (0.8 + 0.2 * twinkle)})`;
    }
    ctx.fill();
  }

  // 已点亮：实线星环，强化"已完成"的稳定感
  if (lit) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 1.95, 0, TAU);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.4 * intensity);
    ctx.lineWidth = 0.75 / globalScale;
    ctx.stroke();
  }

  // 待点亮（自评待验证）：虚线细环 + 空心核，与实心已点亮区分
  if (claimed && !lit) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 1.75, 0, TAU);
    ctx.setLineDash([2.4 / globalScale, 3.4 / globalScale]);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.45);
    ctx.lineWidth = 0.9 / globalScale;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 推荐路径：呼吸光圈 + 黄色闪烁边框（游戏化关卡提示）
  if (recommended) {
    const pulse = reduceMotion ? 0.55 : 0.5 + 0.5 * Math.sin(t * 2.2 + node.phase * 2);
    const yellow = '#ffc94a';
    
    // 外圈发光（黄色光晕）
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * (3.2 + pulse * 0.6), 0, TAU);
    ctx.strokeStyle = `rgba(255, 201, 74, ${0.25 + pulse * 0.25})`;
    ctx.lineWidth = (1.5 + pulse * 0.8) / globalScale;
    ctx.stroke();
    
    // 第二层脉动边框（更接近星星）
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * (2.1 + pulse * 0.35), 0, TAU);
    ctx.strokeStyle = `rgba(255, 201, 74, ${0.35 + pulse * 0.45})`;
    ctx.lineWidth = (1.0 + pulse * 0.6) / globalScale;
    ctx.stroke();
    
    // 黄色外圈光晕（lighter 混合，发光感）
    ctx.globalCompositeOperation = 'lighter';
    const haloR = r * (4.5 + pulse * 1.2);
    const halo = ctx.createRadialGradient(node.x, node.y, r * 1.5, node.x, node.y, haloR);
    halo.addColorStop(0, `rgba(255, 201, 74, ${0.2 + pulse * 0.15})`);
    halo.addColorStop(0.5, `rgba(255, 201, 74, ${0.08 + pulse * 0.06})`);
    halo.addColorStop(1, 'rgba(255, 201, 74, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(node.x, node.y, haloR, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    
    // 旋转的角标光环（虚线边框绕着转）
    if (!reduceMotion) {
      const rot = t * 0.6 + node.phase;
      ctx.save();
      ctx.translate(node.x, node.y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.6, 0, TAU);
      ctx.setLineDash([3 / globalScale, 5 / globalScale]);
      ctx.lineDashOffset = -rot * 10;
      ctx.strokeStyle = `rgba(255, 220, 120, ${0.35 + pulse * 0.3})`;
      ctx.lineWidth = 0.8 / globalScale;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // 悬停光圈（hovered 时始终用原星系色提示）
  if (hovered) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 2.4, 0, TAU);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.55);
    ctx.lineWidth = 0.9 / globalScale;
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';

  // 名称：随缩放分级显现，悬停时始终可读
  const labelAlpha = hovered ? 1 : nodeLabelAlpha(globalScale, node);
  if (labelAlpha > 0.02) {
    ctx.globalAlpha = labelAlpha;
    ctx.font = `${(10 + node.importance * 0.8) / globalScale}px "Poppins", -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4 / globalScale;
    ctx.fillStyle = lit ? 'rgba(242,250,255,0.95)' : claimed ? 'rgba(214,228,246,0.82)' : 'rgba(160,175,195,0.65)';
    ctx.fillText(node.name, node.x, node.y + r * 1.9 + 3 / globalScale);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawPointerArea(node, color, ctx) {
  const r = starRadius(node) + 7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, TAU);
  ctx.fill();
}

function drawFlare(ctx, x, y, len, angle, color, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(1, 0.11);
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.drawImage(glowSprite(color, [[0, 1], [0.3, 0.45], [1, 0]]), -len, -len, len * 2, len * 2);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ============ 星线（细线 + 光流） ============ */
function drawLink(link, ctx, globalScale) {
  const s = link.source;
  const t = link.target;
  if (!s || !t || s.x == null || t.x == null) return;

  const tg = galaxyOf(t);
  const color = tg ? tg.color : '#9dc7ff';
  const isPrereq = link.type === 'prerequisite';
  const baseAlpha = isPrereq ? 0.14 : 0.08;
  const flowAlpha = isPrereq ? 0.6 : 0.38;

  // 基底线（加粗一点点）
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(t.x, t.y);
  ctx.strokeStyle = hexToRgba(color, baseAlpha);
  ctx.lineWidth = (isPrereq ? 1.15 : 0.85) / globalScale;
  ctx.stroke();

  if (reduceMotion) return;

  const len = Math.hypot(t.x - s.x, t.y - s.y);
  if (len < 1) return;
  const dash = Math.min(22, len * 0.18);
  const gap = Math.max(55, len * 0.72);
  const period = dash + gap;
  const off = (performance.now() * 0.05 + link.seed) % period;

  // 流光虚线（更粗更亮）
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(t.x, t.y);
  ctx.setLineDash([dash, gap]);
  ctx.lineDashOffset = -off;
  ctx.strokeStyle = hexToRgba(color, flowAlpha);
  ctx.lineWidth = (isPrereq ? 1.45 : 1.05) / globalScale;
  ctx.stroke();
  ctx.setLineDash([]);

  // 流光光点（更大更亮）
  const p = (performance.now() * 0.00012 * link.speed + link.seed / 200) % 1;
  const px = s.x + (t.x - s.x) * p;
  const py = s.y + (t.y - s.y) * p;
  const dotR = isPrereq ? 5.0 : 3.8;
  ctx.drawImage(
    glowSprite(color, isPrereq ? [[0, 1], [0.35, 0.45], [1, 0]] : [[0, 0.8], [0.35, 0.3], [1, 0]]),
    px - dotR, py - dotR, dotR * 2, dotR * 2
  );
}

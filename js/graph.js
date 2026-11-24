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
    });

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
}

export function resize() {
  if (!graph || !container) return;
  graph.width(container.clientWidth);
  graph.height(container.clientHeight);
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

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, hexToRgba(g.color, 0.085));
    grad.addColorStop(0.45, hexToRgba(g.color, 0.045));
    grad.addColorStop(1, hexToRgba(g.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
  });

  ctx.globalCompositeOperation = 'source-over';

  // 星系名（缩小时显现，无边框）
  if (labelAlpha > 0.02) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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

      ctx.globalAlpha = labelAlpha * 0.88;
      ctx.font = `${12 / globalScale}px -apple-system, "PingFang SC", sans-serif`;
      ctx.fillStyle = hexToRgba(g.color, 0.95);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 6 / globalScale;
      ctx.fillText(g.name, cx, cy - R * 0.72);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });
  }
}

/* ============ 星星（柔光 + 弧光 + 星核） ============ */
function drawStarNode(node, ctx, globalScale) {
  const r = starRadius(node);
  const g = galaxyOf(node);
  const galaxyColor = g ? g.color : '#9dc7ff';
  const lit = isLit(node.id);
  const claimed = isClaimed(node.id);
  const recommended = highlight.has(node.id) && !lit;

  const t = nowSec();
  const twinkle = reduceMotion ? 0.92 : 0.74 + 0.26 * Math.sin(t * node.tSpeed + node.phase);
  const hovered = hoveredNode && hoveredNode.id === node.id;
  const baseIntensity = lit ? 1.15 : claimed ? 0.68 : 0.42;
  const intensity = twinkle * baseIntensity * (hovered ? 1.7 : 1);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 大范围柔光
  const glowR = r * (hovered ? 7 : 5.6);
  const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR);
  glow.addColorStop(0, hexToRgba(galaxyColor, 0.62 * intensity));
  glow.addColorStop(0.22, hexToRgba(galaxyColor, 0.24 * intensity));
  glow.addColorStop(0.55, hexToRgba(galaxyColor, 0.07 * intensity));
  glow.addColorStop(1, hexToRgba(galaxyColor, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(node.x, node.y, glowR, 0, TAU);
  ctx.fill();

  // 弧光：两道拉长的光弧
  drawFlare(ctx, node.x, node.y, r * 7.5, 0, galaxyColor, 0.5 * intensity);
  drawFlare(ctx, node.x, node.y, r * 6.2, Math.PI / 2, galaxyColor, 0.3 * intensity);

  // 星核
  ctx.beginPath();
  ctx.arc(node.x, node.y, r * 1.25, 0, TAU);
  ctx.fillStyle = hexToRgba(galaxyColor, 0.55 * intensity);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(node.x, node.y, r * 0.6, 0, TAU);
  ctx.fillStyle = `rgba(255,255,255,${(lit ? 0.92 : claimed ? 0.68 : 0.5) * (0.8 + 0.2 * twinkle)})`;
  ctx.fill();

  // 已点亮：一圈淡色星环
  if (lit) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 1.95, 0, TAU);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.4 * intensity);
    ctx.lineWidth = 0.75 / globalScale;
    ctx.stroke();
  }

  // 自评掌握：待验证的细环
  if (claimed) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 1.55, 0, TAU);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.2);
    ctx.lineWidth = 0.6 / globalScale;
    ctx.stroke();
  }

  // 推荐路径：呼吸光圈
  if (recommended) {
    const pulse = reduceMotion ? 0.55 : 0.5 + 0.5 * Math.sin(t * 1.8 + node.phase);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * (2.5 + pulse * 0.7), 0, TAU);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.22 + pulse * 0.3);
    ctx.lineWidth = 1.1 / globalScale;
    ctx.stroke();
  }

  // 悬停光圈
  if (hovered) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 2.4, 0, TAU);
    ctx.strokeStyle = hexToRgba(galaxyColor, 0.5);
    ctx.lineWidth = 0.9 / globalScale;
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';

  // 名称：随缩放分级显现，悬停时始终可读
  const labelAlpha = hovered ? 1 : nodeLabelAlpha(globalScale, node);
  if (labelAlpha > 0.02) {
    ctx.globalAlpha = labelAlpha;
    ctx.font = `${(10 + node.importance * 0.8) / globalScale}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4 / globalScale;
    ctx.fillStyle = lit ? 'rgba(242,250,255,0.95)' : claimed ? 'rgba(214,228,246,0.82)' : 'rgba(186,200,222,0.7)';
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
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
  g.addColorStop(0, hexToRgba(color, alpha));
  g.addColorStop(0.3, hexToRgba(color, alpha * 0.45));
  g.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, len, 0, TAU);
  ctx.fill();
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
  const baseAlpha = isPrereq ? 0.1 : 0.055;
  const flowAlpha = isPrereq ? 0.42 : 0.24;

  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(t.x, t.y);
  ctx.strokeStyle = hexToRgba(color, baseAlpha);
  ctx.lineWidth = (isPrereq ? 0.85 : 0.6) / globalScale;
  ctx.stroke();

  if (reduceMotion) return;

  const len = Math.hypot(t.x - s.x, t.y - s.y);
  if (len < 1) return;
  const dash = Math.min(16, len * 0.14);
  const gap = Math.max(70, len * 0.85);
  const period = dash + gap;
  const off = (performance.now() * 0.05 + link.seed) % period;

  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(t.x, t.y);
  ctx.setLineDash([dash, gap]);
  ctx.lineDashOffset = -off;
  ctx.strokeStyle = hexToRgba(color, flowAlpha);
  ctx.lineWidth = (isPrereq ? 1.0 : 0.75) / globalScale;
  ctx.stroke();
  ctx.setLineDash([]);

  const p = (performance.now() * 0.0001 * link.speed + link.seed / 200) % 1;
  const px = s.x + (t.x - s.x) * p;
  const py = s.y + (t.y - s.y) * p;
  const dotR = isPrereq ? 3.6 : 2.6;
  const dg = ctx.createRadialGradient(px, py, 0, px, py, dotR);
  dg.addColorStop(0, hexToRgba(color, isPrereq ? 0.9 : 0.55));
  dg.addColorStop(0.35, hexToRgba(color, isPrereq ? 0.32 : 0.18));
  dg.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.arc(px, py, dotR, 0, TAU);
  ctx.fill();
}

import { Data, galaxyMastery } from './data.js';
import { getState } from './store.js';
import { formatDate, trapFocus, toast } from './util.js';
import { titleFor, matchRole } from './profile.js';

const W = 1080;
const H = 1350;
const M = 84;
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawMark(ctx, cx, cy, R) {
  const prevAlpha = ctx.globalAlpha;
  const prevColor = ctx.fillStyle;
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 30; i++) {
      const t = Math.pow((i + 0.5) / 30, 0.72);
      const th = arm * Math.PI + t * 0.95 * Math.PI * 2;
      const r = (0.1 + 0.84 * t) * R;
      ctx.globalAlpha = prevAlpha * (0.45 + 0.55 * (1 - t));
      ctx.fillStyle = t < 0.45 ? '#eaf4ff' : '#a9cdfb';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(th) * r, cy + Math.sin(th) * r, Math.max(0.55, 1.45 - t), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = prevAlpha;
  ctx.fillStyle = prevColor;
}

function drawHeatmap(ctx, x, y, size, gap, cells) {
  const palette = [
    'rgba(255,255,255,0.05)',
    'rgba(108,231,168,0.20)',
    'rgba(108,231,168,0.40)',
    'rgba(108,231,168,0.68)',
    'rgba(108,231,168,0.95)'
  ];
  cells.forEach((count, index) => {
    const col = Math.floor(index / 7);
    const row = index % 7;
    rr(ctx, x + col * (size + gap), y + row * (size + gap), size, size, 3);
    ctx.fillStyle = palette[Math.min(4, count)];
    ctx.fill();
  });
}

function buildData(state) {
  const lit = state.lit;
  const mastery = galaxyMastery(lit);
  const records = Object.values(state.records || {}).filter(r => r && r.best);
  const avgBest = records.length
    ? Math.round(records.reduce((sum, r) => sum + r.best, 0) / records.length)
    : 0;

  /* 学习轨迹：与「我的」页同口径，由首次点亮时间还原每日活跃度 */
  const DAY = 86400000;
  const litEntries = Object.entries(lit)
    .map(([id, v]) => ({ at: Number(v && v.at) || 0 }))
    .filter(item => item.at > 0);
  const dayCount = {};
  litEntries.forEach(item => {
    const d = new Date(item.at);
    d.setHours(0, 0, 0, 0);
    dayCount[d.getTime()] = (dayCount[d.getTime()] || 0) + 1;
  });
  const dayKeys = Object.keys(dayCount).map(Number).sort((a, b) => a - b);
  let bestStreak = 0;
  let run = 0;
  dayKeys.forEach((ts, index) => {
    run = index > 0 && ts - dayKeys[index - 1] === DAY ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7;
  const heatStart = today.getTime() - dow * DAY - 11 * 7 * DAY;
  const cells = Array.from({ length: 84 }, (_, index) => {
    const ts = heatStart + index * DAY;
    return dayCount[ts] || 0;
  });

  return {
    litCount: Object.keys(lit).length,
    total: Data.nodes.length,
    title: titleFor(Object.keys(lit).length),
    role: Data.roleById[state.direction] || Data.roles[0],
    covered: Data.galaxies.filter(g => mastery[g.id] && mastery[g.id].ratio > 0).length,
    topGalaxies: Data.galaxies
      .map(g => ({ name: g.name, color: g.color, ratio: mastery[g.id] ? mastery[g.id].ratio : 0 }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 4),
    matches: Data.roles
      .map(r => ({ role: r, ...matchRole(r, lit) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3),
    coreLit: Data.nodes
      .filter(n => lit[n.id] && n.core)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 8),
    attempts: state.counters.attempts,
    avgBest,
    trace: {
      activeDays: dayKeys.length,
      bestStreak,
      recent7: litEntries.filter(item => item.at >= today.getTime() - 6 * DAY).length,
      cells
    }
  };
}

function draw(canvas, data) {
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#04070f');
  bg.addColorStop(0.55, '#060c18');
  bg.addColorStop(1, '#08111f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  glow(ctx, 170, 190, 460, 'rgba(60,140,255,0.11)');
  glow(ctx, 950, 1080, 520, 'rgba(80,220,150,0.075)');
  glow(ctx, 700, 520, 380, 'rgba(150,110,255,0.05)');

  let seed = 20261123;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.12 + rand() * 0.6;
    ctx.fillStyle = rand() > 0.86 ? '#bcd7ff' : '#ffffff';
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, rand() * 1.5 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 顶部标识与日期
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `500 19px ${FONT}`;
  ctx.fillStyle = 'rgba(160,190,230,0.72)';
  drawMark(ctx, M + 8, 89, 9);
  ctx.fillText('知识星图 · KNOWLEDGE STAR MAP', M + 26, 96);
  ctx.textAlign = 'right';
  ctx.font = `400 17px ${FONT}`;
  ctx.fillStyle = 'rgba(130,150,178,0.75)';
  ctx.fillText(formatDate(Date.now()), W - M, 96);

  // 称号与说明
  ctx.textAlign = 'left';
  ctx.font = `600 52px ${FONT}`;
  ctx.fillStyle = '#eef6ff';
  ctx.fillText(data.title.name, M, 190);
  ctx.font = `400 21px ${FONT}`;
  ctx.fillStyle = 'rgba(160,182,208,0.92)';
  ctx.fillText(data.title.note, M, 231);
  ctx.font = `500 21px ${FONT}`;
  ctx.fillStyle = 'rgba(140,190,255,0.9)';
  ctx.fillText(`目标方向 · ${data.role.name}`, M, 272);

  // 统计卡
  const stats = [
    { label: '已点亮知识点', value: `${data.litCount}/${data.total}` },
    { label: '覆盖星系', value: `${data.covered}/11` },
    { label: '挑战次数', value: String(data.attempts) },
    { label: '平均最好成绩', value: data.avgBest ? String(data.avgBest) : '—' }
  ];
  const cardW = (W - M * 2 - 18 * 3) / 4;
  stats.forEach((stat, i) => {
    const x = M + i * (cardW + 18);
    rr(ctx, x, 300, cardW, 122, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,175,230,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `600 36px ${FONT}`;
    ctx.fillStyle = '#eaf2ff';
    ctx.fillText(stat.value, x + cardW / 2, 362);
    ctx.font = `400 17px ${FONT}`;
    ctx.fillStyle = 'rgba(150,170,196,0.88)';
    ctx.fillText(stat.label, x + cardW / 2, 396);
  });

  // 学习轨迹：近 12 周迷你热力图 + 活跃度
  ctx.textAlign = 'left';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = 'rgba(200,218,240,0.92)';
  ctx.fillText('学习轨迹 · 近 12 周', M, 472);

  const cell = 14;
  const cellGap = 4;
  const heatY = 494;
  drawHeatmap(ctx, M, heatY, cell, cellGap, data.trace.cells);

  ctx.font = `400 14px ${FONT}`;
  ctx.fillStyle = 'rgba(126,145,170,0.75)';
  ctx.fillText('每列一周 · 从周一开始', M, heatY + 136);

  const traceStats = [
    { label: '活跃天数', value: String(data.trace.activeDays) },
    { label: '最长连续', value: `${data.trace.bestStreak} 天` },
    { label: '近 7 天点亮', value: String(data.trace.recent7) }
  ];
  const statLeft = M + 12 * (cell + cellGap) - cellGap + 58;
  const statGap = (W - M - statLeft) / 3;
  traceStats.forEach((stat, i) => {
    const x = statLeft + i * statGap;
    ctx.textAlign = 'left';
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = '#eaf2ff';
    ctx.fillText(stat.value, x, heatY + 56);
    ctx.font = `400 16px ${FONT}`;
    ctx.fillStyle = 'rgba(150,170,196,0.9)';
    ctx.fillText(stat.label, x, heatY + 84);
  });

  // 星系掌握度
  ctx.textAlign = 'left';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = 'rgba(200,218,240,0.92)';
  ctx.fillText('星系掌握度 · TOP 4', M, 676);
  data.topGalaxies.forEach((g, i) => {
    const mid = 706 + i * 54;
    ctx.font = `400 21px ${FONT}`;
    ctx.fillStyle = g.ratio > 0 ? 'rgba(214,232,255,0.92)' : 'rgba(140,156,178,0.68)';
    ctx.textAlign = 'left';
    ctx.fillText(g.name, M, mid + 7);
    const bx = M + 200;
    const bw = 566;
    rr(ctx, bx, mid - 5, bw, 10, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    if (g.ratio > 0) {
      const fillW = Math.max(10, bw * Math.min(1, g.ratio));
      rr(ctx, bx, mid - 5, fillW, 10, 5);
      const fg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      fg.addColorStop(0, g.color);
      fg.addColorStop(1, `${g.color}aa`);
      ctx.fillStyle = fg;
      ctx.fill();
    }
    ctx.font = `500 20px ${FONT}`;
    ctx.fillStyle = 'rgba(170,190,215,0.88)';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(g.ratio * 100)}%`, W - M, mid + 7);
  });

  // 岗位匹配
  ctx.textAlign = 'left';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = 'rgba(200,218,240,0.92)';
  ctx.fillText('岗位匹配度 · TOP 3', M, 908);
  data.matches.forEach((m, i) => {
    const top = 928 + i * 66;
    ctx.font = `500 23px ${FONT}`;
    ctx.fillStyle = 'rgba(226,238,252,0.95)';
    ctx.textAlign = 'left';
    ctx.fillText(m.role.name, M, top + 24);
    ctx.font = `600 26px ${FONT}`;
    ctx.fillStyle = i === 0 ? '#6ce7a8' : 'rgba(190,210,235,0.9)';
    ctx.textAlign = 'right';
    ctx.fillText(`${m.pct}%`, W - M, top + 25);
    const trackW = W - M * 2;
    rr(ctx, M, top + 40, trackW, 8, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    if (m.pct > 0) {
      rr(ctx, M, top + 40, Math.max(8, trackW * (m.pct / 100)), 8, 4);
      ctx.fillStyle = i === 0 ? '#6ce7a8' : '#7fb3ff';
      ctx.fill();
    }
  });

  // 代表能力
  ctx.textAlign = 'left';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = 'rgba(200,218,240,0.92)';
  ctx.fillText('已点亮的核心知识点', M, 1146);

  if (!data.coreLit.length) {
    ctx.font = `400 21px ${FONT}`;
    ctx.fillStyle = 'rgba(140,156,178,0.8)';
    ctx.fillText('从任意一颗没有前置的星开始，先点亮第一颗核心知识点。', M, 1190);
  } else {
    const chipH = 44;
    let x = M;
    let y = 1166;
    data.coreLit.forEach(node => {
      ctx.font = `400 19px ${FONT}`;
      const tw = ctx.measureText(node.name).width;
      const cw = tw + 36;
      if (x + cw > W - M) {
        x = M;
        y += chipH + 14;
      }
      if (y > 1236) return;
      rr(ctx, x, y, cw, chipH, 12);
      ctx.fillStyle = 'rgba(108,231,168,0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(108,231,168,0.24)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(191,255,224,0.92)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.name, x + 18, y + chipH / 2 + 1);
      ctx.textBaseline = 'alphabetic';
      x += cw + 12;
    });
  }

  // 页脚
  ctx.strokeStyle = 'rgba(150,185,235,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, 1296);
  ctx.lineTo(W - M, 1296);
  ctx.stroke();
  ctx.font = `400 16px ${FONT}`;
  ctx.fillStyle = 'rgba(126,145,170,0.8)';
  ctx.textAlign = 'left';
  ctx.fillText('判分与推荐均在本地完成 · SWEBOK v4 / CS2023 对齐', M, 1328);
  ctx.textAlign = 'right';
  ctx.fillText('知识星图 · Knowledge Star Map', W - M, 1328);
}

function summaryText(data) {
  const top = data.matches.map(m => `${m.role.name} ${m.pct}%`).join(' / ');
  return [
    `【知识星图】${data.title.name}`,
    `已点亮 ${data.litCount}/${data.total} 个知识点，覆盖 ${data.covered} 个星系，挑战 ${data.attempts} 次。`,
    data.trace.activeDays
      ? `近 12 周活跃 ${data.trace.activeDays} 天，最长连续 ${data.trace.bestStreak} 天。`
      : '',
    `目标方向：${data.role.name}；岗位匹配：${top}。`,
    data.coreLit.length ? `代表能力：${data.coreLit.slice(0, 5).map(n => n.name).join('、')}。` : '',
    '把课程知识连成一张可验证的能力星图。'
  ].filter(Boolean).join('\n');
}

function downloadCanvas(canvas) {
  canvas.toBlob(blob => {
    if (!blob) {
      toast('图片生成失败，请重试', 'warn');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `知识星图-能力档案-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('能力档案卡已下载', 'success');
  }, 'image/png');
}

async function copySummary(data) {
  const text = summaryText(data);
  try {
    await navigator.clipboard.writeText(text);
    toast('文字摘要已复制', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    toast(ok ? '文字摘要已复制' : '复制失败，请手动选择文本', ok ? 'success' : 'warn');
  }
}

function showModal(canvas, data) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const previous = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop share-backdrop';
  overlay.innerHTML = `
    <div class="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="sc-title">
      <button class="modal-close" data-act="close" aria-label="关闭">✕</button>
      <div class="modal-head">
        <span class="eyebrow">能力档案卡</span>
        <h2 id="sc-title">把这一阶段的星空发出去</h2>
        <p class="modal-sub">1080 × 1350 · 含 12 周学习轨迹 · 适合朋友圈 / 小红书 / 作品集封面</p>
      </div>
      <div class="share-preview"></div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="copy">复制文字摘要</button>
        <button class="btn ghost" data-act="close">关闭</button>
        <button class="btn primary" data-act="download">下载 PNG</button>
      </div>
    </div>`;
  overlay.querySelector('.share-preview').appendChild(canvas);
  root.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (previous && previous.focus) previous.focus();
  };
  const onKey = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    trapFocus(overlay.querySelector('.share-modal'), e);
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      close();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'close') close();
    else if (act.dataset.act === 'download') downloadCanvas(canvas);
    else if (act.dataset.act === 'copy') copySummary(data);
  });
  requestAnimationFrame(() => {
    const target = overlay.querySelector('[data-act="download"]');
    if (target) target.focus();
  });
}

export function openShareCard() {
  const data = buildData(getState());
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('aria-label', '知识星图能力档案卡预览');
  draw(canvas, data);
  showModal(canvas, data);
}

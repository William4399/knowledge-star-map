import { Data, galaxyMastery, nodeById, galaxyOf, questionsFor } from './data.js';
import { getState, exportText, importText, resetAll, resetOnboarding } from './store.js';
import {
  TAU, escapeHtml, formatDate, toast, confirmDialog, downloadText
} from './util.js';

let radarCache = null;

const TITLES = [
  { min: 46, name: '星系主理人', note: '整张星图几乎被你点亮，可以开始带别人走了。' },
  { min: 35, name: '星域工程师', note: '多个星域形成合力，已经具备完整的工程能力结构。' },
  { min: 21, name: '领航员', note: '能独立规划路线，开始在某个方向上形成深度。' },
  { min: 9, name: '探索者', note: '已经走出入门区，下一步是补齐关键前置、形成主线。' },
  { min: 1, name: '观星者', note: '第一颗星已经点亮，保持节奏比一次点亮很多更重要。' },
  { min: 0, name: '初入星海', note: '从任意一颗没有前置的星开始，先建立正反馈。' }
];

export function titleFor(count) {
  return TITLES.find(t => count >= t.min);
}

export function matchRole(role, lit) {
  const required = role.required || [];
  const groups = role.anyOfGroups || [];
  const done = required.filter(id => lit[id]).length;
  const groupsDone = groups.filter(g => g.ids.some(id => lit[id])).length;
  const total = required.length + groups.length;
  const reqCov = total ? (done + groupsDone) / total : 0;

  const mastery = galaxyMastery(lit);
  let weightSum = 0;
  let weighted = 0;
  Object.keys(role.galaxyWeights || {}).forEach(gid => {
    const w = role.galaxyWeights[gid];
    weightSum += w;
    weighted += w * (mastery[gid] ? mastery[gid].ratio : 0);
  });
  const galCov = weightSum ? weighted / weightSum : 0;
  const pct = Math.round((reqCov * 0.65 + galCov * 0.35) * 100);
  return { pct, reqCov, galCov, done: done + groupsDone, total };
}

function buildAdvice(lit, mastery) {
  const litCount = Object.keys(lit).length;
  if (!litCount) {
    return '星图还是暗的。建议从「成长路径」里的第一批推荐开始，先点亮 3–5 颗，系统才能给出更准确的能力判断。';
  }
  const sorted = Data.galaxies
    .map(g => ({ g, ratio: mastery[g.id] ? mastery[g.id].ratio : 0 }))
    .sort((a, b) => b.ratio - a.ratio);
  const strong = sorted.filter(x => x.ratio > 0).slice(0, 2);
  const weak = sorted[sorted.length - 1];
  const parts = [];
  if (strong.length) {
    parts.push(`目前能力最集中的星域是 ${strong.map(x => `${x.g.name}（${Math.round(x.ratio * 100)}%）`).join(' 与 ')}。`);
  }
  if (weak && weak.ratio < 0.25) {
    parts.push(`${weak.g.name} 的覆盖度偏低，如果你打算走相关方向，建议优先补上它的核心节点。`);
  }
  if (litCount < 20) {
    parts.push('现在的重点不是广度，而是把一条完整链路点亮：前置 → 核心 → 应用，这会比零散点亮更有说服力。');
  } else {
    parts.push('你已经形成多条链路，接下来可以对照目标方向的能力清单做查漏补缺。');
  }
  return parts.join('');
}

function drawRadar(canvas, items) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const n = items.length;
  const cx = w / 2;
  const cy = h / 2;
  const labelFont = w < 420 ? 10 : 10.5;
  ctx.font = `${labelFont}px -apple-system, "PingFang SC", sans-serif`;

  // 预留标签宽度，避免文字被画布裁掉
  let labelW = 0;
  items.forEach(item => { labelW = Math.max(labelW, ctx.measureText(item.name).width); });
  const marginX = labelW + 20;
  const marginY = 22;
  const R = Math.max(48, Math.min((w - marginX * 2) / 2, (h - marginY * 2) / 2));
  const angle = i => -Math.PI / 2 + (i * TAU) / n;

  // 网格
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const r = (R * ring) / 4;
      const x = cx + Math.cos(angle(i)) * r;
      const y = cy + Math.sin(angle(i)) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = ring === 4 ? 'rgba(150,185,235,0.18)' : 'rgba(150,185,235,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 轴线
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle(i)) * R, cy + Math.sin(angle(i)) * R);
    ctx.strokeStyle = 'rgba(150,185,235,0.08)';
    ctx.stroke();
  }

  // 数据多边形
  const points = items.map((item, i) => {
    const value = Math.max(0.02, Math.min(1, item.ratio));
    return { x: cx + Math.cos(angle(i)) * R * value, y: cy + Math.sin(angle(i)) * R * value };
  });

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0, 'rgba(108,231,168,0.32)');
  grad.addColorStop(1, 'rgba(108,231,168,0.06)');
  ctx.beginPath();
  points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(108,231,168,0.75)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, TAU);
    ctx.fillStyle = '#bfffe0';
    ctx.fill();
  });

  // 标签：按所在侧对齐，并夹取在画布内，保证 11 个星系名完整可读
  ctx.textBaseline = 'middle';
  items.forEach((item, i) => {
    const a = angle(i);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let x = cx + cos * (R + 12);
    let y = cy + sin * (R + 11);
    const tw = ctx.measureText(item.name).width;

    if (cos > 0.3) {
      ctx.textAlign = 'left';
      x = Math.min(x, w - tw - 4);
    } else if (cos < -0.3) {
      ctx.textAlign = 'right';
      x = Math.max(x, tw + 4);
    } else {
      ctx.textAlign = 'center';
      x = Math.max(tw / 2 + 4, Math.min(x, w - tw / 2 - 4));
    }
    y = Math.max(labelFont, Math.min(y, h - labelFont));

    ctx.fillStyle = item.ratio > 0 ? 'rgba(214,232,255,0.9)' : 'rgba(124,140,162,0.68)';
    ctx.fillText(item.name, x, y);
  });
}

export function renderProfile(root, handlers = {}) {
  const state = getState();
  const lit = state.lit;
  const litCount = Object.keys(lit).length;
  const total = Data.nodes.length;
  const title = titleFor(litCount);
  const mastery = galaxyMastery(lit);
  const items = Data.galaxies.map(g => ({
    id: g.id,
    name: g.name,
    color: g.color,
    ratio: mastery[g.id] ? mastery[g.id].ratio : 0
  }));
  const galaxyCount = items.filter(x => x.ratio > 0).length;

  const records = Object.values(state.records).filter(r => r && r.best);
  const avgBest = records.length
    ? Math.round(records.reduce((sum, r) => sum + r.best, 0) / records.length)
    : 0;
  const role = Data.roleById[state.direction] || Data.roles[0];
  const matches = Data.roles
    .map(r => ({ role: r, ...matchRole(r, lit) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  const mistakeItems = Object.entries(state.mistakes || {})
    .map(([qid, m]) => {
      const node = nodeById(m.node);
      if (!node) return null;
      const q = questionsFor(node.id).find(item => item.id === qid);
      if (!q) return null;
      return { qid, m, node, q, g: galaxyOf(node) };
    })
    .filter(Boolean)
    .sort((a, b) => b.m.at - a.m.at);

  const mistakeHtml = mistakeItems.length ? mistakeItems.map(item => {
    const color = item.g ? item.g.color : '#9dc7ff';
    const q = item.q;
    const detail = q.type === 'choice'
      ? (item.m.chosen == null || !q.options[item.m.chosen]
        ? '未作答'
        : `你的选择：${String.fromCharCode(65 + item.m.chosen)}. ${escapeHtml(q.options[item.m.chosen])}`)
      : (item.m.missing.length
        ? `缺少关键词：${item.m.missing.map(escapeHtml).join('、')}`
        : '未达到关键词要求');
    return `
      <article class="mistake-row">
        <span class="target-dot" style="background:${color};box-shadow:0 0 9px ${color}"></span>
        <div class="mistake-main">
          <div class="mistake-title">
            <b>${escapeHtml(item.node.name)}</b>
            <span class="tag" style="color:${color};border-color:${color}55">${escapeHtml(item.g ? item.g.name : '未分类')}</span>
            <span class="mistake-type ${q.type}">${q.type === 'choice' ? '选择题答错' : '简答未达标'}</span>
          </div>
          <p class="mistake-stem">${escapeHtml(q.stem)}</p>
          <p class="mistake-meta">${detail} · 错过 ${item.m.count} 次 · ${formatDate(item.m.at)}</p>
        </div>
        <button class="btn ghost sm" data-action="review" data-id="${item.node.id}">重练</button>
      </article>`;
  }).join('')
    : `<div class="empty compact">
        <p>暂无待复习的错题。</p>
        <p class="muted">挑战未通过时，答错的题目会自动记录在这里；通过后自动清除。</p>
      </div>`;

  const onboarding = state.onboarding;
  const onboardingLine = onboarding.done
    ? `${escapeHtml(onboarding.major || '未填写专业')} · ${escapeHtml(onboarding.grade || '未填写年级')} · 摸底 ${onboarding.quiz.correct}/${onboarding.quiz.total}`
    : '尚未完成入门测评';

  const matchHtml = matches.map(m => `
    <article class="match-card">
      <header class="match-head">
        <div>
          <h3>${escapeHtml(m.role.name)}</h3>
          <p class="muted small">${escapeHtml(m.role.short)}</p>
        </div>
        <span class="match-pct"><b>${m.pct}<em>%</em></b><small>匹配度</small></span>
      </header>
      <div class="progress-track"><i style="width:${m.pct}%"></i></div>
      <p class="muted small">方向能力 ${m.done} / ${m.total} 项已点亮</p>
      <div class="match-block">
        <h4>对口岗位</h4>
        ${m.role.jobs.map(j => `
          <div class="job">
            <b>${escapeHtml(j.title)}</b>
            <div class="job-tags">${j.keywords.map(k => `<span>${escapeHtml(k)}</span>`).join('')}</div>
          </div>`).join('')}
      </div>
      <div class="match-block">
        <h4>可参加的比赛</h4>
        <ul class="comp-list">
          ${m.role.competitions.map(c => `<li><b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.note)}</span></li>`).join('')}
        </ul>
      </div>
      <button class="btn ghost sm full" data-action="direction" data-id="${m.role.id}">以该方向规划路径</button>
    </article>`).join('');

  root.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">能力档案</span>
        <h1>我的星空</h1>
        <p>已点亮的星星会在这里累积成一份可解释的能力画像。</p>
      </div>
      <div class="profile-badge">
        <span class="eyebrow">当前称号</span>
        <b>${escapeHtml(title.name)}</b>
        <span class="muted small">${escapeHtml(onboardingLine)}</span>
        <button class="btn primary sm" data-action="share">生成能力档案卡</button>
      </div>
    </div>

    <section class="panel profile-hero">
      <div class="profile-main">
        <span class="eyebrow">${escapeHtml(role.name)} · 目标方向</span>
        <h2>${escapeHtml(title.name)}</h2>
        <p class="hero-tagline">${escapeHtml(title.note)}</p>
        <div class="stat-grid">
          <div class="stat"><b>${litCount}<em>/${total}</em></b><span>已点亮知识点</span></div>
          <div class="stat"><b>${galaxyCount}<em>/11</em></b><span>覆盖星系</span></div>
          <div class="stat"><b>${state.counters.attempts}</b><span>挑战次数</span></div>
          <div class="stat"><b>${avgBest || '—'}</b><span>平均最好成绩</span></div>
        </div>
      </div>
      <div class="radar-wrap">
        <canvas id="radar-canvas" aria-label="十一个知识星系的掌握度雷达图"></canvas>
        <p class="radar-note">按重要度加权的星系掌握度</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>待复习</h2><span class="count">${mistakeItems.length}</span></div>
      <p class="panel-sub">最近一次挑战中答错的题目会留在这里；重新通过该知识点的挑战后自动清除。</p>
      <div class="mistake-list">${mistakeHtml}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>能力评价</h2><span class="count">自动生成</span></div>
      <p class="advice">${escapeHtml(buildAdvice(lit, mastery))}</p>
      <div class="galaxy-bars">
        ${items.map(item => `
          <div class="galaxy-bar">
            <span class="gb-name"><i style="background:${item.color}"></i><span>${escapeHtml(item.name)}</span></span>
            <div class="progress-track"><i style="width:${Math.round(item.ratio * 100)}%;background:${item.color}"></i></div>
            <span class="gb-pct">${Math.round(item.ratio * 100)}%</span>
          </div>`).join('')}
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>岗位与比赛匹配</h2><span class="count">Top 3</span></div>
      <p class="panel-sub">匹配度 = 方向必修覆盖度 65% + 方向相关星系掌握度 35%。岗位关键词与赛事信息为人工整理参考，非官方要求。</p>
      <div class="match-grid">${matchHtml}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>存档与设置</h2><span class="count">本地存储</span></div>
      <p class="panel-sub">存档只保存在当前浏览器的 localStorage 中，不会上传到任何服务器。换设备时请使用导出 / 导入。</p>
      <div class="data-actions">
        <button class="btn ghost" data-action="export">导出存档</button>
        <button class="btn ghost" data-action="import">导入存档</button>
        <button class="btn ghost" data-action="onboard">重做入门测评</button>
        <button class="btn danger" data-action="reset">清空所有数据</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
      <p class="muted small">存档创建于 ${formatDate(state.createdAt)} · 最近更新 ${formatDate(state.updatedAt)}</p>
    </section>

    <p class="page-foot">知识星图 · CS2023 / SWEBOK v4 对齐 · 判分与推荐均在本地完成</p>`;

  const canvas = root.querySelector('#radar-canvas');
  if (canvas) {
    radarCache = { canvas, items };
    requestAnimationFrame(() => drawRadar(canvas, items));
  }

  const fileInput = root.querySelector('#import-file');

  root.onclick = async e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'direction') {
      if (handlers.onDirection) handlers.onDirection(actionEl.dataset.id);
    } else if (action === 'review') {
      if (handlers.onReview) handlers.onReview(actionEl.dataset.id);
    } else if (action === 'share') {
      if (handlers.onShare) handlers.onShare();
    } else if (action === 'export') {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`知识星图-存档-${stamp}.json`, exportText());
      toast('存档已导出', 'success');
    } else if (action === 'import') {
      if (fileInput) fileInput.click();
    } else if (action === 'onboard') {
      const ok = await confirmDialog({
        title: '重做入门测评？',
        message: '会重新采集专业、自评与摸底结果，但不会清空你已经点亮的星星。',
        confirmText: '开始重做'
      });
      if (!ok) return;
      resetOnboarding();
      if (handlers.onOnboarding) handlers.onOnboarding();
    } else if (action === 'reset') {
      const ok = await confirmDialog({
        title: '清空所有数据？',
        message: '已点亮的知识点、挑战记录与入门结果都会被删除，且无法恢复。建议先导出存档。',
        confirmText: '确认清空',
        danger: true
      });
      if (!ok) return;
      resetAll();
      toast('数据已清空', 'warn');
      if (handlers.onReset) handlers.onReset();
    }
  };

  if (fileInput) {
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const text = await file.text();
      const result = importText(text);
      if (!result.ok) {
        toast(result.error || '导入失败', 'warn');
        return;
      }
      toast('存档已导入', 'success');
      if (handlers.onDataChanged) handlers.onDataChanged();
    };
  }
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (radarCache && radarCache.canvas && radarCache.canvas.isConnected) {
      drawRadar(radarCache.canvas, radarCache.items);
    }
  }, 160);
});

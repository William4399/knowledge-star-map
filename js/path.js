import { Data, nodeById, galaxyOf, unlocked, missingPrereqs, questionsFor } from './data.js';
import { getState, setDirection } from './store.js';
import { escapeHtml, starsHtml } from './util.js';

function unlockPotential(nodeId, lit, cache) {
  if (cache && cache[nodeId] != null) return cache[nodeId];
  const fake = { ...lit, [nodeId]: 1 };
  let count = 0;
  Data.nodes.forEach(n => {
    if (fake[n.id]) return;
    if (!unlocked(n, lit) && unlocked(n, fake)) count += 1;
  });
  if (cache) cache[nodeId] = count;
  return count;
}

function scoreNode(node, role, lit, state, potential) {
  const weight = role.galaxyWeights[node.galaxy] ?? 0.3;
  let score = weight * 40 + node.importance * 4 - node.complexity * 2 + potential * 3;
  if (node.core) score += 2;
  if (role.required.includes(node.id)) score += 12;
  if (state.claimed[node.id]) score += 6;
  return score;
}

function reasonFor(node, role) {
  if (role.required.includes(node.id)) return '方向必修';
  const weight = role.galaxyWeights[node.galaxy] ?? 0;
  if (weight >= 0.8) return '方向核心';
  if (node.core) return '体系核心';
  return '补齐相邻能力';
}

export function roleProgress(role, lit) {
  const required = role.required.map(id => ({ id, node: nodeById(id), lit: !!lit[id] }));
  const groups = (role.anyOfGroups || []).map(g => ({
    name: g.name,
    ids: g.ids,
    satisfied: g.ids.some(id => lit[id]),
    options: g.ids.map(id => ({ id, node: nodeById(id), lit: !!lit[id] }))
  }));
  const done = required.filter(x => x.lit).length;
  const groupsDone = groups.filter(g => g.satisfied).length;
  const total = required.length + groups.length;
  const doneAll = done + groupsDone;
  return {
    required,
    groups,
    done,
    groupsDone,
    total,
    doneAll,
    percent: total ? doneAll / total : 0
  };
}

export function buildPlan() {
  const state = getState();
  const lit = state.lit;
  const role = Data.roleById[state.direction] || Data.roles[0];
  const ready = [];
  const upcoming = [];
  const cache = {};

  Data.nodes.forEach(node => {
    if (lit[node.id]) return;
    const missing = missingPrereqs(node, lit);
    const anyMissing = (node.any_of || []).filter(id => !lit[id]);

    if (unlocked(node, lit)) {
      const potential = unlockPotential(node.id, lit, cache);
      ready.push({
        node,
        missing,
        anyMissing,
        potential,
        score: scoreNode(node, role, lit, state, potential),
        reason: reasonFor(node, role)
      });
    } else if (missing.length <= 2 && anyMissing.length <= 1) {
      upcoming.push({ node, missing, anyMissing });
    }
  });

  ready.sort((a, b) => b.score - a.score);
  upcoming.sort((a, b) => (b.node.importance - a.node.importance) || (a.missing.length - b.missing.length));

  return {
    role,
    ready,
    upcoming,
    progress: roleProgress(role, lit)
  };
}

const READY_LIMIT = 6;
const UPCOMING_LIMIT = 6;
const expanded = { ready: false, upcoming: false };

export function renderPath(root, handlers = {}) {
  const plan = buildPlan();
  const { role, ready, upcoming, progress } = plan;
  const pct = Math.round(progress.percent * 100);
  const shownReady = expanded.ready ? ready : ready.slice(0, READY_LIMIT);
  const shownUpcoming = expanded.upcoming ? upcoming : upcoming.slice(0, UPCOMING_LIMIT);

  const dirPills = Data.roles.map(r => `
    <button class="dir-pill ${r.id === role.id ? 'active' : ''}" data-action="direction" data-id="${r.id}">
      ${escapeHtml(r.name)}
    </button>`).join('');

  const readyHtml = shownReady.length ? shownReady.map(item => {
    const g = galaxyOf(item.node);
    const qCount = questionsFor(item.node.id).length;
    const tags = [
      `<span class="tag" style="color:${g.color};border-color:${g.color}55">${escapeHtml(g.name)}</span>`,
      `<span class="tag accent">${escapeHtml(item.reason)}</span>`,
      item.node.core ? '<span class="tag core">核心</span>' : ''
    ].filter(Boolean).join('');
    return `
      <article class="target">
        <div class="target-main">
          <div class="target-title">
            <span class="target-dot" style="background:${g.color};box-shadow:0 0 10px ${g.color}"></span>
            <h3>${escapeHtml(item.node.name)}</h3>
            ${tags}
          </div>
          <p class="target-desc">${escapeHtml(item.node.description)}</p>
          <div class="target-meta">
            <span>重要度 ${starsHtml(item.node.importance)}</span>
            <span>难度 ${item.node.complexity} / 5</span>
            <span>${qCount} 题 · 60 分及格</span>
            ${item.potential > 0 ? `<span class="potential">点亮后可解锁 ${item.potential} 颗</span>` : ''}
          </div>
        </div>
        <div class="target-actions">
          <button class="btn primary sm" data-action="challenge" data-id="${item.node.id}">挑战</button>
          <button class="btn ghost sm" data-action="focus" data-id="${item.node.id}">定位</button>
        </div>
      </article>`;
  }).join('') : (pct === 100
    ? `<div class="empty done"><p>✦ 这个方向的必修能力已经全部点亮。</p><p class="muted">可以切换到其他方向继续拓展，或去「我的」查看岗位与比赛匹配。</p></div>`
    : `<div class="empty">
      <p>当前没有可以直接挑战的星星。</p>
      <p class="muted">先看看下方「接下来会解锁」，完成前置依赖后这里会出现新的目标。</p>
    </div>`);

  const upcomingHtml = shownUpcoming.length ? shownUpcoming.map(item => {
    const g = galaxyOf(item.node);
    const missingNames = item.missing.map(id => nodeById(id)?.name || id);
    const anyNames = item.anyMissing.map(id => nodeById(id)?.name || id);
    const need = missingNames.length
      ? `还需点亮：${missingNames.map(escapeHtml).join('、')}`
      : `还需掌握任一门：${anyNames.map(escapeHtml).join(' / ')}`;
    return `
      <article class="upcoming-row">
        <span class="target-dot small" style="background:${g.color}"></span>
        <div class="upcoming-main">
          <b>${escapeHtml(item.node.name)}</b>
          <span class="tag" style="color:${g.color};border-color:${g.color}55">${escapeHtml(g.name)}</span>
          <p>${need}</p>
        </div>
        <button class="btn ghost sm" data-action="focus" data-id="${item.node.id}">查看</button>
      </article>`;
  }).join('') : '<div class="empty compact"><p>没有即将解锁的节点，先完成上方推荐。</p></div>';

  const requiredHtml = progress.required.map(item => `
    <li class="${item.lit ? 'done' : ''}">
      <span class="check">${item.lit ? '✓' : '○'}</span>
      <span class="check-name">${escapeHtml(item.node ? item.node.name : item.id)}</span>
      <span class="check-galaxy">${escapeHtml(item.node ? galaxyOf(item.node).name : '')}</span>
    </li>`).join('');

  const groupsHtml = progress.groups.map(group => `
    <li class="group ${group.satisfied ? 'done' : ''}">
      <span class="check">${group.satisfied ? '✓' : '○'}</span>
      <span class="check-name">${escapeHtml(group.name)}</span>
      <span class="check-options">
        ${group.options.map(o => `<span class="mini ${o.lit ? 'on' : ''}">${escapeHtml(o.node ? o.node.name : o.id)}</span>`).join('')}
      </span>
    </li>`).join('');

  const completeBanner = pct === 100 ? `
    <div class="panel banner-success">
      <b>✦ 这个方向的必修能力已经全部点亮</b>
      <p>可以去「我的」查看岗位与比赛匹配，或者切换方向继续拓展。</p>
    </div>` : '';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">成长路径</span>
        <h1>下一步，点亮哪颗星</h1>
        <p>根据前置依赖与目标方向的权重，实时计算你现在最值得挑战的知识点。</p>
      </div>
      <div class="dir-select" role="group" aria-label="选择目标方向">${dirPills}</div>
    </div>

    <section class="panel path-hero">
      <div class="hero-copy">
        <span class="eyebrow">目标方向</span>
        <h2>${escapeHtml(role.name)}</h2>
        <p class="hero-tagline">${escapeHtml(role.tagline)}</p>
        <p class="muted">${escapeHtml(role.description)}</p>
        <div class="progress-line">
          <div class="progress-track"><i style="width:${pct}%"></i></div>
          <span>${progress.doneAll} / ${progress.total}</span>
        </div>
        <p class="muted small">${role.required.length} 个必修节点${progress.groups.length ? ` + ${progress.groups.length} 组任一条件` : ''} · 通过挑战后自动计入</p>
      </div>
      <div class="hero-stat">
        <b style="color:${pct === 100 ? '#6ce7a8' : '#eaf2ff'}">${pct}%</b>
        <span>方向完成度</span>
      </div>
    </section>

    ${completeBanner}

    <section class="panel">
      <div class="panel-head">
        <h2>现在就能挑战</h2>
        <span class="count">${ready.length}</span>
      </div>
      <p class="panel-sub">这些星的前置条件已经满足，按方向相关度与解锁潜力排序。</p>
      <div class="target-list">${readyHtml}</div>
      ${ready.length > READY_LIMIT ? `<div class="list-more"><button class="btn ghost sm" data-action="expand" data-list="ready">${expanded.ready ? '收起列表' : `展开其余 ${ready.length - READY_LIMIT} 个`}</button></div>` : ''}
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>接下来会解锁</h2>
        <span class="count">${upcoming.length}</span>
      </div>
      <p class="panel-sub">再点亮 1–2 颗相关星星，就能把这些节点纳入可挑战范围。</p>
      <div class="upcoming-list">${upcomingHtml}</div>
      ${upcoming.length > UPCOMING_LIMIT ? `<div class="list-more"><button class="btn ghost sm" data-action="expand" data-list="upcoming">${expanded.upcoming ? '收起列表' : `展开其余 ${upcoming.length - UPCOMING_LIMIT} 个`}</button></div>` : ''}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>方向能力清单</h2><span class="count">${progress.doneAll}/${progress.total}</span></div>
      <p class="panel-sub">清单为人工整理的岗位能力参考，用来校准学习顺序，不是招聘硬性要求。</p>
      <ul class="checklist">${requiredHtml}${groupsHtml}</ul>
    </section>

    <p class="page-foot">推荐结果由本地规则计算：前置依赖 + 星系权重 + 重要度 / 难度 + 解锁潜力。</p>`;

  root.onclick = e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    if (action === 'direction') {
      expanded.ready = false;
      expanded.upcoming = false;
      setDirection(id);
    } else if (action === 'expand') {
      expanded[actionEl.dataset.list] = !expanded[actionEl.dataset.list];
      renderPath(root, handlers);
    } else if (action === 'challenge' && handlers.onChallenge) {
      handlers.onChallenge(id);
    } else if (action === 'focus' && handlers.onFocus) {
      handlers.onFocus(id);
    }
  };
}

import { Data, nodeById, galaxyOf, unlocked, missingPrereqs } from './data.js';
import { getState, setPlan } from './store.js';
import { escapeHtml, formatDate, toast, downloadText } from './util.js';
import { scoreNode, unlockPotential } from './path.js';
import { buildCalendar } from './ics.js';

const DAY = 24 * 3600 * 1000;
const WEEK = 7 * DAY;
export const HORIZONS = [4, 6, 8];
export const PACE_OPTIONS = [8, 12, 16, 20];
const DEFAULT_WEEKS = 4;
const DEFAULT_PACE = 16;

function hoursFor(node) {
  return Math.round(node.complexity * 2.5 * 2) / 2;
}

function md(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function inputDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* 按推荐度模拟解锁顺序：每次挑选当前可挑战里得分最高的节点 */
function buildSequence(role, state, limit) {
  const taken = { ...state.lit };
  const seq = [];
  while (seq.length < limit) {
    let best = null;
    Data.nodes.forEach(node => {
      if (taken[node.id] || !unlocked(node, taken)) return;
      const potential = unlockPotential(node.id, taken, null);
      const score = scoreNode(node, role, taken, state, potential);
      if (!best || score > best.score) best = { node, score };
    });
    if (!best) break;
    seq.push(best.node);
    taken[best.node.id] = 1;
  }
  return seq;
}

function chunkWeeks(seq, weeks, weekHours) {
  const buckets = Array.from({ length: weeks }, () => []);
  let week = 0;
  let spent = 0;
  for (const node of seq) {
    const hours = hoursFor(node);
    if (buckets[week].length && spent + hours > weekHours) {
      if (week >= weeks - 1) break;
      week += 1;
      spent = 0;
    }
    buckets[week].push({ node, hours });
    spent += hours;
  }
  return buckets;
}

export function createPlan(weeks = DEFAULT_WEEKS, options = {}) {
  const state = getState();
  const role = Data.roleById[state.direction] || Data.roles[0];
  const safeWeeks = HORIZONS.includes(Number(weeks)) ? Number(weeks) : DEFAULT_WEEKS;
  const weeklyHours = PACE_OPTIONS.includes(Number(options.weeklyHours))
    ? Number(options.weeklyHours)
    : DEFAULT_PACE;
  const startAt = Number(options.startAt) || Date.now();
  const buckets = chunkWeeks(buildSequence(role, state, safeWeeks * 5), safeWeeks, weeklyHours);
  const entries = [];
  buckets.forEach((bucket, index) => {
    bucket.forEach(item => entries.push({ week: index, node: item.node.id, hours: item.hours }));
  });
  return { direction: role.id, weeks: safeWeeks, weeklyHours, startAt, generatedAt: Date.now(), entries };
}

function ensurePlan() {
  const state = getState();
  const plan = state.plan;
  if (plan && Array.isArray(plan.entries) && plan.direction === state.direction) return plan;
  const next = createPlan(plan && plan.weeks ? plan.weeks : DEFAULT_WEEKS, {
    weeklyHours: plan ? plan.weeklyHours : undefined,
    startAt: plan ? plan.startAt : undefined
  });
  setPlan(next);
  return next;
}

function exportIcs(plan, entries, role) {
  const events = Array.from({ length: plan.weeks }, (_, index) => {
    const tasks = entries.filter(entry => entry.week === index);
    if (!tasks.length) return null;
    const start = plan.startAt + index * WEEK;
    const hours = tasks.reduce((sum, entry) => sum + entry.hours, 0);
    const description = [
      `方向：${role.name}`,
      `预计投入：${hours} 小时（每周约 ${plan.weeklyHours} 小时）`,
      '任务：',
      ...tasks.map(entry => `- ${entry.node.name}（${entry.hours} 小时）`)
    ].join('\n');
    return {
      uid: `ksm-${plan.generatedAt}-w${index}@knowledge-star-map`,
      start: new Date(start),
      end: new Date(start + 7 * DAY),
      summary: `知识星图 · 第 ${index + 1} 周：${role.name}`,
      description
    };
  }).filter(Boolean);

  if (!events.length) {
    toast('当前计划没有可导出的任务', 'warn');
    return;
  }
  const text = buildCalendar({
    calendarName: `知识星图 · ${role.name} · ${plan.weeks} 周计划`,
    events
  });
  const stamp = formatDate(Date.now()).replace(/\./g, '-');
  downloadText(`知识星图-学习计划-${stamp}.ics`, text, 'text/calendar;charset=utf-8');
  toast(`已导出 ${events.length} 周日历事件`, 'success');
}

function weekFocus(tasks) {
  const weight = {};
  tasks.forEach(item => {
    weight[item.node.galaxy] = (weight[item.node.galaxy] || 0) + (item.node.importance || 1);
  });
  let best = null;
  Object.keys(weight).forEach(key => {
    if (!best || weight[key] > weight[best]) best = key;
  });
  return best ? Data.galaxyById[best] : null;
}

function taskHtml(entry, state) {
  const node = entry.node;
  const g = galaxyOf(node);
  const color = g ? g.color : '#9dc7ff';
  const done = !!state.lit[node.id];
  const ready = !done && unlocked(node, state.lit);
  const record = state.records[node.id];
  const missing = missingPrereqs(node, state.lit).map(id => nodeById(id)?.name || id);
  const anyMissing = (node.any_of || []).filter(id => !state.lit[id]).map(id => nodeById(id)?.name || id);

  let need = '';
  if (!done && !ready) {
    need = missing.length
      ? ` · 需先点亮：${missing.map(escapeHtml).join('、')}`
      : ` · 需先掌握任一门：${anyMissing.map(escapeHtml).join(' / ')}`;
  }
  const statusTag = done
    ? '<span class="task-status done">已完成</span>'
    : ready
      ? '<span class="task-status ready">可挑战</span>'
      : '<span class="task-status">待解锁</span>';
  const action = done
    ? '<span class="task-done-mark" aria-label="已完成">✓</span>'
    : ready
      ? `<button class="btn primary sm" data-action="challenge" data-id="${node.id}">挑战</button>`
      : `<button class="btn ghost sm" data-action="focus" data-id="${node.id}">查看前置</button>`;

  return `
    <li class="task ${done ? 'done' : ''}">
      <span class="task-dot" style="background:${color};box-shadow:0 0 9px ${color}"></span>
      <div class="task-main">
        <div class="task-title">
          <b>${escapeHtml(node.name)}</b>
          <span class="tag" style="color:${color};border-color:${color}55">${escapeHtml(g ? g.name : '未分类')}</span>
          ${statusTag}
        </div>
        <p class="task-meta">重要度 ${node.importance}/5 · 难度 ${node.complexity}/5 · 预计 ${entry.hours} 小时${done && record ? ` · 最好 ${record.best} 分` : ''}${need}</p>
      </div>
      <div class="task-actions">${action}</div>
    </li>`;
}

export function renderPlan(root, handlers = {}) {
  const state = getState();
  const plan = ensurePlan();
  const role = Data.roleById[plan.direction] || Data.roles[0];
  const entries = plan.entries
    .map(entry => ({ ...entry, node: nodeById(entry.node) }))
    .filter(entry => entry.node);
  const plannedIds = new Set(entries.map(entry => entry.node.id));
  const doneCount = entries.filter(entry => state.lit[entry.node.id]).length;
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
  const pct = entries.length ? Math.round(doneCount / entries.length * 100) : 0;
  const now = Date.now();
  const upcoming = now < plan.startAt;
  const rawWeek = Math.floor((now - plan.startAt) / WEEK);
  const currentWeek = Math.max(0, Math.min(plan.weeks - 1, rawWeek));
  const expired = now >= plan.startAt + plan.weeks * WEEK;
  const outside = Data.nodes.filter(node => !state.lit[node.id] && !plannedIds.has(node.id));
  const outsideReady = outside.filter(node => unlocked(node, state.lit));
  const allDone = doneCount === entries.length && entries.length > 0;

  const weekHtml = Array.from({ length: plan.weeks }, (_, index) => {
    const tasks = entries.filter(entry => entry.week === index);
    const done = tasks.filter(entry => state.lit[entry.node.id]).length;
    const hours = tasks.reduce((sum, entry) => sum + entry.hours, 0);
    const startAt = plan.startAt + index * WEEK;
    const isCurrent = index === currentWeek && !expired && !upcoming;
    const complete = tasks.length > 0 && done === tasks.length;
    const focus = weekFocus(tasks);
    const tasksHtml = tasks.length
      ? `<ul class="week-tasks">${tasks.map(entry => taskHtml(entry, state)).join('')}</ul>`
      : '<p class="week-empty">本周没有待安排的任务，可以用来复习与巩固。</p>';

    return `
      <article class="panel week-card${isCurrent ? ' current' : ''}${complete ? ' complete' : ''}">
        <header class="week-head">
          <div class="week-title">
            <span class="week-badge">W${index + 1}</span>
            <div>
              <h2>第 ${index + 1} 周${isCurrent ? ' · 本周' : ''}</h2>
              <p>${md(startAt)} – ${md(startAt + 6 * DAY)}${focus ? ` · 重点 ${escapeHtml(focus.name)}` : ''} · 预计 ${hours} 小时</p>
            </div>
          </div>
          <div class="week-side">
            <span class="week-pct">${done} / ${tasks.length} 已完成</span>
            <div class="progress-track"><i style="width:${tasks.length ? Math.round(done / tasks.length * 100) : 0}%"></i></div>
          </div>
        </header>
        ${tasksHtml}
      </article>`;
  }).join('');

  const horizonPills = HORIZONS.map(weeks => `
    <button class="dir-pill ${weeks === plan.weeks ? 'active' : ''}" data-action="horizon" data-id="${weeks}">${weeks} 周</button>`).join('');
  const pacePills = PACE_OPTIONS.map(hours => `
    <button class="dir-pill ${hours === plan.weeklyHours ? 'active' : ''}" data-action="pace" data-id="${hours}">${hours} 小时</button>`).join('');

  let bannerHtml = '';
  if (allDone) {
    bannerHtml = `
      <div class="panel banner-success">
        <b>✦ 这个周期的任务已经全部完成</b>
        <p>可以重新规划下一阶段${outside.length ? `，还有 ${outside.length} 颗未点亮的星星` : '，或者切换方向继续拓展'}。</p>
        <div class="banner-actions"><button class="btn sm" data-action="replan">规划下一阶段</button></div>
      </div>`;
  } else if (expired) {
    bannerHtml = `
      <div class="panel plan-hint">
        <p>计划的 ${plan.weeks} 周周期已经结束${doneCount < entries.length ? '，还有任务没有完成' : ''}。重新规划会从今天开始新周期，并按当前进度继续排序。</p>
        <button class="btn sm" data-action="replan">重新规划</button>
      </div>`;
  } else if (outsideReady.length) {
    bannerHtml = `
      <div class="panel plan-hint">
        <p>有 ${outsideReady.length} 颗新解锁的星星不在当前计划里，可以重新规划把它们纳入安排。</p>
        <button class="btn sm" data-action="replan">重新规划</button>
      </div>`;
  }

  const emptyHtml = entries.length === 0
    ? `<div class="panel"><div class="empty ${outside.length === 0 ? 'done' : ''}">
        <p>${outside.length === 0 ? '✦ 所有知识点都已点亮，没有需要安排的任务了。' : '暂时没有可安排的任务。'}</p>
        <p class="muted">${outside.length === 0 ? '可以切换方向继续拓展，或去「我的」查看岗位匹配。' : '先完成已有挑战，再回来看看。'}</p>
      </div></div>`
    : '';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">学习计划</span>
        <h1>把目标拆成 ${plan.weeks} 周</h1>
        <p>每周可投入 ${plan.weeklyHours} 小时，先补前置，再推主干。任务状态跟随挑战结果自动更新。</p>
      </div>
      <div class="plan-tools">
        <div class="dir-select" role="group" aria-label="计划周期">${horizonPills}</div>
        <button class="btn ghost sm" data-action="replan">重新规划</button>
      </div>
    </div>

    <section class="panel plan-hero">
      <div class="hero-copy">
        <span class="eyebrow">当前计划</span>
        <h2>${escapeHtml(role.name)} · ${plan.weeks} 周学习计划</h2>
        <p class="hero-tagline">${upcoming ? `将于 ${formatDate(plan.startAt)} 开始` : `自 ${formatDate(plan.startAt)} 起`} · 每周约 ${plan.weeklyHours} 小时</p>
        <p class="muted">${expired ? '计划周期已经结束，建议重新规划。' : upcoming ? '计划尚未开始，可以先按第 1 周安排预习。' : '通过挑战后，对应任务会自动打勾。'}</p>
        <div class="progress-line">
          <div class="progress-track"><i style="width:${pct}%"></i></div>
          <span>${doneCount} / ${entries.length} 任务</span>
        </div>
        <p class="muted small">预计投入 ${totalHours} 小时 · 计划外还有 ${outside.length} 颗未点亮节点</p>
      </div>
      <div class="hero-stat">
        <b style="color:${allDone ? '#6ce7a8' : '#eaf2ff'}">${pct}%</b>
        <span>计划完成度</span>
      </div>
    </section>

    <section class="panel plan-config" aria-label="计划设置">
      <div class="config-group">
        <span class="config-label">每周可投入</span>
        <div class="dir-select" role="group" aria-label="每周可投入时长">${pacePills}</div>
      </div>
      <label class="config-group">
        <span class="config-label">开始日期</span>
        <input class="plan-date" id="plan-start" type="date" value="${inputDate(plan.startAt)}" aria-label="计划开始日期">
      </label>
      <button class="btn ghost sm plan-export" data-action="export">导出日历 · .ics</button>
      <p class="config-hint">切换每周投入会按新节奏重排任务；修改开始日期只影响周次显示与导出的日程。</p>
    </section>

    ${bannerHtml}
    ${emptyHtml}
    ${weekHtml}

    <p class="page-foot">计划由本地规则生成：前置依赖 + 方向权重 + 每周可投入 ${plan.weeklyHours} 小时；点亮结果会自动同步。</p>`;

  root.onclick = e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    if (action === 'horizon') {
      const weeks = Number(id);
      if (!HORIZONS.includes(weeks) || weeks === getState().plan?.weeks) return;
      setPlan(createPlan(weeks, { weeklyHours: plan.weeklyHours, startAt: plan.startAt }));
      renderPlan(root, handlers);
    } else if (action === 'pace') {
      const hours = Number(id);
      if (!PACE_OPTIONS.includes(hours) || hours === plan.weeklyHours) return;
      setPlan(createPlan(plan.weeks, { weeklyHours: hours, startAt: plan.startAt }));
      renderPlan(root, handlers);
      toast(`已按每周 ${hours} 小时重新排期`, 'success');
    } else if (action === 'export') {
      exportIcs(plan, entries, role);
    } else if (action === 'replan') {
      const current = getState().plan;
      const weeks = current ? current.weeks : DEFAULT_WEEKS;
      setPlan(createPlan(weeks, {
        weeklyHours: current ? current.weeklyHours : DEFAULT_PACE,
        startAt: Date.now()
      }));
      renderPlan(root, handlers);
      if (handlers.onReplan) handlers.onReplan();
    } else if (action === 'challenge') {
      if (handlers.onChallenge) handlers.onChallenge(id);
    } else if (action === 'focus') {
      if (handlers.onFocus) handlers.onFocus(id);
    }
  };

  const startInput = root.querySelector('#plan-start');
  if (startInput) {
    startInput.addEventListener('change', () => {
      const value = startInput.value;
      if (!value) return;
      const next = new Date(`${value}T00:00:00`);
      if (Number.isNaN(next.getTime())) return;
      const current = getState().plan;
      if (!current) return;
      setPlan({ ...current, startAt: next.getTime() });
      renderPlan(root, handlers);
      toast(`计划开始日期已设为 ${formatDate(next.getTime())}`, 'success');
    });
  }
}

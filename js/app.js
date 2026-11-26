import {
  loadData, Data, nodeById, galaxyOf, hardPrereqs, unlocked
} from './data.js';
import {
  load, getState, subscribe, isLit, isClaimed, unlightNode, setDirection, setHighlight
} from './store.js';
import { initBackground, setBackgroundActive } from './background.js';
import {
  initGraph, resetView, focusNode, setHighlight as setGraphHighlight,
  resize as resizeGraph, setGraphActive, onGraphMove
} from './graph.js';
import { openChallenge } from './challenge.js';
import { buildPlan, renderPath } from './path.js';
import { renderPlan } from './plan.js';
import { renderProfile } from './profile.js';
import { openShareCard } from './sharecard.js';
import { openOnboarding } from './onboarding.js';
import { openNodeList } from './nodelist.js';
import { escapeHtml, toast, confirmDialog } from './util.js';
import { loadKnowledgeBase, getLearningGuides, QuestionBank, CHALLENGE_SIZE } from './kb.js';

const views = {
  graph: document.getElementById('view-graph'),
  path: document.getElementById('view-path'),
  plan: document.getElementById('view-plan'),
  profile: document.getElementById('view-profile')
};
const pathRoot = document.getElementById('path-root');
const planRoot = document.getElementById('plan-root');
const profileRoot = document.getElementById('profile-root');
const detail = document.getElementById('detail');
const detailHead = document.getElementById('detail-head');
const detailContent = document.getElementById('detail-content');
const detailFoot = document.getElementById('detail-foot');
const statusBar = document.getElementById('status');
const directionChip = document.getElementById('direction-chip');
const highlightBtn = document.getElementById('toggle-highlight');
const bootEl = document.getElementById('boot');

const passThreshold = () => Data.questionMeta.pass_threshold || 60;

let currentView = 'graph';
let selectedId = null;
let autoOnboardingOpened = false;
let spaceApi = null;

let nebulaApi = null;

/* WebGL 星空可用时优先使用，否则回退到 canvas 星空 */
function setBgActive(active) {
  if (spaceApi) spaceApi.setSpaceActive(active);
  else setBackgroundActive(active);
  if (nebulaApi) nebulaApi.setNebulaFxActive(active);
}

/* 背景视差：星图平移时背景按比例跟随，缩放时轻微放大，让背景与星图连成一体 */
let fxLayer = null;
let bgBase = null;

function updateBgParallax({ cx, cy, k }) {
  if (!fxLayer) fxLayer = document.getElementById('nebula-fx');
  if (!fxLayer) return;
  if (!bgBase) bgBase = { cx, cy, k };
  const PAN = 0.14;
  const scale = Math.min(1.3, Math.max(1, Math.pow(k / bgBase.k, 0.32)));
  const tx = -(cx - bgBase.cx) * k * PAN;
  const ty = -(cy - bgBase.cy) * k * PAN;
  fxLayer.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
}

/* ============ 视图切换 ============ */
function setView(name, opts = {}) {
  if (!views[name]) name = 'graph';
  currentView = name;
  document.body.dataset.view = name;

  Object.keys(views).forEach(key => {
    const el = views[key];
    if (!el) return;
    if (key === name) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });

  document.querySelectorAll('.tab, .bottom-tab').forEach(btn => {
    const active = btn.dataset.view === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    if (btn.getAttribute('role') === 'tab') btn.tabIndex = active ? 0 : -1;
  });

  closeDetail();

  // 非星图视图或页面隐藏时停掉星图与背景动画，省电降耗
  const animate = name === 'graph' && !document.hidden;
  setGraphActive(animate);
  setBgActive(animate);

  if (name === 'graph') {
    updateHighlight();
    updateStatus();
  } else if (name === 'path') {
    renderPathView();
  } else if (name === 'plan') {
    renderPlanView();
  } else if (name === 'profile') {
    renderProfileView();
  }

  if (!opts.fromHash) {
    const target = '#' + name;
    if (location.hash !== target) history.replaceState(null, '', target);
  }
}

function wireNav() {
  document.querySelectorAll('.tab, .bottom-tab').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  const tabs = document.getElementById('tabs');
  if (tabs) {
    tabs.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const buttons = [...tabs.querySelectorAll('.tab')];
      const index = buttons.indexOf(document.activeElement);
      if (index === -1) return;
      e.preventDefault();
      const next = buttons[(index + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      next.focus();
      setView(next.dataset.view);
    });
  }

  window.addEventListener('hashchange', () => {
    const name = (location.hash || '#graph').slice(1);
    setView(name, { fromHash: true });
  });

  document.getElementById('help-btn').addEventListener('click', openOnboardingFlow);
  directionChip.addEventListener('click', openDirectionPicker);

  document.getElementById('reset-view').addEventListener('click', () => {
    resetView();
    closeDetail();
  });

  document.getElementById('node-list').addEventListener('click', () => {
    openNodeList({
      onSelect: id => {
        setView('graph');
        setTimeout(() => {
          focusNode(id);
          openDetail(id);
        }, 90);
      }
    });
  });

  document.addEventListener('visibilitychange', () => {
    const animate = !document.hidden && currentView === 'graph';
    setGraphActive(animate);
    setBgActive(animate);
  });

  highlightBtn.addEventListener('click', () => {
    const state = getState();
    setHighlight(!state.settings.highlight);
    updateHighlight();
    toast(state.settings.highlight ? '已开启推荐高亮' : '已关闭推荐高亮', 'info');
  });

  document.querySelectorAll('[data-close-detail]').forEach(btn => {
    btn.addEventListener('click', closeDetail);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDetail();
  });

  window.addEventListener('resize', () => resizeGraph());
}

/* ============ 详情卡 ============ */
function chipHtml(ids) {
  return ids.map(id => {
    const n = nodeById(id);
    const done = isLit(id);
    return `<span class="${done ? 'done' : ''}">${escapeHtml(n ? n.name : id)}</span>`;
  }).join('');
}

function openDetail(id) {
  const node = nodeById(id);
  if (!node) return;
  selectedId = id;

  const g = galaxyOf(node);
  const color = g ? g.color : '#9dc7ff';
  const lit = isLit(id);
  const claimed = isClaimed(id);
  const ready = unlocked(node, getState().lit);
  const prereqIds = hardPrereqs(id);
  const anyOf = node.any_of || [];
  const record = getState().records[id];
  const templateCount = getLearningGuides(id)?.questionTemplates?.length || 0;
  
  // 知识库信息
  const guide = getLearningGuides(id);

  let prereqHtml = '';
  if (prereqIds.length || anyOf.length) {
    prereqHtml = `
      <div class="detail-section">
        <div class="detail-label">前置依赖</div>
        ${prereqIds.length ? `<div class="chips">${chipHtml(prereqIds)}</div>` : ''}
        ${anyOf.length ? `<div class="chips gap"><span class="chips-label">任一即可</span>${chipHtml(anyOf)}</div>` : ''}
      </div>`;
  } else {
    prereqHtml = `
      <div class="detail-section">
        <div class="detail-label">前置依赖</div>
        <div class="chips"><span class="done">起点星 · 无前置</span></div>
      </div>`;
  }

  // 原有资源 + 知识库资源合并
  const existingResources = (node.resources && node.resources.length)
    ? node.resources.map(r => r.url
      ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener"><i class="res-mark" aria-hidden="true"></i><span>${escapeHtml(r.title)}</span></a>`
      : `<div class="resource"><i class="res-mark" aria-hidden="true"></i><span>${escapeHtml(r.title)}</span></div>`).join('')
    : '';
    
  const learnRefs = guide?.learn || [];
  const practiceRefs = guide?.practice || [];
  
  let resourcesHtml = existingResources || '<div class="resource muted">暂未收录学习资源</div>';
  if (learnRefs.length) {
    resourcesHtml += `<div class="section-title" style="margin-top:12px">推荐学习</div>`;
    resourcesHtml += learnRefs.map(r => 
      `<a href="${escapeHtml(r.url || '#')}" target="_blank" rel="noopener" class="kb-resource"><i class="res-mark" aria-hidden="true"></i><span>${escapeHtml(r.title)}</span></a>`
    ).join('');
  }
  if (practiceRefs.length) {
    resourcesHtml += `<div class="section-title" style="margin-top:12px">练习平台</div>`;
    resourcesHtml += practiceRefs.map(r => 
      `<a href="${escapeHtml(r.url || '#')}" target="_blank" rel="noopener" class="kb-resource"><i class="res-mark" aria-hidden="true"></i><span>${escapeHtml(r.title)}</span></a>`
    ).join('');
  }

  const threshold = passThreshold();
  
  // 题量以 CHALLENGE_SIZE 为唯一来源，避免与挑战弹窗不一致
  
  /* ---- 吸底行动区：一个主行动 + 可选次级文字按钮 ---- */
  let footHtml = '';
  if (lit) {
    footHtml = `
      <p class="detail-state">✦ 已点亮${record ? ` · 最好 ${record.best} 分` : ''}</p>
      <button class="detail-cta" data-act="challenge" data-id="${id}">重新挑战</button>
      <button class="detail-link" data-act="unlight" data-id="${id}">撤销点亮</button>`;
  } else if (ready) {
    footHtml = `
      ${claimed ? '<p class="detail-note">自评已了解，等待一次客观验证。</p>' : ''}
      <button class="detail-cta" data-act="challenge" data-id="${id}">开始挑战</button>
      <p class="detail-sub">${CHALLENGE_SIZE} 题 · ${threshold} 分及格 · 通过后点亮</p>`;
  } else {
    const missing = prereqIds.filter(pid => !isLit(pid)).map(pid => nodeById(pid)?.name || pid);
    const tip = missing.length
      ? `还需点亮：${missing.map(escapeHtml).join('、')}`
      : `需先掌握任一门：${anyOf.map(pid => nodeById(pid)?.name || pid).map(escapeHtml).join(' / ')}`;
    footHtml = `
      <button class="detail-cta" disabled>前置未满足</button>
      <p class="detail-sub">${tip}</p>`;
  }
  
  // 可考方向（收敛为一行标签，不再解释）
  let templatesHtml = '';
  if (templateCount) {
    templatesHtml = `
      <div class="detail-section">
        <div class="detail-label">可考方向 <em>${templateCount} 个模板</em></div>
        <div class="kb-templates">
          ${guide.questionTemplates.slice(0, 4).map(t => `<span class="kb-template-tag">${escapeHtml(t)}</span>`).join('')}
          ${templateCount > 4 ? `<span class="kb-template-more">+${templateCount - 4}</span>` : ''}
        </div>
      </div>`;
  }

  detailHead.innerHTML = `
    <h2>${escapeHtml(node.name)}</h2>
    <div class="detail-tags">
      <span class="detail-tag" style="color:${color};border-color:${color}55">${escapeHtml(g ? g.name : '未分类')}</span>
      ${lit ? '<span class="detail-tag is-lit">已点亮</span>'
        : claimed ? '<span class="detail-tag is-claimed">待验证</span>'
        : '<span class="detail-tag">未点亮</span>'}
    </div>`;

  detailContent.innerHTML = `
    <div class="detail-metrics">
      <div><span>重要度</span><b>${node.importance} / 5</b></div>
      <div><span>难度</span><b>${node.complexity} / 5</b></div>
      <div><span>题量</span><b>${CHALLENGE_SIZE} 题</b></div>
    </div>
    <p class="desc">${escapeHtml(node.description)}</p>
    ${prereqHtml}
    ${templatesHtml}
    <div class="detail-section">
      <div class="detail-label">学习资源</div>
      <div class="resources">${resourcesHtml}</div>
    </div>`;

  detailFoot.innerHTML = footHtml;
  detail.classList.add('show');
  detailContent.scrollTop = 0;
}

function closeDetail() {
  selectedId = null;
  detail.classList.remove('show');
}

detail.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'challenge') {
    openChallenge(id, {
      onChange: () => {
        updateStatus();
        if (currentView === 'path') renderPathView();
      }
    });
  } else if (btn.dataset.act === 'unlight') {
    const node = nodeById(id);
    const ok = await confirmDialog({
      title: '撤销点亮？',
      message: `「${node ? node.name : id}」会重新变暗，但历史挑战记录仍会保留。`,
      confirmText: '撤销',
      danger: true
    });
    if (!ok) return;
    unlightNode(id);
    openDetail(id);
    toast('已撤销点亮', 'warn');
  }
});

/* ============ 状态与高亮 ============ */
function updateStatus() {
  if (!Data.loaded) return;
  const state = getState();
  const role = Data.roleById[state.direction] || Data.roles[0];
  const litCount = Object.keys(state.lit).length;
  const plan = buildPlan();
  const next = plan.ready[0];
  statusBar.innerHTML = `
    <span class="status-line">已点亮 <b>${litCount}</b> / ${Data.nodes.length} · ${escapeHtml(role.name)}</span>
    <span class="status-line dim">${next ? `下一颗：${escapeHtml(next.node.name)}` : '当前可挑战节点已完成'} · 滚轮缩放 · 点击星星</span>`;
}

function updateDirectionChip() {
  const state = getState();
  const role = Data.roleById[state.direction] || Data.roles[0];
  directionChip.textContent = `方向 · ${role ? role.name : '未选择'}`;
  directionChip.title = '点击切换目标方向';
}

function updateHighlight() {
  if (!Data.loaded) return;
  const state = getState();
  if (!state.settings.highlight) {
    setGraphHighlight([]);
  } else {
    const plan = buildPlan();
    // 只高亮最近的下一关，避免整张图都在发光
    setGraphHighlight(plan.ready.slice(0, 1).map(item => item.node.id));
  }
  highlightBtn.textContent = state.settings.highlight ? '推荐高亮 · 开' : '推荐高亮 · 关';
  highlightBtn.setAttribute('aria-pressed', state.settings.highlight ? 'true' : 'false');
}

function updateAll() {
  updateStatus();
  updateDirectionChip();
  updateHighlight();
}

/* ============ 路径 / 我的 ============ */
function renderPathView() {
  renderPath(pathRoot, {
    onChallenge: id => openChallenge(id, {
      onChange: () => {
        updateStatus();
        if (currentView === 'path') renderPathView();
      }
    }),
    onFocus: id => {
      setView('graph');
      setTimeout(() => {
        focusNode(id);
        openDetail(id);
      }, 80);
    }
  });
}

function renderPlanView() {
  renderPlan(planRoot, {
    onChallenge: id => openChallenge(id, {
      onChange: () => {
        updateStatus();
        if (currentView === 'plan') renderPlanView();
        if (currentView === 'path') renderPathView();
      }
    }),
    onFocus: id => {
      setView('graph');
      setTimeout(() => {
        focusNode(id);
        openDetail(id);
      }, 80);
    },
    onReplan: () => toast('已从今天重新排期，任务按当前进度重排', 'success')
  });
}

function renderProfileView() {
  renderProfile(profileRoot, {
    onDirection: id => {
      setDirection(id);
      setView('path');
    },
    onOnboarding: () => openOnboardingFlow(),
    onReview: id => openChallenge(id, {
      onChange: () => {
        updateAll();
        if (currentView === 'profile') renderProfileView();
      }
    }),
    onShare: () => openShareCard(),
    onInstall: () => promptInstall(),
    onReset: () => {
      updateAll();
      setView('graph');
    },
    onDataChanged: () => {
      updateAll();
      if (currentView === 'profile') renderProfileView();
    }
  });
  syncInstallButton();
}

/* ============ 安装与离线 ============ */
let installPrompt = null;

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

function syncInstallButton() {
  const btn = document.getElementById('install-app');
  if (btn) btn.hidden = isStandalone();
}

async function promptInstall() {
  if (!installPrompt) {
    toast('当前浏览器没有提供安装入口，可用浏览器菜单中的「安装应用 / 添加到主屏幕」', 'info');
    return;
  }
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const choice = await prompt.userChoice;
  syncInstallButton();
  if (choice && choice.outcome === 'accepted') toast('正在安装「知识星图」', 'success');
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  syncInstallButton();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  syncInstallButton();
  toast('「知识星图」已安装到桌面', 'success');
});

/* ============ 方向选择 ============ */
function openDirectionPicker() {
  const state = getState();
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal direction-modal" role="dialog" aria-modal="true" aria-labelledby="dir-title">
      <button class="modal-close" data-act="close" aria-label="关闭">✕</button>
      <header class="modal-head">
        <span class="eyebrow">目标方向</span>
        <h2 id="dir-title">你想先去哪片星域</h2>
        <p class="modal-sub">方向只影响推荐顺序和岗位匹配，随时可以切换。</p>
      </header>
      <div class="role-grid picker">
        ${Data.roles.map(r => `
          <button class="role-card ${r.id === state.direction ? 'selected' : ''}" data-role="${r.id}">
            <b>${escapeHtml(r.name)}</b>
            <span>${escapeHtml(r.tagline)}</span>
            <em>${escapeHtml(r.short)}</em>
          </button>`).join('')}
      </div>
    </div>`;
  document.getElementById('modal-root').appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const onKey = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-act="close"]')) {
      close();
      return;
    }
    const btn = e.target.closest('[data-role]');
    if (!btn) return;
    const role = Data.roleById[btn.dataset.role];
    close();
    setDirection(btn.dataset.role);
    toast(`目标方向已切换为「${role ? role.name : btn.dataset.role}」`, 'success');
  });

  const first = overlay.querySelector('.role-card');
  if (first) first.focus();
}

/* ============ 引导 ============ */
function openOnboardingFlow() {
  openOnboarding({
    onFinish: () => {
      updateAll();
      setView('graph');
      if (currentView === 'path') renderPathView();
      if (currentView === 'profile') renderProfileView();
    }
  });
}

/* ============ 启动 ============ */
function showBootError(message) {
  if (!bootEl) return;
  bootEl.querySelector('.boot-intro-canvas')?.remove();
  bootEl.classList.remove('intro-armed');
  bootEl.innerHTML = `
    <div class="boot-inner">
      <div class="boot-mark">✦</div>
      <h1>知识星图加载失败</h1>
      <p class="boot-error">${escapeHtml(message)}</p>
      <p class="boot-hint">请确认在项目目录下运行了本地服务，例如：<code>python -m http.server 8765</code>，然后访问 <code>http://localhost:8765/index.html</code>。</p>
    </div>`;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function boot() {
  load();
  registerServiceWorker();

  // 启动动画与数据加载并行；动画跑到收尾才开始揭示界面
  let introPromise = null;
  if (bootEl) {
    introPromise = import('./intro.js')
      .then(mod => mod.playIntro({ host: bootEl, emblem: bootEl.querySelector('.boot-emblem') }))
      .catch(() => { bootEl.classList.add('stage-on'); });
  }

  try {
    await Promise.all([loadData(), loadKnowledgeBase()]);
  } catch (err) {
    console.error(err);
    showBootError(err.message || '数据加载失败');
    return;
  }
  if (introPromise) {
    // 兜底：标签页在后台时 rAF 不触发，最多等 5.4s 就继续揭示
    await Promise.race([introPromise, new Promise(resolve => setTimeout(resolve, 5400))]);
    // 图标接管后停留片刻，让观众看清完整的星旋，再进入星图
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  if (bootEl) bootEl.classList.add('stage-on');

  // 背景优先用 WebGL 星空；加载失败或 WebGL 不可用时回退到原来的 canvas 星空
  try {
    const mod = await import('./space.js');
    if (mod.initSpace(document.getElementById('space-bg'))) {
      spaceApi = mod;
      document.getElementById('starfield')?.remove();
    }
  } catch (err) {
    console.warn('WebGL 星空初始化失败，回退 canvas 星空', err);
  }
  if (!spaceApi) initBackground();

  // 程序化星云层：WebGL 不可用时保留纯星空
  try {
    const nb = await import('./nebula.js');
    nebulaApi = nb.initNebulaFx(document.getElementById('nebula-fx'));
    if (nebulaApi) nebulaApi.setNebulaFxActive(currentView === 'graph' && !document.hidden);
  } catch (err) {
    console.warn('程序化星云初始化失败，继续使用星空背景', err);
  }

  try {
    onGraphMove(updateBgParallax);
    initGraph(document.getElementById('graph-container'), {
      onSelectNode: id => openDetail(id),
      onBackgroundClick: closeDetail
    });
  } catch (err) {
    console.error(err);
    showBootError(err.message || '星图初始化失败');
    return;
  }

  wireNav();
  updateAll();

  const initial = (location.hash || '#graph').slice(1);
  setView(initial, { fromHash: true });

  subscribe(({ type }) => {
    updateAll();
    // 计划自身的写入由计划页负责重绘，避免递归渲染
    if (type === 'plan') return;
    if (currentView === 'path') renderPathView();
    if (currentView === 'plan') renderPlanView();
    if (currentView === 'profile') renderProfileView();
    if (currentView === 'graph' && selectedId) openDetail(selectedId);
  });

  if (bootEl) {
    bootEl.classList.add('hidden');
    setTimeout(() => bootEl.remove(), 520);
  }

  if (!getState().onboarding.done && !autoOnboardingOpened) {
    autoOnboardingOpened = true;
    setTimeout(() => openOnboardingFlow(), 520);
  }
}

boot();

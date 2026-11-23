import { Data, nodeById, galaxyOf, questionsFor } from './data.js';
import { getState, completeOnboarding } from './store.js';
import { escapeHtml, toast } from './util.js';

const MAJORS = ['计算机科学与技术', '软件工程', '人工智能', '信息安全', '数据科学', '其他 / 尚未确定'];
const GRADES = ['大一', '大二', '大三', '大四', '研究生'];
const QUIZ_POOL = [
  'python', 'c', 'algo_complexity', 'ds_array', 'net_http',
  'db_rel', 'eng_git', 'sys_os', 'se_arch', 'sec_web', 'math_discrete', 'ai_ml'
];
const STEP_NAMES = ['基本信息', '自我评估', '摸底小测', '目标方向'];

let active = null;

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickQuiz() {
  const picked = [];
  for (const id of shuffle(QUIZ_POOL)) {
    const choices = questionsFor(id).filter(q => q.type === 'choice');
    if (!choices.length) continue;
    picked.push({ nodeId: id, question: choices[Math.floor(Math.random() * choices.length)] });
    if (picked.length >= 6) break;
  }
  return picked;
}

export function openOnboarding(options = {}) {
  if (active) return;
  const state = getState();
  const draft = {
    step: 0,
    major: state.onboarding.major || '',
    grade: state.onboarding.grade || '',
    selfRated: new Set(state.onboarding.selfRated || []),
    direction: state.direction,
    quiz: pickQuiz(),
    answers: {},
    quizDone: false
  };

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop onboard-backdrop';
  overlay.innerHTML = `
    <div class="modal onboard-modal" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div class="onboard-top">
        <div class="ob-steps" id="ob-steps"></div>
        <button class="modal-close" data-act="close" aria-label="关闭引导">✕</button>
      </div>
      <div class="onboard-body" id="ob-body"></div>
      <div class="onboard-foot" id="ob-foot"></div>
    </div>`;
  document.getElementById('modal-root').appendChild(overlay);

  const body = overlay.querySelector('#ob-body');
  const foot = overlay.querySelector('#ob-foot');
  const stepsEl = overlay.querySelector('#ob-steps');
  const previousFocus = document.activeElement;

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    active = null;
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  };

  const trap = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      toast('已退出引导，下次进入会再次出现', 'info');
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea')]
      .filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const onKey = e => trap(e);
  document.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) return;
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === 'close') close();
    else if (act === 'next') goNext();
    else if (act === 'back') goBack();
    else if (act === 'skip') skip();
    else if (act === 'finish') finish();
  });

  overlay.addEventListener('change', e => {
    const target = e.target;
    if (target.matches('[data-self]')) {
      const id = target.value;
      if (target.checked) draft.selfRated.add(id);
      else draft.selfRated.delete(id);
      const counter = body.querySelector('[data-self-count]');
      if (counter) counter.textContent = draft.selfRated.size;
    }
    if (target.matches('input[name="direction"]')) {
      draft.direction = target.value;
      body.querySelectorAll('.role-card').forEach(card => {
        card.classList.toggle('selected', card.querySelector('input').checked);
      });
    }
  });

  function renderSteps() {
    if (draft.step === 0 || draft.step === 4) {
      stepsEl.innerHTML = '';
      return;
    }
    stepsEl.innerHTML = STEP_NAMES.map((name, i) => {
      const index = i + 1;
      const cls = index < draft.step ? 'done' : index === draft.step ? 'active' : '';
      return `<div class="ob-step ${cls}"><i>${index < draft.step ? '✓' : index}</i><span>${name}</span></div>`;
    }).join('<span class="ob-line"></span>');
  }

  function header(eyebrow, title, sub) {
    return `<header class="onboard-head">
      <span class="eyebrow">${escapeHtml(eyebrow)}</span>
      <h2 id="ob-title" tabindex="-1">${escapeHtml(title)}</h2>
      <p>${sub}</p>
    </header>`;
  }

  function render() {
    renderSteps();
    if (draft.step === 0) renderWelcome();
    else if (draft.step === 1) renderProfileStep();
    else if (draft.step === 2) renderQuiz();
    else if (draft.step === 3) renderDirection();
    else renderSummary();
    foot.innerHTML = `<div class="modal-actions">${actionsForStep()}</div>`;
    const title = body.querySelector('h2');
    if (title) title.focus({ preventScroll: true });
  }

  function actionsForStep() {
    if (draft.step === 0) {
      return `<button class="btn ghost" data-act="skip">跳过，直接逛星图</button>
        <button class="btn primary" data-act="next">开始</button>`;
    }
    if (draft.step === 1) {
      return `<button class="btn ghost" data-act="back">上一步</button>
        <button class="btn primary" data-act="next">下一步</button>`;
    }
    if (draft.step === 2) {
      return `<button class="btn ghost" data-act="back">上一步</button>
        <button class="btn primary" data-act="next">提交并继续</button>`;
    }
    if (draft.step === 3) {
      return `<button class="btn ghost" data-act="back">上一步</button>
        <button class="btn primary" data-act="next">生成我的星图</button>`;
    }
    return `<button class="btn ghost" data-act="back">返回修改</button>
      <button class="btn primary" data-act="finish">进入星图</button>`;
  }

  function renderWelcome() {
    body.innerHTML = `
      ${header('3 分钟入门', '先把星图变成你的',
        '回答几个问题，我们会生成一条适合你的起始路径。所有数据只保存在本地浏览器。')}
      <div class="welcome-grid">
        <div class="welcome-item">
          <b>① 基本信息</b>
          <p>专业与年级，决定推荐的起点难度。</p>
        </div>
        <div class="welcome-item">
          <b>② 自我评估</b>
          <p>勾选你确定学过的内容，它们会进入待验证区。</p>
        </div>
        <div class="welcome-item">
          <b>③ 摸底小测</b>
          <p>6 道选择题，答对即可直接点亮对应知识点。</p>
        </div>
        <div class="welcome-item">
          <b>④ 目标方向</b>
          <p>后端 / 前端 / AI / 安全 / 系统 / 算法，路径会随之调整。</p>
        </div>
      </div>
      <p class="onboard-hint">自评不会直接点亮星星，只有通过客观挑战或摸底答对才会点亮。</p>`;
  }

  function renderProfileStep() {
    const majorOptions = MAJORS.map(m => `<option value="${escapeHtml(m)}" ${draft.major === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
    const gradeOptions = GRADES.map(g => `<option value="${escapeHtml(g)}" ${draft.grade === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('');

    const selfHtml = Data.galaxies.map(g => {
      const nodes = Data.nodes.filter(n => n.galaxy === g.id);
      return `<div class="self-group">
        <div class="self-galaxy" style="color:${g.color}">${escapeHtml(g.name)}</div>
        <div class="self-chips">
          ${nodes.map(n => `<label class="self-chip">
            <input type="checkbox" data-self value="${n.id}" ${draft.selfRated.has(n.id) ? 'checked' : ''}>
            <span>${escapeHtml(n.name)}</span>
          </label>`).join('')}
        </div>
      </div>`;
    }).join('');

    body.innerHTML = `
      ${header('第 1 步 · 基本信息', '先认识一下你',
        '这些信息只用于调整推荐顺序，不会上传到任何服务器。')}
      <div class="form-row">
        <label class="field">
          <span>专业</span>
          <select id="ob-major"><option value="">请选择</option>${majorOptions}</select>
        </label>
        <label class="field">
          <span>年级</span>
          <select id="ob-grade"><option value="">请选择</option>${gradeOptions}</select>
        </label>
      </div>
      <div class="self-head">
        <h3>你已经系统学过哪些？</h3>
        <span class="muted small">已选 <b data-self-count>${draft.selfRated.size}</b> 项 · 可跳过</span>
      </div>
      <p class="muted small">勾选后标记为「待验证」，不会直接点亮。请只勾选你确定学过、能经得起提问的内容。</p>
      <div class="self-groups">${selfHtml}</div>`;
  }

  function renderQuiz() {
    const quizHtml = draft.quiz.map((item, qi) => {
      const node = nodeById(item.nodeId);
      const g = galaxyOf(node);
      const q = item.question;
      return `<li class="quiz-item">
        <div class="quiz-head">
          <span class="quiz-index">${qi + 1}</span>
          <span class="quiz-node" style="color:${g.color}">${escapeHtml(node.name)}</span>
        </div>
        <p class="quiz-stem">${escapeHtml(q.stem)}</p>
        <div class="options compact">
          ${q.options.map((opt, oi) => `
            <label class="option">
              <input type="radio" name="quiz-${qi}" value="${oi}" ${draft.answers[qi] === oi ? 'checked' : ''}>
              <span class="option-key">${String.fromCharCode(65 + oi)}</span>
              <span class="option-text">${escapeHtml(opt)}</span>
            </label>`).join('')}
        </div>
      </li>`;
    }).join('');

    body.innerHTML = `
      ${header('第 2 步 · 摸底小测', '用 6 道题校准起点',
        '答对即可点亮对应知识点，答错也没关系，之后可以重新挑战。')}
      <ol class="quiz-list">${quizHtml}</ol>`;
  }

  function renderDirection() {
    const cards = Data.roles.map(r => `
      <label class="role-card ${draft.direction === r.id ? 'selected' : ''}">
        <input type="radio" name="direction" value="${r.id}" ${draft.direction === r.id ? 'checked' : ''}>
        <b>${escapeHtml(r.name)}</b>
        <span>${escapeHtml(r.tagline)}</span>
        <em>${escapeHtml(r.short)}</em>
      </label>`).join('');
    body.innerHTML = `
      ${header('第 3 步 · 目标方向', '你现在更想往哪走',
        '方向只影响推荐顺序与岗位匹配，随时可以在「成长路径」里切换。')}
      <div class="role-grid">${cards}</div>`;
  }

  function renderSummary() {
    const correctItems = draft.quiz.filter((item, i) => draft.answers[i] === item.question.answer);
    const role = Data.roleById[draft.direction];
    const correctNames = correctItems.map(item => nodeById(item.nodeId).name);
    body.innerHTML = `
      ${header('准备完成', '你的起始星图已就绪',
        '下面的结果会在进入星图时写入本地存档，之后随时可以撤销或重新挑战。')}
      <div class="summary-grid">
        <div class="summary-item">
          <span>目标方向</span>
          <b>${escapeHtml(role ? role.name : draft.direction)}</b>
        </div>
        <div class="summary-item">
          <span>摸底成绩</span>
          <b>${correctItems.length} / ${draft.quiz.length}</b>
        </div>
        <div class="summary-item">
          <span>直接点亮</span>
          <b>${correctItems.length} 颗</b>
        </div>
        <div class="summary-item">
          <span>待验证自评</span>
          <b>${draft.selfRated.size} 项</b>
        </div>
      </div>
      ${correctNames.length
        ? `<p class="summary-note">✦ 将点亮：${correctNames.map(escapeHtml).join('、')}</p>`
        : '<p class="summary-note">这次摸底没有答对，没关系，从零开始点亮第一颗星。</p>'}
      <p class="onboard-hint">建议先点亮 3–5 颗核心星，再进行第一次完整挑战。</p>`;
  }

  function captureProfile() {
    const majorEl = body.querySelector('#ob-major');
    const gradeEl = body.querySelector('#ob-grade');
    if (majorEl) draft.major = majorEl.value;
    if (gradeEl) draft.grade = gradeEl.value;
  }

  function captureQuiz() {
    draft.quiz.forEach((_, i) => {
      const checked = body.querySelector(`input[name="quiz-${i}"]:checked`);
      if (checked) draft.answers[i] = Number(checked.value);
      else delete draft.answers[i];
    });
  }

  function goNext() {
    if (draft.step === 1) captureProfile();
    if (draft.step === 2) {
      captureQuiz();
      const missing = draft.quiz.filter((_, i) => draft.answers[i] == null);
      if (missing.length) {
        toast(`还有 ${missing.length} 道题没有作答`, 'warn');
        return;
      }
      draft.quizDone = true;
    }
    if (draft.step >= 4) return;
    draft.step += 1;
    render();
    body.scrollTop = 0;
  }

  function goBack() {
    if (draft.step <= 0) return;
    draft.step -= 1;
    render();
    body.scrollTop = 0;
  }

  function finish() {
    const correct = draft.quiz.filter((item, i) => draft.answers[i] === item.question.answer);
    completeOnboarding({
      major: draft.major,
      grade: draft.grade,
      selfRated: [...draft.selfRated],
      direction: draft.direction,
      quiz: { correct: correct.length, total: draft.quiz.length },
      litIds: correct.map(item => item.nodeId)
    });
    close();
    toast(`✦ 起始星图已生成，点亮 ${correct.length} 颗星`, 'success');
    if (options.onFinish) options.onFinish();
  }

  function skip() {
    const state = getState();
    completeOnboarding({
      major: state.onboarding.major || '',
      grade: state.onboarding.grade || '',
      selfRated: state.onboarding.selfRated || [],
      direction: state.direction,
      quiz: { correct: 0, total: 0 },
      litIds: []
    });
    close();
    toast('已跳过引导，可随时点击右上角 ? 重做', 'info');
    if (options.onFinish) options.onFinish();
  }

  render();
  active = { close };
}

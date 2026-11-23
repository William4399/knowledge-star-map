import { Data, nodeById, galaxyOf, questionsFor } from './data.js';
import { getState, passChallenge, failChallenge } from './store.js';
import { escapeHtml, toast } from './util.js';

let active = null;

export function openChallenge(nodeId, options = {}) {
  if (active) return;
  const node = nodeById(nodeId);
  const questions = questionsFor(nodeId);
  if (!node || !questions.length) {
    toast('这个知识点暂时没有可用题目', 'warn');
    return;
  }

  const threshold = Data.questionMeta.pass_threshold || 60;
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop challenge-backdrop';
  overlay.innerHTML = `
    <div class="modal challenge-modal" role="dialog" aria-modal="true" aria-labelledby="ch-title">
      <button class="modal-close" data-act="close" aria-label="关闭挑战">✕</button>
      <div class="modal-body" id="ch-body"></div>
    </div>`;
  document.getElementById('modal-root').appendChild(overlay);

  const body = overlay.querySelector('#ch-body');
  const previousFocus = document.activeElement;
  const local = { index: 0, answers: {}, phase: 'intro', result: null };
  const g = galaxyOf(node);
  const color = g ? g.color : '#6ce7a8';

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    active = null;
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    if (options.onClose) options.onClose();
  };

  const trap = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...overlay.querySelectorAll('button:not([disabled]), input, textarea')]
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
    if (e.target === overlay) {
      if (local.phase !== 'questions') close();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const action = act.dataset.act;
    if (action === 'close') close();
    else if (action === 'start') startQuestions();
    else if (action === 'next') step(1);
    else if (action === 'prev') step(-1);
    else if (action === 'submit') submit();
    else if (action === 'retry') startQuestions();
    else if (action === 'done') close();
  });

  function headerHtml(eyebrow, title, sub) {
    return `<header class="modal-head">
      <span class="eyebrow">${escapeHtml(eyebrow)}</span>
      <h2 id="ch-title" tabindex="-1">${escapeHtml(title)}</h2>
      <p class="modal-sub">${sub}</p>
    </header>`;
  }

  function intro() {
    local.phase = 'intro';
    const record = getState().records[node.id];
    const lit = !!getState().lit[node.id];
    body.innerHTML = `
      ${headerHtml('能力验证 · ' + (g ? g.name : '知识点'), node.name,
        `<span class="tag" style="color:${color};border-color:${color}66">${g ? g.name : '未分类'}</span>
         ${node.core ? '<span class="tag core">核心</span>' : ''}`)}
      <div class="challenge-meta">
        <div><b>${questions.length}</b><span>题</span></div>
        <div><b>${threshold}</b><span>分及格</span></div>
        <div><b>${record ? record.best : '—'}</b><span>历史最好</span></div>
        <div><b>${record ? record.attempts : 0}</b><span>挑战次数</span></div>
      </div>
      ${lit ? '<p class="challenge-note good">✦ 这颗星已点亮。重新挑战可以刷新你的最好成绩。</p>'
            : '<p class="challenge-note">通过挑战后，这颗星才会真正点亮，并计入能力档案。</p>'}
      <div class="rules">
        <h3>判分规则</h3>
        <ul>
          <li>选择题：答对得满分，答错不得分。</li>
          <li>简答题：命中关键词达到要求即通过，否则只给少量部分分。</li>
          <li>总分 ≥ ${threshold} 且所有简答题达标，才算通过。</li>
        </ul>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close">稍后再来</button>
        <button class="btn primary" data-act="start">${lit ? '重新挑战' : '开始挑战'}</button>
      </div>`;
    focusTitle();
  }

  function startQuestions() {
    local.phase = 'questions';
    local.index = 0;
    local.answers = {};
    local.result = null;
    renderQuestion();
  }

  function renderQuestion() {
    const q = questions[local.index];
    const answer = local.answers[local.index];
    const isLast = local.index === questions.length - 1;

    let inputHtml = '';
    if (q.type === 'choice') {
      inputHtml = `<div class="options">${q.options.map((opt, i) => `
        <label class="option">
          <input type="radio" name="q-option" value="${i}" ${answer === i ? 'checked' : ''}>
          <span class="option-key">${String.fromCharCode(65 + i)}</span>
          <span class="option-text">${escapeHtml(opt)}</span>
        </label>`).join('')}</div>`;
    } else {
      inputHtml = `<textarea class="short-input" rows="4" maxlength="400"
        placeholder="用 1-2 句话作答，系统会按关键词判分">${escapeHtml(answer || '')}</textarea>
        <p class="input-hint">关键词判分，不需要和参考答案逐字一致。</p>`;
    }

    body.innerHTML = `
      <header class="challenge-progress">
        <div class="progress-text">第 ${local.index + 1} / ${questions.length} 题
          <span class="q-type">${q.type === 'choice' ? '单选' : '简答'}</span>
        </div>
        <div class="progress-track"><i style="width:${((local.index + 1) / questions.length) * 100}%"></i></div>
      </header>
      <div class="question">
        <h2 class="question-stem">${escapeHtml(q.stem)}</h2>
        ${inputHtml}
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="prev" ${local.index === 0 ? 'disabled' : ''}>上一题</button>
        ${isLast
          ? '<button class="btn primary" data-act="submit">提交答卷</button>'
          : '<button class="btn primary" data-act="next">下一题</button>'}
      </div>`;
    focusTitle(true);
  }

  function capture() {
    const q = questions[local.index];
    if (q.type === 'choice') {
      const checked = body.querySelector('input[name="q-option"]:checked');
      if (checked) local.answers[local.index] = Number(checked.value);
      else delete local.answers[local.index];
    } else {
      const ta = body.querySelector('.short-input');
      const value = ta ? ta.value.trim() : '';
      if (value) local.answers[local.index] = ta.value;
      else delete local.answers[local.index];
    }
  }

  function step(delta) {
    capture();
    const next = local.index + delta;
    if (next < 0 || next >= questions.length) return;
    local.index = next;
    renderQuestion();
  }

  function scoreAnswer(q, ans) {
    if (q.type === 'choice') {
      const ok = ans === q.answer;
      return { ok, score: ok ? 1 : 0, hits: [], missing: [] };
    }
    const text = String(ans || '').toLowerCase();
    const hits = q.keywords.filter(k => text.includes(k.toLowerCase()));
    const missing = q.keywords.filter(k => !hits.includes(k));
    const ok = hits.length >= q.minHits;
    const ratio = q.keywords.length ? hits.length / q.keywords.length : 0;
    return { ok, score: ok ? 1 : Math.min(0.6, ratio * 0.6), hits, missing };
  }

  function submit() {
    capture();
    const unanswered = questions.findIndex((q, i) => local.answers[i] == null || local.answers[i] === '');
    if (unanswered !== -1) {
      local.index = unanswered;
      renderQuestion();
      toast(`第 ${unanswered + 1} 题还没有作答`, 'warn');
      return;
    }

    const details = questions.map((q, i) => ({ q, ans: local.answers[i], ...scoreAnswer(q, local.answers[i]) }));
    const total = Math.round((details.reduce((sum, d) => sum + d.score, 0) / details.length) * 100);
    const allShortOk = details.every(d => d.q.type !== 'short' || d.ok);
    const passed = total >= threshold && allShortOk;

    const state = getState();
    const alreadyLit = !!state.lit[node.id];
    if (passed) passChallenge(node.id, total);
    else failChallenge(node.id, total);

    local.phase = 'result';
    local.result = { details, total, passed, allShortOk, alreadyLit };
    renderResult();

    if (options.onChange) options.onChange({ nodeId: node.id, passed, total });
    if (passed) toast(alreadyLit ? `成绩已更新：${node.name} ${total} 分` : `✦ 已点亮「${node.name}」`, 'success');
  }

  function renderResult() {
    const { details, total, passed, allShortOk, alreadyLit } = local.result;
    const review = details.map((d, i) => {
      const q = d.q;
      const yourAnswer = q.type === 'choice'
        ? `${String.fromCharCode(65 + Number(d.ans))}. ${escapeHtml(q.options[d.ans])}`
        : escapeHtml(d.ans);
      const keywordHtml = q.type === 'short'
        ? `<div class="keyword-line">
             ${d.hits.map(k => `<span class="kw hit">${escapeHtml(k)}</span>`).join('')}
             ${d.missing.map(k => `<span class="kw miss">${escapeHtml(k)}</span>`).join('')}
           </div>
           <p class="reference">参考：${escapeHtml(q.reference || '')}</p>`
        : `<p class="reference">正确答案：${String.fromCharCode(65 + q.answer)}. ${escapeHtml(q.options[q.answer])}</p>`;

      return `<article class="review ${d.ok ? 'ok' : 'bad'}">
        <div class="review-head">
          <span class="review-index">${i + 1}</span>
          <span class="review-score">${(d.score * 1).toFixed(1)} / 1.0</span>
        </div>
        <p class="review-stem">${escapeHtml(q.stem)}</p>
        <p class="your-answer">你的作答：${yourAnswer}</p>
        ${keywordHtml}
        <p class="explain">${escapeHtml(q.explain || '')}</p>
      </article>`;
    }).join('');

    const shortNote = !allShortOk && total >= threshold
      ? '<p class="challenge-note warn">总分过线，但有简答题未达到关键词要求，因此本次不算通过。</p>'
      : '';

    body.innerHTML = `
      <div class="result-hero ${passed ? 'pass' : 'fail'}">
        <div class="score-ring" style="--p:${total};--c:${passed ? '#6ce7a8' : '#f0a35e'}">
          <span class="score-num">${total}</span><span class="score-unit">分</span>
        </div>
        <h2 id="ch-title" tabindex="-1">${passed ? (alreadyLit ? '成绩已更新' : '挑战通过，星星点亮') : '还差一点，别急着走'}</h2>
        <p>${passed
          ? `${node.name} · 已达到 ${threshold} 分及格线，已计入你的能力档案。`
          : `距离及格线还差 ${Math.max(0, threshold - total)} 分。看完解析再试一次，通常就能过。`}</p>
      </div>
      ${shortNote}
      <div class="review-list">${review}</div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="done">${passed ? '回到星图' : '稍后再来'}</button>
        <button class="btn ${passed ? 'primary' : 'ghost'}" data-act="retry">${passed ? '再刷一次' : '再试一次'}</button>
      </div>`;
    focusTitle();
  }

  function focusTitle(soft = false) {
    const title = body.querySelector('h2');
    if (!title) return;
    if (soft && window.matchMedia('(pointer: coarse)').matches) return;
    title.focus({ preventScroll: true });
  }

  intro();
  active = { close };
}

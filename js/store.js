const KEY = 'ksm.save.v2';
const SCHEMA = 2;

const listeners = new Set();

function blank() {
  return {
    version: SCHEMA,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lit: {},
    claimed: {},
    records: {},
    direction: 'backend',
    onboarding: {
      done: false,
      major: '',
      grade: '',
      selfRated: [],
      quiz: { correct: 0, total: 0, at: null }
    },
    settings: { highlight: true },
    counters: { attempts: 0, answered: 0, correct: 0 },
    plan: null,
    mistakes: {}
  };
}

function sanitizeMistakes(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.keys(raw).slice(0, 200).forEach(qid => {
    const v = raw[qid];
    if (!v || typeof v !== 'object' || typeof v.node !== 'string') return;
    out[qid] = {
      node: v.node,
      type: v.type === 'short' ? 'short' : 'choice',
      chosen: Number.isFinite(Number(v.chosen)) ? Number(v.chosen) : null,
      missing: Array.isArray(v.missing) ? v.missing.filter(x => typeof x === 'string').slice(0, 10) : [],
      at: Number(v.at) || Date.now(),
      count: Math.max(1, Number(v.count) || 1)
    };
  });
  return out;
}

function sanitizePlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const weeks = [4, 6, 8].includes(Number(raw.weeks)) ? Number(raw.weeks) : 4;
  const entries = Array.isArray(raw.entries)
    ? raw.entries
      .filter(e => e && typeof e.node === 'string' && Number.isFinite(Number(e.week)))
      .map(e => ({
        week: Math.max(0, Math.min(weeks - 1, Math.floor(Number(e.week)))),
        node: e.node,
        hours: Number(e.hours) > 0 ? Math.round(Number(e.hours) * 2) / 2 : 4
      }))
    : [];
  return {
    direction: typeof raw.direction === 'string' && raw.direction ? raw.direction : 'backend',
    weeks,
    generatedAt: Number(raw.generatedAt) || Date.now(),
    entries
  };
}

let state = blank();
let quotaWarned = false;

function normalizeLit(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.keys(raw).forEach(id => {
    const v = raw[id];
    if (v === 'lit') out[id] = { at: Date.now(), score: 100, source: 'legacy' };
    else if (v && typeof v === 'object') {
      out[id] = {
        at: Number(v.at) || Date.now(),
        score: Number(v.score) || 100,
        source: v.source || 'challenge'
      };
    }
  });
  return out;
}

function sanitize(raw) {
  const base = blank();
  if (!raw || typeof raw !== 'object') return base;
  base.createdAt = Number(raw.createdAt) || Date.now();
  base.updatedAt = Number(raw.updatedAt) || Date.now();
  base.lit = normalizeLit(raw.lit);
  base.claimed = raw.claimed && typeof raw.claimed === 'object' ? { ...raw.claimed } : {};
  Object.keys(base.claimed).forEach(id => { if (base.lit[id]) delete base.claimed[id]; });
  base.records = raw.records && typeof raw.records === 'object' ? { ...raw.records } : {};
  if (typeof raw.direction === 'string' && raw.direction) base.direction = raw.direction;
  if (raw.onboarding && typeof raw.onboarding === 'object') {
    base.onboarding = {
      done: !!raw.onboarding.done,
      major: raw.onboarding.major || '',
      grade: raw.onboarding.grade || '',
      selfRated: Array.isArray(raw.onboarding.selfRated) ? raw.onboarding.selfRated.filter(x => typeof x === 'string') : [],
      quiz: raw.onboarding.quiz && typeof raw.onboarding.quiz === 'object' ? raw.onboarding.quiz : { correct: 0, total: 0, at: null }
    };
  }
  if (raw.settings && typeof raw.settings === 'object') {
    base.settings.highlight = raw.settings.highlight !== false;
  }
  if (raw.counters && typeof raw.counters === 'object') {
    base.counters = {
      attempts: Number(raw.counters.attempts) || 0,
      answered: Number(raw.counters.answered) || 0,
      correct: Number(raw.counters.correct) || 0
    };
  }
  base.plan = sanitizePlan(raw.plan);
  base.mistakes = sanitizeMistakes(raw.mistakes);
  return base;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = sanitize(JSON.parse(raw));
  } catch (err) {
    console.warn('[store] 读取存档失败，使用空存档', err);
    state = blank();
  }
  return state;
}

export function getState() {
  return state;
}

export function save() {
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    if (!quotaWarned) {
      quotaWarned = true;
      console.warn('[store] 保存失败', err);
    }
  }
}

function emit(type, detail) {
  save();
  listeners.forEach(fn => {
    try { fn({ type, detail, state }); } catch (err) { console.error(err); }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isLit(id) {
  return !!state.lit[id];
}

export function isClaimed(id) {
  return !!state.claimed[id];
}

export function litSet() {
  return state.lit;
}

function clearNodeMistakes(nodeId) {
  Object.keys(state.mistakes).forEach(qid => {
    if (state.mistakes[qid].node === nodeId) delete state.mistakes[qid];
  });
}

function applyMistakeData(nodeId, data) {
  if (!data) return;
  const { wrong = [], rightIds = [] } = data;
  rightIds.forEach(qid => { delete state.mistakes[qid]; });
  wrong.forEach(item => {
    if (!item || !item.qid) return;
    const prev = state.mistakes[item.qid];
    state.mistakes[item.qid] = {
      node: nodeId,
      type: item.type === 'short' ? 'short' : 'choice',
      chosen: Number.isFinite(Number(item.chosen)) ? Number(item.chosen) : null,
      missing: Array.isArray(item.missing) ? item.missing.slice(0, 10) : [],
      at: Date.now(),
      count: (prev && prev.count ? prev.count : 0) + 1
    };
  });
}

export function lightNode(id, score = 100, source = 'challenge') {
  if (!state.lit[id]) {
    state.lit[id] = { at: Date.now(), score, source };
  } else {
    state.lit[id].score = Math.max(state.lit[id].score || 0, score);
  }
  delete state.claimed[id];
  clearNodeMistakes(id);
  emit('lit', { id, score, source });
}

export function unlightNode(id) {
  if (!state.lit[id]) return false;
  delete state.lit[id];
  emit('unlit', { id });
  return true;
}

export function passChallenge(id, score, mistakeData) {
  const rec = state.records[id] || { attempts: 0, best: 0 };
  rec.attempts += 1;
  rec.best = Math.max(rec.best || 0, score);
  rec.last = score;
  rec.lastAt = Date.now();
  rec.passedAt = rec.passedAt || Date.now();
  rec.source = 'challenge';
  state.records[id] = rec;
  state.counters.attempts += 1;

  const wasLit = !!state.lit[id];
  state.lit[id] = {
    at: state.lit[id]?.at || Date.now(),
    score: Math.max(state.lit[id]?.score || 0, score),
    source: 'challenge'
  };
  delete state.claimed[id];
  clearNodeMistakes(id);
  emit('challenge-pass', { id, score, firstTime: !wasLit });
}

export function failChallenge(id, score, mistakeData) {
  const rec = state.records[id] || { attempts: 0, best: 0 };
  rec.attempts += 1;
  rec.best = Math.max(rec.best || 0, score);
  rec.last = score;
  rec.lastAt = Date.now();
  state.records[id] = rec;
  state.counters.attempts += 1;
  applyMistakeData(id, mistakeData);
  emit('challenge-fail', { id, score });
}

export function setClaimed(ids) {
  state.claimed = {};
  ids.forEach(id => {
    if (!state.lit[id]) state.claimed[id] = true;
  });
  emit('claimed');
}

export function setDirection(direction) {
  if (state.direction === direction) return;
  state.direction = direction;
  emit('direction', { direction });
}

export function getPlan() {
  return state.plan;
}

export function setPlan(plan) {
  state.plan = plan;
  emit('plan', { plan });
}

export function setHighlight(enabled) {
  state.settings.highlight = !!enabled;
  emit('settings');
}

export function completeOnboarding(payload) {
  const { major, grade, selfRated = [], direction, quiz, litIds = [] } = payload;
  state.onboarding = {
    done: true,
    major,
    grade,
    selfRated,
    quiz: { correct: quiz.correct, total: quiz.total, at: Date.now() }
  };
  if (direction) state.direction = direction;

  state.claimed = {};
  selfRated.forEach(id => {
    if (!state.lit[id]) state.claimed[id] = true;
  });

  litIds.forEach(id => {
    const prev = state.lit[id];
    state.lit[id] = {
      at: prev?.at || Date.now(),
      score: Math.max(prev?.score || 0, 100),
      source: prev?.source || 'onboarding'
    };
    delete state.claimed[id];
    const rec = state.records[id] || { attempts: 0, best: 0 };
    rec.best = Math.max(rec.best || 0, 100);
    rec.passedAt = rec.passedAt || Date.now();
    rec.source = rec.source || 'onboarding';
    state.records[id] = rec;
  });

  state.counters.answered += quiz.total;
  state.counters.correct += quiz.correct;
  emit('onboarding');
}

export function resetOnboarding() {
  state.onboarding.done = false;
  emit('onboarding-reset');
}

export function resetAll() {
  state = blank();
  emit('reset');
}

export function exportText() {
  return JSON.stringify(state, null, 2);
}

export function importText(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是合法的 JSON' };
  }
  if (!raw || typeof raw !== 'object' || !raw.lit) {
    return { ok: false, error: '这不是知识星图的存档文件' };
  }
  state = sanitize(raw);
  emit('import');
  return { ok: true };
}

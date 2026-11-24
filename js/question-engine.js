/**
 * 出题引擎 v2
 * ============
 * 设计目标：
 * 1. 题目语义自洽：题干、正确答案、干扰项都来自概念卡的结构化字段
 * 2. 真正的随机：PRNG + 近期出题窗口，连续两套卷几乎不重复
 * 3. 难度分层：按 attempts / best / 点亮状态调整认知层次比例
 * 4. 组卷约束：3 单选 + 2 简答、覆盖 ≥3 个概念、答案位置 ≥3 种
 *
 * 本模块不依赖 DOM，可单独用 Node 校验。
 */

const SEEN_KEY = 'ksm_seen';
const SEEN_LIMIT = 30;

// 7 种问法：type 决定题型，level 决定认知层次
export const ANGLES = {
  def: { type: 'choice', level: 1, label: '定义辨析' },
  explain: { type: 'short', level: 1, label: '概念释义' },
  scene: { type: 'choice', level: 2, label: '场景匹配' },
  pitfall: { type: 'choice', level: 2, label: '误区识辨' },
  compare: { type: 'short', level: 2, label: '对比说明' },
  contrast: { type: 'choice', level: 3, label: '对比辨析' },
  apply: { type: 'short', level: 3, label: '场景应用' }
};

// ---------- 基础工具 ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function readSeen() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(SEEN_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeSeen(map) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* 存储不可用时静默降级 */
  }
}

// ---------- 难度分层 ----------

function allocateLevels(weights, count) {
  const raw = weights.map(([level, weight]) => [level, weight * count]);
  const counts = {};
  let used = 0;
  raw.forEach(([level, value]) => {
    counts[level] = Math.floor(value);
    used += counts[level];
  });
  let left = count - used;
  const byRemainder = raw
    .map(([level, value]) => [level, value - Math.floor(value)])
    .sort((a, b) => b[1] - a[1]);
  let i = 0;
  while (left > 0) {
    counts[byRemainder[i % byRemainder.length][0]] += 1;
    left -= 1;
    i += 1;
  }
  const levels = [];
  Object.keys(counts).forEach(level => {
    for (let n = 0; n < counts[level]; n++) levels.push(Number(level));
  });
  return levels;
}

export function levelPlan(state, nodeId, count) {
  const record = state?.records?.[nodeId];
  const attempts = record?.attempts || 0;
  const best = record?.best || 0;
  const lit = !!state?.lit?.[nodeId];
  let weights;
  if (lit && best >= 85) {
    weights = [[1, 0.2], [2, 0.4], [3, 0.4]];
  } else if (attempts >= 3 || best >= 60) {
    weights = [[1, 0.4], [2, 0.4], [3, 0.2]];
  } else if (attempts >= 1) {
    weights = [[1, 0.5], [2, 0.4], [3, 0.1]];
  } else {
    weights = [[1, 0.6], [2, 0.4], [3, 0]];
  }
  return allocateLevels(weights, count);
}

// ---------- 引擎 ----------

export class QuestionEngine {
  constructor(concepts = [], branches = []) {
    this.branchMap = {};
    this.byBranch = {};
    branches.forEach(b => { this.branchMap[b.id] = b; });
    concepts.forEach(card => {
      if (!card || !card.id || !card.branchId) return;
      (this.byBranch[card.branchId] ||= []).push(card);
    });
    Object.values(this.byBranch).forEach(list => {
      list.sort((a, b) => a.level - b.level);
    });
  }

  hasBranch(branchId) {
    return (this.byBranch[branchId] || []).length >= 3;
  }

  /**
   * 生成一套试卷
   * @param {object} opts { nodeId, branch, count, state, staticQuestions }
   */
  buildPaper({ nodeId, branch, count = 5, state = {}, staticQuestions = [] }) {
    const cards = this.byBranch[branch?.id] || [];
    if (cards.length < 3) return [];

    const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    const seenMap = readSeen();
    const seenList = Array.isArray(seenMap[nodeId]) ? seenMap[nodeId] : [];
    const levels = shuffle(levelPlan(state, nodeId, count), rng);
    const shortCount = Math.max(1, Math.round(count * 0.4));
    const types = shuffle(
      Array.from({ length: count }, (_, i) => (i < count - shortCount ? 'choice' : 'short')),
      rng
    );
    const slots = types.map((type, i) => ({ type, level: levels[i] }));

    let paper = null;
    for (let attempt = 0; attempt < 30 && !paper; attempt++) {
      paper = this._assemble({ cards, branch, slots, rng, seenList, requirePositions: true });
    }
    // 30 次仍无法满足答案位置分布时，仅放宽该约束
    for (let attempt = 0; attempt < 12 && !paper; attempt++) {
      paper = this._assemble({ cards, branch, slots, rng, seenList, requirePositions: false });
    }
    if (!paper) return [];

    const swapped = this._maybeSwapStatic(paper, staticQuestions, rng, branch);
    markSeen(nodeId, swapped.map(q => q.stemKey).filter(Boolean));
    return shuffle(swapped, rng);
  }

  _assemble({ cards, branch, slots, rng, seenList, requirePositions }) {
    const usage = {};
    const usedAngles = new Set();
    const picked = [];

    for (const slot of slots) {
      const candidate = this._pickCandidate(cards, slot, usage, usedAngles, seenList, rng);
      if (!candidate) return null;
      const question = this._buildQuestion(candidate.card, candidate.angle, branch, cards, rng);
      if (!question) return null;
      question.level = slot.level;
      picked.push(question);
      usage[candidate.card.id] = (usage[candidate.card.id] || 0) + 1;
      usedAngles.add(candidate.card.id + ':' + candidate.angle);
    }

    if (new Set(picked.map(q => q.conceptId)).size < 3) return null;

    if (requirePositions) {
      const choiceAnswers = picked.filter(q => q.type === 'choice').map(q => q.answer);
      if (new Set(choiceAnswers).size < Math.min(3, choiceAnswers.length)) return null;
    }
    return picked;
  }

  _pickCandidate(cards, slot, usage, usedAngles, seenList, rng) {
    const options = [];
    cards.forEach(card => {
      if ((usage[card.id] || 0) >= 2) return;
      Object.keys(ANGLES).forEach(angle => {
        if (ANGLES[angle].type !== slot.type) return;
        if (usedAngles.has(card.id + ':' + angle)) return;
        if ((angle === 'contrast' || angle === 'compare') && !card.contrast) return;
        if (!this._canBuild(card, angle)) return;
        const stemKey = card.id + ':' + angle;
        const seenIndex = seenList.indexOf(stemKey);
        options.push({
          card,
          angle,
          seen: seenIndex,
          // 优先同层次，其次概念卡本身难度贴近当前层次
          levelMatch: (ANGLES[angle].level === slot.level ? 0 : 2)
            + (card.level === slot.level ? 0 : 1),
          noise: rng()
        });
      });
    });
    if (!options.length) return null;
    options.sort((a, b) => {
      // 未出过的题面绝对优先；都已出过时优先更久未用的
      if (a.seen !== b.seen) return a.seen === -1 ? -1 : b.seen === -1 ? 1 : a.seen - b.seen;
      if (a.levelMatch !== b.levelMatch) return a.levelMatch - b.levelMatch;
      return a.noise - b.noise;
    });
    return options[0];
  }

  _canBuild(card, angle) {
    if (angle === 'def' || angle === 'scene') return !!card[angle === 'def' ? 'definition' : 'scenario'];
    if (angle === 'pitfall') return !!card.pitfall && (card.key_points || []).length >= 2;
    if (angle === 'contrast') return !!card.contrast?.diff;
    if (angle === 'explain' || angle === 'apply') return (card.keywords || []).length >= 2;
    if (angle === 'compare') return !!card.contrast?.with && (card.keywords || []).length >= 1;
    return false;
  }

  _buildQuestion(card, angle, branch, cards, rng) {
    if (ANGLES[angle].type === 'choice') {
      return this._buildChoice(card, angle, branch, rng);
    }
    return this._buildShort(card, angle, branch);
  }

  _buildChoice(card, angle, branch, rng) {
    let stem;
    let correct;
    let distractors;

    if (angle === 'def') {
      stem = `关于「${card.term}」，下列哪一项描述最准确？`;
      correct = card.definition;
      distractors = this._fieldPool('definition', card, branch);
    } else if (angle === 'scene') {
      stem = `以下哪种情境最适合使用「${card.term}」？`;
      correct = card.scenario;
      distractors = this._fieldPool('scenario', card, branch);
    } else if (angle === 'pitfall') {
      stem = `关于「${card.term}」，下列哪一项是常见的错误做法或误解？`;
      correct = card.pitfall;
      distractors = uniq(card.key_points || []).filter(t => t !== correct);
    } else if (angle === 'contrast') {
      const other = card.contrast?.with || '';
      stem = `「${card.term}」与「${other}」的核心区别是？`;
      correct = card.contrast?.diff || '';
      distractors = uniq([card.definition, card.scenario, card.pitfall]).filter(t => t !== correct);
    } else {
      return null;
    }

    const pool = shuffle(uniq(distractors).filter(t => t && t !== correct), rng).slice(0, 3);
    if (!correct || pool.length < 3) return null;

    const options = shuffle([correct, ...pool], rng);
    const answer = options.indexOf(correct);
    const explainMap = {
      def: `「${card.term}」：${card.definition}`,
      scene: `「${card.term}」的典型场景：${card.scenario}`,
      pitfall: `常见误区：${card.pitfall}`,
      contrast: `与「${card.contrast?.with || ''}」的区别：${card.contrast?.diff || ''}`
    };
    return this._finish({
      type: 'choice',
      stem,
      options,
      answer,
      explain: explainMap[angle],
      card,
      angle,
      branch
    });
  }

  _fieldPool(field, card, branch) {
    return uniq(
      (this.byBranch[branch.id] || [])
        .filter(c => c.id !== card.id)
        .map(c => c[field])
    ).filter(t => t && t !== card[field]);
  }

  _buildShort(card, angle, branch) {
    let stem;
    let keywords;
    let reference;

    if (angle === 'explain') {
      stem = `请用一两句话解释「${card.term}」的含义。`;
      keywords = uniq(card.keywords || []);
      reference = `${card.definition} 关键点：${(card.key_points || []).join('；')}`;
    } else if (angle === 'compare') {
      stem = `请说明「${card.term}」与「${card.contrast.with}」的区别，并各举一个适用场景。`;
      keywords = uniq([...(card.keywords || []).slice(0, 2), card.contrast.with]);
      reference = `区别：${card.contrast.diff} 场景：${card.scenario}`;
    } else if (angle === 'apply') {
      stem = `在「${branch.name}」相关开发中，什么情况下你会选择「${card.term}」？请结合具体场景说明。`;
      keywords = uniq(card.keywords || []);
      reference = `适用场景：${card.scenario} 注意：${card.pitfall}`;
    } else {
      return null;
    }

    if (keywords.length < 2) return null;
    return this._finish({
      type: 'short',
      stem,
      keywords,
      minHits: Math.max(2, Math.ceil(keywords.length * 0.6)),
      reference,
      card,
      angle,
      branch
    });
  }

  _finish({ type, stem, options, answer, explain, keywords, minHits, reference, card, angle, branch }) {
    const idPart = String(card.id).replace(/[^\w-]/g, '_');
    const optHash = type === 'choice'
      ? hashStr(options.slice().sort().join('|'))
      : hashStr(keywords.join('|'));
    const refs = (branch.learn_refs || []).slice(0, 1);
    return {
      id: `q_${card.branchId.replace(/\./g, '_')}_${idPart}_${angle}`,
      dynamic: true,
      type,
      stem,
      options,
      answer,
      explain,
      keywords,
      minHits,
      reference,
      conceptId: card.id,
      angle,
      level: ANGLES[angle].level,
      fingerprint: `${branch.id}.${card.id}:${angle}:${optHash}`,
      stemKey: `${card.id}:${angle}`,
      refs,
      source: 'concept'
    };
  }

  _maybeSwapStatic(paper, staticQuestions, rng, branch) {
    if (!staticQuestions.length || rng() > 0.3) return paper;
    const usage = {};
    paper.forEach(q => { usage[q.conceptId] = (usage[q.conceptId] || 0) + 1; });
    const slots = paper
      .map((q, index) => ({ q, index }))
      .filter(({ q }) => usage[q.conceptId] >= 2);
    if (!slots.length) return paper;

    const usedIds = new Set(paper.map(q => q.id));
    const slot = slots[Math.floor(rng() * slots.length)];
    const candidates = staticQuestions.filter(q => q.type === slot.q.type && !usedIds.has(q.id));
    if (!candidates.length) return paper;
    const staticQ = candidates[Math.floor(rng() * candidates.length)];

    const next = paper.slice();
    next[slot.index] = {
      ...staticQ,
      conceptId: 'static:' + staticQ.id,
      angle: 'static',
      level: 2,
      stemKey: null,
      fingerprint: `static.${staticQ.id}:static:0`,
      source: 'static'
    };

    if (slot.q.type === 'choice') {
      const answers = next.filter(q => q.type === 'choice').map(q => q.answer);
      if (new Set(answers).size < Math.min(3, answers.length)) return paper;
    }
    return next;
  }
}

function markSeen(nodeId, keys) {
  if (!nodeId || !keys.length) return;
  const map = readSeen();
  const list = Array.isArray(map[nodeId]) ? map[nodeId].slice() : [];
  keys.forEach(key => {
    const index = list.indexOf(key);
    if (index !== -1) list.splice(index, 1);
    list.push(key);
  });
  map[nodeId] = list.slice(-SEEN_LIMIT);
  writeSeen(map);
}

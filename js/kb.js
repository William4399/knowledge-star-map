/**
 * 知识库模块 - Knowledge Base Integration
 * ============================================
 *
 * 职责：
 * 1. 加载 knowledge_base.json 与 concepts.json，建立 branchId → nodeId 映射
 * 2. 把组卷工作委托给 question-engine（概念卡驱动，语义自洽）
 * 3. 提供学习指南（learn_refs / practice_refs）访问接口
 * 4. 基于用户历史表现实现难度分层的题目推荐
 *
 * 对外 API 保持不变：QuestionBank / getAdaptiveQuestions / CHALLENGE_SIZE /
 * loadKnowledgeBase / getLearningGuides / getWeakAreas / getSuggestedPrereqs /
 * BRANCH_TO_NODE / NODE_TO_BRANCH
 */

import { Data, questionsFor } from './data.js';
import { getState } from './store.js';
import { QuestionEngine } from './question-engine.js';

// 单次挑战的题目数量：详情卡、路径页、挑战弹窗统一从此处取值
export const CHALLENGE_SIZE = 5;

// ============ 节点映射表：知识库 branchId → 项目 nodeId ============
const BRANCH_TO_NODE = {
  // 编程语言
  '1.1': 'c',
  '1.2': 'python',
  '1.3': 'cpp',
  '1.4': 'java',
  '1.5': 'js',
  // 数据结构与算法
  '2.1': 'algo_complexity',
  '2.2': 'ds_array',
  '2.3': 'ds_tree',
  '2.4': 'ds_hash',
  '2.5': 'algo_sort',
  '2.6': 'algo_dp',
  '2.7': 'ds_graph',
  '2.8': 'ds_stack',
  // 计算机系统
  '3.1': 'sys_os',
  '3.2': 'sys_arch',
  '3.3': 'sys_process',
  '3.4': 'sys_memory',
  '3.5': 'sys_linux',
  // 网络与Web
  '4.1': 'net_tcp',
  '4.2': 'net_http',
  '4.3': 'web_browser',
  '4.4': 'web_html',
  // 后端与架构
  '5.1': 'be_sysdesign',
  '5.2': 'be_framework',
  '5.3': 'be_api',
  '5.4': 'be_mq',
  '5.5': 'be_micro',
  // 数据与存储
  '6.1': 'db_rel',
  '6.2': 'db_sql',
  '6.3': 'db_tx',
  '6.4': 'db_index',
  '6.5': 'db_nosql',
  // 软件工程
  '7.1': 'se_pattern',
  '7.2': 'se_arch',
  '7.3': 'se_req',
  // 工程实践
  '8.1': 'eng_git',
  '8.2': 'eng_test',
  '8.3': 'eng_debug',
  '8.4': 'eng_ci',
  '8.5': 'eng_doc',
  // 人工智能
  '9.1': 'ai_data',
  '9.2': 'ai_ml',
  '9.3': 'ai_llm',
  '9.4': 'ai_eval',
  '9.5': 'ai_dl',
  '9.6': 'ai_rag',
  // 数学基础
  '10.1': 'math_discrete',
  '10.2': 'math_prob',
  '10.3': 'math_linear',
  // 安全基础
  '11.1': 'sec_web',
  '11.2': 'sec_auth',
  '11.3': 'sec_crypto'
};

// 反向映射：nodeId → branchId
const NODE_TO_BRANCH = {};
Object.entries(BRANCH_TO_NODE).forEach(([branch, node]) => {
  NODE_TO_BRANCH[node] = branch;
});

// ============ 模块状态 ============
let kbData = null;
let nodeBranchMap = {}; // 运行时构建的 nodeId → branch 信息
let engine = null;      // 概念卡出题引擎

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function snapshotToQuestion(qid, mistake) {
  const snap = mistake?.snapshot;
  if (!snap) return null;
  return {
    id: qid,
    dynamic: true,
    snapshot: true,
    type: snap.type === 'short' ? 'short' : 'choice',
    stem: snap.stem || '',
    options: Array.isArray(snap.options) ? snap.options : [],
    answer: Number.isFinite(Number(snap.answer)) ? Number(snap.answer) : null,
    keywords: Array.isArray(snap.keywords) ? snap.keywords : [],
    reference: snap.reference || '',
    explain: snap.explain || ''
  };
}

// ============ 加载知识库 ============
export async function loadKnowledgeBase() {
  if (kbData) return kbData;

  try {
    const [kbRes, conceptRes] = await Promise.all([
      fetch('data/knowledge_base.json', { cache: 'no-cache' }),
      fetch('data/concepts.json', { cache: 'no-cache' })
    ]);
    if (!kbRes.ok) throw new Error('知识库加载失败');
    kbData = await kbRes.json();

    // 构建 nodeId → branch 信息的快速查找表
    nodeBranchMap = {};
    (kbData.branches || []).forEach(branch => {
      const nodeId = BRANCH_TO_NODE[branch.id];
      if (nodeId) nodeBranchMap[nodeId] = branch;
    });

    let concepts = [];
    if (conceptRes.ok) {
      const conceptData = await conceptRes.json();
      concepts = conceptData.concepts || [];
    } else {
      console.warn('[KB] 概念卡加载失败，将降级为静态题库');
    }

    engine = new QuestionEngine(concepts, kbData.branches || []);
    return kbData;
  } catch (err) {
    console.warn('[KB] 知识库加载失败', err);
    kbData = { meta: {}, branches: [] };
    nodeBranchMap = {};
    engine = new QuestionEngine([], []);
    return kbData;
  }
}

export function isKbLoaded() {
  return !!kbData && kbData.branches && kbData.branches.length > 0;
}

// ============ 获取节点的知识库信息 ============
export function getBranchInfo(nodeId) {
  return nodeBranchMap[nodeId] || null;
}

// ============ 题库管理器 ============
export class QuestionBank {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.branch = nodeBranchMap[nodeId] || null;
    this.staticQuestions = questionsFor(nodeId);
    this.state = getState();
  }

  /**
   * 获取一套随机、语义自洽、难度分层的题目
   * @param {number} count 题目数量，默认 5
   */
  getAdaptiveQuestions(count = CHALLENGE_SIZE) {
    if (engine && this.branch && engine.hasBranch(this.branch.id)) {
      const paper = engine.buildPaper({
        nodeId: this.nodeId,
        branch: this.branch,
        count,
        state: getState(),
        staticQuestions: this.staticQuestions
      });
      if (paper.length >= Math.min(count, 3)) return paper;
    }

    // 降级路径：概念卡不可用时只使用静态题库，避免挑战流程中断
    return shuffle(this.staticQuestions).slice(0, count);
  }

  /**
   * 从错题记录中提取薄弱点题目（优先使用提交时保存的题目快照）
   */
  getWeakQuestions() {
    const state = getState();
    const result = [];

    Object.entries(state.mistakes || {}).forEach(([qid, m]) => {
      if (m.node !== this.nodeId) return;
      const q = snapshotToQuestion(qid, m)
        || this.staticQuestions.find(sq => sq.id === qid);
      if (q) result.push(q);
    });

    return result;
  }
}

// ============ 学习指南相关 ============

/**
 * 获取节点的学习资料
 * @param {string} nodeId
 * @returns {{learn: Array, practice: Array}|null}
 */
export function getLearningGuides(nodeId) {
  const branch = nodeBranchMap[nodeId];
  if (!branch) return null;

  return {
    learn: branch.learn_refs || [],
    practice: branch.practice_refs || [],
    difficulty: branch.difficulty,
    importance: branch.importance,
    desc: branch.desc,
    questionTemplates: branch.question_templates || []
  };
}

/**
 * 获取所有可提升的薄弱领域
 * 基于星系掌握度和错题分析
 */
export function getWeakAreas() {
  const state = getState();
  if (!state.records || Object.keys(state.records).length === 0) {
    return [];
  }

  const weakness = {};

  Object.values(state.mistakes || {}).forEach(m => {
    weakness[m.node] = (weakness[m.node] || 0) + m.count;
  });

  Object.entries(state.records).forEach(([nodeId, record]) => {
    if (record.attempts >= 2 && record.best < 70) {
      weakness[nodeId] = (weakness[nodeId] || 0) + 2;
    }
  });

  return Object.entries(weakness)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nodeId, score]) => {
      const node = Data.byId[nodeId];
      return {
        nodeId,
        nodeName: node?.name || nodeId,
        galaxy: node?.galaxy,
        weaknessScore: score,
        branch: nodeBranchMap[nodeId]
      };
    });
}

/**
 * 基于知识库分支间的依赖关系获取建议学习顺序
 */
export function getSuggestedPrereqs(nodeId) {
  const branch = nodeBranchMap[nodeId];
  if (!branch) return [];

  const catId = branch.id.split('.')[0];
  return (kbData?.branches || [])
    .filter(b => b.id.startsWith(catId + '.') && b.id !== branch.id)
    .slice(0, 3)
    .map(b => ({
      nodeId: BRANCH_TO_NODE[b.id],
      name: b.name,
      desc: b.desc
    }))
    .filter(x => x.nodeId && Data.byId[x.nodeId]);
}

// ============ 导出 ============
export {
  BRANCH_TO_NODE,
  NODE_TO_BRANCH
};

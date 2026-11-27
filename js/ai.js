/**
 * AI 语义判分（DeepSeek，经代理调用）
 * ------------------------------------
 * 铁律：API Key 只存在服务端（Cloudflare Worker 的 secret），绝不进入前端/APK。
 * 前端只调用你自己的代理地址，断网/未配置/超时都会自动回退到关键词判分。
 *
 * 配置代理地址（二选一）：
 * 1. 修改下面 DEFAULT_PROXY_URL 为你的 Worker 地址；
 * 2. 或浏览器控制台执行 localStorage.setItem('ksm_ai_proxy', 'https://你的域名.workers.dev')。
 */

const DEFAULT_PROXY_URL = 'https://knowledge-star-map.2117841858.workers.dev';

const STORAGE_KEY = 'ksm_ai_proxy';

function proxyUrl() {
  try {
    const custom = localStorage.getItem(STORAGE_KEY);
    if (custom) return custom;
  } catch {
    /* localStorage 不可用时用默认 */
  }
  return DEFAULT_PROXY_URL;
}

/** 当前生效的代理地址（空字符串表示未配置） */
export function currentProxyUrl() {
  return proxyUrl();
}

/** 自定义代理地址（局域网演示时填 http://笔记本IP:8892）；传空字符串恢复默认 */
export function setProxyUrl(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 熔断：网络不可达或超时后 5 分钟内直接走本地判分，避免每次提交干等 */
let brokenUntil = 0;

export function aiEnabled() {
  return !!proxyUrl() && Date.now() >= brokenUntil;
}

function markBroken() {
  brokenUntil = Date.now() + 5 * 60 * 1000;
}

export const AI_TIMEOUT_MS = 15000;

/**
 * 简答题 AI 判分
 * @param {{stem:string, reference:string, keywords:string[], answer:string}} payload
 * @returns {Promise<{score:number, hits:string[], missing:string[], feedback:string, ai:true}>}
 */
export async function gradeShortAnswer({ stem, reference, keywords, answer }) {
  if (!aiEnabled()) throw new Error('AI 未配置');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await fetch(proxyUrl().replace(/\/$/, '') + '/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stem, reference, keywords, answer }),
      signal: ctrl.signal
    });
    if (!resp.ok) throw new Error('AI 服务返回 ' + resp.status);
    const data = await resp.json();
    if (typeof data.score !== 'number' || Number.isNaN(data.score)) {
      throw new Error('AI 返回格式错误');
    }
    return {
      score: Math.min(1, Math.max(0, data.score)),
      hits: Array.isArray(data.hits) ? data.hits.map(String) : [],
      missing: Array.isArray(data.missing) ? data.missing.map(String) : [],
      feedback: typeof data.feedback === 'string' ? data.feedback : '',
      ai: true
    };
  } catch (err) {
    // 网络不可达 / 超时：熔断 5 分钟，期间直接用本地判分
    if (err && (err.name === 'AbortError' || err instanceof TypeError)) markBroken();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

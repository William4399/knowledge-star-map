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

const DEFAULT_PROXY_URL = '';

function proxyUrl() {
  try {
    return localStorage.getItem('ksm_ai_proxy') || DEFAULT_PROXY_URL;
  } catch {
    return DEFAULT_PROXY_URL;
  }
}

export function aiEnabled() {
  return !!proxyUrl();
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
  } finally {
    clearTimeout(timer);
  }
}

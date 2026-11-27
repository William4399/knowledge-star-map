/**
 * AI 语义判分（DeepSeek，经代理调用）
 * ------------------------------------
 * 铁律：API Key 只存在服务端（Cloudflare Worker 的 secret），绝不进入前端/APK。
 * 前端只调用你自己的代理地址，断网/未配置/超时都会自动回退到关键词判分。
 *
 * 默认走已部署的公网代理（腾讯云 CloudBase），无需任何配置即可用 AI 判分。
 * 如需换地址：页面「存档与设置 → AI 判分代理」填写，或控制台执行
 * localStorage.setItem('ksm_ai_proxy', 'https://你的地址')。
 */

const DEFAULT_PROXY_URL = 'https://ksm-ai-d0g3hv6kib4574433-1542918062.ap-shanghai.app.tcloudbase.com';

const STORAGE_KEY = 'ksm_ai_proxy';

/** 从本机 / 局域网打开页面时，默认用同一台机器的 8893 端口做代理（配合 serve.mjs + local-proxy.mjs 零配置可用） */
function sameHostProxy() {
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'http://127.0.0.1:8893';
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return `http://${h}:8893`;
  } catch {
    /* 非浏览器环境 */
  }
  return '';
}

/** 候选代理地址：自定义 > 默认公网代理 > 本机/局域网 8893（本地代理作为兜底） */
function proxyCandidates() {
  const list = [];
  try {
    const custom = localStorage.getItem(STORAGE_KEY);
    if (custom) list.push(custom);
  } catch {
    /* localStorage 不可用时用默认 */
  }
  if (DEFAULT_PROXY_URL) list.push(DEFAULT_PROXY_URL);
  const same = sameHostProxy();
  if (same) list.push(same);
  return [...new Set(list.map(u => u.replace(/\/$/, '')))];
}

function proxyUrl() {
  return proxyCandidates()[0] || '';
}

/** 上次成功的代理地址，下次优先使用，避免重复等待不可用地址 */
let preferredBase = '';

function orderedCandidates() {
  const list = proxyCandidates();
  const i = list.indexOf(preferredBase);
  if (i > 0) {
    list.splice(i, 1);
    list.unshift(preferredBase);
  }
  return list;
}

/** 当前生效的代理地址（空字符串表示未配置） */
export function currentProxyUrl() {
  return proxyUrl();
}

/** 自定义代理地址（局域网演示时填 http://笔记本IP:8893）；传空字符串恢复默认 */
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

  let lastErr = null;
  for (const base of orderedCandidates()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(base + '/grade', {
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
      preferredBase = base;
      return {
        score: Math.min(1, Math.max(0, data.score)),
        hits: Array.isArray(data.hits) ? data.hits.map(String) : [],
        missing: Array.isArray(data.missing) ? data.missing.map(String) : [],
        feedback: typeof data.feedback === 'string' ? data.feedback : '',
        ai: true
      };
    } catch (err) {
      lastErr = err;
      // 只有网络不可达/超时/返回格式错误时换下一个地址；服务端明确报错则直接抛出
      const retriable = err && (err.name === 'AbortError' || err instanceof TypeError || /格式错误/.test(err.message));
      if (!retriable) throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // 所有地址都不可达：熔断 5 分钟，期间直接用本地判分
  markBroken();
  throw lastErr || new Error('AI 服务不可用');
}

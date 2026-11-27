/**
 * 知识星图 · DeepSeek 判分代理（Cloudflare Worker）
 * ==================================================
 * 作用：前端（网页 / Android WebView）只调用本 Worker，API Key 保存在服务端 secret，
 *       不会进入前端代码或 APK。
 *
 * 部署步骤（约 5 分钟）：
 * 1. 安装 wrangler：npm i -g wrangler
 * 2. 登录：wrangler login
 * 3. 在本目录执行：wrangler deploy deepseek-worker.js --name ksm-ai --compatibility-date 2026-01-01
 * 4. 写入密钥：wrangler secret put DEEPSEEK_API_KEY   （粘贴你的 DeepSeek Key）
 * 5. 把得到的 https://ksm-ai.<你的账号>.workers.dev 填到前端 js/ai.js 的 DEFAULT_PROXY_URL，
 *    或在浏览器控制台 localStorage.setItem('ksm_ai_proxy', 该地址)
 *
 * 前端请求：POST /grade  { stem, reference, keywords[], answer }
 * 返回：      { score: 0~1, hits: string[], missing: string[], feedback: string }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-KSM-Token'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (url.pathname !== '/grade') return json({ error: 'not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!env.DEEPSEEK_API_KEY) return json({ error: 'server key not configured' }, 500);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    // 输入裁剪：只接受判分必需字段，并限制长度，避免被当作无限额聊天接口滥用
    const stem = String(payload.stem || '').slice(0, 600);
    const reference = String(payload.reference || '').slice(0, 1200);
    const answer = String(payload.answer || '').slice(0, 3000);
    const keywords = Array.isArray(payload.keywords)
      ? payload.keywords.slice(0, 12).map(k => String(k).slice(0, 60))
      : [];
    if (!stem || !answer.trim()) return json({ error: 'stem/answer required' }, 400);

    const systemPrompt = `你是一名严格而鼓励学生的软件工程课程阅卷老师。根据题干、参考答案和评分关键词，给学生的简答题作答打分。

要求：
1. 只依据语义判断，学生用自己的话表达也算命中，不要求逐字相同。
2. score 为 0 到 1 的小数：0.6 表示基本掌握；完全错误或空白为 0；表达准确完整可给 0.9~1。
3. hits 为学生已覆盖的评分要点（从给定关键词中选，可用近义表述）；missing 为未覆盖的要点。
4. feedback 用中文，80 字以内，先肯定做对的地方，再指出缺失点和一条具体改进建议。
5. 只输出 JSON，格式：{"score":0.0,"hits":[],"missing":[],"feedback":""}`;

    const userPrompt = `【题干】${stem}
【参考答案】${reference}
【评分关键词】${keywords.join('、')}
【学生作答】${answer}`;

    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          temperature: 0.2,
          max_tokens: 600,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });
      if (!resp.ok) return json({ error: 'upstream ' + resp.status }, 502);

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content || '';
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        // 偶发模型未严格输出 JSON 时，尝试截取第一个 JSON 对象
        const m = content.match(/\{[\s\S]*\}/);
        if (!m) return json({ error: 'bad model output' }, 502);
        parsed = JSON.parse(m[0]);
      }

      const score = Number(parsed.score);
      if (Number.isNaN(score)) return json({ error: 'bad score' }, 502);
      return json({
        score: Math.min(1, Math.max(0, score)),
        hits: Array.isArray(parsed.hits) ? parsed.hits.map(String).slice(0, 12) : [],
        missing: Array.isArray(parsed.missing) ? parsed.missing.map(String).slice(0, 12) : [],
        feedback: String(parsed.feedback || '').slice(0, 300)
      });
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 502);
    }
  }
};

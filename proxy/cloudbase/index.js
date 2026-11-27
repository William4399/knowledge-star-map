/**
 * 知识星图 · DeepSeek 判分代理（腾讯云开发 CloudBase 云函数版）
 * ============================================================
 * 与 proxy/local-proxy.mjs、proxy/deepseek-worker.js 使用相同的 /grade 协议。
 * 部署后通过「HTTP 访问服务」暴露，当前线上地址：
 * POST https://ksm-ai-d0g3hv6kib4574433-1542918062.ap-shanghai.app.tcloudbase.com/grade
 *
 * 关键点：API Key 只存在此函数的环境变量里，不进前端、不进仓库。
 */

const KEY = process.env.DEEPSEEK_API_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const SYSTEM_PROMPT = `你是一名严格而鼓励学生的软件工程课程阅卷老师。根据题干、参考答案和评分关键词，给学生的简答题作答打分。

要求：
1. 只依据语义判断，学生用自己的话表达也算命中，不要求逐字相同。
2. score 为 0 到 1 的小数：0.6 表示基本掌握；完全错误或空白为 0；表达准确完整可给 0.9~1。
3. hits 为学生已覆盖的评分要点（从给定关键词中选，可用近义表述）；missing 为未覆盖的要点。
4. feedback 用中文，80 字以内，先肯定做对的地方，再指出缺失点和一条具体改进建议。
5. 只输出 JSON，格式：{"score":0.0,"hits":[],"missing":[],"feedback":""}`;

function respond(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
    body: JSON.stringify(data)
  };
}

exports.main = async (event) => {
  const method = (event && (event.httpMethod || event.method)) || 'POST';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (!KEY) return respond(500, { error: 'server key not configured' });

  let payload;
  try {
    payload = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
  } catch {
    return respond(400, { error: 'invalid json' });
  }

  const stem = String(payload.stem || '').slice(0, 600);
  const reference = String(payload.reference || '').slice(0, 1200);
  const answer = String(payload.answer || '').slice(0, 3000);
  const keywords = Array.isArray(payload.keywords)
    ? payload.keywords.slice(0, 12).map(k => String(k).slice(0, 60))
    : [];
  if (!stem || !answer.trim()) return respond(400, { error: 'stem/answer required' });

  const userPrompt = `【题干】${stem}\n【参考答案】${reference}\n【评分关键词】${keywords.join('、')}\n【学生作答】${answer}`;

  try {
    const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!upstream.ok) return respond(502, { error: 'upstream ' + upstream.status });

    const data = await upstream.json();
    const content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return respond(502, { error: 'bad model output' });
      parsed = JSON.parse(m[0]);
    }

    const score = Number(parsed.score);
    if (Number.isNaN(score)) return respond(502, { error: 'bad score' });
    return respond(200, {
      score: Math.min(1, Math.max(0, score)),
      hits: Array.isArray(parsed.hits) ? parsed.hits.map(String).slice(0, 12) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String).slice(0, 12) : [],
      feedback: String(parsed.feedback || '').slice(0, 300)
    });
  } catch (err) {
    return respond(502, { error: String((err && err.message) || err) });
  }
};
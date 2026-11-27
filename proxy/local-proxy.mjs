/**
 * 知识星图 · 本地 AI 判分代理（局域网演示用）
 * ==========================================
 * 用途：国内网络无法稳定访问 workers.dev 时的保底方案。
 *       笔记本运行本脚本（Key 只存在这台机器上），手机连同一 Wi-Fi / 笔记本热点，
 *       在 App「我的 → 存档与设置 → AI 判分代理」填 http://<笔记本IP>:8893 即可。
 *
 * 用法：
 *   Windows PowerShell:
 *     $env:DEEPSEEK_API_KEY="sk-你的key"; node proxy/local-proxy.mjs
 *   macOS/Linux:
 *     DEEPSEEK_API_KEY=sk-你的key node proxy/local-proxy.mjs
 *
 * 与 Cloudflare Worker（proxy/deepseek-worker.js）使用完全相同的 /grade 协议。
 */

import http from 'node:http';
import fs from 'node:fs';

/** 优先读环境变量，其次读同目录 .env（该文件已被 git 忽略，不会进仓库） */
let KEY = process.env.DEEPSEEK_API_KEY || '';
if (!KEY) {
  try {
    const text = fs.readFileSync(new URL('./.env', import.meta.url), 'utf8');
    const m = text.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+)$/m);
    if (m) KEY = m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* 没有 .env 就继续用环境变量 */
  }
}

const PORT = Number(process.env.AI_PROXY_PORT || 8893);

if (!KEY) {
  console.error('未找到 DEEPSEEK_API_KEY。');
  console.error('方式一：在 proxy/.env 里写 DEEPSEEK_API_KEY=sk-你的key');
  console.error('方式二：启动前设置环境变量 DEEPSEEK_API_KEY');
  process.exit(1);
}

const SYSTEM_PROMPT = `你是一名严格而鼓励学生的软件工程课程阅卷老师。根据题干、参考答案和评分关键词，给学生的简答题作答打分。

要求：
1. 只依据语义判断，学生用自己的话表达也算命中，不要求逐字相同。
2. score 为 0 到 1 的小数：0.6 表示基本掌握；完全错误或空白为 0；表达准确完整可给 0.9~1。
3. hits 为学生已覆盖的评分要点（从给定关键词中选，可用近义表述）；missing 为未覆盖的要点。
4. feedback 用中文，80 字以内，先肯定做对的地方，再指出缺失点和一条具体改进建议。
5. 只输出 JSON，格式：{"score":0.0,"hits":[],"missing":[],"feedback":""}`;

function send(res, status, data, cors) {
  const body = JSON.stringify(data);
  res.writeHead(res === null ? 500 : (data && data.error ? data.status || 400 : 200), {
    'Content-Type': 'application/json; charset=utf-8',
    ...(cors ? {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    } : {})
  });
  res.end(body);
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url.replace(/\/$/, '') !== '/grade' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  let payload;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid json' }));
    return;
  }

  const stem = String(payload.stem || '').slice(0, 600);
  const reference = String(payload.reference || '').slice(0, 1200);
  const answer = String(payload.answer || '').slice(0, 3000);
  const keywords = Array.isArray(payload.keywords)
    ? payload.keywords.slice(0, 12).map(k => String(k).slice(0, 60))
    : [];

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
          { role: 'user', content: `【题干】${stem}\n【参考答案】${reference}\n【评分关键词】${keywords.join('、')}\n【学生作答】${answer}` }
        ]
      })
    });
    if (!upstream.ok) throw new Error('upstream ' + upstream.status);
    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(content); }
    catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('bad model output');
      parsed = JSON.parse(m[0]);
    }
    const score = Number(parsed.score);
    if (Number.isNaN(score)) throw new Error('bad score');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      score: Math.min(1, Math.max(0, score)),
      hits: Array.isArray(parsed.hits) ? parsed.hits.map(String).slice(0, 12) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String).slice(0, 12) : [],
      feedback: String(parsed.feedback || '').slice(0, 300)
    }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err && err.message || err) }));
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`AI 判分代理已启动： http://0.0.0.0:${PORT}`);
  console.log(`局域网手机访问：   http://<本机IP>:${PORT}`);
});

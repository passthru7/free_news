// 极简触发代理：POST /trigger → 调 GitHub API 触发 free_news 抓取
// token 从环境变量 GITHUB_TOKEN 读取，不进入网页
const http = require('node:http');

const REPO = 'passthru7/free_news';
const PORT = process.env.TRIGGER_PORT || 8787;
const TOKEN = process.env.GITHUB_TOKEN || '';
const ALLOWED_ORIGIN = '*'; // GitHub Pages 域名；如需收紧可改为 https://passthru7.github.io

if (!TOKEN) { console.error('需要环境变量 GITHUB_TOKEN'); process.exit(1); }

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/trigger') { res.writeHead(404); res.end(); return; }

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/fetch.yml/dispatches`, {
      method: 'POST',
      headers: { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github+json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    res.writeHead(r.status === 204 ? 200 : r.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: r.status === 204 }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`trigger proxy on 0.0.0.0:${PORT}`));

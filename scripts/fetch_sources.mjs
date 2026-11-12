// fetch_sources.mjs — 抓取 7 个优惠来源，生成 data.json
// 用法: node fetch_sources.mjs [输出目录]
// 由 GitHub Actions 每 2 小时调用一次

import fs from 'node:fs';
import path from 'node:path';

const SOURCES = [
  { key: 'linuxdo', name: 'LINUX DO 福利羊毛', type: 'jina_rss', url: 'https://r.jina.ai/https://linux.do/c/welfare/36.rss' },
  { key: 'v2ex', name: 'V2EX 推广', type: 'rss', url: 'https://www.v2ex.com/feed/promotions.xml' },
  { key: 'epic', name: 'Epic 免费游戏', type: 'epic', url: 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN' },
  { key: 'nodeseek', name: 'NodeSeek', type: 'rss', url: 'https://rss.nodeseek.com/' },
  { key: 'appinn', name: '小众软件', type: 'rss', url: 'https://www.appinn.com/feed/' },
  { key: 'ghxi', name: '果核剥壳', type: 'rss', url: 'https://www.ghxi.com/feed' },
  { key: 'iplaysoft', name: '异次元软件世界', type: 'rss', url: 'https://www.iplaysoft.com/feed' },
];

const RETENTION_DAYS = 7;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function xmlText(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').trim();
}
function tagContent(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? xmlText(m[1]) : '';
}
function parseRss(xml) {
  const blocks = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = itemRe.exec(xml))) blocks.push(m[1]);
  if (!blocks.length) while ((m = entryRe.exec(xml))) blocks.push(m[1]);
  const items = [];
  for (const b of blocks) {
    let link = tagContent(b, 'link');
    if (!link) { const lm = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (lm) link = lm[1].trim(); }
    const date = tagContent(b, 'pubDate') || tagContent(b, 'published') || tagContent(b, 'updated') || tagContent(b, 'dc:date');
    // 简介取 description/content:encoded，去掉 HTML 标签
    let desc = tagContent(b, 'description') || tagContent(b, 'content:encoded') || tagContent(b, 'summary');
    desc = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    items.push({ title: tagContent(b, 'title'), link: link.trim(), date: date.trim(), summary: desc });
  }
  return items;
}
function parseJinaMarkdown(text) {
  const items = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lm = lines[i].match(/^###\s+\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*$/);
    if (!lm) continue;
    let date = '';
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) continue;
      if (/[A-Za-z]{3},\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t)) date = t;
      break;
    }
    items.push({ title: lm[1].trim(), link: lm[2].trim(), date, summary: '' });
  }
  return items;
}
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function categorize(title) {
  const t = title.toLowerCase();
  if (/(epic|游戏|喜加一|steam)/.test(t)) return '游戏';
  if (/(会员|订阅|\bpro\b|会员版)/i.test(title)) return '会员订阅';
  if (/(白嫖|免费领取|免费送|免单)/.test(t)) return '免费白嫖';
  if (/(限免|限时免费|free game|领游戏)/.test(t)) return '限免';
  if (/(折扣|优惠码|大促|降价|券|立减|秒杀|特价)/.test(t)) return '低价优惠';
  return '其他';
}

async function fetchSource(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    let items = [];
    if (src.type === 'epic') {
      const r = await fetch(src.url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const j = await r.json();
      const catalog = j?.data?.Catalog?.searchStore?.elements || [];
      const now = Date.now();
      for (const e of catalog) {
        const promos = e.promotions?.promotionalOffers || [];
        let isFree = false, endDate = null;
        for (const p of promos) {
          const ds = p.discountSetting || {};
          if (ds.discountPercentage === 0 || ds.discountPrice === 0) { isFree = true; endDate = p.endDate || null; }
        }
        if (isFree && endDate && new Date(endDate).getTime() > now) {
          const slug = e.productSlug || e.catalogNs?.mappings?.[0]?.pageSlug || '';
          items.push({
            title: `Epic 免费：${e.title}`,
            link: slug ? `https://store.epicgames.com/zh-CN/p/${slug}` : 'https://store.epicgames.com/zh-CN/free-games',
            summary: e.description || '',
            date: new Date(endDate).toISOString(),
            expires_at: new Date(endDate).toISOString(),
            category: '游戏',
          });
        }
      }
    } else if (src.type === 'jina_rss') {
      const r = await fetch(src.url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      items = parseJinaMarkdown(await r.text()).map(it => ({ ...it, summary: '' }));
    } else {
      const r = await fetch(src.url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA } });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      items = parseRss(await r.text());
    }
    items = items.filter(it => it.title && it.link).map(it => ({
      title: it.title, link: it.link, summary: it.summary || '',
      date: parseDate(it.date), expires_at: it.expires_at || null, category: it.category || categorize(it.title),
    }));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '抓取失败' };
  } finally {
    clearTimeout(timer);
  }
}

// 历史状态：记住每个链接首次出现的时间（本轮新增标记）、以及上轮各源状态
function loadHistory(stateDir) {
  const f = path.join(stateDir, 'history.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { seen: {}, ran_at: null }; }
}
function saveHistory(stateDir, h) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'history.json'), JSON.stringify(h));
}

async function main() {
  const outDir = process.argv[2] || 'docs';
  const stateDir = process.argv[3] || 'state';
  const hist = loadHistory(stateDir);
  const nowIso = new Date().toISOString();
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;

  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const sources = [], merged = new Map();

  for (let i = 0; i < SOURCES.length; i++) {
    const src = SOURCES[i];
    const s = settled[i];
    const r = s.status === 'fulfilled' ? s.value : { ok: false, error: String(s.reason) };
    sources.push({ key: src.key, name: src.name, ok: r.ok, count: r.ok ? r.items.length : 0, error: r.ok ? '' : r.error });
    if (r.ok) for (const it of r.items) {
      if (!merged.has(it.link)) merged.set(it.link, { ...it, source_key: src.key });
    }
  }

  const items = [];
  for (const it of merged.values()) {
    const seen = hist.seen[it.link];
    const firstSeen = seen || nowIso;
    hist.seen[it.link] = firstSeen;
    const pubTime = it.date ? new Date(it.date).getTime() : null;
    // 只保留 7 天内：以发布时间或首次抓到时间为准
    const refTime = pubTime || Date.parse(firstSeen);
    if (refTime && refTime < cutoff) continue;
    items.push({
      title: it.title, link: it.link, summary: it.summary,
      category: it.category, source_key: it.source_key,
      date: it.date, expires_at: it.expires_at,
      first_seen: firstSeen,
      is_new: (Date.now() - Date.parse(firstSeen)) < 6 * 3600 * 1000,
    });
  }
  items.sort((a, b) => (b.first_seen || '').localeCompare(a.first_seen || ''));

  // 清理 30 天未见的链接，防止 history.json 无限增长
  for (const [link, fs1] of Object.entries(hist.seen)) {
    if (Date.parse(fs1) < Date.now() - 30 * 86400 * 1000) delete hist.seen[link];
  }
  hist.ran_at = nowIso;
  saveHistory(stateDir, hist);

  const data = { ran_at: nowIso, sources, items };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(data, null, 1));
  const okN = sources.filter(s => s.ok).length;
  console.log(`抓取完成: ${okN}/${sources.length} 来源成功, ${items.length} 条在架`);
  for (const s of sources) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}${s.ok ? ` (${s.count})` : ` — ${s.error}`}`);
}

main();

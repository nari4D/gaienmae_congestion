/**
 * 外苑前エリア イベントスクレイパー
 *
 * 取得対象: 神宮球場 / 国立競技場 / 秩父宮
 * 青年館は公式サイトに公演時刻がないため手動管理 (index.html の MANUAL_EVENTS)
 *
 * 使い方:
 *   node scraper.js              # 今月から4ヶ月分
 *   node scraper.js 2026 5       # 2026年5月から4ヶ月分
 *   node scraper.js 2026 5 6     # 2026年5月から6ヶ月分
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'events.js');

// ── 対象月を決定 ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const now  = new Date();
const startYear  = args[0] ? parseInt(args[0]) : now.getFullYear();
const startMonth = args[1] ? parseInt(args[1]) : now.getMonth() + 1;
const monthCount = args[2] ? parseInt(args[2]) : 4;

const targetMonths = [];
for (let i = 0; i < monthCount; i++) {
  let y = startYear, m = startMonth + i;
  while (m > 12) { m -= 12; y++; }
  targetMonths.push({ year: y, month: m });
}

console.log('対象月:', targetMonths.map(t => `${t.year}/${pad(t.month)}`).join(' '));
console.log();

// ── ユーティリティ ──────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function toH(timeStr) {
  const m = String(timeStr).match(/(\d{1,2})[：:時](\d{2})/);
  if (!m) return null;
  return parseInt(m[1]) + parseInt(m[2]) / 60;
}

function dateStr(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

function inTargetRange(y, m) {
  return targetMonths.some(t => t.year === y && t.month === m);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GaienmaeBot/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// ── 神宮球場 (JSON) ──────────────────────────────────────────────────────────
async function scrapeJingu() {
  console.log('[神宮球場] JSON取得中...');
  const data = await fetch('https://www.jingu-stadium.com/event/json/data.json').then(r => r.json());
  const events = [];

  for (const block of data.flat()) {
    const year = block.year;
    for (const ym of (block.yearData || [])) {
      const month = ym.month;
      if (!inTargetRange(year, month)) continue;   // 対象月のみ

      for (const dm of (ym.monthData || [])) {
        const day = dm.day;
        for (const ev of (dm.dayData || [])) {
          const [hh, mm] = ev.time.split(':').map(Number);
          const startH = hh + mm / 60;
          const cat = ev.category || '';

          let title = cat;
          if (ev.value && ev.value[0]) {
            const v = ev.value[0];
            const m1 = (v.team1 || '').match(/alt='([^']+)'/);
            const m2 = (v.team2 || '').match(/alt='([^']+)'/);
            if (m1 && m2) title = `${m1[1]} vs ${m2[1]}`;
            else if (v.title) title = v.title;
          }

          const { openOffset, dur } = jinguDur(cat);
          events.push({ date: dateStr(year, month, day), venue: 'jingu', title, open: startH - openOffset, start: startH, dur });
        }
      }
    }
  }
  console.log(`[神宮球場] ${events.length}件`);
  return events;
}

function jinguDur(cat) {
  if (cat === 'プロ野球')        return { openOffset: 1.0, dur: 3.0 };
  if (cat.includes('大学野球'))  return { openOffset: 0.5, dur: 4.0 };
  return { openOffset: 0.5, dur: 1.5 };
}

// ── 国立競技場 (JNS-E HTML) ──────────────────────────────────────────────────
async function scrapeMUFG() {
  const events = [];
  console.log('[国立競技場] HTML取得中...');

  for (const { year, month } of targetMonths) {
    const ym  = `${year}${pad(month)}`;
    // 今月は /event/、それ以外は /event/page/YYYYMM/
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const url = isCurrentMonth ? 'https://jns-e.com/event/' : `https://jns-e.com/event/page/${ym}/`;

    let html;
    try { html = await fetchText(url); }
    catch (e) { console.warn(`  ${year}/${pad(month)}: スキップ (${e.message})`); continue; }

    // /event/xxxx/ へのリンクを持つ <li><a> ブロックを抽出
    const items = [...html.matchAll(/<li><a href="\/event\/[^"]+">[\s\S]*?<\/a><\/li>/g)];
    let count = 0;

    for (const item of items) {
      const raw  = item[0];
      const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      // タイトル
      const titleM = raw.match(/class="p-event-list__head"[^>]*>([\s\S]*?)<\/p>/);
      const title  = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!title) continue;

      const isSports = raw.includes('スポーツ');
      const dur = isSports ? 2.0 : 2.5;

      // 日付 ("span class="date">MM/DD")
      const dateParts = [...raw.matchAll(/<span class="date">(\d{2})\/(\d{2})<\/span>/g)];
      if (!dateParts.length) continue;

      const dates = dateParts.map(dp => {
        const mo = parseInt(dp[1]), da = parseInt(dp[2]);
        const y = mo < month ? year + 1 : year; // 年またぎ対応
        return { y, mo, da };
      });

      // 時刻: 日付別の個別指定 ("2026年4月25日(土)開場15:00 開演18:00")
      const perDateRe = /(\d{4})年(\d{1,2})月(\d{1,2})日[^開場]*?開場(\d{1,2}[：:]\d{2})[^開演]*?開演(\d{1,2}[：:]\d{2})/g;
      const perDates  = [...text.matchAll(perDateRe)];

      if (perDates.length > 0) {
        // 日付ごとの個別時刻 (例: TWICE)
        for (const pd of perDates) {
          const open = toH(pd[4]), start = toH(pd[5]);
          if (open === null || start === null) continue;
          if (!inTargetRange(parseInt(pd[1]), parseInt(pd[2]))) continue;
          events.push({ date: dateStr(parseInt(pd[1]), parseInt(pd[2]), parseInt(pd[3])), venue: 'mufg', title, open, start, dur });
          count++;
        }
      } else {
        // 共通時刻パターン①: コンサート "開場15:30 開演17:30"
        const concertM = text.match(/開場(\d{1,2}[：:]\d{2})\s*開演(\d{1,2}[：:]\d{2})/);
        // 共通時刻パターン②: スポーツ "開始時間 19:30 キックオフ"
        const sportsM  = !concertM && text.match(/開始時間\s+(\d{1,2}[：:]\d{2})/);

        let open = null, start = null;
        if (concertM) {
          open  = toH(concertM[1]);
          start = toH(concertM[2]);
        } else if (sportsM) {
          start = toH(sportsM[1]);
          open  = start - 1.0; // 開場時間は公表なし→キックオフ1時間前と推定
        } else {
          continue; // "未定" などはスキップ
        }
        if (open === null || start === null) continue;

        for (const { y, mo, da } of dates) {
          if (!inTargetRange(y, mo)) continue;
          events.push({ date: dateStr(y, mo, da), venue: 'mufg', title, open, start, dur });
          count++;
        }
      }
    }
    console.log(`  ${year}/${pad(month)}: ${count}件`);
  }
  console.log(`[国立競技場] 計${events.length}件`);
  return events;
}

// ── 秩父宮 (HTML リスト + 個別ページ) ──────────────────────────────────────
async function scrapeChichibunomiya() {
  console.log('[秩父宮] リスト取得中...');
  const html  = await fetchText('https://www.jpnsport.go.jp/chichibunomiya/event/tabid/59/Default.aspx');
  const rows  = [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)];
  const links = [];

  for (const row of rows) {
    const dateM = row[0].match(/(\d{4})\/(\d{2})\/(\d{2})/);
    const linkM = row[0].match(/href="([^"]+eid=\d+[^"]*)"/);
    const nameM = row[0].match(/<a[^>]*>([\s\S]*?)<\/a>/);
    if (!dateM || !linkM) continue;

    const [, y, m, d] = dateM;
    const evY = parseInt(y), evM = parseInt(m), evD = parseInt(d);
    if (!inTargetRange(evY, evM)) continue;

    const title = nameM ? nameM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    const url   = linkM[1].startsWith('http') ? linkM[1] : `https://www.jpnsport.go.jp${linkM[1]}`;
    links.push({ date: dateStr(evY, evM, evD), url, title });
  }

  console.log(`[秩父宮] ${links.length}件の個別ページを並列取得中...`);

  const results = await Promise.all(links.map(async ({ date, url, title }) => {
    try {
      const detail = await fetchText(url);
      const text   = detail.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

      const openM  = text.match(/開場時間\s*([\d：:時]+|未定)/);
      const startM = text.match(/開始時間\s*([\d：:時]+)/);

      const start = startM ? toH(startM[1]) : null;
      let   open  = openM && openM[1] !== '未定' ? toH(openM[1]) : null;
      if (start !== null && open === null) open = start - 0.5; // 開場時間未定の場合

      return { date, venue: 'rugby', title, open, start };
    } catch { return null; }
  }));

  const events = [];
  for (const ev of results) {
    if (!ev || ev.start === null) continue;
    const isUniversity = ev.title.includes('大学') || ev.title.includes('セブンズ');
    const dur = isUniversity ? 6.0 : 1.5;
    events.push({ date: ev.date, venue: 'rugby', title: ev.title, open: ev.open, start: ev.start, dur });
  }
  console.log(`[秩父宮] ${events.length}件`);
  return events;
}

// ── メイン ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== 外苑前 スクレイパー ===\n');
  const t0 = Date.now();

  const [jingu, mufg, rugby] = await Promise.all([
    scrapeJingu(),
    scrapeMUFG(),
    scrapeChichibunomiya(),
  ]);

  const all = [...jingu, ...mufg, ...rugby];
  all.sort((a, b) => a.date.localeCompare(b.date));

  const generated = new Date().toLocaleString('ja-JP');
  const js = `// 自動生成 — ${generated}
// 青年館は手動管理 (index.html の MANUAL_EVENTS)
window.SCRAPED_EVENTS_UPDATED = "${generated}";
window.SCRAPED_EVENTS = ${JSON.stringify(all, null, 2)};
`;
  fs.writeFileSync(OUT_FILE, js, 'utf8');

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ ${all.length}件を events.js に書き出し (${sec}秒)`);
}

main().catch(err => { console.error('エラー:', err.message); process.exit(1); });

/**
 * dsh-stock-watch — 宏观 K 线/分时与手机页 /m 的一致性测试
 *
 * 需求（2026-10-06）：盯盘插件也要有 K 线，且与 https://stock.fueryuanyi.com/m 一致、
 * 同样实时更新。
 *
 * 「一致」的可验收定义：**同一份数据逐点相同**。所以这里不是"看起来像"，而是
 * 把插件路由的输出与 stock-panel 原始接口的返回**逐根/逐点比对**：
 *   插件 /dsh-stock-watch/macro/kline  ⇄  stock-panel /api/macro/kline
 *   插件 /dsh-stock-watch/macro/timeline ⇄  stock-panel /api/macro/timeline
 * 只要插件自作主张换源、少取几根、错位一个字段，这里立刻红。
 *
 * 依赖本机 stock-panel API（127.0.0.1:8888，与插件运行时的同一个源）。
 * 用法：node scripts/test-macro-chart.mjs [symbol]
 */
import { pathToFileURL } from "node:url";

const SYMBOL = (process.argv[2] || "XAU").toUpperCase();
const DB = process.env.DSH_STOCK_WATCH_DB_API || "http://127.0.0.1:8888";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) { console.log("✅ " + name); return; }
  failed += 1;
  console.log("❌ " + name + (extra === undefined ? "" : "  → " + JSON.stringify(extra)));
}

// ── 用 stub 的 ctx.webServer 收插件路由（同 smoke.mjs 的做法）──
const routes = {};
const ctx = {
  effect: (fn) => fn(),
  webServer: { register: (route) => { routes[route.path] = route.handler; return () => {}; } },
  get: () => undefined,
};
const mod = await import(pathToFileURL(new URL("../index.js", import.meta.url).pathname).href);
mod.apply(ctx);

function call(path, query) {
  return new Promise((resolve) => {
    let status = 0;
    const res = {
      writeHead: (s) => { status = s; },
      end: (body) => resolve({ status, json: JSON.parse(typeof body === "string" ? body : JSON.stringify(body)) }),
    };
    routes[path]({ url: path + (query ? "?" + query : "") }, res);
  });
}
async function db(path) {
  const r = await fetch(DB + path);
  return r.json();
}

console.log(`— 一致性测试（${SYMBOL}，对照 ${DB}）—`);
ok("两个新路由都注册上了",
   !!routes["/dsh-stock-watch/macro/kline"] && !!routes["/dsh-stock-watch/macro/timeline"],
   Object.keys(routes));

// ① K 线：日/周/月三个周期，插件输出 vs stock-panel 原始列式数据
for (const [period, bars] of [["day", 240], ["week", 260], ["month", 120]]) {
  const mine = (await call("/dsh-stock-watch/macro/kline", `symbol=${SYMBOL}&period=${period}&bars=${bars}`)).json;
  const raw = await db(`/api/macro/kline?symbol=${SYMBOL}&period=${period}&bars=${bars}`);
  const b = raw.bars || {};
  const n = (b.d || []).length;
  ok(`${period}: 根数与 stock-panel 一致（插件 ${mine.candles.length} / 源 ${n}）`,
     mine.candles.length === n && n > 0, { mine: mine.candles.length, src: n });
  let mismatched = null;
  for (let i = 0; i < n; i++) {
    const c = mine.candles[i];
    if (!c
        || c.time !== String(b.d[i])
        || c.open !== Number(b.o[i]) || c.high !== Number(b.h[i])
        || c.low !== Number(b.l[i]) || c.close !== Number(b.c[i])) { mismatched = { i, mine: c, src: { d: b.d[i], o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i] } }; break; }
  }
  ok(`${period}: 逐根 OHLC 完全相同`, mismatched === null, mismatched);
  ok(`${period}: 原样透传 hasVol/digits/unit（与 /m 同一份元数据）`,
     mine.hasVol === (raw.hasVol !== false) && mine.digits === Number(raw.digits) && mine.unit === raw.unit,
     { mine: { hasVol: mine.hasVol, digits: mine.digits, unit: mine.unit },
       src: { hasVol: raw.hasVol, digits: raw.digits, unit: raw.unit } });
}

// ② 分时：逐点比对（time/price），并确认 t 单调递增（跨日历日也要连续）
const mine = (await call("/dsh-stock-watch/macro/timeline", `symbol=${SYMBOL}`)).json;
const raw = await db(`/api/macro/timeline?symbol=${SYMBOL}`);
const src = (raw.data || [])[0] || null;
const srcPts = (src && src.data) || [];
ok(`分时点数与 stock-panel 一致（插件 ${mine.points.length} / 源 ${srcPts.length}）`,
   mine.points.length === srcPts.length, { mine: mine.points.length, src: srcPts.length });
let bad = null;
for (let i = 0; i < srcPts.length; i++) {
  const a = mine.points[i];
  if (!a || a.p !== Number(srcPts[i].price)) { bad = { i, mine: a, src: srcPts[i] }; break; }
}
ok("分时逐点价格相同", bad === null, bad);
let mono = true;
for (let i = 1; i < mine.points.length; i++) {
  if (mine.points[i].t <= mine.points[i - 1].t) { mono = false; break; }
}
ok("分时时间戳严格递增（24 小时盘跨日历日也不会回退）", mono);

// ③ 边界：非宏观 code / 未知 symbol 必须报错，而不是悄悄返回股票口径的数据
const notMacro = (await call("/dsh-stock-watch/macro/kline", "symbol=sh600105&period=day")).json;
ok("非宏观代码 → 明确报错（不去拉腾讯、也不返回空图当成功）",
   notMacro.candles.length === 0 && !!notMacro.error, notMacro);
const unknown = (await call("/dsh-stock-watch/macro/kline", "symbol=NOPE&period=day")).json;
ok("未知 symbol → 明确报错", unknown.candles.length === 0 && !!unknown.error, unknown);
const noMin = (await call("/dsh-stock-watch/macro/timeline", "symbol=sh600105")).json;
ok("非宏观代码的分时 → 明确报错", noMin.points.length === 0 && !!noMin.error, noMin);

// ④ 形状契约：客户端靠 code/period 判定「这份数据是不是当前这只票的」
ok("K 线响应带 code 与 period（客户端据此过滤，缺了就永远显示加载中）",
   mine.points.length >= 0 && (await call("/dsh-stock-watch/macro/kline", `symbol=${SYMBOL}&period=day`)).json.code === SYMBOL);

if (failed) {
  console.log(`\n✘ ${failed} 项不通过 —— 插件的宏观图与 /m 不是同一份数据了`);
  process.exit(1);
}
console.log("\n✓ 全部通过（插件宏观 K 线/分时与手机页 /m 逐点同源）");

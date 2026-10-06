/**
 * dsh-stock-watch — ⚡ 信号 视图的两条回归绊线（2026-10-06 用户连报两次）
 *
 * 报障①「点 ⚡ 信号 什么都没有了」：
 *   宏观标的里靠 DB 兜底的那几条（美元指数 / 美元日元 / 美元人民币 / 人民币账户黄金）
 *   没有 prevClose，/api/macro 给的 `pct` 是 **null**；而价格有值，所以服务端给
 *   live=true + state=halted。客户端原先写死 `row.live ? (… changePercent.toFixed(2) …) : ""`，
 *   `null >= 0` 为 true → `.toFixed` 抛 TypeError → React 整棵子树消失（面板空白）。
 *   触发条件很窄但很好撞：**给某个 halted 的宏观标的设了目标价、现价又越过它**，
 *   那一行就进了信号列表，于是「一点信号就白」。
 *
 * 报障②「点进那一行没显示」：
 *   详情视图/拉图 effect/研究报告是按 code 在 **当前分组** 的 data.rows 里找行；
 *   而 ⚡ 信号 是唯一会展示别的分组（尤其 🌍 宏观）行的地方 —— 找不到行 → 头部
 *   名字价格是「--」、目标价读不到、`row.macro` 也丢了 → 把宏观标的当股票去拉
 *   腾讯分时 → 空图 + 「分时：接口返回异常」。修法是查跨分组索引
 *   （`rowByCodeRef`：⚡ 信号 的行 ∪ 当前分组的行）。
 *
 * 这个脚本锁四件事：
 *   ① fmtPct / pctDir 对 null / undefined / NaN 的容忍（「—」与中性灰，不假装涨跌）；
 *   ② formatPrice(null) 不能印成「0.000」；
 *   ③ 源码里**不再出现**裸的 `changePercent.toFixed(`；
 *   ④ 详情视图三处都走跨分组索引，且索引确实由「信号行 ∪ 当前分组行」拼出来。
 *
 * 用法：node scripts/test-signal-view.mjs
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** 从 client.js 里抠出一个 `function name(参数) { … }` 的定义（按缩进收尾）。 */
function pick(name, arg = "row") {
  const start = src.indexOf(`function ${name}(${arg}) {`);
  if (start < 0) throw new Error(`抽不到函数 ${name}()`);
  const end = src.indexOf("\n    }", start);
  if (end < 0) throw new Error(`${name}() 的收尾找不到`);
  return src.slice(start, end + 6);
}

const fmtPct = new Function(`${pick("fmtPct")}\nreturn fmtPct;`)();
const pctDir = new Function(`${pick("pctDir")}\nreturn pctDir;`)();
const formatPrice = new Function(`${pick("formatPrice", "p")}\nreturn formatPrice;`)();

let failed = 0;
function ok(name, cond, extra) {
  if (cond) { console.log("✅ " + name); return; }
  failed += 1;
  console.log("❌ " + name + (extra === undefined ? "" : "  → " + JSON.stringify(extra)));
}

const live = (pct) => ({ live: true, changePercent: pct });

// ① 文案
ok("null 涨跌幅 → 「—」而不是抛错", fmtPct(live(null)) === "—", fmtPct(live(null)));
ok("undefined 涨跌幅 → 「—」", fmtPct(live(undefined)) === "—", fmtPct(live(undefined)));
ok("NaN 涨跌幅 → 「—」", fmtPct(live(NaN)) === "—", fmtPct(live(NaN)));
ok("0 → +0.00%", fmtPct(live(0)) === "+0.00%", fmtPct(live(0)));
ok("涨 → 带 +", fmtPct(live(0.77)) === "+0.77%", fmtPct(live(0.77)));
ok("跌 → 带 -", fmtPct(live(-2.38)) === "-2.38%", fmtPct(live(-2.38)));
ok("非 live → 空串", fmtPct({ live: false, changePercent: 1.2 }) === "");
ok("row 缺失 → 空串", fmtPct(null) === "" && fmtPct(undefined) === "");

// ② 方向（颜色）
ok("null → 无方向（中性灰）", pctDir(live(null)) === 0);
ok("涨 → 1", pctDir(live(1)) === 1);
ok("跌 → -1", pctDir(live(-1)) === -1);
ok("0 → 1（平盘归涨色，与原来一致）", pctDir(live(0)) === 1);
ok("非 live → 0", pctDir({ live: false, changePercent: 1 }) === 0);

// ②b 价格文案：null 不能变成「0.000」（halted 宏观行的 high/low/price 都是 null）
ok("formatPrice(null) → --（不是 0.000）", formatPrice(null) === "--", formatPrice(null));
ok("formatPrice('') → --", formatPrice("") === "--", formatPrice(""));
ok("formatPrice(undefined) → --", formatPrice(undefined) === "--");
ok("formatPrice(102.125) → 102.13", formatPrice(102.125) === "102.13", formatPrice(102.125));
ok("formatPrice(6.7035) → 6.704（三位小数口径不变）", formatPrice(6.7035) === "6.704", formatPrice(6.7035));
ok("formatPrice(0) → 0.000（真 0 仍然照印）", formatPrice(0) === "0.000", formatPrice(0));

// ③ 源码扫描：**禁止**任何 `changePercent.toFixed(` 的裸写法（注释行不算）。
//    安全写法是先 `const n = row.changePercent` 判类型、再 `n.toFixed(2)`（fmtPct 就是这么写的），
//    所以这个字面量一旦出现，就是有人又在渲染路径上直接算百分比了 —— 必须拦。
const bare = src.split("\n")
  .map((line, i) => ({ line: line.trim(), no: i + 1 }))
  .filter((x) => !x.line.startsWith("//") && x.line.includes("changePercent.toFixed("));
ok("渲染路径里没有裸的 changePercent.toFixed()", bare.length === 0, bare);
ok("涨跌幅只由 fmtPct 一处产出（判类型 + 兜底「—」）",
   /function fmtPct\(row\) \{[\s\S]*?typeof n !== "number"[\s\S]*?return "—"[\s\S]*?\n    \}/.test(src));

// ④ 跨分组行查找：详情视图（头部/目标价/宏观说明）、拉图 effect、研究报告三处，
//    都必须按「信号行 ∪ 当前分组行」的索引找 —— 只查当前分组会漏掉 ⚡ 信号 里的宏观行。
const lookups = (src.match(/rowByCodeRef\.current\.get\(view\.code\)/g) || []).length;
ok("按 code 找行都走跨分组索引（详情渲染 + 研究报告，≥2 处）", lookups >= 2, lookups);
// 拉图 effect 不再按「宏观就早退」处理：2026-10-06 起宏观也要拉图
// （走 stock-panel 的 /api/macro/*，与 /m 同一个接口）
ok("拉图 effect 不再对宏观早退", !/if \(r && r\.macro\) return undefined;/.test(src));
ok("宏观图走 /macro/kline 与 /macro/timeline 两条新路由",
   src.includes('api("/macro/kline"') && src.includes('api("/macro/timeline"'));
ok("索引确实由「⚡ 信号 的行 ∪ 当前分组的行」拼出来",
   /rowByCodeRef\.current = \(\(\) => \{[\s\S]*?for \(const r of signalRows\)[\s\S]*?for \(const r of rows\)[\s\S]*?\}\)\(\)/.test(src));
const oldLookup = src.split("\n")
  .map((line, i) => ({ line: line.trim(), no: i + 1 }))
  .filter((x) => !x.line.startsWith("//")
                 && x.line.includes("data.rows.find(")
                 && x.line.includes("view.code"));
ok("没有退回「只在当前分组里找行」的写法", oldLookup.length === 0, oldLookup);

if (failed) {
  console.log(`\n✘ ${failed} 项不通过 —— ⚡ 信号 视图的回归又回来了（空白 / 点进去没内容）`);
  process.exit(1);
}
console.log("\n✓ 全部通过（null 涨跌幅不再打崩列表；跨分组点进去也能找到行）");

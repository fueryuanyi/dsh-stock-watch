/**
 * dsh-stock-watch — 「有价但没有涨跌幅」这条回归的绊线
 *
 * 背景（2026-10-06 用户报障：点 ⚡ 信号 什么都没有了）：
 *   宏观标的里靠 DB 兜底的那几条（美元指数 / 美元日元 / 美元人民币 / 人民币账户黄金）
 *   没有 prevClose，/api/macro 给的 `pct` 是 **null**；而价格有值，所以服务端给
 *   live=true + state=halted。客户端原先写死 `row.live ? (… changePercent.toFixed(2) …) : ""`，
 *   `null >= 0` 为 true → `.toFixed` 抛 TypeError → React 整棵子树消失（面板空白）。
 *   触发条件很窄但很好撞：**给某个 halted 的宏观标的设了目标价、现价又越过它**，
 *   那一行就进了信号列表，于是「一点信号就白」。
 *
 * 这个脚本锁两件事：
 *   ① fmtPct / pctDir 对 null / undefined / NaN 的容忍（「—」与中性灰，不假装涨跌）；
 *   ② 源码里**不再出现**裸的 `changePercent.toFixed(`（只能出现在 fmtPct 里）——
 *      这条是真正的绊线：渲染路径里任何一个新的裸用法都会重新引入同一个崩溃。
 *
 * 用法：node scripts/test-pct-null.mjs
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

if (failed) {
  console.log(`\n✘ ${failed} 项不通过 —— 「有价没涨跌幅」这条回归回来了，点 ⚡ 信号 会再次整块空白`);
  process.exit(1);
}
console.log("\n✓ 全部通过（null 涨跌幅不会再把列表渲染打崩）");

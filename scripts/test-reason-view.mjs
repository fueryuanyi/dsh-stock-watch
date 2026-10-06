/**
 * dsh-stock-watch — 目标价理由（「为什么设这个价」）的展示回归
 *
 * 需求（2026-10-06）：详情里除了买入/卖出目标，还要在**同一处**看到对应的理由，
 * 且必须与 stock-panel 面板、手机页 /m 保持同步。
 *
 * 同步靠的是「同一份存储 + 同一个读接口」这条不变量：
 *   stock_targets.buy_reason / sell_reason
 *     → stock-panel /api/targets（唯一真理源）
 *     → 本插件 /dsh-stock-watch/targets 原样透传
 *     → targetRowOf() 搬成 buyReason / sellReason → 详情里的 .sk-why 块
 * 三个界面读的**不是各自的副本**，所以不存在「谁先改谁后改」的一致性问题；
 * 插件侧 60s 轮询 /targets（refreshTargets），在面板或 /m 上写的理由一分钟内出现。
 *
 * 这个脚本锁三件事：
 *   ① targetRowOf 必须把理由搬过来（漏了就「目标价有、理由没有」）；
 *   ② 只有理由、没有价的行也不能被丢掉（后端删行口径是「价与理由全空」）；
 *   ③ 源码层面：详情块读的是 targets[stripApiCode(view.code)]（DB 真源，不是行上的副本），
 *      列表行有 ✍ 标记，字段名与 stock-panel 的列名一致（buy_reason / sell_reason）。
 *
 * 用法：node scripts/test-reason-view.mjs
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** 抠出 `function name(arg) { … }`（按 4 空格缩进收尾）。 */
function pickFn(name, arg) {
  const start = src.indexOf(`function ${name}(${arg}) {`);
  if (start < 0) throw new Error(`抽不到函数 ${name}()`);
  const end = src.indexOf("\n    }", start);
  if (end < 0) throw new Error(`${name}() 的收尾找不到`);
  return src.slice(start, end + 6);
}

/** 抠出 `const name = (arg) => { … };`。 */
function pickArrow(name, arg) {
  const start = src.indexOf(`const ${name} = (${arg}) => {`);
  if (start < 0) throw new Error(`抽不到箭头函数 ${name}`);
  const end = src.indexOf("\n    };", start);
  if (end < 0) throw new Error(`${name} 的收尾找不到`);
  return src.slice(start, end + 7);
}

const targetRowOf = new Function(`${pickArrow("targetRowOf", "t")}\nreturn targetRowOf;`)();
const reasonLines = new Function(`${pickFn("reasonLines", "text")}\nreturn reasonLines;`)();
const reasonSplit = new Function(`${pickFn("reasonSplit", "entry")}\nreturn reasonSplit;`)();

let failed = 0;
function ok(name, cond, extra) {
  if (cond) { console.log("✅ " + name); return; }
  failed += 1;
  console.log("❌ " + name + (extra === undefined ? "" : "  → " + JSON.stringify(extra)));
}

// ① DB 行 → 内部行形状：价与理由都要搬
const row = targetRowOf({
  buy_target: 13.5, sell_target: null,
  buy_reason: "2026-10-06 半年线附近，分批接\n2026-10-07 破了就作废",
  sell_reason: "2026-10-06 到前高 31.5 兑现",
  buy_hit_at: "2026-10-06",
});
ok("买入价搬过来了", row.buyPrice === 13.5, row.buyPrice);
ok("卖出价未设 → 不产生 sellPrice", !("sellPrice" in row), row);
ok("买入理由原样搬过来（含换行）",
   row.buyReason === "2026-10-06 半年线附近，分批接\n2026-10-07 破了就作废", row.buyReason);
ok("卖出理由原样搬过来", row.sellReason === "2026-10-06 到前高 31.5 兑现", row.sellReason);
ok("已达标记仍在", row.buyHitAt === "2026-10-06");

// ② 只有理由、没有价的行也要在（后端只在「价与理由全空」时删行）
const whyOnly = targetRowOf({ buy_reason: "2026-10-06 只写了想法，价还没定" });
ok("只有理由的行也带得动理由", whyOnly.buyReason === "2026-10-06 只写了想法，价还没定");
ok("只有理由的行没有价字段", !("buyPrice" in whyOnly) && !("sellPrice" in whyOnly));

// ③ 全空 → 不产生任何字段
ok("空对象 → 空", Object.keys(targetRowOf({})).length === 0);
ok("null → 空", Object.keys(targetRowOf(null)).length === 0);
ok("理由为空串 → 不产生理由字段",
   !("buyReason" in targetRowOf({ buy_target: 1, buy_reason: "" })));

// ④ 条目切分与日期拆解（与 /m、面板同一口径）
ok("多条理由切分（空行丢弃）", JSON.stringify(reasonLines("a\n\n b \n")) === '["a","b"]', reasonLines("a\n\n b \n"));
ok("null → 空列表", reasonLines(null).length === 0);
const s1 = reasonSplit("2026-10-06 回调到年线");
ok("日期抬出来", s1.d === "2026-10-06" && s1.t === "回调到年线", s1);
const s2 = reasonSplit("回调到年线 2026-10-06");
ok("日期在中间 → 整条当正文（不吞内容）", s2.d === "" && s2.t === "回调到年线 2026-10-06", s2);

// ⑤ 源码层面：读的是 DB 真源、有一眼可见的标记、字段名与 stock-panel 列名一致
ok("详情理由块读 targets[stripApiCode(view.code)]（DB 真源，不是行上的副本）",
   /targets\[stripApiCode\(view\.code\)\]/.test(src));
ok("详情渲染确实插入了理由块",
   (src.match(/whyBlock/g) || []).length >= 2, (src.match(/whyBlock/g) || []).length);
ok("列表行有 ✍ 标记（有理由才出现）",
   src.includes("hasReason(row.code)") && src.includes("sk-why-badge"));
ok("字段名与 stock-panel 的列名一致（读 buy_reason / sell_reason）",
   src.includes("t.buy_reason") && src.includes("t.sell_reason"));
ok("写侧不越权：插件里没有理由的写入口",
   !src.includes("_reason_append") && !src.includes("_reason_del"));

if (failed) {
  console.log(`\n✘ ${failed} 项不通过 —— 「理由与目标价同一处、且与面板//m 同步」这条链断了`);
  process.exit(1);
}
console.log("\n✓ 全部通过（理由随目标价一行搬动；详情里同一处可见；字段与 stock-panel 同源）");

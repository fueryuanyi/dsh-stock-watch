#!/usr/bin/env node
/**
 * 批量快照的解析与规模验证（2026-10-06 把「一个标的一次请求」改成整批那次）。
 *
 * 三件事必须成立，缺一不可：
 *   ① 批量解析出的价格/涨跌幅与**单只分钟接口**那份一致 —— 两边本来就是腾讯的
 *      同一个 `qt` 数组，字段位若漂了，界面上会出现「价格没变但涨跌幅变了」这类
 *      最难查的错；
 *   ② 覆盖率：整批取到的数 = 请求的数（漏一只 = 那只永远显示 `--`）；
 *   ③ 规模：一轮 /quotes 的上游请求数从「标的数」降到「1~2 + 当前分组」。
 *
 * 报文用的是**实测原文**（腾讯 qt.gtimg.cn，GBK 解码后 88 个字段），不是手搓的。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");

// ── ① 取数路径（源码级）──
assert.match(src, /const batchQuotes = stockSymbols\.length > 0 \? await fetchBatchQuotes/, "快照没走整批");
assert.match(src, /if \(!\(includeMinutes && curCodes\.has\(s\.code\)\)\) return \{ quote: snap, prices: \[\] \}/,
             "非当前分组的标的仍会发分钟请求");
assert.match(src, /QUOTE_BATCH_SIZE = 60/, "批量大小常量不见了");
assert.match(src, /new TextDecoder\("gbk"\)/, "批量接口是 GBK 文本，必须显式转码");

// ── ② 解析（纯函数，抠出来跑）──
const fn = src.slice(src.indexOf("function parseTencentBatch"), src.indexOf("async function fetchBatchQuotes"));
const mod = await import("data:text/javascript," + encodeURIComponent(fn + "\nexport { parseTencentBatch };"));
const text = 'v_sh600737="1~中粮糖业~600737~14.66~13.80~14.10~670381~371525~298856~14.66~1414~14.65~378~14.64~154~14.63~548~14.62~98~14.67~106~14.68~449~14.69~589~14.70~4195~14.71~890~~20260930161434~0.86~6.23~14.73~14.09~14.66/670381/972325951~670381~97233~3.13~28.13~~14.73~14.09~4.64~313.56~313.56~2.80~15.18~12.42~1.06~-3637~14.50~25.77~32.96~~~1.32~97232.5951~46.1790~315~   A~GP-A~-13.10~-2.33~2.32~9.95~5.97~19.97~9.51~1.95~-3.49~27.26~2138848228~2138848228~-41.23~-12.84~2138848228~~~-6.09~0.00~~CNY~0~___D__F__N~14.75~-2193~";';
const m = mod.parseTencentBatch(text);
assert.equal(m.size, 1, "应解析出 1 只");
const q = m.get("600737");
assert.equal(q.code, "sh600737");
assert.equal(q.name, "中粮糖业");
assert.equal(q.price, 14.66);
assert.equal(q.changeAmount, 0.86);      // [31]
assert.equal(q.changePercent, 6.23);     // [32]
assert.equal(q.high, 14.73);             // [33]
assert.equal(q.low, 14.09);              // [34]
assert.equal(q.volume, 670381);          // [6] 手
assert.equal(q.amount, 97233 * 10000);   // [37] 万元 → 元

// 与单只分钟接口同一套字段位（两边算法一致才敢换取数方式）
const minuteQt = src.slice(src.indexOf("function parseMinuteJson"), src.indexOf("async function fetchQuoteResult"));
for (const idx of ["qt[1]", "qt[3]", "qt[31]", "qt[32]", "qt[33]", "qt[34]", "qt[6]", "qt[37]"]) {
  assert.ok(minuteQt.includes(idx), `分钟接口那份解析没有 ${idx} —— 两份字段位已不一致`);
}

// ── ③ 残缺/垃圾报文不能造出半条行 ──
assert.equal(mod.parseTencentBatch("").size, 0);
assert.equal(mod.parseTencentBatch('v_pv_none_match="1";').size, 0);
assert.equal(mod.parseTencentBatch('v_sh600737="1~2~3";').size, 0, "字段不足 35 个应丢弃");
assert.equal(mod.parseTencentBatch('v_sz000001="1~平安银行').size, 0, "半截报文应丢弃");

// 多只一批时的规模：60 个代码 = 1 发
assert.match(src, /i \+= QUOTE_BATCH_SIZE/, "分批循环不见了");

console.log(`✅ 批量快照：解析（88 字段实测报文）/ 与分钟接口同字段位 / 垃圾报文 / 分批 —— 全过`);

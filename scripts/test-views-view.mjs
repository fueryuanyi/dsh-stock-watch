#!/usr/bin/env node
/**
 * 🧠 判断（只读）在插件里的契约。
 *
 * 三件必须成立：
 *   ① 宿主有只读代理 `/views` → 打到 stock-panel 的 `/api/views`（带 code）；
 *   ② 客户端**不出现任何写调用**（action:add/update/delete 或 POST /views）——
 *      写入口只该在桌面面板与手机页，插件里多一个入口就多一处会漂的口径；
 *   ③ 该取数**不进 10 秒轮询**：判断是天粒度，进轮询只会白打请求。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const idx = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const cli = readFileSync(new URL("../client.js", import.meta.url), "utf8");

// ① 宿主路由
assert.match(idx, /register\("\/dsh-stock-watch\/views"/, "宿主缺 /views 只读代理");
assert.match(idx, /\/api\/views` \+ \(code \? `\?code=\$\{encodeURIComponent\(code\)\}` : ""\)/,
             "代理没把 code 传给 /api/views");
assert.match(idx, /sendJson\(res, 200, \{ ok: true, views: json\.views \|\| \[\], stats: json\.stats \|\| \{\}/,
             "回包形状不对（客户端要读 views/stats）");

// ② 客户端只读（收窄到"判断"这一条：关注池的 action:"add" 是合法用法，别误伤）
for (const bad of ['api("/view",', '"/api/view"', 'views", { action', '"POST", "/views"']) {
  assert.ok(!cli.includes(bad), `客户端出现了判断的写入口 ${bad} —— 插件必须只读`);
}
assert.ok(!/\/views[\s\S]{0,80}action:/.test(cli), "views 调用旁边出现了 action —— 疑似写入口");
assert.match(cli, /function viewsOf\(code, cacheRef\)/, "缺 viewsOf");
assert.match(cli, /api\("\/views", \{ code: stripApiCode\(code\) \}\)/, "取数没带 code");
assert.match(cli, /sk-views/, "没有渲染块");

// ③ 不进轮询：viewsOf 只应在详情渲染里调用一次（不在 load/轮询里）
const calls = [...cli.matchAll(/viewsOf\(/g)].length;
assert.equal(calls, 2, `viewsOf 出现 ${calls} 次（1 次定义 + 1 次调用才对）`);
assert.match(cli, /viewsOf\(view\.code, viewsCacheRef\);/, "详情里没按当前标的取数");

console.log("✅ 插件「判断」只读契约通过（代理带 code / 客户端零写调用 / 不进轮询）");

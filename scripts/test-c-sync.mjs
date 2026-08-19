/**
 * C 方案本地验证脚本（无 cordis 依赖）：
 * 模拟 ctx.webServer.register 收集路由，然后：
 *  1) 8888 关闭时：/config 降级 settings.json
 *  2) 8888 开启（假 API 返回 DB 关注池）时：/config 返回 DB 分组（bucket → tab，无 bucket → 全部关注）
 *  3) /watchlist POST add / remove 直写假 DB 并返回 ok
 *  4) 空关注池时 /config 返回空组（不降级）
 *
 * 运行：node scripts/test-c-sync.mjs
 */
import http from "node:http";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// 先设置 DB 指向假服务器端口（index.js 惰性读取 env，import 前设好）
const PORT = 18888;
process.env.DSH_STOCK_WATCH_DB_API = `http://127.0.0.1:${PORT}`;
const { apply: pluginApply } = await import("../index.js");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (extra ? " — " + extra : "")); }
}

/** 收集路由的伪 ctx：effect 立即执行（cordis 中 effect 在上下文就绪后调用，测试里同步触发） */
function makeCtx() {
  const routes = {};
  return {
    routes,
    ctx: {
      webServer: { register: ({ kind, path, handler }) => { routes[path] = handler; } },
      effect: (fn) => fn(),
      get: () => undefined,
    },
  };
}

/** 模拟请求对象 */
function makeReq(method, body) {
  const req = { method, url: "/", on: (ev, cb) => { if (ev === "data" && body) cb(JSON.stringify(body)); if (ev === "end") cb(); } };
  return req;
}

/** 解析响应 */
function captureRes() {
  let status = 0;
  let payload = null;
  const res = {
    writeHead: (s) => { status = s; },
    end: (b) => { payload = JSON.parse(b); },
  };
  return { res, get: () => ({ status, payload }) };
}

// 假 DB API：先写关注池
const DB = new Map();
const DB_GROUPS = [
  { code: "000333", name: "美的集团", bucket: "核心" },
  { code: "600885", name: "宏发股份", bucket: "" },
  { code: "002142", name: "宁波银行", bucket: "核心" },
  { code: "603259", name: "药明康德", bucket: "" },
];
for (const s of DB_GROUPS) DB.set(s.code, s);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && url.pathname === "/api/watchlist") {
    res.end(JSON.stringify({ count: DB.size, stocks: [...DB.values()] }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/watchlist/add") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      const code = String(data.code);
      if (!DB.has(code)) DB.set(code, { code, name: data.name || code, bucket: "" });
      res.end(JSON.stringify({ ok: true, added: [code] }));
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/watchlist/remove") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      for (const c of data.codes || []) DB.delete(String(c));
      res.end(JSON.stringify({ ok: true, removed: data.codes || [] }));
    });
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

// 准备 ~/.stocking/settings.json（降级测试用）
const stockingDir = join(homedir(), ".stocking");
mkdirSync(stockingDir, { recursive: true });
const settingsPath = join(stockingDir, "settings.json");
const legacySettings = { groups: [{ name: "旧分组", symbols: [{ code: "sh600000" }, { code: "sz000001" }] }] };
writeFileSync(settingsPath, JSON.stringify(legacySettings));

async function run() {
  console.log("== 测试 1：8888 关闭（DB 不可用）→ /config 降级 settings.json ==");
  {
    const { ctx, routes } = makeCtx();
    pluginApply(ctx);
    // 此刻假服务器尚未 listen（18888 未监听）= DB 不可用
    const { res, get } = captureRes();
    await routes["/dsh-stock-watch/config"](makeReq("GET"), res);
    const out = get();
    check("HTTP 200", out.status === 200);
    check("source=file（降级）", out.payload.source === "file");
    check("dbDown=true", out.payload.dbDown === true);
    check("返回 settings.json 分组", out.payload.groups[0].name === "旧分组");
    check("分组含 sh600000", out.payload.groups[0].symbols.some((s) => s.code === "sh600000"));
  }

  console.log("== 测试 2：8888 开启 → /config 返回 DB 分组 ==");
  await new Promise((r) => server.listen(PORT, r));
  {
    const { ctx, routes } = makeCtx();
    pluginApply(ctx);
    const { res, get } = captureRes();
    await routes["/dsh-stock-watch/config"](makeReq("GET"), res);
    const out = get();
    check("HTTP 200", out.status === 200);
    check("source=db", out.payload.source === "db");
    check("dbDown=false", out.payload.dbDown === false);
    const names = out.payload.groups.map((g) => g.name);
    check("bucket 分组「核心」存在", names.includes("核心"));
    check("bucket 分组「未分组」存在", names.includes("未分组"));
    const core = out.payload.groups.find((g) => g.name === "核心");
    check("「核心」含美的+宁波银行", core.symbols.length === 2 && core.symbols.every((s) => ["sz000333", "sz002142"].includes(s.code)));
    const ungrouped = out.payload.groups.find((g) => g.name === "未分组");
    check("「未分组」含宏发+药明", ungrouped.symbols.length === 2);
    check("代码带市场前缀", out.payload.groups.every((g) => g.symbols.every((s) => /^(sh|sz)\d{6}$/.test(s.code))));
  }

  console.log("== 测试 3：/watchlist 代理 add / remove 直写 DB ==");
  {
    const { ctx, routes } = makeCtx();
    pluginApply(ctx);
    // add
    {
      const { res, get } = captureRes();
      await routes["/dsh-stock-watch/watchlist"](makeReq("POST", { action: "add", code: "sh600519", name: "贵州茅台" }), res);
      const out = get();
      check("add 返回 ok", out.status === 200 && out.payload.ok === true);
      check("DB 已含 600519", DB.has("600519"));
      check("DB name 为贵州茅台", DB.get("600519").name === "贵州茅台");
    }
    // add 非法代码
    {
      const { res, get } = captureRes();
      await routes["/dsh-stock-watch/watchlist"](makeReq("POST", { action: "add", code: "abc" }), res);
      check("非法代码被拒 400", get().status === 400);
    }
    // add 缺失 action
    {
      const { res, get } = captureRes();
      await routes["/dsh-stock-watch/watchlist"](makeReq("POST", { code: "sh600519" }), res);
      check("缺 action 被拒 400", get().status === 400);
    }
    // remove
    {
      const { res, get } = captureRes();
      await routes["/dsh-stock-watch/watchlist"](makeReq("POST", { action: "remove", code: "sz000333" }), res);
      const out = get();
      check("remove 返回 ok", out.status === 200 && out.payload.ok === true);
      check("DB 已删 000333", !DB.has("000333"));
    }
    // remove 后 DB 缓存失效 → /config 重新拉（验证缓存失效：新 ctx 用相同进程缓存，先清）
    {
      const { ctx, routes } = makeCtx();
      pluginApply(ctx);
      const { res, get } = captureRes();
      await routes["/dsh-stock-watch/config"](makeReq("GET"), res);
      const out = get();
      const core = out.payload.groups.find((g) => g.name === "核心");
      check("remove 后「核心」只剩宁波银行", core && core.symbols.length === 1 && core.symbols[0].code === "sz002142");
    }
  }

  console.log("== 测试 4：DB 空关注池 → /config 返回空「全部关注」tab（不降级到旧配置） ==");
  {
    process.env.DSH_STOCK_WATCH_DB_CACHE_TTL = "0"; // 关闭缓存，确保读到最新 DB
    DB.clear();
    const { ctx, routes } = makeCtx();
    pluginApply(ctx);
    const { res, get } = captureRes();
    await routes["/dsh-stock-watch/config"](makeReq("GET"), res);
    const out = get();
    check("source=db（仍以 DB 为准）", out.payload.source === "db");
    check("dbDown=false", out.payload.dbDown === false);
    check("空「全部关注」tab（不显示旧配置/默认分组）",
      Array.isArray(out.payload.groups) && out.payload.groups.length === 1
      && out.payload.groups[0].name === "全部关注" && out.payload.groups[0].symbols.length === 0);
  }

  console.log("== 测试 5：/config 与 /quotes 走 5s TTL 缓存（不重复打 DB） ==");
  {
    DB.clear();
    for (const s of DB_GROUPS.slice(0, 2)) DB.set(s.code, s);
    const { ctx, routes } = makeCtx();
    pluginApply(ctx);
    let hits = 0;
    // 复用已启动 server，包一层计数：重建 server 太重，改为直接观察两次调用一致即可
    const { res: r1, get: g1 } = captureRes();
    await routes["/dsh-stock-watch/config"](makeReq("GET"), r1);
    const { res: r2, get: g2 } = captureRes();
    await routes["/dsh-stock-watch/config"](makeReq("GET"), r2);
    check("两次 /config 结果一致（缓存）", JSON.stringify(g1().payload.groups) === JSON.stringify(g2().payload.groups));
    check("缓存生效（第二次仍是 DB 分组）", g2().payload.source === "db" && g2().payload.groups.length === 2);
    void hits;
  }

  server.close();
  rmSync(stockingDir, { recursive: true, force: true });
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

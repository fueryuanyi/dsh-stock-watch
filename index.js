/**
 * dsh-stock-watch — node 端
 *
 * cordis 插件：在 dsh web 服务器上注册 /dsh-stock-watch/* 路由：
 *   - /dsh-stock-watch/config   读取 ~/.stocking/settings.json（客户端首次迁移用）
 *   - /dsh-stock-watch/quotes   按分组拉取实时行情（腾讯分钟接口，快照 + 分时）
 *   - /dsh-stock-watch/kline    日/周/月 K 线（fqkline 接口，前复权）
 *   - /dsh-stock-watch/minute   分时详情（分钟点 + 昨收）
 *
 * 浏览器端（client.js）通过 fetch 消费这些路由。
 * 数据源与原 stocking CLI 的 market.ts 同源：腾讯财经 web.ifzq.gtimg.cn。
 */
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * C 方案：DB 单一真理源（stock-panel 本地 API）
 *
 * - 关注池成员与分组以 http://127.0.0.1:8888/api/watchlist 为准（stocks.active=1）。
 * - /config 优先返回 DB 分组；8888 不可用或关注池为空时降级 ~/.stocking/settings.json（旧行为）。
 * - 药丸内「添加/删除股票」经 /dsh-stock-watch/watchlist 代理直写 DB（严格单一来源）。
 * - 分组（bucket）的增删改名锁定在面板侧，药丸为只读镜像视图。
 * - 目标价（buyPrice/sellPrice）是盯盘私货，留在浏览器 localStorage 覆盖层，合并时按 code 保留。
 */
const DB_API_TIMEOUT = 2000;
let dbGroupsCache = null;
let dbGroupsCacheAt = 0;

/** DB API 基址（惰性读取，便于测试/环境覆盖） */
function dbApiBase() {
  return process.env.DSH_STOCK_WATCH_DB_API || "http://127.0.0.1:8888";
}

/** DB 分组缓存 TTL（默认 5s，测试可置 0 关闭缓存） */
function dbCacheTtl() {
  const v = parseInt(process.env.DSH_STOCK_WATCH_DB_CACHE_TTL || "5000", 10);
  return Number.isFinite(v) && v >= 0 ? v : 5000;
}

const name = "dsh-stock-watch";
/** Required services: webServer（HTTP 路由）。 */
const inject = ["webServer"];

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const STOCKS_PATH = join(MODULE_DIR, "data", "a_stocks.json");
const SKILLS_SRC_DIR = join(MODULE_DIR, "skills");
/** 安装时注入到用户技能目录的技能（与「一键分析」提示词引用的技能保持一致）。 */
const BUNDLED_SKILLS = ["investment-research", "frontend-design"];

// ---------------------------------------------------------------------------
// 技能注入：安装插件（首次启动 dsh web）时把自带技能复制到用户技能目录
// ~/.agents/skills/<name>/，让「一键分析」引用的技能真正可用（此前只是随包文件）。
// - 目标已存在 SKILL.md 则跳过，尊重用户已有/自定义版本（删除后重启可重新注入）
// - 可用环境变量覆盖：DSH_STOCK_WATCH_SKILLS_DIR（目标目录）、DSH_STOCK_WATCH_NO_SKILLS=1（禁用）
// ---------------------------------------------------------------------------
function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else copyFileSync(s, d);
  }
}

function ensureUserSkills() {
  if (process.env.DSH_STOCK_WATCH_NO_SKILLS === "1") return;
  const skillsRoot = process.env.DSH_STOCK_WATCH_SKILLS_DIR || join(homedir(), ".agents", "skills");
  for (const skill of BUNDLED_SKILLS) {
    const src = join(SKILLS_SRC_DIR, skill);
    const dest = join(skillsRoot, skill);
    try {
      if (existsSync(join(dest, "SKILL.md"))) continue; // 已存在：尊重用户版本，不覆盖
      if (!existsSync(join(src, "SKILL.md"))) continue; // 包内缺失（本地开发可能没拷）：跳过
      copyDirSync(src, dest);
      writeFileSync(
        join(dest, "_user_meta.json"),
        JSON.stringify({ name: skill, installedAt: Date.now(), source: "dsh-stock-watch" }, null, 2),
      );
      console.log(`[dsh-stock-watch] 已注入技能 ${skill} -> ${dest}`);
    } catch (e) {
      console.error(`[dsh-stock-watch] 技能 ${skill} 注入失败:`, e && e.message ? e.message : e);
    }
  }
}

let stocksCache = null;

// ---------------------------------------------------------------------------
// 扇形菜单注入提示词（不直接暴露：客户端只发送「每日复盘/行情分析/涨停分析」几个字，
// 完整提示词由系统提示条件式注入——仅当用户消息匹配对应关键词时生效）
// ---------------------------------------------------------------------------
const FAN_PROMPTS = {
  // 数据管道前缀：若本机存在 stock-panel 项目（/Users/tt/code/stock-panel），
  // 每日复盘必须先走 sp5 market-review 读取落盘的市场复盘数据，再基于真实数据回答，
  // 不得凭空编造涨停家数/连板/晋级率等数据。项目缺失时降级为网络现拉并标注数据来源。
  每日复盘: `请作为专业的A股短线复盘分析师，帮我完成今天的盘后复盘。请基于以下框架：

数据管道（必须执行）：若本机存在 /Users/tt/code/stock-panel 项目，先运行
  cd /Users/tt/code/stock-panel && ./sp5 market-review --date 今天
读取生成的 sp-reviews/_市场/YYYY-MM-DD.md（含涨停家数/炸板/连板分布/晋级率/主线板块/情绪/关注池联动），
再运行 ./sp5 status 与 ./sp5 review --all --pinned-only 获取持仓与置顶股复盘要点。
所有数字以这些文件为准；项目不存在时用网络数据并明确标注来源与置信度，严禁凭空编造。

1. 市场概览：指数表现、成交量变化、涨跌家数分布。不要只报数据，要点出"这说明什么"。

2. 涨停梯队：今日涨停多少家？炸板多少家？连板高度到几板了？首板、二板、三板各多少？晋级率如何？

3. 主线与轮动：今天市场围绕哪些方向在交易？哪些是主线、哪些只是轮动？哪些方向冲高回落？

4. 情绪判断：今天的情绪是在加强、分化、修复还是退潮？赚钱效应如何？

5. 核心个股反馈：龙头股、中军股的表现如何？从它们的走势能看出什么？结合关注池联动提示持仓股表现。

6. 明日关键观察：明天最需要盯住的变量是什么？不要只说"关注市场变化"，要说具体看什么指标。

输出格式用7个板块，每个板块一句话结论。要有明确判断，不要模棱两可。`,
  行情分析: `获取A股实时行情数据，给出整体分析：

数据管道（必须执行）：若本机存在 /Users/tt/code/stock-panel 项目，用 ./sp5 status 与 ./sp5 list
拿持仓与关注池，行情数字以 ./sp5 check <代码> 与实时接口为准，不得凭空编造；项目不存在时用网络数据并标注来源。

市场温度：当前是进攻还是防守格局？一句话定性。

量价关系：放量还是缩量？量价是否配合？说明什么？

结构分化：大小盘风格如何？哪些板块在领涨/领跌？

操作基调：此刻适合积极、谨慎还是观望？给明确结论。
输出要求：每项不超过两行，总字数控制在200字以内。`,
  涨停分析: `基于今日涨停数据（涨停家数、连板高度、炸板率、涨停板块分布），分析：

数据管道（必须执行）：若本机存在 /Users/tt/code/stock-panel 项目，先运行
  cd /Users/tt/code/stock-panel && ./sp5 market-review --date 今天
读取 sp-reviews/_市场/YYYY-MM-DD.md 的涨停梯队/主线/情绪数据后回答；项目不存在时用网络数据并标注来源。

情绪热度（亢奋/正常/冰点）

主线板块（涨停最集中方向）

龙头高度及晋级情况

明天接力风险或机会
每项一句话，总字数控制在150字以内。`,
};

// 2026-08-25: web.ifzq.gtimg.cn 的 /appstock/app/minute/query 被腾讯 WAF 拦截（HTTP 501→waf.tencent.com/501page.html），
// 同路径换 ifzq.gtimg.cn（无 web. 前缀）实测正常；K 线接口 web.ifzq 仍可用，保持不动。
const MINUTE_API = "https://ifzq.gtimg.cn/appstock/app/minute/query?code={code}&r=0.1";
// 批量快照：腾讯同一个 `q=` 接口能一次吞几十个代码（实测 60 个 0.2s 内回）。
// 2026-10-06 之前是**一个标的一次请求**（111 只 ≈ 111 发/轮）—— 那正是当初必须加
// 上游熔断的原因；现在整批只要 1~2 发，熔断基本不会再触发。
const QUOTE_BATCH_API = "https://qt.gtimg.cn/q={codes}";
const QUOTE_BATCH_SIZE = 60;
const KLINE_API = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,,{count},qfq";

const DEFAULT_GROUPS = [
  { name: "分组1", symbols: [{ code: "sh000001" }, { code: "sz399300" }, { code: "sh601899" }] },
  { name: "分组2", symbols: [] },
];

// ---------------------------------------------------------------------------
// 配置读取与容错清洗（与 stocking/src/settings.ts 语义一致）
// ---------------------------------------------------------------------------

/** 只接受正数价格，其余视为未配置 */
function normalizePrice(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function normalizeSymbol(raw) {
  if (typeof raw === "string") return { code: raw };
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  if (typeof o.code !== "string" || o.code.length === 0) return null;
  const s = { code: o.code };
  if (typeof o.name === "string" && o.name.trim()) s.name = o.name.trim();
  // 标签式分组（stock-panel DB stocks.groups，只读镜像）：透传给客户端行渲染。
  const tags = normalizeTags(o.groups !== undefined ? o.groups : o.tags);
  if (tags.length > 0) s.tags = tags;
  const buy = normalizePrice(o.buyPrice);
  if (buy !== undefined) s.buyPrice = buy;
  const sell = normalizePrice(o.sellPrice);
  if (sell !== undefined) s.sellPrice = sell;
  return s;
}

/** 标签数组清洗：非空字符串、去重、单条 ≤16 字、最多 6 条 */
function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const v = t.trim().slice(0, 16);
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length >= 6) break;
  }
  return out;
}

function normalizeGroup(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 32) : "未命名分组";
  const symbols = [];
  const seen = new Set();
  if (Array.isArray(raw.symbols)) {
    for (const item of raw.symbols) {
      const sym = normalizeSymbol(item);
      if (!sym || seen.has(sym.code)) continue;
      seen.add(sym.code);
      symbols.push(sym);
    }
  }
  return { name, symbols };
}

/** 客户端 localStorage 配置（清洗 + 跨组去重） */
function normalizeClientGroups(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const g = normalizeGroup(item);
    if (!g) continue;
    g.symbols = g.symbols.filter((s) => {
      if (seen.has(s.code)) return false;
      seen.add(s.code);
      return true;
    });
    out.push(g);
  }
  return out.length > 0 ? out : null;
}

/** 去掉市场前缀（sh600000 → 600000），用于回写 DB */
function stripApiCode(code) {
  const s = String(code || "");
  return s.replace(/^(sh|sz|bj)/i, "");
}

/** 6 位数字 → 带市场前缀（供腾讯接口/药丸内部用） */
function ensureApiCode(code, market) {
  const s = stripApiCode(code);
  if (/^\d{6}$/.test(s)) return normalizeApiCode(s, market);
  return s;
}

/**
 * 市场前缀：优先用 DB 的 market 字段（权威），否则按代码段推断。
 * 推断口径与 stock-panel 面板 data/api_server.py 的 _sdk_code 完全一致：
 * 6→沪、4/8→北、9→深、5→沪市基金/ETF、15/16/18→深市基金/ETF/LOF、其余（0/3）→深。
 * 注意 159xxx 是深市 ETF——旧版缺这一段会推成 sh，腾讯接口取不到行情（行无价）。
 */
function marketOf(code, market) {
  const m = String(market || "").trim().toLowerCase();
  if (m === "sh" || m === "sz" || m === "bj") return m;
  const c = stripApiCode(code);
  const d = c[0];
  if (d === "6" || d === "5") return "sh";
  if (d === "4" || d === "8") return "bj";
  if (d === "9") return "sz";
  if (c.startsWith("15") || c.startsWith("16") || c.startsWith("18")) return "sz";
  return "sz";
}

/** 从本地 stock-panel API 拉关注池（DB stocks.active=1），失败/超时返回 null */
async function fetchDbWatchlist() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DB_API_TIMEOUT);
  try {
    const res = await fetch(`${dbApiBase()}/api/watchlist`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return json && Array.isArray(json.stocks) ? json.stocks : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * DB 关注池行 → stock-watch 分组数组。
 * 分组策略（C 方案 · 严格单一来源）：
 *   - 成员：只保留 active=1 的关注池（服务端已过滤），按 code 去重。
 *   - 分组 tab：用 DB 的 bucket（互斥单分组）生成 tab；buckets 表里的空分组也生成 tab
 *     （否则「新建空分组」会因无股票被过滤掉，用户误以为没建成）。
 *   - 无 bucket 的股票进「未分组」兜底 tab（无任何分组时显示「全部关注」）。
 *   - 代码统一转带市场前缀；名称从 DB 取（腾讯行情名称只是展示覆盖）。
 */
function dbWatchlistToGroups(stocks, buckets) {
  const byBucket = new Map();
  const seen = new Set();
  for (const s of stocks) {
    const rawCode = String(s.code || "").trim();
    if (!rawCode) continue;
    const code = ensureApiCode(rawCode, s.market); // DB market 字段优先（159xxx 深市 ETF 曾被推成 sh 取不到行情）
    if (seen.has(code)) continue;
    seen.add(code);
    const sym = { code };
    if (s.name && String(s.name).trim()) sym.name = String(s.name).trim();
    // DB 的 labels（标签，可多选）一并带上，供药丸行内展示；bucket（互斥单分组）仍是 tab 来源。
    const tags = normalizeTags(s.groups);
    if (tags.length > 0) sym.tags = tags;
    const bucket = (s.bucket || "").trim();
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(sym);
  }
  // 真实分组名集合：关注池非空 bucket ∪ buckets 表（含空分组）
  const names = new Set();
  for (const b of byBucket.keys()) if (b) names.add(b);
  for (const b of (buckets || [])) {
    const n = (b && b.bucket) ? String(b.bucket).trim() : "";
    if (n) names.add(n);
  }
  const groups = [];
  if (names.size === 0) {
    // 无任何分组：单「全部关注」tab
    groups.push({ name: "全部关注", bucket: "", symbols: byBucket.get("") || [] });
  } else {
    const ungrouped = byBucket.get("") || [];
    if (ungrouped.length > 0) groups.push({ name: "未分组", bucket: "", symbols: ungrouped });
    // 按组内股票数降序，空分组靠后，同数按名称
    const sorted = [...names].sort((a, b) => {
      const na = (byBucket.get(a) || []).length;
      const nb = (byBucket.get(b) || []).length;
      if (na !== nb) return nb - na;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const name of sorted) {
      // bucket 字段 = 真实分组名；空 bucket 的兜底 tab「未分组」bucket 记为 ""，
      // 供前端区分「真实分组」与「兜底/虚拟 tab」（后者不可改名/删除、加票进未分组）。
      groups.push({ name, bucket: name, symbols: byBucket.get(name) || [] });
    }
  }
  return groups;
}

/** 从本地 API 拉全部分组名（含空分组），失败返回 null */
async function fetchDbBuckets() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DB_API_TIMEOUT);
  try {
    const res = await fetch(`${dbApiBase()}/api/buckets`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return json && Array.isArray(json.buckets) ? json.buckets : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 带 5s TTL 缓存的 DB 分组读取（/config 与 /quotes 共用） */
async function loadDbGroups() {
  const now = Date.now();
  if (dbGroupsCache && now - dbGroupsCacheAt < dbCacheTtl()) return dbGroupsCache;
  const stocks = await fetchDbWatchlist();
  if (!stocks) return null;
  const buckets = await fetchDbBuckets();
  dbGroupsCache = dbWatchlistToGroups(stocks, buckets);
  dbGroupsCacheAt = now;
  return dbGroupsCache;
}

/** 把宏观虚拟分组挂到最后。**每个出口都要过这一道** —— 漏掉任何一个，
 *  DB 挂掉降级读文件时宏观 tab 就会凭空消失（那种"有时有有时没有"最难查）。 */
function withMacroGroup(groups) {
  // 调用方带来的宏观 symbol 要**保留其字段**（buyPrice/sellPrice 是目标价合并进来的）。
  // 早先这里无条件重建成 { code }，等于把宏观目标价整个丢掉 ——
  // 表现是「在 /m 给金价设了目标价，药丸的 ⚡ 信号 永远不亮」（行上还看得见值，
  // 因为那是客户端 targets 状态直接渲染的，所以更难发现）。
  const incoming = (groups || []).find((x) => x && x.name === MACRO_GROUP_NAME);
  const byCode = new Map();
  if (incoming && Array.isArray(incoming.symbols)) {
    for (const sym of incoming.symbols) {
      if (sym && typeof sym.code === "string") byCode.set(sym.code, sym);
    }
  }
  const g = (groups || []).filter((x) => x && x.name !== MACRO_GROUP_NAME);
  const macro = {
    name: MACRO_GROUP_NAME,
    virtual: "macro",
    symbols: [...MACRO_CODES].map((code) => {
      const inc = byCode.get(code);
      return inc ? { ...inc, code } : { code };
    }),
  };
  return [...g, macro];
}

async function loadGroups() {
  // 优先 DB：即使关注池为空也以 DB 为准（避免显示旧配置/默认分组的误导）
  const dbGroups = await loadDbGroups();
  if (dbGroups !== null) {
    return { groups: withMacroGroup(dbGroups), source: "db", path: dbApiBase(), dbDown: false };
  }
  // DB 不可用（8888 没起 / 超时）→ 降级 ~/.stocking/settings.json（旧行为）
  const path = join(homedir(), ".stocking", "settings.json");
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    const groups = [];
    const seen = new Set();
    if (Array.isArray(parsed?.groups)) {
      for (const item of parsed.groups) {
        const group = normalizeGroup(item);
        if (!group) continue;
        group.symbols = group.symbols.filter((s) => {
          if (seen.has(s.code)) return false;
          seen.add(s.code);
          return true;
        });
        groups.push(group);
      }
    } else if (Array.isArray(parsed?.symbols)) {
      // v1 扁平结构 → 内存迁移为单分组
      const group = { name: "分组1", symbols: [] };
      const localSeen = new Set();
      for (const item of parsed.symbols) {
        const sym = normalizeSymbol(item);
        if (!sym || localSeen.has(sym.code)) continue;
        localSeen.add(sym.code);
        group.symbols.push(sym);
      }
      groups.push(group);
    }
    if (groups.length > 0) return { groups: withMacroGroup(groups), source: "file", path, dbDown: true };
  } catch {
    /* 读取/解析失败 → 兜底默认分组 */
  }
  return { groups: withMacroGroup(DEFAULT_GROUPS), source: "default", path: null, dbDown: true };
}

// ---------------------------------------------------------------------------
// 🌍 宏观分组（2026-10-02 加）
//
// 9 个宏观标的（现货金银 / WTI·布伦特 / 美元指数 / 美元日元 / 美元人民币 /
// 上证指数 / 人民币账户黄金）不是股票，数据来自 **stock-panel 的 /api/macro**
// （那里已经做完了多源降级、状态判定与合成口径），不走腾讯行情。
//
// 做成**虚拟分组**，与「临时盯盘」同一个套路：始终挂在最后、不入 DB buckets、
// 不可删不可改名 —— 它是插件自己的能力，不是你维护的关注分组。
const MACRO_GROUP_NAME = "🌍 宏观";
// symbol 带命名空间（XAU / IDX.SSEC / …），与 6 位股票代码天然不撞
const MACRO_CODES = new Set([
  "USDJPY", "OIL", "IDX.SSEC", "USDCNY", "CNYGOLD", "CL", "DXY", "XAG", "XAU",
]);
function isMacroCode(code) {
  return MACRO_CODES.has(String(code || "").trim());
}
// 显示名的**兜底**。权威名字在 stock-panel 的 /api/macro（config/macro.yaml 是源头），
// 但那一趟要打 9 个实时源、实测 8.9 秒（冷启动更久）—— 取数失败时若把名字退化成代码，
// tab 里就是 9 行 USDJPY/IDX.SSEC，看不懂。所以这里留一份镜像，只在取不到时用。
// 与 marketOf 对 _sdk_code 的做法同款：**镜像 + 注释指向源头**，不是第二事实来源。
const MACRO_NAMES = {
  USDJPY: "美元/日元", OIL: "布伦特原油", "IDX.SSEC": "上证指数",
  USDCNY: "美元/人民币", CNYGOLD: "人民币账户黄金", CL: "WTI原油",
  DXY: "美元指数", XAG: "现货白银", XAU: "现货黄金",
};

/** 拉宏观快照。返回 {code: {name, price, changePercent, high, low, unit, state, note}} */
async function fetchMacroQuotes() {
  const ctrl = new AbortController();
  // 上限 25s：实测 /api/macro 一趟 8.9s（它要打 9 个实时源），冷启动或东财重试时更久。
  // 原来给 12s，结果第一次轮询被掐断 → 9 行全退化成代码（2026-10-02 实测踩到）。
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${dbApiBase()}/api/macro`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const items = (json && json.items) || [];
    const out = new Map();
    for (const it of items) {
      out.set(it.id, {
        name: it.name,
        price: it.price,
        changePercent: it.pct,
        high: it.high,
        low: it.low,
        unit: it.unit,
        state: it.state,          // live / stale / halted
        stateNote: it.stateNote,  // 为什么非实时（源固有延迟 / 已收盘 / 久无更新）
        note: it.note,            // 口径提醒（合约月 / 离岸在岸 / 折算口径）
        src: it.src,
      });
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 宏观标的的 K 线 / 分时（数据源只有一个：stock-panel 的 /api/macro/*）
// ---------------------------------------------------------------------------
// 为什么必须走 stock-panel 而不是自己拉：
//   ① 宏观 9 个标的不是股票，腾讯/新浪都没有能直接对上的代码与复权口径；
//   ② 手机页 /m 的宏观图读的就是 `/api/macro/kline`（macro_klines 表 + 现货金银的
//      「当日未收盘 bar」合成），**要与 /m 一致就只能是同一份数据**；
//   ③ 顺带白拿它的多源降级、状态判定与均线/MACD，插件不再维护第二套口径。
//
// 响应形状刻意与 /api/kline 对齐（d/o/h/l/c/v/m5/m10/m20），这里转成插件内部
// 既有的 candles 形状，客户端那套 LwcChart 一行不改就能画。
const MACRO_FETCH_TIMEOUT = 12000;

async function fetchMacroKline(symbol, period, bars) {
  const mid = String(symbol || "").trim().toUpperCase();
  if (!isMacroCode(mid)) return { candles: [], error: "不是宏观标的" };
  const per = period === "week" || period === "month" ? period : "day";
  const base = { symbol: mid, period: per };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MACRO_FETCH_TIMEOUT);
  try {
    const url = `${dbApiBase()}/api/macro/kline?symbol=${encodeURIComponent(mid)}`
      + `&period=${per}&bars=${encodeURIComponent(String(bars || 60))}`;
    const r = await fetch(url, { signal: ctrl.signal });
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json || json.ok === false) {
      return { ...base, candles: [], error: (json && json.error) || `本地 API 返回 ${r.status}` };
    }
    const b = (json && json.bars) || {};
    const d = Array.isArray(b.d) ? b.d : [];
    const candles = [];
    for (let i = 0; i < d.length; i++) {
      const open = Number(b.o?.[i]);
      const high = Number(b.h?.[i]);
      const low = Number(b.l?.[i]);
      const close = Number(b.c?.[i]);
      if (![open, high, low, close].every(Number.isFinite)) continue;
      candles.push({
        time: String(d[i]),
        open, high, low, close,
        volume: Number(b.v?.[i]) || 0,
      });
    }
    return {
      ...base,
      candles,
      name: json.name || MACRO_NAMES[mid] || mid,
      unit: json.unit || "",
      digits: Number.isFinite(Number(json.digits)) ? Number(json.digits) : 2,
      // 现货金银与 WTI 没有成交量（v 恒 0）：客户端据此把量能那一栏收掉，
      // 与 /m 的「上K线 / 下MACD（现货无成交量）」同一取舍，而不是画一片空白柱
      hasVol: json.hasVol !== false,
      // 当日未收盘 bar（新浪外汇日线滞后 ≥1 天时补的那根）：与 /m 用同一根，
      // 差别只在 /m 画空心、Lightweight Charts 画不了空心 —— 所以这里把
      // live/liveState 透传给客户端，由它写在状态行里说清「末根是未收盘的」
      live: !!json.live,
      liveState: json.liveState || null,
      liveAt: json.liveAt || null,
      error: candles.length ? null : "无K线数据",
    };
  } catch {
    return { ...base, candles: [], error: "本地 API 不可用（stock-panel 8888）" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMacroTimeline(symbol) {
  const mid = String(symbol || "").trim().toUpperCase();
  if (!isMacroCode(mid)) return { points: [], error: "不是宏观标的" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MACRO_FETCH_TIMEOUT);
  try {
    const url = `${dbApiBase()}/api/macro/timeline?symbol=${encodeURIComponent(mid)}`;
    const r = await fetch(url, { signal: ctrl.signal });
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json || json.ok === false) {
      return { symbol: mid, points: [], prevClose: null,
               error: (json && json.error) || `本地 API 返回 ${r.status}` };
    }
    const s = (Array.isArray(json.data) ? json.data[0] : null) || null;
    const raw = (s && Array.isArray(s.data)) ? s.data : [];
    // date 是 YYYYMMDD（stock-panel 侧剥了横线）；24 小时盘横跨两个日历日，
    // 所以按「时间回绕即进下一天」逐点递增，而不是一律挂同一个日期
    const iso = /^\d{8}$/.test(String(s && s.date || ""))
      ? `${String(s.date).slice(0, 4)}-${String(s.date).slice(4, 6)}-${String(s.date).slice(6, 8)}`
      : "";
    const points = [];
    let dayOffset = 0;
    let prevHm = "";
    for (const pt of raw) {
      const hm = String((pt && pt.time) || "").slice(0, 5);
      const p = Number(pt && pt.price);
      if (!/^\d{2}:\d{2}$/.test(hm) || !Number.isFinite(p)) continue;
      if (prevHm && hm < prevHm) dayOffset += 1;      // 跨过一个日历日
      prevHm = hm;
      let t = 0;
      if (iso) {
        const ms = Date.parse(`${iso}T${hm}:00+08:00`);
        if (!Number.isNaN(ms)) t = Math.round(ms / 1000) + dayOffset * 86400;
      }
      if (!t) continue;
      const avg = Number(pt.avgPrice);
      points.push({ t, p, avg: Number.isFinite(avg) ? avg : null, v: 0 });
    }
    if (points.length === 0) {
      return { symbol: mid, points: [], prevClose: (s && s.preClose) ?? null,
               date: iso, span: (s && s.span) || "", digits: s?.digits, unit: s?.unit || "",
               macro: true, error: "无分时数据（非交易时段或数据源不可用）" };
    }
    return {
      symbol: mid, points,
      prevClose: (s && s.preClose) ?? null,
      date: iso, span: (s && s.span) || "",
      digits: s?.digits, unit: s?.unit || "",
      macro: true, error: null,
    };
  } catch {
    return { symbol: mid, points: [], prevClose: null, error: "本地 API 不可用（stock-panel 8888）" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 腾讯财经接口（与 stocking/src/market.ts 同源）
// ---------------------------------------------------------------------------

function normalizeApiCode(code, market) {
  if (code.startsWith("sh") || code.startsWith("sz") || code.startsWith("bj")) return code;
  return marketOf(code, market) + code;
}

/** 股票池：data/a_stocks.json（全 A 股 {code, name}，惰性加载并缓存；兼容 BOM） */
async function loadStocks() {
  if (stocksCache) return stocksCache;
  try {
    const text = await readFile(STOCKS_PATH, "utf8");
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const parsed = JSON.parse(clean);
    stocksCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    stocksCache = [];
  }
  return stocksCache;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// 腾讯接口熔断（2026-09-16 加）
// 起因：/quotes 一次请求会为全部分组的每只股票各发一次上游请求（111 只 ≈ 111 发），
//   前端展开态每 10s 轮询一次。平时没事，但 21:04-21:25 腾讯那两个 A 记录
//   （117.62.241.183 / 114.222.112.45）集体 i/o timeout 时，失败请求一直挂到
//   12s 超时，于是每轮都在重发，21 分钟刷出 1968 条同一条 mihomo 日志
//   （mihomo.log 涨到 804KB，把 check-node.sh 的日志哨兵打醒）。
// 做法：按上游 host 熔断 —— 连续 BLOCK_FAILS_TO_TRIP 次失败才进入冷却（一次抽风不算），
//   冷却期内直接返回失败、不再发起上游连接，恢复探测按指数退避（10s→20s→…→60s 封顶），
//   任意一次成功立刻清零恢复。只碰腾讯这两个接口；其余 fetch 调用不受影响。
const BLOCK_FAILS_TO_TRIP = 3;      // 连续失败几次才熔断
const BLOCK_COOLDOWN_MS = 10000;    // 基础冷却 10s（前端轮询间隔就是 10s）
const BLOCK_COOLDOWN_MAX_MS = 60000; // 指数退避封顶 60s
const upstreamCircuit = new Map();  // host -> { fails, openUntil, cooldown, skipped, lastLog }

function upstreamHostOf(url) {
  try { return new URL(url).host; } catch { return String(url); }
}

function circuitOf(host) {
  let c = upstreamCircuit.get(host);
  if (!c) {
    c = { fails: 0, openUntil: 0, cooldown: BLOCK_COOLDOWN_MS, skipped: 0, lastLog: 0 };
    upstreamCircuit.set(host, c);
  }
  return c;
}

/** 熔断期间直接返回失败（调用方已有 catch 兜底），不发起上游连接 */
function upstreamBlocked(url) {
  const host = upstreamHostOf(url);
  const c = circuitOf(host);
  if (!(c.openUntil > Date.now())) return false;
  c.skipped += 1;
  // 每冷却窗口最多留一条日志，便于判断「是 upstream 挂了，不是插件挂了」
  if (Date.now() - c.lastLog >= c.cooldown) {
    c.lastLog = Date.now();
    console.error(
      `[dsh-stock-watch] ${host} 熔断中(${c.cooldown / 1000}s)，本窗口已跳过 ${c.skipped} 次上游请求`
    );
  }
  return true;
}

function upstreamOk(url) {
  const c = circuitOf(upstreamHostOf(url));
  if (c.fails || c.openUntil || c.skipped) {
    console.error(`[dsh-stock-watch] ${upstreamHostOf(url)} 已恢复（跳过 ${c.skipped} 次）`);
  }
  c.fails = 0; c.openUntil = 0; c.cooldown = BLOCK_COOLDOWN_MS; c.skipped = 0;
}

function upstreamFail(url) {
  const c = circuitOf(upstreamHostOf(url));
  c.fails += 1;
  if (c.fails < BLOCK_FAILS_TO_TRIP) return;
  const wasOpen = c.openUntil > Date.now();
  if (wasOpen) c.cooldown = Math.min(c.cooldown * 2, BLOCK_COOLDOWN_MAX_MS);
  c.openUntil = Date.now() + c.cooldown;
  c.skipped = 0;
}

/** 带熔断的腾讯接口请求 */
async function fetchJsonTencent(url) {
  if (upstreamBlocked(url)) throw new Error(`upstream circuit open: ${upstreamHostOf(url)}`);
  try {
    const json = await fetchJson(url);
    upstreamOk(url);
    return json;
  } catch (e) {
    upstreamFail(url);
    throw e;
  }
}

/** 解析单只股票的分钟接口响应（快照 + 可选分时价格） */
function parseMinuteJson(code, json, includeMinutes) {
  if (!json || json.code !== 0) return { quote: null, prices: [] };
  const apiCode = normalizeApiCode(code);
  const sd = json.data && json.data[apiCode];
  if (!sd) return { quote: null, prices: [] };
  let prices = [];
  if (includeMinutes) {
    const raw = sd.data && sd.data.data;
    if (Array.isArray(raw)) {
      for (const line of raw) {
        const parts = String(line).split(" ");
        if (parts.length >= 2) {
          const p = parseFloat(parts[1]);
          if (!Number.isNaN(p)) prices.push(p);
        }
      }
    }
  }
  const qt = sd.qt && sd.qt[apiCode];
  if (Array.isArray(qt) && qt.length >= 35) {
    return {
      quote: {
        code,
        name: String(qt[1] ?? ""),
        price: parseFloat(qt[3] ?? "0"),
        changeAmount: parseFloat(qt[31] ?? "0"),
        changePercent: parseFloat(qt[32] ?? "0"),
        high: parseFloat(qt[33] ?? "0"),
        low: parseFloat(qt[34] ?? "0"),
        volume: parseInt(qt[6] ?? "0", 10),
        amount: parseFloat(qt[37] ?? "0") * 10000,
      },
      prices,
    };
  }
  return { quote: null, prices };
}

/**
 * 腾讯 `q=` 是 **GBK 文本**（不是 JSON），所以这里不能用 fetchJson —— 要拿二进制再转码。
 * 熔断闸门与别的上游共用（按 host 记账：这两个接口在不同域名上）。
 */
async function fetchTextTencent(url) {
  if (upstreamBlocked(url)) throw new Error(`upstream circuit open: ${upstreamHostOf(url)}`);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    upstreamOk(url);
    return text;
  } catch (e) {
    upstreamFail(url);
    throw e;
  }
}

/**
 * 解析 `v_sh600737="1~中粮糖业~600737~14.66~13.80~...";` 形式的批量快照（**纯函数**，可离线测）。
 *
 * 字段位与 `parseMinuteJson` 里那个 `qt` 数组**完全相同**（腾讯两处是同一份数组），
 * 所以两边算出来的价格天然一致 —— 这也是敢把快照从单只挪到批量的依据。
 * 键用**无市场前缀**的 6 位代码（返回里就没有前缀）。
 */
function parseTencentBatch(text) {
  const out = new Map();
  for (const seg of String(text || "").split(";")) {
    const m = /v_([a-z]{2}\d{6})="([^"]*)"/.exec(seg.trim());
    if (!m) continue;
    const parts = m[2].split("~");
    if (parts.length < 35) continue;                  // 停牌/未上市时常是残缺数组
    const num = (i) => {
      const v = parseFloat(parts[i]);
      return Number.isNaN(v) ? 0 : v;
    };
    out.set(m[1].replace(/^(sh|sz|bj)/, ""), {
      code: m[1],
      name: String(parts[1] ?? ""),
      price: num(3),
      changeAmount: num(31),
      changePercent: num(32),
      high: num(33),
      low: num(34),
      volume: parseInt(parts[6] ?? "0", 10) || 0,
      amount: parseFloat(parts[37] ?? "0") * 10000 || 0,
    });
  }
  return out;
}

/**
 * 整批取快照 → Map(无前缀 code → quote)。
 * 分批是必须的：URL 有长度上限，且一次几百个代码对上游也不礼貌。
 * 某一批失败只丢那一批（对应行显示 `--`，行本身仍在）—— 不要因为一批失败让整屏空白。
 */
async function fetchBatchQuotes(symbols) {
  const out = new Map();
  const codes = symbols.map((s) => normalizeApiCode(s.code));
  for (let i = 0; i < codes.length; i += QUOTE_BATCH_SIZE) {
    const chunk = codes.slice(i, i + QUOTE_BATCH_SIZE);
    try {
      const text = await fetchTextTencent(QUOTE_BATCH_API.replace("{codes}", chunk.join(",")));
      for (const [bare, q] of parseTencentBatch(text)) out.set(bare, q);
    } catch (e) {
      console.error(`[dsh-stock-watch] 批量快照失败（${chunk.length} 只）：${e.message}`);
    }
  }
  return out;
}

async function fetchQuoteResult(symbol, includeMinutes) {
  try {
    const json = await fetchJsonTencent(MINUTE_API.replace("{code}", normalizeApiCode(symbol.code)));
    return parseMinuteJson(symbol.code, json, includeMinutes);
  } catch {
    return { quote: null, prices: [] };
  }
}

function computeTrigger(price, buyPrice, sellPrice) {
  if (buyPrice === undefined && sellPrice === undefined) return "none";
  if (sellPrice !== undefined && price >= sellPrice) return "sell";
  if (buyPrice !== undefined && price <= buyPrice) return "buy";
  return "wait";
}

async function fetchKline(code, period, refPrice) {
  const apiCode = normalizeApiCode(code);
  const count = period === "day" ? "160" : "120";
  const url = KLINE_API.replace("{code}", apiCode).replace("{period}", period).replace("{count}", count);
  try {
    const json = await fetchJsonTencent(url);
    if (!json || json.code !== 0) return { candles: [], error: "接口返回异常" };
    const sd = json.data && json.data[apiCode];
    if (!sd) return { candles: [], error: "无K线数据" };
    const keys = period === "day"
      ? ["qfqday", "day", "hfqday"]
      : period === "week" ? ["qfqweek", "week", "hfqweek"] : ["qfqmonth", "month", "hfqmonth"];
    let rows = null;
    for (const k of keys) {
      if (Array.isArray(sd[k])) { rows = sd[k]; break; }
    }
    if (!rows) return { candles: [], error: "无K线数据" };
    const candles = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const time = String(row[0]);
      const open = parseFloat(row[1]);
      const close = parseFloat(row[2]);
      const high = parseFloat(row[3]);
      const low = parseFloat(row[4]);
      if (!time || Number.isNaN(open) || Number.isNaN(close) || Number.isNaN(high) || Number.isNaN(low)) continue;
      candles.push({ time, open, high, low, close, volume: parseFloat(row[5]) || 0 });
    }
    if (candles.length === 0) return { candles: [], error: "无K线数据" };
    // 自校正（实测列序 [date, open, close, high, low, volume] 正确，仅作保险）
    if (typeof refPrice === "number" && Number.isFinite(refPrice) && refPrice > 0) {
      const last = candles[candles.length - 1];
      if (last && Math.abs(last.low - refPrice) < Math.abs(last.close - refPrice)) {
        for (const c of candles) {
          const close = c.low;
          const high = c.close;
          const low = c.high;
          c.close = close;
          c.high = high;
          c.low = low;
        }
      }
    }
    return { candles, error: null };
  } catch {
    return { candles: [], error: "行情获取失败" };
  }
}

async function fetchMinuteDetail(code) {
  const apiCode = normalizeApiCode(code);
  try {
    const json = await fetchJsonTencent(MINUTE_API.replace("{code}", apiCode));
    if (!json || json.code !== 0) return { date: null, prevClose: null, points: [], error: "接口返回异常" };
    const sd = json.data && json.data[apiCode];
    if (!sd || !sd.data) return { date: null, prevClose: null, points: [], error: "无分时数据" };
    const raw = sd.data.data;
    const date = typeof sd.data.date === "string" ? sd.data.date : "";
    const isoDate = date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : "";
    const points = [];
    if (Array.isArray(raw)) {
      for (const line of raw) {
        const parts = String(line).split(" ");
        if (parts.length < 3) continue;
        const hm = parts[0];
        const p = parseFloat(parts[1]);
        const v = parseFloat(parts[2]) || 0;
        if (!/^\d{4}$/.test(hm) || Number.isNaN(p)) continue;
        let t = 0;
        if (isoDate) {
          const ms = Date.parse(`${isoDate}T${hm.slice(0, 2)}:${hm.slice(2, 4)}:00+08:00`);
          if (!Number.isNaN(ms)) t = Math.round(ms / 1000);
        }
        if (t <= 0) continue;
        points.push({ t, p, v });
      }
    }
    let prevClose = null;
    const qt = sd.qt && sd.qt[apiCode];
    if (Array.isArray(qt) && qt.length >= 35) {
      const price = parseFloat(qt[3] ?? "0");
      const chg = parseFloat(qt[32] ?? "0");
      if (price > 0 && Number.isFinite(chg)) prevClose = price / (1 + chg / 100);
    }
    if (points.length === 0) return { date, prevClose, points: [], error: "无分时数据" };
    return { date, prevClose, points, error: null };
  } catch {
    return { date: null, prevClose: null, points: [], error: "行情获取失败" };
  }
}

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function queryOf(req) {
  return new URL(req.url ?? "/", "http://x").searchParams;
}

/** 读取 POST JSON body（代理药丸增删票到本地 DB API 用） */
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

/**
 * 插件主体：注册 /dsh-stock-watch/* 路由。
 * @param {import("cordis").Context} ctx
 */
function apply(ctx) {
  // 安装/启动时把自带技能注入用户技能目录（幂等：已有则跳过）
  try {
    ensureUserSkills();
  } catch (e) {
    console.error("[dsh-stock-watch] 技能注入异常:", e && e.message ? e.message : e);
  }

  const register = (path, handler) =>
    ctx.effect(() => ctx.webServer.register({ kind: "exact", path, handler }), `dsh-stock-watch: ${path}`);

  register("/dsh-stock-watch/config", async (_req, res) => {
    const loaded = await loadGroups();
    sendJson(res, 200, {
      groups: loaded.groups,
      source: loaded.source,
      path: loaded.path,
      dbDown: !!loaded.dbDown,
      dbBase: dbApiBase(),
    });
  });

  // C 方案：药丸内增删关注直写本地 DB（严格单一来源，不回写 localStorage 分组）。
  // body: { action: "add"|"remove", code: "sh600000"|"600000", name?: string, bucket?: string }
  register("/dsh-stock-watch/watchlist", async (req, res) => {
    const body = await readBody(req);
    const action = body.action;
    const code = stripApiCode(body.code || "");
    if (action !== "add" && action !== "remove") {
      sendJson(res, 400, { ok: false, error: 'action 必须为 "add" 或 "remove"' });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      sendJson(res, 400, { ok: false, error: "无效股票代码: " + body.code });
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DB_API_TIMEOUT);
    try {
      const payload = action === "add"
        ? { code, name: typeof body.name === "string" ? body.name : "", bucket: typeof body.bucket === "string" ? body.bucket : "" }
        : { codes: [code], clear_bucket: body.clear_bucket === true };
      const r = await fetch(`${dbApiBase()}/api/watchlist/${action === "add" ? "add" : "remove"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json.ok !== true) {
        sendJson(res, 502, { ok: false, error: (json && json.error) || `本地 API 返回 ${r.status}` });
        return;
      }
      dbGroupsCache = null; // 失效缓存，下次 /config 重新拉 DB
      sendJson(res, 200, { ok: true, action, code });
    } catch {
      sendJson(res, 502, { ok: false, error: `本地 API 不可用（${dbApiBase()}，请先启动 stock-panel 面板服务）` });
    } finally {
      clearTimeout(timer);
    }
  });

  // 分组（bucket）写操作代理：药丸的分组增删改名直写本地 DB（严格单一来源）。
  // body: { action: "add"|"rename"|"delete", bucket?: string, from?: string, to?: string }
  register("/dsh-stock-watch/buckets", async (req, res) => {
    const body = await readBody(req);
    const action = body.action;
    const bucket = typeof body.bucket === "string" ? body.bucket.trim().slice(0, 32) : "";
    const from = typeof body.from === "string" ? body.from.trim().slice(0, 32) : "";
    const to = typeof body.to === "string" ? body.to.trim().slice(0, 32) : "";
    let path = "";
    let payload = {};
    if (action === "add") {
      if (!bucket) { sendJson(res, 400, { ok: false, error: "分组名不能为空" }); return; }
      path = "/api/buckets/add"; payload = { bucket };
    } else if (action === "rename") {
      if (!from || !to) { sendJson(res, 400, { ok: false, error: "需要 from 和 to" }); return; }
      path = "/api/buckets/rename"; payload = { from, to };
    } else if (action === "delete") {
      if (!bucket) { sendJson(res, 400, { ok: false, error: "分组名不能为空" }); return; }
      path = "/api/buckets/delete"; payload = { bucket };
    } else {
      sendJson(res, 400, { ok: false, error: 'action 必须为 "add" | "rename" | "delete"' });
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DB_API_TIMEOUT);
    try {
      const r = await fetch(`${dbApiBase()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json.ok !== true) {
        sendJson(res, 502, { ok: false, error: (json && json.error) || `本地 API 返回 ${r.status}` });
        return;
      }
      dbGroupsCache = null; // 失效缓存，下次 /config 重新拉 DB
      sendJson(res, 200, { ok: true, action });
    } catch {
      sendJson(res, 502, { ok: false, error: `本地 API 不可用（${dbApiBase()}，请先启动 stock-panel 面板服务）` });
    } finally {
      clearTimeout(timer);
    }
  });

  // 目标价读写代理：药丸里设/清买卖目标价直写本地 DB（stock_targets 表，唯一真理源）。
  // **这是 C 方案的最后一块**：此前目标价是药丸里唯一的 localStorage 私货层，
  // 结果是「在面板/手机页设的目标价药丸看不见，在药丸设的又不会推 Bark」——
  // 两边都以为自己是全部。分组与关注池早已改成直写 DB，目标价也照同一套路收口。
  //
  // GET  /dsh-stock-watch/targets                      → 全量目标价（含宏观 code）
  // POST /dsh-stock-watch/targets {code,buy_target,sell_target}  → 写/清（两侧皆空即删行）
  // POST /dsh-stock-watch/targets {code,rearm:"buy"|"sell"|"both"} → 重新武装（清达成标记）
  register("/dsh-stock-watch/targets", async (req, res) => {
    const method = (req.method || "GET").toUpperCase();

    if (method === "GET") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), DB_API_TIMEOUT);
      try {
        const r = await fetch(`${dbApiBase()}/api/targets`, { signal: ctrl.signal });
        const json = await r.json().catch(() => ({}));
        if (!r.ok) {
          sendJson(res, 502, { ok: false, error: `本地 API 返回 ${r.status}` });
          return;
        }
        sendJson(res, 200, { ok: true, targets: (json && json.targets) || {} });
      } catch {
        sendJson(res, 502, { ok: false, error: `本地 API 不可用（${dbApiBase()}）` });
      } finally {
        clearTimeout(timer);
      }
      return;
    }

    if (method !== "POST") {
      sendJson(res, 405, { ok: false, error: "只支持 GET / POST" });
      return;
    }

    const body = await readBody(req);
    // 宏观 code 不是 6 位数字（XAU / IDX.SSEC / …），所以这里只去市场前缀、不校验数字位数；
    // 合法性交给 stock-panel 的 set_target（它自己有 is_macro_code 分流）。
    const code = String(body.code || "").trim().replace(/^(sh|sz|bj)/i, "");
    if (!code) {
      sendJson(res, 400, { ok: false, error: "缺少 code" });
      return;
    }

    let path = "/api/target";
    let payload = { code };
    if (body.rearm !== undefined) {
      const kind = String(body.rearm || "");
      if (kind !== "buy" && kind !== "sell" && kind !== "both") {
        sendJson(res, 400, { ok: false, error: 'rearm 必须为 "buy" | "sell" | "both"' });
        return;
      }
      path = "/api/target/rearm";
      payload = { code, kind: kind === "both" ? "" : kind };
    } else {
      // 只转发**出现**的键：undefined 与 null 语义不同（null = 清除该项）
      if ("buy_target" in body) payload.buy_target = body.buy_target;
      if ("sell_target" in body) payload.sell_target = body.sell_target;
      if (!("buy_target" in payload) && !("sell_target" in payload)) {
        sendJson(res, 400, { ok: false, error: "没有任何可更新的字段" });
        return;
      }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DB_API_TIMEOUT);
    try {
      const r = await fetch(`${dbApiBase()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json.ok !== true) {
        sendJson(res, 502, { ok: false, error: (json && json.error) || `本地 API 返回 ${r.status}` });
        return;
      }
      // set_target 返回写入后的行（删干净了返回 {}）；rearm 返回全量里的该 code
      sendJson(res, 200, { ok: true, code, target: json.target || {} });
    } catch {
      sendJson(res, 502, { ok: false, error: `本地 API 不可用（${dbApiBase()}，请先启动 stock-panel 面板服务）` });
    } finally {
      clearTimeout(timer);
    }
  });

  // 添加股票搜索：按代码或名称匹配全 A 股池，返回带市场前缀的代码
  register("/dsh-stock-watch/stocks", async (req, res) => {
    const needle = (queryOf(req).get("q") ?? "").trim();
    if (!needle) {
      sendJson(res, 200, { rows: [] });
      return;
    }
    const lower = needle.toLowerCase();
    const list = await loadStocks();
    const rows = [];
    for (const s of list) {
      if (s.code.includes(lower) || (s.name && s.name.toLowerCase().includes(lower))) {
        rows.push({ code: normalizeApiCode(s.code), name: s.name });
        if (rows.length >= 50) break;
      }
    }
    sendJson(res, 200, { rows, total: rows.length });
  });

  register("/dsh-stock-watch/quotes", async (req, res) => {
    try {
      const q = queryOf(req);
      const groupIndex = parseInt(q.get("group") ?? "0", 10) || 0;
      const includeMinutes = q.get("minutes") === "1";
      let loaded;
      // 分组配置走 POST body：关注池 111 只带标签后 query 串会超过 Node maxHeaderSize(16KB) → 431。
      // 旧 GET ?groups= 保留兼容（无 body 时回退）。
      let groupsPayload = null;
      if (String(req.method || "GET").toUpperCase() === "POST") {
        const body = await readBody(req);
        if (body && body.groups !== undefined) groupsPayload = body.groups;
      }
      const groupsParam = groupsPayload !== null && groupsPayload !== undefined
        ? groupsPayload
        : q.get("groups");
      if (groupsParam !== null && groupsParam !== undefined) {
        try {
          const raw = typeof groupsParam === "string" ? JSON.parse(groupsParam) : groupsParam;
          const clientGroups = normalizeClientGroups(raw);
          loaded = clientGroups
            ? { groups: withMacroGroup(clientGroups), source: "local", path: null }
            : await loadGroups();
        } catch {
          loaded = await loadGroups();
        }
      } else {
        loaded = await loadGroups();
      }
      const groups = loaded.groups;
      const safeIdx = groups.length > 0 ? Math.min(groupIndex, groups.length - 1) : 0;
      const curGroup = groups[safeIdx] || groups[0] || null;

      // 全部分组去重后的 symbols（保持分组顺序），用于算全局买入/卖出信号
      const allSymbols = [];
      const seenCodes = new Set();
      for (const g of groups) {
        for (const s of (g.symbols || [])) {
          if (seenCodes.has(s.code)) continue;
          seenCodes.add(s.code);
          allSymbols.push(s);
        }
      }
      const curCodes = new Set((curGroup ? curGroup.symbols : []).map((s) => s.code));

      // 并发拉全部行情（当前分组的按需带分钟数据，其余只取快照算信号）。
      // 宏观标的**不发腾讯请求** —— 它们不是股票，code 形如 XAU/IDX.SSEC，
      // 发过去只会白等超时；改从 /api/macro 一次性取快照（9 个一次请求）。
      const macroSymbols = allSymbols.filter((s) => isMacroCode(s.code));
      const stockSymbols = allSymbols.filter((s) => !isMacroCode(s.code));
      const macroQuotes = macroSymbols.length > 0 ? await fetchMacroQuotes() : null;

      // 快照走**整批**（1~2 发覆盖全部标的），分钟线只给当前分组按需单发 ——
      // 2026-10-06 改：此前每个标的都发一次 minute 请求（111 只 ≈ 111 发/轮），
      // 那既慢（~8s）又是熔断频发的根源。快照与分钟来自同一个 `qt` 数组，
      // 字段位一致，所以价格不会因为换了取数方式而变化。
      const batchQuotes = stockSymbols.length > 0 ? await fetchBatchQuotes(stockSymbols) : new Map();
      const allResults = await Promise.all(
        stockSymbols.map(async (s) => {
          const bare = String(s.code).replace(/^(sh|sz|bj)/, "");
          const snap = batchQuotes.get(bare) || null;
          if (!(includeMinutes && curCodes.has(s.code))) return { quote: snap, prices: [] };
          const one = await fetchQuoteResult(s, true);
          // 分钟接口顺带回一份快照：它更"此刻"，有就用它；没有再退回整批那份
          return { quote: one.quote || snap, prices: one.prices };
        })
      );
      const byCode = new Map();
      stockSymbols.forEach((s, i) => {
        byCode.set(s.code, allResults[i] ?? { quote: null, prices: [] });
      });
      for (const s of macroSymbols) {
        const q2 = macroQuotes ? macroQuotes.get(s.code) : null;
        byCode.set(s.code, {
          quote: q2
            ? {
                name: q2.name, price: q2.price, changePercent: q2.changePercent,
                changeAmount: (q2.price != null && q2.changePercent != null)
                  ? q2.price - q2.price / (1 + q2.changePercent / 100) : null,
                high: q2.high, low: q2.low, volume: null, amount: null,
                unit: q2.unit, state: q2.state, stateNote: q2.stateNote, src: q2.src,
                note: q2.note,
              }
            : null,
          prices: [],
        });
      }

      const makeRow = (sym, parsed) => {
        const q2 = parsed.quote;
        const row = {
          code: sym.code,
          name: q2 ? q2.name : sym.name || sym.code,
          trigger: "none",
          live: false,
        };
        if (sym.buyPrice !== undefined) row.buyPrice = sym.buyPrice;
        if (sym.sellPrice !== undefined) row.sellPrice = sym.sellPrice;
        if (Array.isArray(sym.tags) && sym.tags.length > 0) row.tags = sym.tags;
        if (q2) {
          row.live = true;
          row.price = q2.price;
          row.changePercent = q2.changePercent;
          row.changeAmount = q2.changeAmount;
          row.high = q2.high;
          row.low = q2.low;
          row.volume = q2.volume;
          row.amount = q2.amount;
          row.trigger = computeTrigger(q2.price, sym.buyPrice, sym.sellPrice);
          if (parsed.prices && parsed.prices.length > 0) row.minutes = parsed.prices;
          // 宏观行的额外信息：前端据此**不做分时/K线**（那些走腾讯，宏观没有），
          // 并把「为什么非实时」显示出来（与 stock-panel 手机页同一口径）
          if (isMacroCode(sym.code)) {
            row.macro = true;
            row.unit = q2.unit || "";
            row.state = q2.state || "";
            row.stateNote = q2.stateNote || "";
            row.note = q2.note || "";
          }
        } else if (isMacroCode(sym.code)) {
          // 连快照都没取到：标记 macro（否则点开还会去要腾讯分时）+ 用兜底**名字**
          // （不能退化成代码），live 保持 false —— 不给假价
          row.macro = true;
          row.name = MACRO_NAMES[sym.code] || sym.code;
        }
        return row;
      };

      // 当前分组的 rows（保持原顺序）
      const rows = [];
      let live = 0;
      let firstError = null;
      for (const sym of (curGroup ? curGroup.symbols : [])) {
        const parsed = byCode.get(sym.code);
        if (!parsed || !parsed.quote) {
          if (!firstError) firstError = "拉取失败";
          rows.push(makeRow(sym, { quote: null, prices: [] }));
          continue;
        }
        const row = makeRow(sym, parsed);
        if (row.live) live += 1;
        rows.push(row);
      }

      // 全局信号：遍历全部股票，收集触发买入/卖出的（含当前分组）
      const signalBuy = [];
      const signalSell = [];
      for (const sym of allSymbols) {
        const parsed = byCode.get(sym.code);
        if (!parsed || !parsed.quote) continue;
        const row = makeRow(sym, parsed);
        if (row.trigger === "buy") signalBuy.push(row);
        else if (row.trigger === "sell") signalSell.push(row);
      }

      sendJson(res, 200, {
        groups: groups.map((g) => ({ name: g.name, count: g.symbols.length })),
        groupIndex: safeIdx,
        rows,
        live: live > 0,
        updatedAt: Date.now(),
        config: { source: loaded.source, path: loaded.path },
        diag: { firstError },
        signal: { buy: signalBuy, sell: signalSell },
      });
    } catch (e) {
      sendJson(res, 500, { error: String(e?.message ?? e) });
    }
  });

  register("/dsh-stock-watch/kline", async (req, res) => {
    const q = queryOf(req);
    const code = q.get("code") ?? "";
    const period = q.get("period") === "week" || q.get("period") === "month" ? q.get("period") : "day";
    const refRaw = parseFloat(q.get("refPrice") ?? "");
    const refPrice = Number.isFinite(refRaw) && refRaw > 0 ? refRaw : null;
    if (!code) {
      sendJson(res, 400, { code, period, candles: [], error: "缺少股票代码", updatedAt: Date.now() });
      return;
    }
    const result = await fetchKline(code, period, refPrice);
    sendJson(res, 200, { code, period, candles: result.candles, error: result.error, updatedAt: Date.now() });
  });

  register("/dsh-stock-watch/minute", async (req, res) => {
    const q = queryOf(req);
    const code = q.get("code") ?? "";
    if (!code) {
      sendJson(res, 400, { code, date: null, prevClose: null, points: [], error: "缺少股票代码", updatedAt: Date.now() });
      return;
    }
    const result = await fetchMinuteDetail(code);
    sendJson(res, 200, {
      code,
      date: result.date,
      prevClose: result.prevClose,
      points: result.points,
      error: result.error,
      updatedAt: Date.now(),
    });
  });

  // 宏观标的的 K 线 / 分时：与手机页 /m 读**同一个** stock-panel 接口
  // （/api/macro/kline、/api/macro/timeline），所以数据逐点相同；插件侧只把它
  // 转成内部 candles/points 形状，渲染仍走同一套 LwcChart / MinuteChart。
  // 之所以要这层代理：浏览器端在 DSH 的源上（3080），跨到 8888 会被 CORS 拦。
  // 🧠 判断（只读代理）：客户端只读不做写入口 —— 与「理由」同一约定，
  // 写入口只在桌面面板 / 手机页，插件里看到的就是最新的。
  // body: { code?: "600547"|"XAU" }  → 该标的相关的判断（缺 code 则全部）
  register("/dsh-stock-watch/views", async (req, res) => {
    const q = queryOf(req);
    const code = stripApiCode(q.get("code") || "");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DB_API_TIMEOUT);
    try {
      const url = `${dbApiBase()}/api/views` + (code ? `?code=${encodeURIComponent(code)}` : "");
      const r = await fetch(url, { signal: ctrl.signal });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json.ok !== true) {
        sendJson(res, 502, { ok: false, error: (json && json.error) || `本地 API 返回 ${r.status}` });
        return;
      }
      sendJson(res, 200, { ok: true, views: json.views || [], stats: json.stats || {},
                           code, updatedAt: Date.now() });
    } catch {
      sendJson(res, 502, { ok: false, error: `本地 API 不可用（${dbApiBase()}）` });
    } finally {
      clearTimeout(timer);
    }
  });

  register("/dsh-stock-watch/macro/kline", async (req, res) => {
    const q = queryOf(req);
    const symbol = q.get("symbol") ?? "";
    const period = q.get("period") === "week" || q.get("period") === "month" ? q.get("period") : "day";
    // 取数根数与 /m 的 KZ_FETCH 一致（日 240 / 周 260 / 月 120）——
    // 少取的话「和 /m 看到的不是同一段历史」，缩放也没得放。
    const dflt = period === "day" ? 240 : period === "week" ? 260 : 120;
    const bars = parseInt(q.get("bars") ?? String(dflt), 10) || dflt;
    const out = await fetchMacroKline(symbol, period, bars);
    // 带上 `code`：客户端判定「这份数据是不是当前这只票的」用的是 `kline.code === view.code`
    // （股票那条路由就是 code），形状对齐才不会出现「数据到了但一直显示加载中」
    sendJson(res, 200, { code: out.symbol, ...out, updatedAt: Date.now() });
  });

  // 客户端渲染错误上报：错误边界把「渲染期抛错」的文本回传到这里，写进 DSH 日志。
  // 为什么值得单独一条路由：React 渲染错误的表现是**整棵子树消失**（面板凭空不见），
  // 浏览器控制台里的堆栈用户看不到、截图也常常来不及 —— 落到日志里才能复盘。
  register("/dsh-stock-watch/client-error", async (req, res) => {
    const body = await readBody(req);
    const msg = String(body.message || "").slice(0, 400).replace(/\s+/g, " ");
    const comp = String(body.componentStack || "").replace(/\s+/g, " ").slice(0, 400);
    console.log(`[dsh-stock-watch] 客户端渲染错误: ${msg}${comp ? " | 组件栈:" + comp : ""}`);
    sendJson(res, 200, { ok: true });
  });

  register("/dsh-stock-watch/macro/timeline", async (req, res) => {
    const q = queryOf(req);
    const symbol = q.get("symbol") ?? "";
    const out = await fetchMacroTimeline(symbol);
    sendJson(res, 200, { code: out.symbol, ...out, updatedAt: Date.now() });
  });

  // 一键分析配套：客户端只发送简短消息「分析{公司名}（代码）」，这里注入一条条件式系统指令，
  // 保证任何会话中出现「分析某家公司」类请求时，依次使用 investment-research / frontend-design 两个技能。
  // 条件式措辞：仅对分析上市公司的请求生效，其它对话不受影响。
  const sp = typeof ctx.get === "function" ? ctx.get("systemPrompt") : undefined;
  if (sp) {
    ctx.effect(
      () => sp.section({
        name: "dsh-stock-watch.analysis",
        order: 200,
        text: "当用户消息以「分析」开头、且意图是分析某家上市公司（而非代码、思路等其他对象）时：\n"
          + "1) 若本机存在 /Users/tt/code/stock-panel 项目，先用 `cd /Users/tt/code/stock-panel && ./sp5 check <代码>` 获取该股技术面全貌（H/C/M 信号标签、多周期共振、bias 五维打分、阶段/情景），技术面数字以此为准，不得凭空编造；\n"
          + "2) 再使用技能 investment-research 完成基本面投资研究分析；\n"
          + "3) 最后使用技能 frontend-design 生成一个介绍该公司的网站。\n"
          + "项目不存在时正常走 investment-research，并标注数据来源与置信度。",
      }),
      "dsh-stock-watch: analysis prompt section",
    );

    // 扇形菜单注入：客户端只发送「每日复盘/行情分析/涨停分析」几个字，
    // 完整提示词在此条件式注入——仅当用户消息匹配对应关键词时按框架执行。
    ctx.effect(
      () => sp.section({
        name: "dsh-stock-watch.fan-prompts",
        order: 201,
        text: "当用户消息为「每日复盘」或以「每日复盘」开头时，执行以下每日复盘任务：\n"
          + FAN_PROMPTS.每日复盘
          + "\n当用户消息为「行情分析」或以「行情分析」开头时，执行以下行情分析任务：\n"
          + FAN_PROMPTS.行情分析
          + "\n当用户消息为「涨停分析」或以「涨停分析」开头时，执行以下涨停分析任务：\n"
          + FAN_PROMPTS.涨停分析,
      }),
      "dsh-stock-watch: fan prompt section",
    );
  }
}

export { apply, inject, name, ensureUserSkills };

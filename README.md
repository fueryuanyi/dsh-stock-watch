<h1 align="center">dsh-stock-watch</h1>
<p align="center">
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
  <a href="https://www.npmjs.com/package/dsh-stock-watch"><img src="https://img.shields.io/npm/v/dsh-stock-watch?style=flat-square&color=00ff41&labelColor=050607" alt="npm version"></a>
  <a href="https://github.com/Awu12277/dsh-stock-watch"><img src="https://img.shields.io/github/stars/Awu12277/dsh-stock-watch?style=flat-square&color=00ff41&labelColor=050607" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/license-MIT-ff1493?style=flat-square&labelColor=050607" alt="MIT">
</p>




A 股自选股实时行情**盯盘插件**：在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web 界面的**右上角**显示一个可折叠弹窗，实时监控自选股行情、切换分组、查看分时与 K 线、设置买卖目标价。

数据源与原终端 CLI 项目 [stocking](https://github.com/Awu12277/stocking) 同源（腾讯财经），配色沿用 A 股红涨绿跌惯例。

## 安装

已发布到 npm，一条命令安装到你的 web profile：

```bash
dsh plugin --profile web add dsh-stock-watch
```

- 本地开发安装：`dsh plugin --profile web add file:D:\projects\github\dsh-stock-watch`
- 或直接通过 git：`dsh plugin --profile web add github:Awu12277/dsh-stock-watch`
- 安装后**重启 `dsh web` 生效**；卸载：`dsh plugin --profile web remove dsh-stock-watch`

安装完成后，刷新页面，右上角出现「📈 自选股」药丸。

## 截图

| 折叠药丸（右上角实时涨跌家数） | 暗色列表（分组 + 分时迷你折线 + 目标价触发） |
|---|---|
| ![pill](screenshots/pill.png) | ![list-dark](screenshots/list-dark.png) |

| 暗色·分时（价格线 / 均价线 / 昨收基准） | 暗色·日 K（TradingView Lightweight Charts） |
|---|---|
| ![minute](screenshots/detail-minute-dark.png) | ![kline](screenshots/detail-kline-dark.png) |

| 浅色主题 |
|---|
| ![light](screenshots/light.png) |

## 功能特性

- **右上角可折叠弹窗**：折叠时显示自选股实时涨跌家数药丸；展开为完整列表，点击任意行进入详情
- **胶囊可拖动**：按住「📈 自选股」药丸可拖到屏幕任意位置，面板随之跟随（右边缘对齐）；展开后按住面板头部也可拖动；位置持久化到 localStorage。**拖到屏幕四边自动吸附**，贴边后胶囊变为**半球**（屏幕边缘显示涨/跌家数，如 `3↑0↓`），点击仍可展开面板
- **多分组自选股**：分组 tab 切换（分组名 + 股票数），配置存浏览器 `localStorage`（首次自动从 `~/.stocking/settings.json` 迁移）
- **实时行情列表**：名称 / 代码、现价、涨跌幅、分时迷你折线、目标价触发标记（买入 / 卖出 / 等待 / -），每 10s 自动刷新（带倒计时）
- **分时视图**：全天分钟价格线（红涨绿跌）+ 黄色均价线（VWAP）+ 昨收虚线基准，时间轴按 **A 股交易时段（北京时间 09:30–11:30 / 13:00–15:00）** 标注，午间休市留白
- **K 线视图**：日 K / 周 K / 月 K 前复权蜡烛图 + 成交量柱 + **MA 均线（MA5 白 / MA10 黄 / MA20 紫 / MA60 绿，A 股配色，右上角可自定义隐藏/显示，配置存 localStorage）**，支持 **`+ / − / 重置` 按钮缩放 K 线**（位于 MA 均线配置左侧），基于 [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs)（CDN 懒加载，失败自动降级为自绘 SVG）
- **目标价可编辑**：详情页点击「买入目标 / 卖出目标」进入输入框（数字 + 两位小数、留空清除、回车确认 / Esc 取消），即时重算触发标记并持久化
- **一键投资研究报告**：详情页「📈 投资研究报告」按钮——**新建一个 DSH 对话**并发送简短消息 `分析{公司名}（代码）`，由会话中的 agent 自动使用 `investment-research` 完成投资研究、`frontend-design` 生成介绍网站（技能指令由 host 端条件式系统提示注入，仅对「分析某家上市公司」类请求生效）；按钮带防抖（进行中禁用，防连点重复建会话）
- **胶囊悬浮扇形菜单**：鼠标移到胶囊（含贴边吸附态）触发 **GSAP 扇形动画**，展开 **📊 行情分析 / 📅 每日复盘 / 🚀 涨停分析** 三个选项（方向按胶囊位置自动选择象限、不越出屏幕；鼠标在扇形区域内不收起，移出才收回）。点击选项同样**新开一个 DSH 对话**并发送简短关键词（如 `每日复盘`），完整提示词（A股短线复盘框架 / 行情分析 4 项 / 涨停分析 4 项）由 host 端条件式系统提示**注入**、不暴露在消息里；「每日复盘」仅在 **15:00–次日 9:00** 可点击，交易时段置灰并提示"还未收盘"；拖动/吸附后扇形自动归位重开
- **安装时自动注入技能**：插件首次启动时把自带的 `investment-research`、`frontend-design` 两个技能复制到用户技能目录 `~/.agents/skills/`（已存在则跳过、不覆盖用户版本；`DSH_STOCK_WATCH_NO_SKILLS=1` 可禁用，`DSH_STOCK_WATCH_SKILLS_DIR` 可改目标目录）
- **暗色 / 浅色主题**：CSS 变量两套配色，默认暗色，☀️/🌙 一键切换（图表配色联动）

## 架构

```
┌─────────────── Web 浏览器 ───────────────┐
│  client.js（客户端插件模块）              │
│  · shell.overlay 槽位 → 右上角弹窗        │
│  · React + Lightweight Charts + SVG 降级  │
│  · 配置存 localStorage（stocking.config.v1）│
│          │ fetch（同源 /dsh-stock-watch/*）│
└──────────┼────────────────────────────────┘
           ▼
┌─────────────── DSH Host（index.js）───────┐
│  cordis 插件：webServer 注册 5 个路由      │
│  · /config   读取 ~/.stocking/settings.json│
│  · /stocks   全 A 股搜索（本地池检索）     │
│  · /quotes   实时行情（腾讯分钟接口）      │
│  · /kline    日/周/月 K 线（fqkline）      │
│  · /minute   分时详情（分钟点 + 昨收）     │
└───────────────────────────────────────────┘
```

### 数据源

- 行情快照 + 分时：`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}&r=0.1`
- 日/周/月 K 线：`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,,{count},qfq`

解析逻辑（字段索引、K 线 `[date, open, close, high, low, volume]` 列序、昨收由 `现价/(1+涨跌幅%)` 反推）与 [stocking 的 market.ts](https://github.com/Awu12277/stocking/blob/main/src/market.ts) 保持一致。Host 端使用 Node 原生 `fetch` 直连（部署即使未挂载 web fetch provider 或沙箱封锁网络，本插件也不受影响）。

### 上游熔断（2026-09-16）

`/quotes` 一次请求会**为全部分组的每只股票各发一次上游请求**（关注池 111 只 ≈ 111 发），前端展开态每 10s 轮询一次。平时无所谓，但腾讯那两个 A 记录集体超时时会出事：

- 2026-09-16 21:04–21:25：`ifzq.gtimg.cn`（117.62.241.183 / 114.222.112.45）全部 `i/o timeout`，失败请求一直挂到 12s 超时，每轮都在重发 → 21 分钟刷出 **1968 条**同一条 mihomo 日志，把 `~/.bin/check-node.sh` 的日志哨兵打醒，推了一条「本机告警（VPS 侧正常）」。

因此腾讯接口（分钟线 + K 线 + 分时详情）统一走 `fetchJsonTencent()`：**按上游 host 熔断**——连续 3 次失败才进入冷却（一次抽风不算），冷却期内直接返回失败、不发起上游连接，恢复探测按指数退避（10s → 20s → … → 60s 封顶），任意一次成功立刻清零恢复。命中熔断时 stderr 打印一行 `ifzq.gtimg.cn 熔断中(Ns)`，便于区分「上游挂了」和「插件挂了」。

实测（模拟上游全挂、前端 10s 轮询）：2 分钟内处理器被调 36 次，真实上游连接从 72 次降到 **4 次**；上游恢复后第一个请求立即放行。

## 🌍 宏观分组（2026-10-02 加）

药丸里多了一个内置分组 `🌍 宏观`，固定挂在所有分组**最后**：

| 标的 | 内部 code | 单位 |
|---|---|---|
| 美元/日元 | `USDJPY` | 日元 |
| 布伦特原油 | `OIL` | 美元/桶 |
| 上证指数 | `IDX.SSEC` | 点 |
| 美元/人民币 | `USDCNY` | 元 |
| 人民币账户黄金 | `CNYGOLD` | 元/克 |
| WTI原油 | `CL` | 美元/桶 |
| 美元指数 | `DXY` | 点 |
| 现货白银 | `XAG` | 美元/盎司 |
| 现货黄金 | `XAU` | 美元/盎司 |

**它是虚拟分组**（与「临时盯盘」同一套路）：不入 DB buckets、不可删不可改名、
行上不给删除按钮 —— 它是插件自己的能力，不是你维护的关注分组。

**数据来自 stock-panel 的 `/api/macro`，不走腾讯**：这 9 个不是股票，
那边已经做完多源降级（腾讯→东财→Yahoo）、状态判定与合成口径
（人民币黄金是伦敦金折算）。`/quotes` 会把宏观 symbol 摘出来单独取一次快照
（9 个一次请求），**不给它们发腾讯请求**（发过去只会白等超时）。

**点开宏观行不会拉分时/K线**（那些走腾讯，宏观没有），而是给一块说明：
现价、涨跌幅、数据来源、以及**「为什么非实时」**——
- `已 43 小时无更新`（上证指数国庆期间的数据停在 09-30）
- `Yahoo 指数/期货源固有延迟约 10 分钟`（美元指数的源天生慢 10 分钟）
- 空 = 数据是当下的

这是 stock-panel 那套状态口径（`live`/`stale`/`halted`）在药丸里的镜像，详见
`stock-panel/docs/宏观看板-方案.md` §4.4b。

**口径提醒也印出来**：两个原油（当月连续合约、与金十可能差一个跨月价差）、
离岸人民币、折算黄金这 4 个标的，快照里的 `note` 会显示在宏观说明块里（`ⓘ …`），
排在「数据从哪来」前面 —— 它解释的是**数字本身怎么读**。
内容是 stock-panel 的 `config/macro.yaml` 给的，插件不自己造一份。

**一处已知取舍**：显示名有一份**兜底镜像**（`MACRO_NAMES`）。权威名字在 `/api/macro`
（`config/macro.yaml` 是源头），但那一趟实测 8.9 秒、冷启动更久，
取不到时若把名字退化成 `USDJPY` 这种代码就看不懂了。兜底只在取数失败时用，
且此时 `live=false`（不给假价）。

## 目录结构

```
dsh-stock-watch/
├── index.js           # node 端 cordis 插件（webServer 路由 + 技能注入 + 系统提示指令）
├── client.js          # 浏览器端客户端模块（__ModuleLoader__ + shell.overlay 槽位）
├── cordis.patch.yml   # 组合补丁：插入 host 插件行（dsh.bundle.patch）
├── package.json       # dsh.bundle + dsh.client 声明
├── data/              # 全 A 股股票池（a_stocks.json，5549 只）
├── skills/            # 随包技能（investment-research / frontend-design，启动时注入用户技能目录）
├── scripts/           # 本地测试脚本（smoke / probe / skills 注入验证）
├── screenshots/       # 运行截图
└── README.md
```

`dsh plugin add` 即 profile 目录内的 `pnpm add`：安装后按 package.json 的 `dsh.bundle.patch` 自动并入 profile 层栈，`dsh.client` 声明自动挂载浏览器端模块。

## 交互说明

| 状态 | 操作 |
|---|---|
| 药丸 | 点击展开 · 按住拖动（拖到屏幕边缘自动吸附为半球，显示涨/跌家数）· 悬停弹出扇形菜单（行情分析/每日复盘/涨停分析，新开对话执行） |
| 列表 | 分组 tab 切换 · 点击行进详情 · ⟳ 手动刷新 · — 折叠 · ☀️/🌙 切主题 |
| 详情 | ← 返回 · 分时 / 日K / 周K / 月K 切换 · 📈 投资研究报告（新建对话一键分析）· 点击买入/卖出目标编辑 · K线 `+`/`−`/`重置` 缩放 |

## 🎯 目标价：stock_targets 是唯一真理源（2026-10-02 收口）

药丸里的买/卖目标价**直写 stock-panel 的 `stock_targets` 表**，与关注池、分组同一套路
（都经 host 代理直写 DB，不在 localStorage 留第二份真相）。

之前不是"两套分工"，是**两边互盲**：
- `/api/watchlist` 不带目标价 → 面板/手机页/CLI 设的目标价，**药丸一直看不见**；
- 药丸里设的只进 localStorage → **不进 DB，Bark 永远不会推**，`/m` 也看不见；
- 更糟的是本地覆盖层会**静默遮盖** DB —— 在手机页改过目标价，药丸里却永远显示旧值。

现在：
- 新增 `/dsh-stock-watch/targets`：`GET` 全量（含宏观 code，9 个一次回来）、
  `POST {code,buy_target,sell_target}` 写入/清除、`POST {code,rearm}` 重新武装；
  直通 stock-panel 的 `/api/target` 与 `/api/target/rearm`。
- 客户端挂载后拉一次，随 `/config` 一起 60s 刷新；编辑走**乐观更新 + 失败回滚**——
  失败必须回滚并明说，静默失败会让人以为设好了，而 Bark 根本没挂上。
- **key 要对齐**：DB 里的 code **无前缀**（`600105`），药丸内部行/分组是 `sh600105`。
  两边直接对 key 永远对不上，所以查表统一走 `stripApiCode()`。
- **已达标记**：`xxx_hit_at` 有值时目标价后面跟一个 `✓已推`（悬停看推送时间），
  与手机页 `/m` 的「🎯买31.00」同一语义。
- **一次性迁库**：旧的 `stocking.targets.v1` / `stocking.config.v1` 里的目标价按**侧**迁
  （DB 没有买入侧才迁买入侧），迁完删掉这两个键。先迁是为了不丢用户设过的目标价，
  后删是为了不再有第二份真相。

**两个踩到的坑，都值得记**：

1. **`withMacroGroup()` 重建宏观 symbol**，早先无条件重建成 `{ code }`，
   把 `buyPrice`/`sellPrice` 整个丢掉 → 宏观目标价永远进不了 ⚡ 信号计算。
   症状很阴：行上看得见值（那是客户端 `targets` 状态直接渲染的），
   但「信号」tab 永远不亮。现在保留调用方带来的字段。
2. **只改局部状态不会反映到详情页**：详情读 `/quotes` 返回的行，而行的 `buyPrice`
   来自「发给 `/quotes` 的 groupsCfg」—— 所以 `refreshTargets()` 之后必须再
   `refreshCfg()` 重新合并一次。首轮谁先回来是不确定的，靠碰运气就是"有时灵有时不灵"。

## 配置与持久化

- **自选股分组与关注池**：DB 为准（`stock-panel` 的 `stocks.bucket` / `stocks.groups`），
  药丸只读镜像，增删改经 host 直写 DB
- **买卖目标价**：DB 为准（`stock_targets`），同上
- **留在 localStorage 的**：面板位置/尺寸、主题、MA 显隐、排序模式、**临时盯盘**分组
  （它刻意不入库，所以只能本地），以及目标价的**一次性迁移来源**（迁完即删）
- 重置：`localStorage.clear()` 后刷新页面（不影响 DB 里的关注池与目标价）

## License

MIT

/**
 * dsh-stock-watch — 浏览器端（client.js）
 *
 * dsh 客户端插件：在 shell.overlay 槽位注册右上角可折叠盯盘弹窗。
 * 数据来自 node 端插件注册的 /dsh-stock-watch/* 路由（同源 fetch）。
 * 自选股配置（分组/代码/买卖目标价）存 localStorage，首次从 settings.json 迁移。
 * 图表：TradingView Lightweight Charts（CDN 懒加载，失败降级自绘 SVG）。
 * 配色沿用 A 股红涨绿跌惯例（涨 #ff1493 / 跌 #00ff41）。
 */
window.__ModuleLoader__.load({
  id: "dsh-stock-watch",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    const { useState, useEffect, useCallback, useRef } = react;

    // ------------------------------------------------------------------ CSS
    const styleTag = document.createElement("style");
    styleTag.textContent = `
.sk-theme-dark{--sk-panel-bg:rgba(13,17,26,.96);--sk-pill-bg:rgba(13,17,26,.93);--sk-border:rgba(255,255,255,.16);--sk-border-soft:rgba(255,255,255,.08);--sk-text:#e5e7eb;--sk-dim:#9ca3af;--sk-muted:#6b7280;--sk-muted-strong:#4b5563;--sk-hover:rgba(255,255,255,.06);--sk-cyan:#22d3ee;--sk-cyan-soft:rgba(34,211,238,.16);--sk-cyan-border:rgba(34,211,238,.5);--sk-shadow:0 8px 32px rgba(0,0,0,.5)}
.sk-theme-light{--sk-panel-bg:rgba(255,255,255,.97);--sk-pill-bg:rgba(255,255,255,.95);--sk-border:rgba(15,23,42,.14);--sk-border-soft:rgba(15,23,42,.08);--sk-text:#1f2937;--sk-dim:#4b5563;--sk-muted:#6b7280;--sk-muted-strong:#9ca3af;--sk-hover:rgba(15,23,42,.06);--sk-cyan:#0891b2;--sk-cyan-soft:rgba(8,145,178,.12);--sk-cyan-border:rgba(8,145,178,.5);--sk-shadow:0 8px 32px rgba(15,23,42,.18)}
.sk-pill{position:fixed;top:14px;right:16px;z-index:1000002;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--sk-pill-bg);border:1px solid var(--sk-border);color:var(--sk-text);cursor:pointer;user-select:none;font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;box-shadow:0 4px 18px rgba(0,0,0,.35);backdrop-filter:blur(8px);pointer-events:auto}
.sk-pill:hover{border-color:var(--sk-cyan-border)}
.sk-pill-title{font-weight:700;color:var(--sk-cyan);white-space:nowrap}
.sk-pill-summary{display:inline-flex;gap:6px;font-weight:600}
.sk-pill-signal{display:inline-flex;gap:5px;font-weight:700;margin-left:1px}
.sk-pill-loading{color:var(--sk-muted)}
/* 贴边吸附：胶囊变为屏幕边缘的半球，显示涨/跌家数（平边贴屏幕边缘，弧面朝内） */
.sk-pill.sk-dock{box-sizing:border-box;width:52px;height:44px;flex-direction:column;gap:1px;padding:3px 4px;justify-content:center;text-align:center}
.sk-dock-left{border-radius:0 22px 22px 0}
.sk-dock-right{border-radius:22px 0 0 22px}
.sk-dock-top{border-radius:0 0 26px 26px}
.sk-dock-bottom{border-radius:26px 26px 0 0}
.sk-dock-body{display:flex;flex-direction:column;align-items:center;gap:0;line-height:1.05}
.sk-dock-count{font-size:10px;font-weight:700;white-space:nowrap}
/* 胶囊悬浮扇形菜单：全屏透明层（不挡点击），选项本身可点；GSAP 驱动位移/缩放/透明度 */
.sk-fan{position:fixed;inset:0;z-index:1000001;pointer-events:none;visibility:hidden}
.sk-fan-item{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;background:var(--sk-pill-bg);border:1px solid var(--sk-cyan-border);color:var(--sk-text);font:11px/1.3 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.38);backdrop-filter:blur(8px);pointer-events:auto;white-space:nowrap;transition:background-color .18s ease,border-color .18s ease,color .18s ease,box-shadow .18s ease,filter .18s ease}
/* hover：青底着色 + 青色光晕；上浮/缩放由 GSAP 驱动（CSS 独立变换属性会被 GSAP 内联的 translate:none 覆盖） */
.sk-fan-item:hover{background:var(--sk-cyan-soft);border-color:var(--sk-cyan);color:var(--sk-cyan);box-shadow:0 0 0 1px rgba(34,211,238,.22),0 10px 26px rgba(34,211,238,.22),0 4px 14px rgba(0,0,0,.35);filter:brightness(1.08)}
.sk-fan-item:active{filter:brightness(.92)}
.sk-fan-item:focus-visible{outline:2px solid var(--sk-cyan);outline-offset:2px}
.sk-fan-item-disabled,.sk-fan-item-disabled:hover{opacity:.4;border-color:var(--sk-border);color:var(--sk-muted);background:transparent;cursor:not-allowed;filter:none;box-shadow:0 6px 22px rgba(0,0,0,.38)}
.sk-fan-icon{font-size:13px}
/* 折叠态反馈 toast */
.sk-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:1000003;background:var(--sk-pill-bg);border:1px solid var(--sk-border);border-radius:8px;padding:6px 14px;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;box-shadow:0 6px 22px rgba(0,0,0,.38);pointer-events:none;white-space:nowrap}
.sk-panel{position:fixed;top:14px;right:16px;z-index:1000002;width:400px;max-height:78vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--sk-panel-bg);border:1px solid var(--sk-border);color:var(--sk-text);box-shadow:var(--sk-shadow);backdrop-filter:blur(10px);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;pointer-events:auto}
.sk-header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--sk-border-soft)}
.sk-title{font-weight:700;color:var(--sk-cyan);white-space:nowrap}
.sk-macro-note{padding:18px 14px;text-align:center;color:var(--sk-muted);font-size:11px;line-height:1.9}
.sk-macro-big{font-size:26px;font-weight:700;color:var(--sk-text);font-variant-numeric:tabular-nums}
.sk-macro-unit{font-size:11px;font-weight:400;color:var(--sk-muted);margin-left:6px}
.sk-macro-chg{font-size:13px;font-weight:600;margin-bottom:12px}
.sk-macro-line{margin-top:4px}
.sk-macro-line code{background:rgba(148,163,184,.16);padding:1px 4px;border-radius:3px}
.sk-tabs{display:flex;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.sk-tabs::-webkit-scrollbar{display:none}
.sk-tab{flex:none;padding:2px 9px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--sk-muted);cursor:pointer;font:inherit;white-space:nowrap}
.sk-tab:hover{color:var(--sk-text)}
.sk-tab-signal{font-weight:700}
.sk-tab-active{background:var(--sk-cyan-soft);color:var(--sk-cyan);border-color:var(--sk-cyan-border)}
.sk-tab-wrap{display:flex;align-items:center;gap:2px;flex:none}
.sk-tab-del{background:transparent;border:none;color:var(--sk-muted);cursor:pointer;font-size:10px;font-weight:700;line-height:1;padding:0 2px;opacity:0;pointer-events:none}
.sk-tab-wrap:hover .sk-tab-del{opacity:1;pointer-events:auto}
.sk-tab-del:hover{color:#ff5555}
.sk-del{background:transparent;border:none;color:var(--sk-muted);cursor:pointer;font-size:11px;padding:0 2px;width:18px;flex:none;border-radius:4px}
.sk-resize{position:absolute;width:14px;height:14px;z-index:6;opacity:.55}
.sk-resize:hover{opacity:1}
.sk-resize-br{bottom:0;right:0;cursor:nwse-resize;border-bottom-right-radius:10px;background:linear-gradient(315deg,transparent 62%,var(--sk-muted) 62%,var(--sk-muted) 75%,transparent 75%)}
.sk-del:hover{color:#ff5555;background:var(--sk-hover)}
/* 宏观行只留占位（保持右侧对齐），不可点也不该看起来可点 */
.sk-del-macro{pointer-events:none;cursor:default}
.sk-right{display:flex;align-items:center;gap:4px;flex:none}
.sk-countdown{color:var(--sk-muted);white-space:nowrap}
.sk-icon{background:transparent;border:none;color:var(--sk-muted);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:6px;font-family:inherit}
.sk-icon:hover{color:var(--sk-text);background:var(--sk-hover)}
.sk-sort-active{color:var(--sk-cyan);background:var(--sk-cyan-soft)}
.sk-rows{overflow-y:auto;padding:4px 6px 8px;flex:1 1 auto}
.sk-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;cursor:pointer}
.sk-row:hover{background:var(--sk-hover)}
.sk-name{display:flex;flex-direction:column;flex:1 1 auto;min-width:88px}
.sk-name-row{display:flex;align-items:center;gap:4px;min-width:0}
.sk-name-text{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-board-chip{flex:none;font-size:9px;font-weight:700;border:1px solid;border-radius:999px;padding:0 5px;line-height:1.5;white-space:nowrap}
.sk-board-cy{color:#ff9f43;border-color:rgba(255,159,67,.55)}
.sk-board-kc{color:#a78bfa;border-color:rgba(167,139,250,.55)}
.sk-board-bj{color:#ff5555;border-color:rgba(255,85,85,.55)}
.sk-code{color:var(--sk-muted);font-size:11px}
.sk-tags{display:flex;align-items:center;gap:3px;margin-top:1px;overflow:hidden;max-width:100%}
.sk-tag{flex:none;max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;line-height:1.5;font-weight:600;padding:0 5px;border-radius:999px;color:var(--sk-cyan,#22d3ee);border:1px solid var(--sk-cyan-border,rgba(34,211,238,.4));background:transparent;opacity:.9}
.sk-tag-more{color:var(--sk-muted);border-color:var(--sk-border,rgba(255,255,255,.16));font-weight:700}
.sk-spark{flex:none;display:block}
.sk-price{width:60px;text-align:right;font-weight:700}
.sk-chg{width:62px;text-align:right}
.sk-trigger{min-width:34px;text-align:center;border:1px solid;border-radius:999px;padding:0 6px;font-weight:700}
.sk-trigger-none{color:var(--sk-muted-strong);border-color:var(--sk-border)}
.sk-empty{padding:18px 10px;text-align:center;color:var(--sk-muted)}
.sk-footer{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border-top:1px solid var(--sk-border-soft);color:var(--sk-muted);font-size:11px}
.sk-foot-left{max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-foot-right{max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-detail-header{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--sk-border-soft)}
.sk-detail-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.sk-back{align-self:flex-start;background:transparent;border:1px solid var(--sk-border);color:var(--sk-muted);border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit}
.sk-back:hover{color:var(--sk-text);border-color:var(--sk-cyan-border)}
.sk-analyze{background:var(--sk-cyan-soft);border:1px solid var(--sk-cyan-border);color:var(--sk-cyan);border-radius:6px;padding:2px 10px;cursor:pointer;font:inherit;font-size:11px;white-space:nowrap}
.sk-analyze:hover{filter:brightness(1.15)}
.sk-analyze:disabled{opacity:.55;cursor:wait;filter:none}
.sk-detail-info{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.sk-detail-name{font-weight:700;font-size:13px}
.sk-detail-price{font-weight:700;font-size:16px}
.sk-detail-chg{font-size:12px}
.sk-detail-trigger{font-size:11px;border:1px solid;border-radius:999px;padding:0 7px;font-weight:700}
.sk-detail-targets{display:flex;gap:10px;flex-wrap:wrap}
.sk-target{font-size:11px;white-space:nowrap}
.sk-target-btn{background:transparent;border:1px dashed var(--sk-border);color:var(--sk-dim);border-radius:6px;padding:1px 8px;cursor:pointer;font:inherit;white-space:nowrap}
.sk-target-btn:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-target-hit{color:#00c853;font-size:10px}
.sk-target-input{width:120px;background:var(--sk-hover);border:1px solid var(--sk-cyan-border);color:var(--sk-text);border-radius:6px;padding:1px 6px;font:inherit;outline:none}
/* 理由（「为什么设这个价」）：与面板 / 手机页 /m 同一份存储，这里只读展示。
   条目多时给固定高度 + 内部滚动 —— 详情页的图不能被理由挤没了。 */
.sk-why{display:flex;flex-direction:column;gap:2px;max-height:76px;overflow-y:auto;
        border-left:2px solid var(--sk-cyan-border);padding-left:8px}
.sk-why-line{font-size:10.5px;line-height:1.45;display:flex;gap:6px;align-items:baseline}
.sk-why-k{flex:none;color:var(--sk-dim)}
.sk-why-d{flex:none;color:var(--sk-cyan);font-variant-numeric:tabular-nums}
.sk-why-t{flex:1;color:var(--sk-muted);word-break:break-word}
/* 行内「写过理由」标记：理由在详情里，列表上不给提示就等于没写 */
.sk-why-badge{color:var(--sk-cyan);opacity:.75;margin-left:4px;font-size:10px}
.sk-flash{font-size:11px}
.sk-periods{display:flex;gap:4px;flex-wrap:wrap}
.sk-period{background:transparent;border:1px solid transparent;color:var(--sk-muted);border-radius:6px;padding:1px 8px;cursor:pointer;font:inherit}
.sk-period:hover{color:var(--sk-text)}
.sk-period-active{color:var(--sk-cyan);border-color:var(--sk-cyan-border);background:var(--sk-cyan-soft)}
.sk-chart-box{width:100%;position:relative}
.sk-candles{display:block;margin:0 auto}
.sk-chart-empty{padding:30px 10px;text-align:center;color:var(--sk-muted)}
.sk-detail-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--sk-border-soft);color:var(--sk-muted);font-size:11px}
.sk-pill{cursor:grab}
.sk-pill:active{cursor:grabbing}
.sk-header,.sk-detail-header{user-select:none;-webkit-user-select:none}
.sk-ma-row{display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap}
.sk-ma-chips{display:inline-flex;gap:6px;flex-wrap:wrap}
.sk-zoom{display:inline-flex;gap:4px;align-items:center}
.sk-zoom-btn{background:transparent;border:1px solid var(--sk-border);color:var(--sk-dim);border-radius:6px;min-width:22px;height:20px;padding:0 6px;cursor:pointer;font:inherit;font-size:11px;line-height:1;white-space:nowrap}
.sk-zoom-btn:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-ma-chip{display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--sk-border);color:var(--sk-dim);border-radius:999px;padding:1px 8px;cursor:pointer;font:inherit;font-size:11px;white-space:nowrap}
.sk-ma-chip:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-ma-chip-off{opacity:.35;text-decoration:line-through}
.sk-ma-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.sk-add-mask{position:absolute;inset:0;z-index:20;background:var(--sk-panel-bg);display:flex;flex-direction:column;padding:10px}
.sk-add-bar{display:flex;gap:8px;padding:6px 10px;border-top:1px solid var(--sk-border-soft)}
.sk-add-bar-btn{flex:1;background:transparent;border:1px dashed var(--sk-border);color:var(--sk-dim);border-radius:8px;padding:6px;cursor:pointer;font:inherit}
.sk-add-bar-btn:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-add-bar-primary{color:var(--sk-cyan);border:1px solid var(--sk-cyan-border);font-weight:600}
.sk-add-bar-primary:hover{background:var(--sk-cyan-soft);color:var(--sk-cyan)}
.sk-add-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.sk-add-title{font-weight:700;color:var(--sk-cyan)}
.sk-add-menu{display:flex;flex-direction:column;gap:6px}
.sk-add-menu-item{background:var(--sk-hover);border:1px solid var(--sk-border);color:var(--sk-text);border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit;text-align:left}
.sk-add-menu-item:hover{border-color:var(--sk-cyan-border)}
/* 窄屏+触摸(手机/平板)隐藏整个盯盘 UI——桌面/触控板设备无论窗口宽窄都显示 */
@media (max-width: 768px) and (pointer: coarse){.sk-pill,.sk-fan,.sk-fan-item,.sk-panel,.sk-toast{display:none!important}}
.sk-add-stock{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}
.sk-add-input{background:var(--sk-hover);border:1px solid var(--sk-cyan-border);color:var(--sk-text);border-radius:6px;padding:5px 8px;font:inherit;outline:none}
.sk-rename-input{width:120px;background:var(--sk-hover);border:1px solid var(--sk-cyan-border);color:var(--sk-text);border-radius:6px;padding:1px 6px;font:inherit;outline:none}
.sk-add-result-added .sk-add-result-name{color:var(--sk-muted)}
.sk-add-result-badge{color:var(--sk-muted);font-size:10px;border:1px solid var(--sk-border);border-radius:999px;padding:0 5px;white-space:nowrap}
.sk-add-results{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.sk-add-result{display:flex;gap:10px;align-items:center;background:transparent;border:none;color:var(--sk-text);border-radius:6px;padding:4px 8px;font:inherit;text-align:left}
.sk-add-result:hover{background:var(--sk-hover)}
.sk-add-result-code{color:var(--sk-muted);font-size:11px;width:52px}
.sk-add-result-act{flex:none;background:var(--sk-cyan-soft);border:1px solid var(--sk-cyan-border);color:var(--sk-cyan);border-radius:4px;padding:1px 7px;cursor:pointer;font:inherit;font-size:10px;white-space:nowrap}
.sk-add-result-act:hover{filter:brightness(1.15)}
.sk-add-result-wo{background:transparent;border:1px solid var(--sk-border);color:var(--sk-dim)}
.sk-add-result-wo:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-add-result-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sk-add-empty{color:var(--sk-muted);text-align:center;padding:14px 0;font-size:11px}
.sk-add-group{display:flex;flex-direction:column;gap:8px}
.sk-add-confirm{background:var(--sk-cyan-soft);border:1px solid var(--sk-cyan-border);color:var(--sk-cyan);border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;font-weight:600}
`;
    document.head.appendChild(styleTag);

    // ------------------------------------------------------------------ 常量
    const UP = "#ff1493";
    const DOWN = "#00ff41";
    const FLAT = "#8b93a7";
    const YELLOW = "#ffcc00";
    const STORAGE_KEY = "stocking.config.v1"; // 旧版全量分组配置：分组早已以 DB 为准，此键只在迁目标价时读一次，随后删除
    const TARGETS_KEY = "stocking.targets.v1"; // 旧版目标价覆盖层：已收口到 DB，此键只在迁库时读一次，随后删除
    const WATCHONLY_KEY = "stocking.watchonly.v1"; // 临时盯盘（不入库）：[{code,name}]，localStorage 私货层
    const SORT_KEY = "stocking.sort.v1"; // 组内排序模式：default | chgDesc | chgAsc（localStorage 私货，与目标价同类）
    const BASE = "/dsh-stock-watch";
    const DEFAULT_GROUPS = [
      { name: "全部关注", symbols: [] },
    ];
    const POS_KEY = "stocking.pos.v1";
    const SIZE_KEY = "stocking.size.v1";
    // 内置提示词（保持不变，规范原文；{name}/{code} 为占位符）。
    // 实际发送使用简短消息「分析{name}（code）」；技能调用指令由 host 端注入的条件式系统提示保证。
    const BUILTIN_ANALYZE_PROMPT = "使用技能 investment-research 分析下{name}（{code}）这家公司，再使用技能 frontend-design 生成一个网站";
    const PANEL_MIN_W = 320;
    const PANEL_MAX_W = 640;
    const PANEL_MIN_H = 240;
    const PANEL_MAX_H = 820;
    const PILL_W = 132;
    const DOCK_W = 52;   // 贴边半球尺寸：吸附到屏幕边缘后胶囊变为半球形（扁矮）
    const DOCK_H = 44;
    const SNAP_PX = 36;  // 拖拽吸附阈值：距边缘 SNAP_PX 内自动贴边
    const PANEL_W = 400;
    const MA_PERIODS = [5, 10, 20, 60];
    const MA_COLOR = { 10: "#ffcc00", 20: "#ff5cd2", 60: "#00ff41" };
    const MA_STORAGE_KEY = "stocking.ma.v1";
    function maColor(p, dark) {
      return p === 5 ? (dark ? "#e5e7eb" : "#374151") : MA_COLOR[p] || "#ffcc00";
    }

    // ------------------------------------------------------------------ 工具
    /**
     * 插件路由请求。params 默认拼 query；options.body 时改发 POST JSON
     * （分组配置含标签后 query 串会超 Node maxHeaderSize → 431，故 /quotes 走 body）。
     */
    async function api(path, params, options) {
      const opts = options || {};
      const init = { cache: "no-store", method: opts.body ? "POST" : "GET" };
      let url = BASE + path;
      if (opts.body) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(opts.body);
      }
      const qs = new URLSearchParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v === undefined || v === null) continue;
          qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
      }
      const q = qs.toString();
      if (q) url += "?" + q;
      const res = await fetch(url, init);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }

    function formatPrice(p) {
      // null / '' 也要判掉：Number(null) === 0 是**有限数**，
      // 不拦的话 halted 的宏观行（high/low/price 都是 null）会印成「0.000」——
      // 一个看着像真价格的假 0。undefined 本来就会落到 isFinite 判定，这里一并写清。
      if (p === null || p === undefined || p === "") return "--";
      const n = Number(p);
      if (!Number.isFinite(n)) return "--";
      return n >= 100 ? n.toFixed(2) : n.toFixed(3);
    }

    // ── 涨跌幅：必须容忍「有价、但没有涨跌幅」的 null ──────────────────────
    // 宏观标的走 /api/macro，其中靠 DB 兜底的那几条（美元指数 / 美元日元 /
    // 美元人民币 / 人民币账户黄金）没有 prevClose，pct 就是 **null**，但价格有值
    // （服务端据此给 live=true + state=halted）。原先这里写死
    // `row.live ? (… row.changePercent.toFixed(2) …) : ""`，
    // 而 `null >= 0` 为 true，接着调 `.toFixed` 就抛 TypeError ——
    // React 渲染里抛错是**整棵子树消失**，表现正是「点了 ⚡ 信号 就什么都没有了」。
    // 2026-10-06 用户报障即此：美元指数设了买入目标价 103、现价 102.125（旧价）触发买入
    // → 该行进信号列表 → 一点信号就空白。所以：拿不到涨跌幅就画「—」。
    function fmtPct(row) {
      if (!row || !row.live) return "";
      const n = row.changePercent;
      if (typeof n !== "number" || !Number.isFinite(n)) return "—";
      return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
    }
    // 涨跌方向：1 涨 / -1 跌 / 0 无方向（非 live 或没有涨跌幅 → 中性灰，不假装涨跌）
    function pctDir(row) {
      if (!row || !row.live) return 0;
      const n = row.changePercent;
      if (typeof n !== "number" || !Number.isFinite(n)) return 0;
      return n >= 0 ? 1 : -1;
    }

    // 板块名（与 stock-panel 面板 signal_engine._boardName 同口径）：主板/创业板/科创板/北交所。
    // 基于 6 位代码前缀判定，不依赖市场前缀（北交所可能被 normalizeApiCode 错标为 sh，故 strip 后再判）。
    function boardOf(code) {
      const c = String(code || "").replace(/^(sh|sz|bj)/i, "");
      if (/^bj/i.test(String(code || "")) || /^[48]/.test(c) || /^920/.test(c)) return "北交所";
      if (/^(300|301)/.test(c)) return "创业板";
      if (/^(688|689)/.test(c)) return "科创板";
      return "主板";
    }
    function boardChip(code) {
      const b = boardOf(code);
      if (b === "主板") return null; // 与面板一致：主板不标，非主板才挂 chip
      return react.createElement("span", { className: "sk-board-chip sk-board-" + (b === "北交所" ? "bj" : b === "创业板" ? "cy" : "kc"), title: "板块：" + b }, b);
    }

    /**
     * 标签 chips（stock-panel DB stocks.groups，只读镜像）。
     * 行内最多展示 3 个，其余折叠为 +N（title 给全量），避免面板窄时撑高行。
     */
    function tagChips(tags) {
      const list = Array.isArray(tags) ? tags.filter((t) => t && String(t).trim()) : [];
      if (list.length === 0) return null;
      const MAX = 3;
      const shown = list.slice(0, MAX);
      const rest = list.length - shown.length;
      const full = "标签：" + list.join(" · ");
      const kids = shown.map((t, i) =>
        react.createElement("span", { key: "tg" + i, className: "sk-tag", title: full }, t));
      if (rest > 0) {
        kids.push(react.createElement("span", { key: "tg-more", className: "sk-tag sk-tag-more", title: full }, "+" + rest));
      }
      return react.createElement("span", { className: "sk-tags" }, kids);
    }

    function triggerMeta(t) {
      if (t === "sell") return { t: "卖出", c: UP };
      if (t === "buy") return { t: "买入", c: DOWN };
      if (t === "wait") return { t: "等待", c: YELLOW };
      return null;
    }

    // DB 目标价行（buy_target/sell_target/…）→ 药丸内部行形状（buyPrice/sellPrice）。
    // 保持 camelCase 是为了不动既有渲染/触发逻辑（computeTrigger、targetChip 都读这个形状）。
    // 理由（2026-10-06 加）也必须一起搬过来 —— 它与目标价是**同一行数据**：
    // stock_targets 的 buy_reason / sell_reason 是「按日期累积的条目日志」（\n 分隔），
    // 与 stock-panel 面板、手机页 /m 读写同一份，插件这边只读展示。
    const targetRowOf = (t) => {
      const out = {};
      if (t && t.buy_target !== undefined && t.buy_target !== null) out.buyPrice = t.buy_target;
      if (t && t.sell_target !== undefined && t.sell_target !== null) out.sellPrice = t.sell_target;
      if (t && t.buy_hit_at) out.buyHitAt = t.buy_hit_at;
      if (t && t.sell_hit_at) out.sellHitAt = t.sell_hit_at;
      if (t && t.buy_reason) out.buyReason = t.buy_reason;
      if (t && t.sell_reason) out.sellReason = t.sell_reason;
      return out;
    };

    // 理由条目日志（\n 分隔）→ 条目数组；空行丢弃。
    function reasonLines(text) {
      return String(text == null ? "" : text).split("\n")
        .map((s) => s.trim()).filter((s) => s);
    }
    // 一条理由拆成「日期 | 正文」——与 /m、面板同一口径：日期抬出来当锚点。
    // 校验（必带日期）在前端写入侧，这里兜底把整条当正文，绝不吞掉用户写的内容。
    function reasonSplit(entry) {
      const m = /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(.*)$/.exec(String(entry || ""));
      return m ? { d: m[1], t: m[2] } : { d: "", t: String(entry || "") };
    }

    /**
     * 去掉市场前缀（sh600105 → 600105）。
     * **目标价表的 code 是无前缀的**（stock_targets / /api/targets 都存 600105），
     * 而药丸内部行/分组用的是带前缀的 sh600105 —— 两边直接对 key 永远对不上。
     * 镜像自 index.js 的 stripApiCode（那边用于回写 DB），源头改了这里要跟着改。
     */
    function stripApiCode(code) {
      return String(code || "").replace(/^(sh|sz|bj)/i, "");
    }

    function computeTrigger(price, buyPrice, sellPrice) {
      if (buyPrice === undefined && sellPrice === undefined) return "none";
      if (sellPrice !== undefined && price >= sellPrice) return "sell";
      if (buyPrice !== undefined && price <= buyPrice) return "buy";
      return "wait";
    }

    // ----------------------------------------------- TradingView Lightweight Charts 懒加载
    let lwcPromise = null;
    function loadLightweightCharts() {
      if (lwcPromise) return lwcPromise;
      const p = new Promise((resolve) => {
        let settled = false;
        const finish = (lib) => {
          if (settled) return;
          settled = true;
          if (!lib) lwcPromise = null;
          resolve(lib);
        };
        try {
          const existing = window.LightweightCharts;
          if (existing) { finish(existing); return; }
          const sources = [
            "https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js",
            "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js",
          ];
          let idx = 0;
          const inject = () => {
            if (idx >= sources.length) { finish(null); return; }
            const s = document.createElement("script");
            s.src = sources[idx];
            s.async = true;
            s.onload = () => {
              if (window.LightweightCharts) finish(window.LightweightCharts);
              else { idx += 1; inject(); }
            };
            s.onerror = () => { idx += 1; inject(); };
            document.head.appendChild(s);
          };
          inject();
          setTimeout(() => finish(null), 9000);
        } catch {
          finish(null);
        }
      });
      lwcPromise = p;
      return p;
    }

    // ----------------------------------------------- GSAP 懒加载（胶囊扇形菜单动画）
    let gsapPromise = null;
    function loadGsap() {
      if (gsapPromise) return gsapPromise;
      const p = new Promise((resolve) => {
        let settled = false;
        const finish = (lib) => {
          if (settled) return;
          settled = true;
          if (!lib) gsapPromise = null;
          resolve(lib);
        };
        try {
          const existing = window.gsap;
          if (existing) { finish(existing); return; }
          const sources = [
            "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
            "https://unpkg.com/gsap@3.12.5/dist/gsap.min.js",
          ];
          let idx = 0;
          const inject = () => {
            if (idx >= sources.length) { finish(null); return; }
            const s = document.createElement("script");
            s.src = sources[idx];
            s.async = true;
            s.onload = () => {
              if (window.gsap) finish(window.gsap);
              else { idx += 1; inject(); }
            };
            s.onerror = () => { idx += 1; inject(); };
            document.head.appendChild(s);
          };
          inject();
          setTimeout(() => finish(null), 9000);
        } catch {
          finish(null);
        }
      });
      gsapPromise = p;
      return p;
    }

    // ----------------------------------------------- 扇形菜单几何
    // 按胶囊中心相对屏幕的位置选择展开象限（优先空间大的一侧），半径按可用空间钳制，保证不越出屏幕。
    // 角度 0°=右、90°=下（屏幕坐标系 y 向下）；3 个选项围绕象限对角方向 ±35° 展开。
    function fanGeometry(pos, pillW, pillH) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = pos ? pos.x + pillW / 2 : vw - PILL_W / 2 - 16;
      const cy = pos ? pos.y + pillH / 2 : 14 + pillH / 2;
      const left = cx;
      const right = vw - cx;
      const top = cy;
      const bottom = vh - cy;
      const hDir = right >= left ? 1 : -1; // 1=向右展开，-1=向左
      const vDir = bottom >= top ? 1 : -1; // 1=向下展开，-1=向上
      const hSpace = hDir === 1 ? right : left;
      const vSpace = vDir === 1 ? bottom : top;
      let base = 0;
      if (hDir === 1 && vDir === 1) base = 45;
      else if (hDir === 1 && vDir === -1) base = -45;
      else if (hDir === -1 && vDir === 1) base = 135;
      else base = 225;
      const R = Math.max(44, Math.min(128, hSpace - 40, vSpace - 40));
      // 选项估算半宽/半高，用于逐项屏幕边界钳制（贴边时接近水平/垂直方向的选项不会推出屏外）
      const HALF_W = 48;
      const HALF_H = 18;
      const EDGE = 6;
      return {
        cx,
        cy,
        hDir,
        vDir,
        items: [base - 35, base, base + 35].map((a) => {
          const rad = (a * Math.PI) / 180;
          let x = cx + Math.cos(rad) * R;
          let y = cy + Math.sin(rad) * R;
          x = Math.min(vw - HALF_W - EDGE, Math.max(HALF_W + EDGE, x));
          y = Math.min(vh - HALF_H - EDGE, Math.max(HALF_H + EDGE, y));
          return { dx: x - cx, dy: y - cy, angle: a };
        }),
      };
    }

    // -------------------------------------------------------------- 分时迷你折线（列表行）
    function Sparkline(props) {
      const prices = props.prices;
      const color = props.color;
      const width = 72;
      const height = 20;
      if (!Array.isArray(prices) || prices.length < 2) {
        return react.createElement("svg", { className: "sk-spark", width, height, viewBox: "0 0 " + width + " " + height });
      }
      const pts = prices.length > 60 ? prices.slice(prices.length - 60) : prices;
      let min = Infinity;
      let max = -Infinity;
      for (const p of pts) { if (p < min) min = p; if (p > max) max = p; }
      const span = (max - min) || 1;
      const coords = pts.map((p, i) => {
        const x = (i / (pts.length - 1)) * (width - 2) + 1;
        const y = height - 2 - ((p - min) / span) * (height - 4);
        return x.toFixed(1) + "," + y.toFixed(1);
      });
      return react.createElement("svg", { className: "sk-spark", width, height, viewBox: "0 0 " + width + " " + height },
        react.createElement("polyline", { points: coords.join(" "), fill: "none", stroke: color, strokeWidth: 1.4 }));
    }

    // -------------------------------------------------------------- K线 SVG 兜底
    function SvgCandles(props) {
      const candles = props.candles || [];
      const width = props.width || 380;
      const height = props.height || 228;
      const fill = props.fill === true;
      if (!Array.isArray(candles) || candles.length === 0) {
        return react.createElement("div", { className: "sk-chart-empty" }, "暂无K线数据");
      }
      const pad = 6;
      let min = Infinity;
      let max = -Infinity;
      for (const c of candles) {
        if (c.low < min) min = c.low;
        if (c.high > max) max = c.high;
      }
      const span = (max - min) || 1;
      const innerH = height - pad * 2;
      const yOf = (v) => pad + innerH - ((v - min) / span) * innerH;
      const n = candles.length;
      const step = (width - pad * 2) / n;
      const bodyW = Math.max(2, step * 0.62);
      const els = [];
      for (let i = 0; i < n; i++) {
        const c = candles[i];
        const x = pad + step * i + step / 2;
        const up = c.close >= c.open;
        const color = up ? UP : DOWN;
        const openY = yOf(c.open);
        const closeY = yOf(c.close);
        const top = Math.min(openY, closeY);
        const bodyH = Math.max(1, Math.abs(closeY - openY));
        els.push(react.createElement("line", { key: "w" + i, x1: x, y1: yOf(c.high), x2: x, y2: yOf(c.low), stroke: color, strokeWidth: 1 }));
        els.push(react.createElement("rect", { key: "b" + i, x: x - bodyW / 2, y: top, width: bodyW, height: bodyH, fill: color }));
      }
      const svgEl = react.createElement("svg", { className: "sk-candles", width, height, viewBox: "0 0 " + width + " " + height, style: fill ? { width: "100%", height: "100%", display: "block" } : undefined }, els);
      return fill
        ? react.createElement("div", { style: { flex: "1 1 0", minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" } }, svgEl)
        : svgEl;
    }

    // ------------------------------------------------------ 分时时间轴：按 A 股交易时段（北京时间 UTC+8）标注
    const SHANGHAI_OFFSET = 8 * 3600;
    function beijingOf(ts) {
      return new Date((Number(ts) + SHANGHAI_OFFSET) * 1000);
    }
    function fmtBeijingClock(ts) {
      const d = beijingOf(ts);
      return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
    }
    // lightweight-charts v4 tick/time formatter：无论浏览器时区，一律按北京时间显示
    function beijingTickFormatter(time, tickMarkType) {
      let ts;
      if (typeof time === "object" && time !== null) {
        ts = Date.UTC(time.year, (time.month || 1) - 1, time.day || 1) / 1000;
      } else {
        ts = Number(time);
      }
      const d = beijingOf(ts);
      const isTime = tickMarkType >= 3 || tickMarkType === "Time" || tickMarkType === "TimeWithSeconds";
      const clock = fmtBeijingClock(ts);
      if (isTime) return clock;
      return String(d.getUTCMonth() + 1) + "-" + String(d.getUTCDate()) + " " + clock;
    }

    // -------------------------------------------------------------- 分时 SVG 兜底
    function SvgMinute(props) {
      const points = props.points || [];
      const prevClose = props.prevClose;
      const width = props.width || 380;
      const height = props.height || 228;
      const dark = props.dark;
      const fill = props.fill === true;
      if (!Array.isArray(points) || points.length < 2) {
        return react.createElement("div", { className: "sk-chart-empty" }, "暂无分时数据");
      }
      const pad = 8;
      const all = points.map((pt) => pt.p).concat((typeof prevClose === "number" && Number.isFinite(prevClose)) ? [prevClose] : []);
      let min = Infinity;
      let max = -Infinity;
      for (const p of all) { if (p < min) min = p; if (p > max) max = p; }
      const span = (max - min) || 1;
      const innerW = width - pad * 2;
      const innerH = height - pad * 2;
      const xOf = (i) => pad + (i / (points.length - 1)) * innerW;
      const yOf = (v) => pad + innerH - ((v - min) / span) * innerH;
      const pricePts = points.map((pt, i) => xOf(i).toFixed(1) + "," + yOf(pt.p).toFixed(1)).join(" ");
      let cumV = 0;
      let cumA = 0;
      const avgPts = points.map((pt, i) => {
        cumV += pt.v;
        cumA += pt.p * pt.v;
        const v = cumV > 0 ? cumA / cumV : pt.p;
        return xOf(i).toFixed(1) + "," + yOf(v).toFixed(1);
      }).join(" ");
      const up = (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0)
        ? points[points.length - 1].p >= prevClose
        : true;
      const els = [];
      els.push(react.createElement("polyline", { key: "price", points: pricePts, fill: "none", stroke: up ? UP : DOWN, strokeWidth: 1.6 }));
      els.push(react.createElement("polyline", { key: "avg", points: avgPts, fill: "none", stroke: YELLOW, strokeWidth: 1 }));
      if (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0) {
        const y = yOf(prevClose);
        els.push(react.createElement("line", { key: "base", x1: pad, y1: y, x2: width - pad, y2: y, stroke: dark ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.4)", strokeWidth: 1, strokeDasharray: "4 3" }));
      }
      // 交易时段标签（北京时间）：开盘 09:30 · 午后开盘 13:00 · 收盘 15:00
      const labelFill = dark ? "rgba(255,255,255,0.5)" : "rgba(15,23,42,0.5)";
      const secOfDay = (ts) => ((ts % 86400) + 86400) % 86400;
      let gapIdx = -1;
      for (let i = 1; i < points.length; i++) {
        const step = secOfDay(points[i].t) - secOfDay(points[i - 1].t);
        if (step > 1800) { gapIdx = i; break; }
      }
      const midIdx = gapIdx > 0 ? gapIdx : Math.floor(points.length / 2);
      els.push(react.createElement("text", { key: "t0", x: 4, y: height - 6, fill: labelFill, fontSize: 9 }, fmtBeijingClock(points[0].t)));
      els.push(react.createElement("text", { key: "t1", x: xOf(midIdx) - 14, y: height - 6, fill: labelFill, fontSize: 9 }, fmtBeijingClock(points[midIdx].t)));
      els.push(react.createElement("text", { key: "t2", x: width - 34, y: height - 6, fill: labelFill, fontSize: 9 }, fmtBeijingClock(points[points.length - 1].t)));
      const svgEl = react.createElement("svg", { className: "sk-candles", width, height, viewBox: "0 0 " + width + " " + height, style: fill ? { width: "100%", height: "100%", display: "block" } : undefined }, els);
      return fill
        ? react.createElement("div", { style: { flex: "1 1 0", minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" } }, svgEl)
        : svgEl;
    }

    // 简单移动平均：按收盘价计算，返回 [{time, value}]（前 period-1 根无值，线从有值处开始）
    function computeMa(candles, period) {
      const data = [];
      let sum = 0;
      for (let i = 0; i < candles.length; i++) {
        sum += candles[i].close;
        if (i >= period) sum -= candles[i - period].close;
        if (i >= period - 1) {
          data.push({ time: candles[i].time, value: sum / period });
        }
      }
      return data;
    }

    // -------------------------------------------------------------- Lightweight Charts K线
    function LwcChart(props) {
      const lwc = props.lwc;
      const candles = props.candles || [];
      const height = props.height || 240;
      const fitKey = props.fitKey || "";
      const dark = props.dark;
      const maVisible = props.maVisible || {};
      const fill = props.fill === true;
      const chartApiRef = props.chartApiRef || null;
      const boxRef = useRef(null);
      const chartRef = useRef(null);
      const seriesRef = useRef(null);
      const volRef = useRef(null);
      const maRefs = useRef([]);
      const lastFitKey = useRef(null);
      useEffect(() => {
        if (!lwc || !boxRef.current) return undefined;
        const el = boxRef.current;
        const chart = lwc.createChart(el, {
          ...(fill ? { autoSize: true } : { width: el.clientWidth || 380, height }),
          layout: { background: { type: "solid", color: "transparent" }, textColor: dark ? "#9ca3af" : "#6b7280", fontSize: 10 },
          grid: { vertLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" }, horzLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" } },
          rightPriceScale: { borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)" },
          timeScale: { borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)" },
          crosshair: {
            mode: 0,
            vertLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
            horzLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
          },
        });
        const series = chart.addCandlestickSeries({
          upColor: UP,
          downColor: DOWN,
          borderUpColor: UP,
          borderDownColor: DOWN,
          wickUpColor: UP,
          wickDownColor: DOWN,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        const vol = chart.addHistogramSeries({
          priceScaleId: "",
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
          scaleMargins: { top: 0.82, bottom: 0 },
        });
        // MA 均线（A 股配色：MA5 白、MA10 黄、MA20 紫、MA60 绿；MA5 随主题取可读灰色）
        const MA_CONFIG = [
          { period: 5, color: maColor(5, dark) },
          { period: 10, color: maColor(10, dark) },
          { period: 20, color: maColor(20, dark) },
          { period: 60, color: maColor(60, dark) },
        ];
        maRefs.current = MA_CONFIG.map((cfg) => {
          const s = chart.addLineSeries({
            color: cfg.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            visible: !maVisible || maVisible[cfg.period] !== false,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
          });
          return { period: cfg.period, series: s };
        });
        chartRef.current = chart;
        seriesRef.current = series;
        volRef.current = vol;
        if (chartApiRef) chartApiRef.current = chart;
        return () => {
          chart.remove();
          chartRef.current = null;
          seriesRef.current = null;
          volRef.current = null;
          maRefs.current = [];
          if (chartApiRef) chartApiRef.current = null;
        };
      }, [lwc, height, dark, fill]);
      // MA 显隐切换：applyOptions({ visible })，无需重建图表
      useEffect(() => {
        for (const ma of maRefs.current) {
          ma.series.applyOptions({ visible: !maVisible || maVisible[ma.period] !== false });
        }
      }, [maVisible]);
      useEffect(() => {
        const series = seriesRef.current;
        const vol = volRef.current;
        if (!series || !vol) return;
        series.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
        vol.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(255,20,147,0.35)" : "rgba(0,255,65,0.35)" })));
        for (const ma of maRefs.current || []) {
          ma.series.setData(computeMa(candles, ma.period));
        }
        if (lastFitKey.current !== fitKey && chartRef.current) {
          lastFitKey.current = fitKey;
          chartRef.current.timeScale().fitContent();
        }
      }, [candles, lwc, fitKey]);
      return react.createElement("div", { ref: boxRef, className: "sk-chart-box", style: fill ? { width: "100%", flex: "1 1 0", minHeight: 0 } : { width: "100%", height } });
    }

    // -------------------------------------------------------------- Lightweight Charts 分时
    function MinuteChart(props) {
      const lwc = props.lwc;
      const points = props.points || [];
      const prevClose = props.prevClose;
      const height = props.height || 240;
      const dark = props.dark;
      const fitKey = props.fitKey || "";
      const fill = props.fill === true;
      const boxRef = useRef(null);
      const chartRef = useRef(null);
      const lineRef = useRef(null);
      const avgRef = useRef(null);
      const baselineRef = useRef(null);
      const lastFitKey = useRef(null);
      useEffect(() => {
        if (!lwc || !boxRef.current) return undefined;
        const el = boxRef.current;
        const chart = lwc.createChart(el, {
          ...(fill ? { autoSize: true } : { width: el.clientWidth || 380, height }),
          layout: { background: { type: "solid", color: "transparent" }, textColor: dark ? "#9ca3af" : "#6b7280", fontSize: 10 },
          grid: { vertLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" }, horzLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" } },
          rightPriceScale: { borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)" },
          timeScale: {
            borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)",
            timeVisible: true,
            secondsVisible: false,
            // v4 中 tickMarkFormatter 属于 timeScale 选项（localization 里只有 timeFormatter）
            tickMarkFormatter: (time, tickMarkType) => beijingTickFormatter(time, tickMarkType),
          },
          crosshair: {
            mode: 0,
            vertLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
            horzLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
          },
          localization: {
            timeFormatter: (time) => beijingTickFormatter(time, 3),
          },
        });
        const line = chart.addLineSeries({
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        const avg = chart.addLineSeries({
          color: YELLOW,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        chartRef.current = chart;
        lineRef.current = line;
        avgRef.current = avg;
        return () => {
          chart.remove();
          chartRef.current = null;
          lineRef.current = null;
          avgRef.current = null;
          baselineRef.current = null;
        };
      }, [lwc, height, dark, fill]);
      useEffect(() => {
        const line = lineRef.current;
        const avg = avgRef.current;
        if (!line || !avg) return;
        if (!Array.isArray(points) || points.length === 0) {
          line.setData([]);
          avg.setData([]);
          return;
        }
        line.setData(points.map((pt) => ({ time: pt.t, value: pt.p })));
        let cumV = 0;
        let cumA = 0;
        avg.setData(points.map((pt) => {
          cumV += pt.v;
          cumA += pt.p * pt.v;
          return { time: pt.t, value: cumV > 0 ? cumA / cumV : pt.p };
        }));
        const lastP = points[points.length - 1].p;
        const up = (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0)
          ? lastP >= prevClose
          : lastP >= points[0].p;
        line.applyOptions({ color: up ? UP : DOWN });
        if (lastFitKey.current !== fitKey && chartRef.current) {
          lastFitKey.current = fitKey;
          chartRef.current.timeScale().fitContent();
        }
      }, [points, prevClose, lwc, fitKey]);
      useEffect(() => {
        const line = lineRef.current;
        if (!line) return;
        if (baselineRef.current) {
          try { line.removePriceLine(baselineRef.current); } catch { /* ignore */ }
          baselineRef.current = null;
        }
        if (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0) {
          try {
            baselineRef.current = line.createPriceLine({
              price: prevClose,
              color: dark ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.4)",
              lineStyle: 2,
              lineWidth: 1,
              axisLabelVisible: true,
              title: "昨收",
            });
          } catch { /* ignore */ }
        }
      }, [prevClose, lwc, dark]);
      return react.createElement("div", { ref: boxRef, className: "sk-chart-box", style: fill ? { width: "100%", flex: "1 1 0", minHeight: 0 } : { width: "100%", height } });
    }

    // -------------------------------------------------------------- 主面板
    function WatchPanel(props) {
      // 槽位标准 props：useSessions / useWorkspaces 是 selector hook，传恒等选择器取整个快照
      // （current = 当前打开的会话 id；workspaces.items 用于让新会话沿用当前工作区）
      const sessions = (props && props.useSessions) ? props.useSessions((s) => s) : null;
      const workspaces = (props && props.useWorkspaces) ? props.useWorkspaces((s) => s) : null;
      const [expanded, setExpanded] = useState(false);
      const [groupIndex, setGroupIndex] = useState(0);
      const [view, setView] = useState(null);
      const [period, setPeriod] = useState("minute");
      const [theme, setTheme] = useState("dark");
      const [groupsCfg, setGroupsCfg] = useState(null);
      const [data, setData] = useState(null);
      const [kline, setKline] = useState(null);
      const [minute, setMinute] = useState(null);
      const [lwc, setLwc] = useState(null);
      const [error, setError] = useState(null);
      const [countdown, setCountdown] = useState(10);
      const [targetEdit, setTargetEdit] = useState(null);
      // 定时刷新要判断「此刻是否正在编辑目标价」，但闭包里拿不到最新 state → 用 ref 镜像
      const targetEditRef = useRef(null);
      useEffect(() => { targetEditRef.current = targetEdit; }, [targetEdit]);
      const [flashMsg, setFlashMsg] = useState(null);
      // 一键分析防抖：进行中禁止重复点击（避免连点创建多个会话/重复扣费）
      const [analyzing, setAnalyzing] = useState(false);
      const analyzingRef = useRef(false);
      // 胶囊悬浮扇形菜单（行情分析 / 每日复盘 / 涨停分析，功能暂未实现）
      const [fanOpen, setFanOpen] = useState(false);
      const fanOpenRef = useRef(false);
      const fanBoxRef = useRef(null);
      const gsapLibRef = useRef(null);
      const fanTimerRef = useRef(null);
      const dataRef = useRef(null);
      // 详情视图按 code 找行的索引（当前分组的行 ∪ ⚡ 信号 的跨分组行）。
      // 只查 `data.rows`（当前分组）会漏掉信号里的宏观行 —— 漏了就会把宏观标的
      // 当成股票去拉腾讯分时（宏观没有 → 「接口返回异常」+ 空图 + 目标价也读不到）。
      const rowByCodeRef = useRef(new Map());
      const flashTimerRef = useRef(null);
      const dragRef = useRef(null);
      const lastMousePosRef = useRef(null);
      const suppressClickRef = useRef(false);
      const pillRef = useRef(null);
      const pillWidthRef = useRef(PILL_W);
      // K线缩放控制：lightweight-charts timeScale 的 barSpacing 越大越放大，fitContent 还原
      const klineChartApiRef = useRef(null);
      const zoomKline = useCallback((factor) => {
        const chart = klineChartApiRef.current;
        if (!chart) return;
        try {
          const ts = chart.timeScale();
          const cur = typeof ts.options().barSpacing === "number" ? ts.options().barSpacing : 6;
          ts.applyOptions({ barSpacing: Math.min(60, Math.max(2, cur * factor)) });
        } catch { /* 图表实例暂不可用则忽略 */ }
      }, []);
      const resetKline = useCallback(() => {
        const chart = klineChartApiRef.current;
        if (!chart) return;
        try { chart.timeScale().fitContent(); } catch { /* 图表实例暂不可用则忽略 */ }
      }, []);
      const [pos, setPos] = useState(() => {
        try {
          const raw = window.localStorage.getItem(POS_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            // 越界自愈：位置若远在视口外（窗口曾更大/换屏残留），忽略并回默认右上角
            if (typeof p.x === "number" && typeof p.y === "number"
              && p.x > -200 && p.x < window.innerWidth + 200
              && p.y > -200 && p.y < window.innerHeight + 200) return p;
          }
        } catch { /* ignore */ }
        return null;
      });
      // 面板尺寸（左下/右下角拉伸，localStorage 持久化；null = 默认 400px 宽 + 内容高）
      const [size, setSize] = useState(() => {
        try {
          const raw = window.localStorage.getItem(SIZE_KEY);
          if (raw) {
            const s = JSON.parse(raw);
            if (typeof s.w === "number" && typeof s.h === "number") return s;
          }
        } catch { /* ignore */ }
        return null;
      });
      // MA 均线显隐配置（localStorage 持久化）
      const [maVisible, setMaVisible] = useState(() => {
        const def = { 5: true, 10: true, 20: true, 60: true };
        try {
          const raw = window.localStorage.getItem(MA_STORAGE_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            for (const k of MA_PERIODS) {
              if (typeof p[k] === "boolean") def[k] = p[k];
            }
          }
        } catch { /* ignore */ }
        return def;
      });
      // 添加面板状态（menu / stock / group）
      const [showAdd, setShowAdd] = useState(null);
      const [stockQuery, setStockQuery] = useState("");
      const [stockResults, setStockResults] = useState(null);
      const [groupName, setGroupName] = useState("");
      const [renameEdit, setRenameEdit] = useState(null);
      const [renameTarget, setRenameTarget] = useState(null);

      // 目标价：**stock-panel 的 stock_targets 表是唯一真理源**（与关注池、分组同一口径）。
      //
      // 此前这里是 localStorage 覆盖层，代价是两边**互盲**：
      //   /api/watchlist 不带目标价 → 面板/手机页/CLI 设的目标价，药丸一直看不见；
      //   药丸里设的又只进 localStorage → 不进 DB，**Bark 永远不会推**，/m 也看不见。
      // 现在：挂载后拉 /targets（与 /config 同节奏 60s 刷新），编辑经 host 直写 DB。
      //
      // localStorage 只剩一个用途：把旧的私货层**迁进 DB**，迁完删掉，不再留第二份真相。
      // （留着就会静默遮盖 DB —— 在手机页改过目标价，药丸里却永远显示旧值。）
      const [targets, setTargets] = useState({});

      // 临时盯盘（不入库）：localStorage 私货层 [{code,name}]，与 DB 关注池合并显示。
      // 加票时「临时盯盘」只写这里，不碰 DB；删除时按来源分流。
      const [watchonly, setWatchonly] = useState(() => {
        try {
          const raw = window.localStorage.getItem(WATCHONLY_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) return p.filter((x) => x && typeof x.code === "string");
          }
        } catch { /* ignore */ }
        return [];
      });
      useEffect(() => {
        try {
          window.localStorage.setItem(WATCHONLY_KEY, JSON.stringify(watchonly));
        } catch { /* ignore */ }
      }, [watchonly]);
      const watchonlyRef = useRef(watchonly);
      useEffect(() => { watchonlyRef.current = watchonly; }, [watchonly]);

      // 组内排序模式（default=代码序 / chgDesc=涨跌幅降序 / chgAsc=涨跌幅升序）。
      // 与目标价同类，属盯盘私货，存 localStorage。
      const [sortMode, setSortMode] = useState(() => {
        try {
          const raw = window.localStorage.getItem(SORT_KEY);
          if (raw === "chgDesc" || raw === "chgAsc" || raw === "default") return raw;
        } catch { /* ignore */ }
        return "default";
      });
      useEffect(() => {
        try { window.localStorage.setItem(SORT_KEY, sortMode); } catch { /* ignore */ }
      }, [sortMode]);

      // 「⚡ 信号」聚合视图开关：true 时列表显示所有分组触发买入/卖出的股票
      const [signalView, setSignalView] = useState(false);

      // 配置源状态（C 方案）：DB 为准 + 目标价覆盖层合并。localStorage 分组不再作为源。
      // 每次拉 /config 都重新同步（DB 增删关注 / 改分组后药丸自动跟随）。
      const [cfgSource, setCfgSource] = useState("db");
      const targetsRef = useRef(targets);
      useEffect(() => { targetsRef.current = targets; }, [targets]);
      // 标签覆盖层：/config 的 DB 标签（code → [标签]）。行渲染以服务端 rows 的 tags 为主，
      // 这里作为兜底（临时盯盘等非 DB 宿主行、旧缓存行）。
      const tagsRef = useRef({});
      useEffect(() => {
        const m = {};
        for (const g of (groupsCfg || [])) {
          for (const s of (g.symbols || [])) {
            if (Array.isArray(s.tags) && s.tags.length > 0) m[s.code] = s.tags;
          }
        }
        tagsRef.current = m;
      }, [groupsCfg]);
      // 旧私货层迁库：只迁 DB 里一条都没有的 code（DB 已有的以 DB 为准，不覆盖用户的更新）。
      // 迁完无条件删掉 localStorage —— 它不该再作为第二份真相存在。
      const migrateLegacyTargets = useCallback(async (dbMap) => {
        let local = {};
        try {
          const raw = window.localStorage.getItem(TARGETS_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") local = parsed;
          }
        } catch { /* ignore */ }
        // 更老的一版把目标价挂在 stocking.config.v1 的 symbol 上，一并收进来（否则这些值会随删键丢掉）
        try {
          const legacy = window.localStorage.getItem(STORAGE_KEY);
          if (legacy) {
            const parsed = JSON.parse(legacy);
            if (parsed && Array.isArray(parsed.groups)) {
              for (const g of parsed.groups) {
                if (!g || !Array.isArray(g.symbols)) continue;
                for (const sym of g.symbols) {
                  if (!sym || typeof sym.code !== "string") continue;
                  const t = local[sym.code] || {};
                  if (sym.buyPrice !== undefined) t.buyPrice = sym.buyPrice;
                  if (sym.sellPrice !== undefined) t.sellPrice = sym.sellPrice;
                  if (t.buyPrice !== undefined || t.sellPrice !== undefined) local[sym.code] = t;
                }
              }
            }
          }
        } catch { /* ignore */ }
        // **按侧**判断，不按整行：DB 已经有买入目标、但本地还有一条卖出目标时，
        // 只丢买入侧、卖出侧照迁（按整行判断会把这条卖出目标静默丢掉）。
        const pending = [];
        for (const [code, t] of Object.entries(local)) {
          if (!t) continue;
          const d = dbMap[code];
          const body = { code };
          if (t.buyPrice !== undefined && (!d || d.buyPrice === undefined)) body.buy_target = t.buyPrice;
          if (t.sellPrice !== undefined && (!d || d.sellPrice === undefined)) body.sell_target = t.sellPrice;
          if (body.buy_target !== undefined || body.sell_target !== undefined) pending.push(body);
        }
        for (const body of pending) {
          try {
            await fetch(BASE + "/targets", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
          } catch { /* 单条失败不阻断其余 */ }
        }
        if (pending.length > 0) {
          // 迁完立刻重拉，避免本地 map 与 DB 不一致（DB 里现在多出这几条）
          try {
            const res2 = await api("/targets");
            const raw2 = (res2 && res2.targets) || {};
            const map2 = {};
            for (const [code, t] of Object.entries(raw2)) map2[stripApiCode(code)] = targetRowOf(t);
            setTargets(map2);
          } catch { /* ignore */ }
        }
        try {
          window.localStorage.removeItem(TARGETS_KEY);
          window.localStorage.removeItem(STORAGE_KEY);
        } catch { /* ignore */ }
        if (pending.length > 0) {
          console.info("[dsh-stock-watch] 已把 " + pending.length + " 条 localStorage 目标价迁进 DB: "
            + pending.map((b) => b.code).join(", "));
        }
      }, []);

      const refreshCfg = useCallback(async () => {
        try {
          const res = await api("/config");
          const dbGroups = (res && Array.isArray(res.groups)) ? res.groups : [];
          const merged = dbGroups.map((g) => ({
            ...g,
            symbols: g.symbols.map((s) => {
              const t = targetsRef.current[stripApiCode(s.code)];
              if (!t) return s;
              const copy = { ...s };
              if (t.buyPrice !== undefined) copy.buyPrice = t.buyPrice;
              if (t.sellPrice !== undefined) copy.sellPrice = t.sellPrice;
              return copy;
            }),
          }));
          // 临时盯盘 tab：挂在最前，虚拟分组（_watchonly=true），不入 DB。
          const wo = watchonlyRef.current || [];
          const woGroup = wo.length > 0
            ? [{ name: "👁 临时盯盘", symbols: wo.map((w) => ({ code: w.code, name: w.name })), _watchonly: true }]
            : [];
          setGroupsCfg([...woGroup, ...merged]);
          setCfgSource(res && res.dbDown ? "file" : "db");
        } catch {
          // host 不可用：保留现有 groupsCfg（不破坏当前视图）
        }
      }, []);

      const refreshTargets = useCallback(async () => {
        // 正在编辑目标价时跳过这次覆盖，否则敲到一半的字会被服务端值吃掉
        if (targetEditRef.current) return;
        try {
          const res = await api("/targets");
          const raw = (res && res.targets) || {};
          const map = {};
          for (const [code, t] of Object.entries(raw)) map[stripApiCode(code)] = targetRowOf(t);
          setTargets(map);
          // 一次性迁移：把旧 localStorage 私货层里 DB 没有的目标价升库，然后删掉私货层。
          await migrateLegacyTargets(map);
          // 关键：targets 改了要重新落到 groupsCfg 上，否则详情页读的是 /quotes 返回的行，
          // 而行的 buyPrice/sellPrice 来自「发给 /quotes 的 groupsCfg」——只 setTargets 不重新合并，
          // 界面上就还是空（第一轮 refreshTargets 与 refreshCfg 谁先回来是不确定的）。
          await refreshCfg();
        } catch {
          // host/DB 不可用：保留当前值（不清空，避免整屏目标价闪没）
        }
      }, [migrateLegacyTargets, refreshCfg]);



      // 挂载 + 定时（60s）轮询 DB 配置
      useEffect(() => {
        refreshCfg();
        refreshTargets();
        const id = setInterval(() => { refreshCfg(); refreshTargets(); }, 60000);
        return () => clearInterval(id);
      }, [refreshCfg, refreshTargets]);

      const load = useCallback(async (includeMinutes) => {
        if (!groupsCfg || groupsCfg.length === 0) return;
        try {
          const res = await api(
            "/quotes",
            { group: groupIndex, minutes: includeMinutes ? 1 : 0 },
            { body: { groups: groupsCfg } },
          );
          setData(res);
          setError(null);
        } catch {
          setError("行情服务不可用");
        }
      }, [groupIndex, groupsCfg]);

      const loadDetail = useCallback(async (code, per) => {
        let refPrice = null;
        const d = dataRef.current;
        if (d && Array.isArray(d.rows)) {
          const r = d.rows.find((x) => x.code === code);
          if (r && r.live && typeof r.price === "number") refPrice = r.price;
        }
        try {
          if (per === "minute") {
            const res = await api("/minute", { code });
            setMinute(res);
          } else {
            const res = await api("/kline", { code, period: per, refPrice });
            setKline(res);
          }
        } catch {
          if (per === "minute") setMinute({ code, points: [], prevClose: null, error: "分时获取失败" });
          else setKline({ code, period: per, candles: [], error: "K线获取失败" });
        }
      }, []);

      const flash = useCallback((text, color) => {
        setFlashMsg({ text, color: color || YELLOW });
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => {
          setFlashMsg(null);
          flashTimerRef.current = null;
        }, 2600);
      }, []);

      // 通用「新开对话发送分析请求」：创建新会话 → 发送简短消息 → 跳到新对话。
      // 完整提示词由 host 端条件式系统提示注入（消息本身保持简短，不暴露完整提示词）。
      const sendAnalysis = useCallback(async (text, label) => {
        // 防抖：上一次请求未结束则忽略本次点击
        if (analyzingRef.current) return;
        const conn = (props && props.connection) || null;
        const api = (conn && conn.api) || null;
        const sessionsSvc = (props && props.sessionsService) || null;
        if (!api || !sessionsSvc) {
          flash((label || "分析") + "：会话服务不可用", YELLOW);
          return;
        }
        analyzingRef.current = true;
        setAnalyzing(true);
        try {
          // 1) 创建新会话：优先沿用当前会话所属 workspace；找不到则回退用当前会话的 cwd
          const curId = sessions ? sessions.current : undefined;
          const ws = (workspaces && Array.isArray(workspaces.items))
            ? workspaces.items.find((w) => curId && Array.isArray(w.sessionIds) && w.sessionIds.indexOf(curId) >= 0)
            : null;
          let createPayload = {};
          if (ws && ws.workspaceId) createPayload = { workspaceId: ws.workspaceId };
          else {
            const cur = (sessions && sessions.byId) ? sessions.byId[curId] : null;
            if (cur && cur.cwd) createPayload = { cwd: cur.cwd };
          }
          const created = await api.sessions.create(createPayload);
          if (!(created && created.result && created.result.ok)) throw new Error("创建新会话失败");
          const sessionId = created.result.value && created.result.value.sessionId;
          if (!sessionId) throw new Error("session.create 未返回 sessionId");
          // 2) 向新会话发送提示词（排队执行）
          const res = await api.sessions.prompt({
            sessionId,
            mode: "queue",
            content: [{ type: "text", text }],
          });
          const accepted = !!(res && res.result && res.result.ok && res.result.value && res.result.value.accepted);
          // 3) 跳到新对话；跳转失败如实提示（消息已发送，去会话列表查看）
          let opened = true;
          try { sessionsSvc.open(sessionId); } catch { opened = false; }
          if (accepted) {
            flash(opened ? "已在新对话发送「" + label + "」✓" : "「" + label + "」已发送 ✓ 未能自动跳转，请在会话列表查看", opened ? "#00ff41" : YELLOW);
          } else {
            flash("「" + label + "」请求未被接受", YELLOW);
          }
        } catch (e) {
          flash((label || "分析") + "失败：" + ((e && e.message) || "未知错误"), "#ff5252");
        } finally {
          analyzingRef.current = false;
          setAnalyzing(false);
        }
      }, [sessions, workspaces, props]);

      // 一键投资研究报告：新开对话发送「分析{公司名}（代码）」，
      // 完整技能指令（investment-research 分析 + frontend-design 生成网站）由 host 端条件式系统提示注入。
      const analyzeStock = useCallback(async () => {
        if (!view || !view.code) return;
        // 名称也走跨分组索引：从 ⚡ 信号 点进来的宏观/他组行不在当前分组的 data.rows 里，
        // 找不到就会把标题写成「分析USDJPY（USDJPY）」这种没有名字的提示词。
        const row = rowByCodeRef.current.get(view.code) || null;
        // 名称做控制字符清洗（防上游字段被污染的提示注入面），空则退回代码
        const rawName = ((row && row.name) || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
        const name = rawName || view.code;
        await sendAnalysis("分析" + name + "（" + view.code + "）", "投资研究报告");
      }, [view, data, sendAnalysis]);

      // 本地即时生效（不等 60s 轮询 / 不等网络往返）：更新 groupsCfg + data + 全局信号列表。
      // 只改目标价相关字段，分组本身仍以 DB 为准（下次 refreshCfg 会按 code 重新合并）。
      const patchLocalTarget = useCallback((code, key, price) => {
        setGroupsCfg((prev) => {
          if (!prev) return prev;
          return prev.map((g) => ({
            ...g,
            symbols: g.symbols.map((s) => {
              if (s.code !== code) return s;
              const copy = { ...s };
              if (price === undefined) delete copy[key];
              else copy[key] = price;
              return copy;
            }),
          }));
        });
        setData((d) => {
          if (!d || !Array.isArray(d.rows)) return d;
          const updateRow = (r) => {
            if (r.code !== code) return r;
            const copy = { ...r };
            if (price === undefined) delete copy[key];
            else copy[key] = price;
            copy.trigger = copy.live ? computeTrigger(copy.price, copy.buyPrice, copy.sellPrice) : "none";
            return copy;
          };
          const rows = d.rows.map(updateRow);
          // 同步全局「⚡ 信号」列表：目标价变化后立即重算该股票的触发状态，
          // 不再等下一次 /quotes 轮询（否则清空目标价后信号列表还残留旧股票）。
          const hasSignal = d.signal && Array.isArray(d.signal.buy) && Array.isArray(d.signal.sell);
          if (!hasSignal) return { ...d, rows };
          const signal = {
            buy: d.signal.buy.filter((r) => r.code !== code),
            sell: d.signal.sell.filter((r) => r.code !== code),
          };
          // 跨分组信号可能不在当前 rows 里：从原 signal 列表找该股票的行情行
          const row = rows.find((r) => r.code === code)
            || d.signal.buy.find((r) => r.code === code)
            || d.signal.sell.find((r) => r.code === code);
          if (row) {
            const updated = updateRow(row);
            if (updated.trigger === "buy") signal.buy.push(updated);
            else if (updated.trigger === "sell") signal.sell.push(updated);
          }
          return { ...d, rows, signal };
        });
      }, []);

      // 目标价写入 = **直写 DB（stock_targets，唯一真理源）**，本地先乐观更新保证点击即响应。
      // 失败必须回滚并明说 —— 静默失败会让人以为设好了，而实际上 Bark 根本没挂上。
      const applyTarget = useCallback(async (code, type, price) => {
        const key = type === "buy" ? "buyPrice" : "sellPrice";
        // code 是药丸内部带前缀的形态（sh600105）；目标价表的 key 是无前缀的（600105）。
        // 两个 key 各有各的用处：mapKey 进 targets 状态，code 用于匹配行/分组。
        const mapKey = stripApiCode(code);
        const prevTargets = targetsRef.current;
        const prevValue = (prevTargets[mapKey] || {})[key];
        // 乐观更新：药丸 UI 立刻变，不用等网络
        setTargets((prev) => {
          const t = { ...(prev[mapKey] || {}) };
          if (price === undefined) delete t[key];
          else t[key] = price;
          const out = { ...prev, [mapKey]: t };
          // 只有「价与理由全空」才算这只票没记录了（与后端 set_target 的删行口径一致）——
          // 理由是可再生的反面：手写判断，丢了不可再生，不能因为清了价就顺手抹掉。
          if (t.buyPrice === undefined && t.sellPrice === undefined
              && !t.buyReason && !t.sellReason) delete out[mapKey];
          return out;
        });
        patchLocalTarget(code, key, price);

        try {
          const body = { code };
          // undefined = 清除该项（stock-panel 的 set_target 把 null 当清除；两侧皆空即删行）
          body[type === "buy" ? "buy_target" : "sell_target"] = (price === undefined ? null : price);
          const res = await fetch(BASE + "/targets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.ok !== true) {
            throw new Error((json && json.error) || ("HTTP " + res.status));
          }
          // 以服务端回值为准（它才是权威：可能被归一化，或整行被删干净）
          const t = targetRowOf(json.target || {});
          setTargets((prev) => {
            const out = { ...prev };
            if (t.buyPrice === undefined && t.sellPrice === undefined
                && !t.buyReason && !t.sellReason) delete out[mapKey];
            else out[mapKey] = t;
            return out;
          });
          patchLocalTarget(code, key, t[key]);
          return true;
        } catch (e) {
          // 回滚到写入前，并明确告诉用户「没存上」
          setTargets(prevTargets);
          patchLocalTarget(code, key, prevValue);
          flash("✘ 目标价未存入 DB：" + (e && e.message ? e.message : "本地面板服务不可用"), "#ff5555");
          return false;
        }
      }, [flash, patchLocalTarget]);

      const commitTargetEdit = useCallback(async (type) => {
        if (!targetEdit || targetEdit.type !== type || !view) return;
        const code = view.code;
        const value = targetEdit.value;
        setTargetEdit(null);
        const label = type === "buy" ? "买入" : "卖出";
        // 成功提示由 applyTarget 决定（写 DB 失败时它会自己 flash 错误并回滚），
        // 这里**不能**先报成功 —— 否则 DB 挂了还满屏「✔ 已设置」。
        if (value.trim() === "") {
          if (await applyTarget(code, type, undefined)) {
            flash("已清除" + label + "目标价（已同步 DB）", "#888888");
          }
          return;
        }
        const price = parseFloat(value);
        if (!Number.isFinite(price) || price <= 0) {
          flash("✘ 价格无效，未保存", "#ff5555");
          return;
        }
        if (await applyTarget(code, type, price)) {
          flash("✔ 已设置" + label + "目标价 " + formatPrice(price) + "（已同步 DB·Bark 生效）");
        }
      }, [targetEdit, view, applyTarget, flash]);

      // 首次展开时预加载 Lightweight Charts
      useEffect(() => {
        if (!expanded || lwc) return undefined;
        let alive = true;
        loadLightweightCharts().then((lib) => { if (alive) setLwc(lib); });
        return () => { alive = false; };
      }, [expanded, lwc]);

      // 挂载即预加载 GSAP（胶囊悬浮扇形动画）
      useEffect(() => {
        let alive = true;
        loadGsap().then((g) => { if (alive) gsapLibRef.current = g; });
        return () => { alive = false; };
      }, []);

      // 扇形菜单开合控制（悬浮胶囊打开；移开延迟关闭，允许滑到选项上；拖动/展开时立即关闭）
      const cancelFanClose = useCallback(() => {
        if (fanTimerRef.current) { clearTimeout(fanTimerRef.current); fanTimerRef.current = null; }
      }, []);
      const openFan = useCallback(() => {
        cancelFanClose();
        setFanOpen(true);
      }, [cancelFanClose]);
      const scheduleFanClose = useCallback(() => {
        if (fanTimerRef.current) clearTimeout(fanTimerRef.current);
        fanTimerRef.current = setTimeout(() => setFanOpen(false), 380);
      }, []);
      const closeFanNow = useCallback(() => {
        cancelFanClose();
        setFanOpen(false);
      }, [cancelFanClose]);
      // 拖动/吸附结束后重置扇形归位：清除中断动画留下的冻结中间态（选项透明度/位移/盒子可见性），
      // 恢复到初始闭合状态，保证下次悬浮能正常重新展开动画。
      const resetFan = useCallback(() => {
        cancelFanClose();
        setFanOpen(false);
        fanOpenRef.current = false; // 强制下一次 effect 视为"未展开"，重新走开启动画
        const box = fanBoxRef.current;
        if (!box) return;
        const items = Array.from(box.querySelectorAll(".sk-fan-item"));
        const g = gsapLibRef.current;
        if (g && items.length) {
          g.set(items, { xPercent: -50, yPercent: -50, x: 0, y: 0, scale: 0.3, autoAlpha: 0, rotation: -8, clearProps: "left,top" });
        } else {
          for (const el of items) { el.style.opacity = "0"; }
        }
        box.style.visibility = "hidden";
        box.style.pointerEvents = "none";
      }, [cancelFanClose]);
      // 组件卸载时清理延迟关闭定时器
      useEffect(() => () => {
        if (fanTimerRef.current) clearTimeout(fanTimerRef.current);
      }, []);

      // 扇形菜单动作：新开对话发送简短关键词（完整提示词由 host 注入；closeFanNow 已在上方声明）
      const fanAction = useCallback((kind) => {
        const entry = kind === "quote"
          ? { text: "行情分析", label: "行情分析" }
          : kind === "review"
            ? { text: "每日复盘", label: "每日复盘" }
            : { text: "涨停分析", label: "涨停分析" };
        closeFanNow();
        sendAnalysis(entry.text, entry.label);
      }, [closeFanNow, sendAnalysis]);

      // 扇形选项 hover：GSAP 上浮 + 微放大（CSS 独立变换属性会被 GSAP 内联 translate:none 覆盖，故走 GSAP）
      const hoverFanItem = useCallback((el, on) => {
        const g = gsapLibRef.current;
        if (!g || !el) return;
        if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        g.to(el, { y: on ? "-=2.5" : "+=2.5", scale: on ? 1.05 : 1, duration: 0.18, ease: "power2.out", overwrite: "auto" });
      }, []);

      // 扇形菜单动画：打开时从胶囊中心扇形展开（GSAP back.out + 交错），关闭时收回
      useEffect(() => {
        if (expanded) return undefined;
        const box = fanBoxRef.current;
        if (!box) return undefined;
        const items = Array.from(box.querySelectorAll(".sk-fan-item"));
        if (items.length === 0) return undefined;
        const wasOpen = fanOpenRef.current;
        fanOpenRef.current = fanOpen;
        if (!fanOpen && !wasOpen) { box.style.visibility = "hidden"; return undefined; }
        const pill = pillRef.current;
        const pw = pill ? pill.offsetWidth : PILL_W;
        const ph = pill ? pill.offsetHeight : 30;
        const geo = fanGeometry(pos, pw, ph);
        const gsap = gsapLibRef.current;
        const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // 展开扇形区域（悬浮热区）：覆盖「胶囊朝向扇形的那条边 → 选项 + 边距」。
        // 返回区域左上角视口坐标，供选项绝对定位换算（容器已从全屏缩为区域）。
        const applyFanRegion = () => {
          const pr = pill ? pill.getBoundingClientRect() : { left: geo.cx, right: geo.cx, top: geo.cy, bottom: geo.cy };
          const M = 36, HW = 56, HH = 24; // 热区边距加大：贴边/曲线移动/短暂停顿不易出区
          let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
          for (const it of geo.items) {
            x1 = Math.min(x1, geo.cx + it.dx - HW);
            y1 = Math.min(y1, geo.cy + it.dy - HH);
            x2 = Math.max(x2, geo.cx + it.dx + HW);
            y2 = Math.max(y2, geo.cy + it.dy + HH);
          }
          const feX = geo.hDir === 1 ? pr.left : pr.right;
          const feY = geo.vDir === 1 ? pr.top : pr.bottom;
          x1 = Math.min(x1, feX) - M;
          x2 = Math.max(x2, feX) + M;
          y1 = Math.min(y1, feY) - M;
          y2 = Math.max(y2, feY) + M;
          box.style.left = x1 + "px";
          box.style.top = y1 + "px";
          box.style.width = (x2 - x1) + "px";
          box.style.height = (y2 - y1) + "px";
          box.style.pointerEvents = "auto";
          return { x1, y1 };
        };
        if (fanOpen && wasOpen) {
          // 已展开中：位置/尺寸变化时仅跟随刷新热区（不重播入场动画），避免胶囊移动后热区失配
          applyFanRegion();
          return undefined;
        }
        if (!fanOpen) {
          // 关闭：收回胶囊中心
          box.style.pointerEvents = "none";
          if (gsap && !reduceMotion) {
            const tl = gsap.timeline({ onComplete: () => { box.style.visibility = "hidden"; } });
            tl.to(items, {
              x: 0, y: 0, scale: 0.3, autoAlpha: 0, rotation: -8,
              duration: 0.22, ease: "power2.in", stagger: 0.03, overwrite: "auto",
            });
            return () => { tl.kill(); };
          }
          box.style.visibility = "hidden";
          return undefined;
        }
        // 打开：选项先叠在胶囊中心，再交错扇形展开（left/top 为相对容器的坐标）
        if (gsap && !reduceMotion) {
          box.style.visibility = "visible";
          const { x1, y1 } = applyFanRegion();
          gsap.set(items, { xPercent: -50, yPercent: -50, left: geo.cx - x1, top: geo.cy - y1, rotation: -10, scale: 0.35, autoAlpha: 0, x: 0, y: 0 });
          const tl = gsap.timeline({
            onComplete: () => {
              // 动画结束后按禁用态补一次变暗（CSS opacity 会被 GSAP 内联 opacity:1 覆盖）
              for (const el of items) {
                if (el.classList.contains("sk-fan-item-disabled")) gsap.set(el, { opacity: 0.4 });
              }
            },
          });
          geo.items.forEach((it, i) => {
            tl.to(items[i], {
              x: it.dx, y: it.dy, scale: 1, autoAlpha: 1, rotation: 0,
              duration: 0.5, ease: "back.out(1.7)",
            }, i * 0.06);
          });
          return () => { tl.kill(); };
        }
        // 兜底（无 GSAP 或用户偏好减少动态）：直接落位
        box.style.visibility = "visible";
        const origin = applyFanRegion();
        items.forEach((el, i) => {
          const it = geo.items[i] || { dx: 0, dy: 0 };
          el.style.left = (geo.cx - origin.x1) + "px";
          el.style.top = (geo.cy - origin.y1) + "px";
          el.style.transform = "translate(" + it.dx + "px, " + it.dy + "px) translate(-50%, -50%) scale(1)";
          el.style.opacity = el.classList.contains("sk-fan-item-disabled") ? "0.4" : "1";
        });
        return undefined;
      }, [fanOpen, expanded, pos]);

      // 悬浮热区：扇形打开期间，指针在胶囊或扇形区域内就不收起（含胶囊与选项之间的空隙），
      // 移出区域才延迟收拢。用全局 mousemove 包含性判断，避免「先经过区域再到胶囊」漏掉取消。
      useEffect(() => {
        if (!fanOpen || expanded) return undefined;
        const within = (x, y, r) => r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        const onMove = (e) => {
          const inPill = within(e.clientX, e.clientY, pillRef.current ? pillRef.current.getBoundingClientRect() : null);
          const inFan = within(e.clientX, e.clientY, fanBoxRef.current ? fanBoxRef.current.getBoundingClientRect() : null);
          if (inPill || inFan) cancelFanClose();
          else scheduleFanClose();
        };
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
      }, [fanOpen, expanded, cancelFanClose, scheduleFanClose]);

      // 展开：每 10s 拉行情（含分时）；折叠：每 30s 轻量拉取
      useEffect(() => {
        if (expanded) {
          setCountdown(10);
          load(true);
          const id = setInterval(() => load(true), 10000);
          return () => clearInterval(id);
        }
        return undefined;
      }, [expanded, load]);

      useEffect(() => {
        if (!expanded) {
          load(false);
          const id = setInterval(() => load(false), 30000);
          return () => clearInterval(id);
        }
        return undefined;
      }, [expanded, load]);

      // 倒计时
      useEffect(() => {
        if (!expanded) return undefined;
        const id = setInterval(() => setCountdown((c) => (c <= 1 ? 10 : c - 1)), 1000);
        return () => clearInterval(id);
      }, [expanded]);

      // 详情视图：进入 / 切周期 / 每 10s 刷新
      useEffect(() => {
        if (!expanded || !view || !view.code) return undefined;
        // 宏观标的不发腾讯请求（见上面 isMacro 的说明）—— 只是不拉图，
        // 价格仍由外层 10s 的 /quotes 轮询刷新。
        // 注意查的是**跨分组索引**：从 ⚡ 信号 点进来的宏观行不在当前分组的 data.rows 里，
        // 只看 data.rows 会 find 不到 → 当成股票去请求腾讯（必然「接口返回异常」）。
        const r = rowByCodeRef.current.get(view.code) || null;
        if (r && r.macro) return undefined;
        loadDetail(view.code, period);
        const id = setInterval(() => loadDetail(view.code, period), 10000);
        return () => clearInterval(id);
      }, [expanded, view, period, loadDetail]);

      // 配置变化时钳制分组下标
      useEffect(() => {
        if (data && Array.isArray(data.groups) && data.groups.length > 0) {
          setGroupIndex((g) => Math.min(Math.max(g, 0), data.groups.length - 1));
        }
      }, [data]);

      // —— 拖拽：窗口级 mousemove/mouseup ——
      useEffect(() => {
        const onMove = (e) => {
          lastMousePosRef.current = { x: e.clientX, y: e.clientY };
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (d.mode === "resize") {
            // 右下角：向右/下拉伸；左下角：向左/下拉伸（宽高钳制）
            const dw = d.handle === "br" ? dx : -dx;
            const w = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, d.baseW + dw));
            const h = Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, d.baseH + dy));
            setSize({ w, h });
            return;
          }
          if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          if (d.moved) {
            // 屏幕四周吸附：靠近边缘即贴边（贴边位置与半球尺寸一致，保证派生 dock 判定稳定）
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let sx = d.baseX + dx;
            let sy = d.baseY + dy;
            if (sx <= SNAP_PX) sx = 0;
            else if (sx >= vw - DOCK_W - SNAP_PX) sx = vw - DOCK_W;
            if (sy <= SNAP_PX) sy = 0;
            else if (sy >= vh - DOCK_H - SNAP_PX) sy = vh - DOCK_H;
            setPos({ x: sx, y: sy });
          }
        };
        const onUp = () => {
          const d = dragRef.current;
          dragRef.current = null;
          // 只有真正拖动过（moved）才抑制随后的 click；普通点击不抑制 → 正常展开
          if (d && d.mode === "pill" && d.moved) suppressClickRef.current = true;
          // 胶囊拖动/吸附结束：重置扇形归位（清掉被中断动画冻结的中间态）；
          // 若鼠标仍停在胶囊上，则立即重新展开，方便直接点选项（延迟到 React 提交新位置后再判断）
          if (d && d.mode === "pill") {
            resetFan();
            setTimeout(() => {
              const pr = pillRef.current ? pillRef.current.getBoundingClientRect() : null;
              const mp = lastMousePosRef.current;
              if (pr && mp && mp.x >= pr.left && mp.x <= pr.right && mp.y >= pr.top && mp.y <= pr.bottom) {
                openFan();
              }
            }, 0);
          }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
      }, []);

      // 位置变化 → 持久化
      useEffect(() => {
        if (!pos) return;
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
        } catch { /* ignore */ }
      }, [pos]);

      // 尺寸变化 → 持久化
      useEffect(() => {
        if (!size) return;
        try {
          window.localStorage.setItem(SIZE_KEY, JSON.stringify(size));
        } catch { /* ignore */ }
      }, [size]);

      // MA 显隐配置 → 持久化
      useEffect(() => {
        try {
          window.localStorage.setItem(MA_STORAGE_KEY, JSON.stringify(maVisible));
        } catch { /* ignore */ }
      }, [maVisible]);

      // 股票搜索（防抖 200ms，调 Host /stocks 全 A 股池）
      useEffect(() => {
        if (showAdd !== "stock") return undefined;
        const q = stockQuery.trim();
        if (!q) { setStockResults(null); return undefined; }
        const timer = setTimeout(async () => {
          try {
            const res = await api("/stocks", { q });
            setStockResults(res && Array.isArray(res.rows) ? res.rows : []);
          } catch {
            setStockResults([]);
          }
        }, 200);
        return () => clearTimeout(timer);
      }, [showAdd, stockQuery]);

      // C 方案：添加股票 = 直写 DB 关注池（经 host 代理 /watchlist），成功后刷新配置。
      // 分组归属由面板（DB bucket）管理，药丸为只读镜像，不再本地新增 symbol。
      // 入库关注：写 DB 关注池（register+active+bucket），经 host 代理，成功后刷新配置。
      // bucket = 当前 tab 的真实分组名；虚拟 tab（临时盯盘/未分组/全部关注）传空（进未分组）。
      const addStock = useCallback(async (code, name, bucket) => {
        const exists = (groupsCfg || []).some((g) => !g._watchonly && g.symbols.some((s) => s.code === code));
        if (exists) { flash("已在关注池：" + name, "#888888"); return; }
        try {
          const res = await fetch(BASE + "/watchlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "add", code, name: name || "", bucket: bucket || "" }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.ok !== true) {
            flash("添加失败：" + (json.error || "未知错误"), "#ff5555");
            return;
          }
          // 若之前在临时盯盘，升级为入库（从 watchonly 移除，避免重复）
          const wo = watchonlyRef.current || [];
          if (wo.some((w) => w.code === code)) setWatchonly(wo.filter((w) => w.code !== code));
          flash("✔ 已入库关注 " + name + (bucket ? "（进「" + bucket + "」）" : ""));
          setStockQuery("");
          setStockResults(null);
          setShowAdd(null); // 添加完成 → 回到股票列表
          await refreshCfg(); // 立即同步 DB（不等 60s 轮询）
        } catch {
          flash("添加失败：本地面板服务不可用", "#ff5555");
        }
      }, [groupsCfg, refreshCfg, flash]);

      // 临时盯盘：只写 localStorage（不入库、不拉行情、面板不可见）。删除时按来源分流。
      const addWatchOnly = useCallback(async (code, name) => {
        const wo = watchonlyRef.current || [];
        if (wo.some((w) => w.code === code)) { flash("已在临时盯盘：" + name, "#888888"); return; }
        const inDb = (groupsCfg || []).some((g) => !g._watchonly && g.symbols.some((s) => s.code === code));
        if (inDb) { flash("已在关注池：" + name, "#888888"); return; }
        setWatchonly([...wo, { code, name: name || code }]);
        flash("👁 已临时盯盘 " + name + "（不入库）");
        setStockQuery("");
        setStockResults(null);
        setShowAdd(null);
        await refreshCfg();
      }, [groupsCfg, refreshCfg, flash]);

      // 新建分组（bucket）：直写 DB（空分组也持久化，会在药丸显示成空 tab）。
      const addGroup = useCallback(async () => {
        const n = (groupName || "").trim();
        if (!n) { flash("请输入分组名", "#ff5555"); return; }
        try {
          const res = await fetch(BASE + "/buckets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "add", bucket: n }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.ok !== true) {
            flash("创建分组失败：" + (json.error || "未知错误"), "#ff5555");
            return;
          }
          flash("✔ 已创建分组 " + n);
          setGroupName("");
          setShowAdd(null);
          await refreshCfg();
        } catch {
          flash("创建分组失败：本地面板服务不可用", "#ff5555");
        }
      }, [groupName, refreshCfg, flash]);

      // 重命名分组（bucket）：直写 DB。虚拟 tab（临时盯盘/未分组/全部关注）不可改名。
      const commitRename = useCallback(async () => {
        const idx = renameTarget;
        const g = (idx != null && groupsCfg) ? groupsCfg[idx] : null;
        const to = (renameEdit || "").trim();
        if (idx == null || !g) { setRenameEdit(null); setRenameTarget(null); return; }
        if (g._watchonly || !g.bucket) { flash("该分组不可重命名", "#888888"); setRenameEdit(null); setRenameTarget(null); return; }
        if (!to || to === g.bucket) { setRenameEdit(null); setRenameTarget(null); return; }
        try {
          const res = await fetch(BASE + "/buckets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "rename", from: g.bucket, to }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.ok !== true) {
            flash("重命名失败：" + (json.error || "未知错误"), "#ff5555");
          } else {
            flash("✔ 已重命名为 " + to);
            await refreshCfg();
          }
        } catch {
          flash("重命名失败：本地面板服务不可用", "#ff5555");
        }
        setRenameEdit(null);
        setRenameTarget(null);
      }, [renameTarget, renameEdit, groupsCfg, refreshCfg, flash]);

      // 删除股票：按来源分流。临时盯盘→删 localStorage；关注池→取消关注（保留在库）。
      const removeStock = useCallback(async (code, name) => {
        const wo = watchonlyRef.current || [];
        if (wo.some((w) => w.code === code)) {
          setWatchonly(wo.filter((w) => w.code !== code));
          flash("已取消临时盯盘 " + name, "#888888");
          await refreshCfg();
          return;
        }
        try {
          const res = await fetch(BASE + "/watchlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "remove", code, clear_bucket: true }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.ok !== true) {
            flash("删除失败：" + (json.error || "未知错误"), "#ff5555");
            return;
          }
          setData((d) => (d && Array.isArray(d.rows)
            ? { ...d, rows: d.rows.filter((r) => r.code !== code) }
            : d));
          flash("已取消关注 " + name + "（保留在库）", "#888888");
          await refreshCfg(); // 立即同步 DB（不等 60s 轮询）
        } catch {
          flash("删除失败：本地面板服务不可用", "#ff5555");
        }
      }, [refreshCfg, flash]);

      // 删除分组（bucket）：直写 DB，组内股票回到未分组。虚拟 tab 不可删除。
      const deleteGroup = useCallback(async (idx) => {
        const g = groupsCfg && groupsCfg[idx];
        if (!g) return;
        if (g._watchonly || !g.bucket) { flash("该分组不可删除", "#888888"); return; }
        try {
          const res = await fetch(BASE + "/buckets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "delete", bucket: g.bucket }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.ok !== true) {
            flash("删除分组失败：" + (json.error || "未知错误"), "#ff5555");
            return;
          }
          flash("✔ 已删除分组 " + g.bucket + "（组内股票回到未分组）", "#888888");
          if (groupIndex >= idx && groupIndex > 0) setGroupIndex((i) => i - 1);
          await refreshCfg();
        } catch {
          flash("删除分组失败：本地面板服务不可用", "#ff5555");
        }
      }, [groupsCfg, groupIndex, refreshCfg, flash]);

      // 按住胶囊/面板头部拖动（按钮/输入框上不触发）
      const startDrag = useCallback((e, mode) => {
        if (e.button !== 0) return;
        const t = e.target;
        if (t && t.closest && t.closest("button, input, a")) return;
        // 新的交互开始：清掉上一次拖出后可能残留的点击抑制标记
        suppressClickRef.current = false;
        const base = pos || { x: window.innerWidth - PILL_W - 16, y: 14 };
        dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: base.x, baseY: base.y, moved: false, mode };
        e.preventDefault();
      }, [pos]);

      // 按住面板左下/右下角拉伸尺寸
      const startResize = useCallback((e, handle) => {
        if (e.button !== 0) return;
        const base = size || { w: 400, h: 0 };
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          baseW: base.w,
          baseH: base.h,
          moved: true,
          mode: "resize",
          handle,
        };
        e.preventDefault();
      }, [size]);

      // 面板位置：右边缘与胶囊右边缘对齐（跟随胶囊）；尺寸：拖拽拉伸后固定
      const panelStyle = (() => {
        const st = {};
        if (pos) {
          const pw = pillWidthRef.current || PILL_W;
          st.left = Math.max(8, Math.min(pos.x + pw - PANEL_W, window.innerWidth - PANEL_W - 8));
          st.top = Math.max(8, Math.min(pos.y, window.innerHeight - 320));
          st.right = "auto";
        }
        if (size) {
          st.width = size.w + "px";
          st.height = size.h + "px";
          st.maxHeight = "none"; // 固定尺寸时取消 78vh 上限，拉伸才生效
        }
        return Object.keys(st).length ? st : undefined;
      })();

      dataRef.current = data;

      const groups = (data && Array.isArray(data.groups)) ? data.groups : [];
      // 标签兜底：服务端 rows 已带 DB 标签，缺失时（旧缓存/临时盯盘）用 /config 的标签映射补齐。
      const tagOf = (code) => tagsRef.current[code];
      const withTags = (r) => {
        if (Array.isArray(r.tags) && r.tags.length > 0) return r;
        const t = tagOf(r.code);
        return t ? { ...r, tags: t } : r;
      };
      const rows = ((data && Array.isArray(data.rows)) ? data.rows : []).map(withTags);
      // 组内排序：默认保持后端代码序；chgDesc/chgAsc 按涨跌幅排序，无行情的排最后。
      const sortedRows = (sortMode === "chgDesc" || sortMode === "chgAsc")
        ? rows.slice().sort((a, b) => {
            const an = a.live && typeof a.changePercent === "number";
            const bn = b.live && typeof b.changePercent === "number";
            if (an && !bn) return -1;
            if (!an && bn) return 1;
            if (!an && !bn) return 0;
            return sortMode === "chgDesc" ? b.changePercent - a.changePercent : a.changePercent - b.changePercent;
          })
        : rows;
      const upCount = rows.filter((r) => r.live && r.changePercent > 0).length;
      const downCount = rows.filter((r) => r.live && r.changePercent < 0).length;
      // 全局信号（跨分组）：买入在前、卖出在后，字段与普通行对齐便于复用渲染
      const signalBuy = (data && data.signal && Array.isArray(data.signal.buy)) ? data.signal.buy : [];
      const signalSell = (data && data.signal && Array.isArray(data.signal.sell)) ? data.signal.sell : [];
      const signalRows = signalBuy.concat(signalSell).map(withTags);
      const signalBuyCount = signalBuy.length;
      const signalSellCount = signalSell.length;
      // 详情视图 / 研究报告要按 code 找行：**当前分组的行 ∪ ⚡ 信号 的跨分组行**。
      // ⚡ 信号 是唯一会展示别的分组（尤其 🌍 宏观）行的地方，点进去时若只在
      // 当前分组里找，就会 find 不到 → 头部名字价格是「--」、目标价读不到、
      // row.macro 也丢了（于是把宏观标的当股票去拉腾讯分时 → 「接口返回异常」）。
      // 顺序上让当前分组的行优先（它带分时分钟数据，图更全）。
      rowByCodeRef.current = (() => {
        const m = new Map();
        for (const r of signalRows) m.set(r.code, r);
        for (const r of rows) m.set(r.code, r);
        return m;
      })();
      // 有理由吗？列表行上的 ✍ 标记用。理由是手写判断，值得在列表上一眼看见
      // （否则「写过理由」这件事只有点开才知道，等于没写）。
      const hasReason = (code) => {
        const t = targets[stripApiCode(code)];
        return !!(t && (t.buyReason || t.sellReason));
      };
      const themeToggle = react.createElement("button", {
        className: "sk-icon",
        onClick: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
        title: theme === "dark" ? "切换到浅色主题" : "切换到暗色主题",
      }, theme === "dark" ? "☀️" : "🌙");
      const SORT_CYCLE = ["default", "chgDesc", "chgAsc"];
      const sortToggle = react.createElement("button", {
        className: "sk-icon" + (sortMode !== "default" ? " sk-sort-active" : ""),
        onClick: () => { const i = SORT_CYCLE.indexOf(sortMode); setSortMode(SORT_CYCLE[(i + 1) % SORT_CYCLE.length]); },
        title: sortMode === "default" ? "排序：代码序（点击→涨跌幅降序）" : sortMode === "chgDesc" ? "排序：涨跌幅降序（点击→涨跌幅升序）" : "排序：涨跌幅升序（点击→代码序）",
      }, sortMode === "default" ? "⇅" : sortMode === "chgDesc" ? "↓" : "↑");

      // 面板右下角拉伸手柄（列表页与详情页共用）
      const resizeHandles = react.createElement("div", { className: "sk-resize sk-resize-br", title: "拉伸面板", onMouseDown: (e) => startResize(e, "br") });

      // —— 折叠态：可拖动小药丸 ——
      if (!expanded) {
        const hasSignal = signalBuyCount > 0 || signalSellCount > 0;
        const signalBadge = hasSignal
          ? react.createElement("span", { className: "sk-pill-signal" },
              signalBuyCount > 0 ? react.createElement("span", { key: "b", style: { color: DOWN } }, "买" + signalBuyCount) : null,
              signalSellCount > 0 ? react.createElement("span", { key: "s", style: { color: UP } }, "卖" + signalSellCount) : null)
          : null;
        const summary = (data && rows.length > 0)
          ? react.createElement("span", { className: "sk-pill-summary" },
              react.createElement("span", { style: { color: UP } }, upCount + "↑"),
              react.createElement("span", { style: { color: DOWN } }, downCount + "↓"),
              signalBadge)
          : (hasSignal
              ? react.createElement("span", { className: "sk-pill-summary" }, signalBadge)
              : react.createElement("span", { className: "sk-pill-loading" }, error ? "⚠" : "…"));
        // 贴边吸附态：胶囊吸附到屏幕边缘后变为半球，显示涨/跌家数
        const dock = (() => {
          if (!pos) return null;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          if (pos.x <= 0) return "left";
          if (pos.x >= vw - DOCK_W - 2) return "right";
          if (pos.y <= 0) return "top";
          if (pos.y >= vh - DOCK_H - 2) return "bottom";
          return null;
        })();
        const dockBody = dock
          ? (hasSignal
              ? react.createElement("span", { className: "sk-dock-body" },
                  signalBuyCount > 0 ? react.createElement("span", { className: "sk-dock-count", style: { color: DOWN } }, "买" + signalBuyCount) : null,
                  signalSellCount > 0 ? react.createElement("span", { className: "sk-dock-count", style: { color: UP } }, "卖" + signalSellCount) : null)
              : (data && rows.length > 0
                  ? react.createElement("span", { className: "sk-dock-body" },
                      react.createElement("span", { className: "sk-dock-count", style: { color: UP } }, upCount + "↑"),
                      react.createElement("span", { className: "sk-dock-count", style: { color: DOWN } }, downCount + "↓"))
                  : react.createElement("span", { className: "sk-pill-loading" }, error ? "⚠" : "…")))
          : null;
        if (pillRef.current) pillWidthRef.current = pillRef.current.offsetWidth || PILL_W;
        const pill = react.createElement("div", {
          className: "sk-pill sk-theme-" + theme + (dock ? " sk-dock sk-dock-" + dock : ""),
          ref: pillRef,
          style: pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined,
          onMouseDown: (e) => { startDrag(e, "pill"); closeFanNow(); },
          onMouseEnter: openFan,
          onClick: () => {
            if (suppressClickRef.current) { suppressClickRef.current = false; return; }
            closeFanNow();
            setExpanded(true);
          },
        },
          dock ? dockBody : [
            react.createElement("span", { key: "t", className: "sk-pill-title" }, "📈 自选股"),
            summary,
          ]);
        // 悬浮扇形菜单（行情分析 / 每日复盘 / 涨停分析；功能暂未实现，仅展示）
        // 每日复盘时段：仅 15:00–次日 9:00 可点击（复盘需当日收盘后数据）；9:00–15:00 交易时段置灰
        const reviewState = (() => {
          const now = new Date();
          const mins = now.getHours() * 60 + now.getMinutes();
          if (mins >= 9 * 60 && mins < 15 * 60) {
            return { disabled: true, tip: "还未收盘，15:00 收盘后可查看每日复盘" };
          }
          return { disabled: false, tip: "查看每日复盘" };
        })();
        const fan = react.createElement("div", {
          className: "sk-fan sk-theme-" + theme,
          ref: fanBoxRef,
        },
          ["quote", "review", "limit"].map((k) => {
            const meta = k === "quote"
              ? { icon: "📊", label: "行情分析" }
              : k === "review"
                ? { icon: "📅", label: "每日复盘" }
                : { icon: "🚀", label: "涨停分析" };
            const reviewDisabled = k === "review" && reviewState.disabled;
            return react.createElement("button", {
              key: k,
              className: "sk-fan-item" + (reviewDisabled ? " sk-fan-item-disabled" : ""),
              title: k === "review" ? reviewState.tip : "「" + meta.label + "」点击后新开对话分析",
              onMouseEnter: (e) => { cancelFanClose(); if (!reviewDisabled) hoverFanItem(e.currentTarget, true); },
              onMouseLeave: (e) => { if (!reviewDisabled) hoverFanItem(e.currentTarget, false); },
              onClick: () => { if (reviewDisabled) return; fanAction(k); },
            },
              react.createElement("span", { className: "sk-fan-icon" }, meta.icon),
              react.createElement("span", null, meta.label));
          }));
        // 折叠态反馈 toast（建会话/发送结果提示）
        const toast = flashMsg
          ? react.createElement("div", { className: "sk-toast sk-theme-" + theme, style: { color: flashMsg.color } }, flashMsg.text)
          : null;
        return react.createElement(react.Fragment, null, pill, fan, toast);
      }

      // —— 详情视图 ——
      if (view && view.code) {
        const row = rowByCodeRef.current.get(view.code) || null;
        const isMinute = period === "minute";
        // 宏观标的（🌍 宏观 分组）不是股票：没有腾讯分时/K线可拉。
        // 这里给一块说明而不是让它去请求（请求只会等到超时，然后显示「获取失败」，
        // 看着像插件坏了）。
        const isMacro = !!(row && row.macro);
        const m = (isMinute && minute && minute.code === view.code) ? minute : null;
        const k = (!isMinute && kline && kline.code === view.code && kline.period === period) ? kline : null;
        const candles = k && Array.isArray(k.candles) ? k.candles : [];
        const _dir = pctDir(row);
        const color = _dir > 0 ? UP : (_dir < 0 ? DOWN : FLAT);
        const trig = row ? triggerMeta(row.trigger) : null;
        const dark = theme === "dark";
        const macroEl = react.createElement("div", { className: "sk-macro-note" },
          react.createElement("div", { className: "sk-macro-big" }, row && row.live ? formatPrice(row.price) : "--",
            react.createElement("span", { className: "sk-macro-unit" }, row && row.unit ? row.unit : "")),
          react.createElement("div", { className: "sk-macro-chg", style: { color } }, fmtPct(row)),
          // 口径提醒排最前：它解释的是「这个数字本身怎么读」（合约月/离岸/折算），
          // 比"数据从哪来"更该先看到 —— 也是「为什么和别处差 2%」的答案
          row && row.note
            ? react.createElement("div", { className: "sk-macro-line" }, "ⓘ " + row.note)
            : null,
          react.createElement("div", { className: "sk-macro-line" },
            "数据来自 stock-panel ",
            react.createElement("code", null, "/api/macro"),
            "（多源降级 + 合成口径）；这里不做分时/K线。"),
          row && row.stateNote
            ? react.createElement("div", { className: "sk-macro-line" }, "⚠ " + row.stateNote)
            : null,
          react.createElement("div", { className: "sk-macro-line" },
            "趋势图请看面板 🌍 宏观 tab，或手机页 /m 的「🌍 宏观」。"));
        const chartEl = isMacro ? macroEl : (isMinute
          ? (lwc
              ? react.createElement(MinuteChart, { lwc, points: m && Array.isArray(m.points) ? m.points : [], prevClose: m ? m.prevClose : null, height: 240, dark, fitKey: view.code + ":minute", fill: !!size })
              : react.createElement(SvgMinute, { points: m && Array.isArray(m.points) ? m.points : [], prevClose: m ? m.prevClose : null, width: 380, height: 228, dark, fill: !!size }))
          : (lwc
              ? react.createElement(LwcChart, { lwc, candles, height: 240, dark, fitKey: view.code + ":" + period, maVisible, fill: !!size, chartApiRef: klineChartApiRef })
              : react.createElement(SvgCandles, { candles, width: 380, height: 228, fill: !!size })));
        const footText = isMacro
          ? ((row && row.stateNote) ? row.stateNote : "宏观标的 · 无分时/K线")
          : isMinute
          ? (m === null ? "分时加载中…" : (m && m.error ? "分时：" + m.error : (m && Array.isArray(m.points) ? m.points.length + " 个分时点" : "")))
          : (k === null ? "K线加载中…" : (k && k.error ? "K线：" + k.error : (candles.length + " 根K线")));
        const targetChip = (type) => {
          const label = type === "buy" ? "买入目标" : "卖出目标";
          const key = type === "buy" ? "buyPrice" : "sellPrice";
          // 值优先读 targets 状态（/targets 的 DB 全量），row 作为兜底：
          // 「已达标记」只有 DB 那趟有（/quotes 的行不带 hit 字段），
          // 两处都读同一个源才不会出现「值变了但标记没跟上」。
          const tEntry = row ? targets[stripApiCode(row.code)] : null;
          const value = (tEntry && tEntry[key] !== undefined) ? tEntry[key] : (row ? row[key] : undefined);
          if (targetEdit && targetEdit.type === type) {
            return react.createElement("span", { className: "sk-target" },
              react.createElement("span", null, label + " "),
              react.createElement("input", {
                className: "sk-target-input",
                value: targetEdit.value,
                autoFocus: true,
                placeholder: "留空=清除",
                onFocus: (e) => e.target.select(),
                onChange: (e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) setTargetEdit({ type, value: v });
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter") commitTargetEdit(type);
                  else if (e.key === "Escape") setTargetEdit(null);
                },
                onBlur: () => commitTargetEdit(type),
              }));
          }
          // 已达标记：stock_targets 的 xxx_hit_at（Bark 推过的时间）。
          // 与手机页 `/m` 的「🎯买31.00」同一语义 —— 回答「这条目标价推过没有」。
          const hitAt = tEntry ? (type === "buy" ? tEntry.buyHitAt : tEntry.sellHitAt) : "";
          return react.createElement("button", {
            className: "sk-target sk-target-btn",
            title: "点击编辑" + label + "（回车确认，留空清除，Esc 取消）"
              + (hitAt ? "\n已达并推送过：" + hitAt + "（改价会自动重新武装）" : ""),
            onClick: () => setTargetEdit({ type, value: value !== undefined ? String(value) : "" }),
          }, label + " " + (value !== undefined ? formatPrice(value) : "-"),
             value !== undefined && hitAt
               ? react.createElement("span", { className: "sk-target-hit" }, " ✓已推")
               : null);
        };
        // 📝 理由：与目标价**同一处**（就在买入/卖出目标那一行下面）——
        // 「在哪个价动手」和「为什么在这个价动手」本来就该挨着看。
        // 数据源是同一份 stock_targets（/targets 的 60s 轮询），所以在 stock-panel 面板
        // 或手机页 /m 上写的理由，这里一分钟内自动出现；插件里只读，不给编辑入口
        // （写理由要完整键盘，面板与 /m 才是写入口）。
        // 按侧分组、时间倒序（最想看的永远是最近那次判断）。
        const whyBlock = (() => {
          const tEntry = targets[stripApiCode(view.code)] || null;
          if (!tEntry) return null;
          const lines = [];
          [["buy", "买入"], ["sell", "卖出"]].forEach((kv) => {
            const text = kv[0] === "buy" ? tEntry.buyReason : tEntry.sellReason;
            reasonLines(text).slice().reverse().forEach((entry) => {
              const p = reasonSplit(entry);
              lines.push(react.createElement("div", { className: "sk-why-line", key: kv[0] + ":" + entry },
                react.createElement("span", { className: "sk-why-k" }, kv[1] + "·"),
                p.d ? react.createElement("span", { className: "sk-why-d" }, p.d) : null,
                react.createElement("span", { className: "sk-why-t" }, p.t || entry)));
            });
          });
          if (lines.length === 0) return null;
          return react.createElement("div", {
            className: "sk-why",
            title: "买入/卖出理由（按日期累积）· 与 stock-panel 面板、手机页 /m 同一份数据",
          }, lines);
        })();
        return react.createElement("div", { className: "sk-panel sk-theme-" + theme, style: panelStyle },
          react.createElement("div", { className: "sk-detail-header", onMouseDown: (e) => startDrag(e, "panel"), title: "按住此处可拖动面板" },
            react.createElement("div", { className: "sk-detail-top" },
              react.createElement("button", { className: "sk-back", onClick: () => setView(null) }, "← 返回列表"),
              react.createElement("button", { className: "sk-analyze", onClick: () => analyzeStock(), disabled: analyzing }, analyzing ? "📈 分析中…" : "📈 投资研究报告"),
              react.createElement("button", { className: "sk-analyze", onClick: () => { if (view && view.code) window.open("http://localhost:8888/index.html#" + String(view.code).replace(/^(sh|sz|bj)/i, ""), "_blank"); }, title: "在 stock-panel 面板打开该股趋势图" }, "📊 面板趋势"),
              react.createElement("button", { className: "sk-icon", onClick: () => setExpanded(false), title: "最小化回胶囊" }, "—")),
            react.createElement("div", { className: "sk-detail-info" },
              react.createElement("span", { className: "sk-detail-name" }, row ? row.name : view.code),
              react.createElement("span", { className: "sk-detail-price", style: { color } }, row && row.live ? formatPrice(row.price) : "--"),
              react.createElement("span", { className: "sk-detail-chg", style: { color } }, fmtPct(row)),
              trig ? react.createElement("span", { className: "sk-detail-trigger", style: { color: trig.c, borderColor: trig.c } }, trig.t) : null),
            react.createElement("div", { className: "sk-detail-targets" }, targetChip("buy"), targetChip("sell")),
            whyBlock,
            flashMsg ? react.createElement("div", { className: "sk-flash", style: { color: flashMsg.color } }, flashMsg.text) : null,
            !isMacro && react.createElement("div", { className: "sk-periods" },
              ["minute", "day", "week", "month"].map((p) =>
                react.createElement("button", {
                  key: p,
                  className: "sk-period" + (p === period ? " sk-period-active" : ""),
                  onClick: () => setPeriod(p),
                }, p === "minute" ? "分时" : p === "day" ? "日K" : p === "week" ? "周K" : "月K")))),
            !isMinute && !isMacro && react.createElement("div", { className: "sk-ma-row" },
              react.createElement("span", { className: "sk-zoom" },
                react.createElement("button", { className: "sk-zoom-btn", title: "缩小K线", onClick: () => zoomKline(1 / 1.35) }, "−"),
                react.createElement("button", { className: "sk-zoom-btn", title: "放大K线", onClick: () => zoomKline(1.35) }, "+"),
                react.createElement("button", { className: "sk-zoom-btn", title: "重置K线缩放", onClick: () => resetKline() }, "重置")),
              react.createElement("span", { className: "sk-ma-chips" },
                MA_PERIODS.map((p) => {
                  const on = !!maVisible[p];
                  return react.createElement("button", {
                    key: p,
                    className: "sk-ma-chip" + (on ? "" : " sk-ma-chip-off"),
                    title: (on ? "隐藏" : "显示") + " MA" + p,
                    onClick: () => setMaVisible((v) => ({ ...v, [p]: !v[p] })),
                  },
                    react.createElement("span", { className: "sk-ma-dot", style: { background: maColor(p, dark) } }),
                    "MA" + p);
                }))),
          chartEl,
          react.createElement("div", { className: "sk-detail-foot" },
            react.createElement("span", null, footText),
            react.createElement("span", { className: "sk-right" }, themeToggle,
              react.createElement("span", { className: "sk-countdown" }, "⏱" + countdown + "s"))),
          resizeHandles);
      }

      // —— 列表视图 ——
      const header = react.createElement("div", { className: "sk-header", onMouseDown: (e) => startDrag(e, "panel"), title: "按住此处可拖动面板" },
        react.createElement("span", { className: "sk-title" }, "📈 自选股盯盘"),
        react.createElement("span", { className: "sk-tabs" },
          react.createElement("span", { key: "__signal__", className: "sk-tab-wrap" + (signalView ? " sk-tab-wrap-active" : "") },
            react.createElement("button", {
              className: "sk-tab sk-tab-signal" + (signalView ? " sk-tab-active" : ""),
              onClick: () => setSignalView(true),
              title: "信号聚合：所有分组触发买入/卖出的股票",
            }, "⚡ 信号" + (signalRows.length > 0 ? " (" + signalRows.length + ")" : ""))),
          groups.map((g, i) => {
            const gcfg = (groupsCfg && groupsCfg[i]) || {};
            const isVirtual = !!gcfg._watchonly || !gcfg.bucket; // 临时盯盘 / 未分组 / 全部关注
            const tabActive = i === groupIndex && !signalView;
            return react.createElement("span", { key: "g" + i, className: "sk-tab-wrap" + (tabActive ? " sk-tab-wrap-active" : "") },
              renameTarget === i
                ? react.createElement("input", {
                    className: "sk-rename-input",
                    value: renameEdit,
                    autoFocus: true,
                    placeholder: "分组名称…",
                    onChange: (e) => setRenameEdit(e.target.value),
                    onKeyDown: (e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") { setRenameEdit(null); setRenameTarget(null); } },
                    onBlur: () => commitRename(),
                  })
                : react.createElement("button", {
                    className: "sk-tab" + (tabActive ? " sk-tab-active" : ""),
                    onClick: () => { setSignalView(false); setGroupIndex(i); },
                    onDoubleClick: (e) => {
                      e.preventDefault();
                      if (isVirtual) { flash("该分组不可重命名", "#888888"); return; }
                      setRenameTarget(i); setRenameEdit(g.name);
                    },
                    title: isVirtual ? "该分组不可重命名" : "双击重命名「" + g.name + "」",
                  }, g.name + (g.count > 0 ? " (" + g.count + ")" : "")),
              isVirtual ? null : react.createElement("button", {
                className: "sk-tab-del",
                title: "删除分组「" + g.name + "」",
                onClick: (e) => { e.stopPropagation(); deleteGroup(i); },
              }, "✕"));
          })),
        react.createElement("span", { className: "sk-right" },
          react.createElement("span", { className: "sk-countdown" }, "⏱" + countdown + "s"),
          themeToggle,
          sortToggle,
          react.createElement("button", { className: "sk-icon", onClick: () => load(true), title: "立即刷新" }, "⟳"),
          react.createElement("button", { className: "sk-icon", onClick: () => setExpanded(false), title: "折叠" }, "—")));

      // 面板定高时列表区域 flex:1 1 0 强制填满并滚动
      const rowsFill = size ? { flex: "1 1 0", minHeight: 0 } : undefined;
      const displayRows = signalView ? signalRows : sortedRows;
      const body = displayRows.length === 0
        ? react.createElement("div", { className: "sk-empty", style: rowsFill }, error ? "行情获取失败，请稍后重试" : (signalView ? "暂无触发买入/卖出的股票" : "（当前分组为空）"))
        : react.createElement("div", { className: "sk-rows", style: rowsFill },
            displayRows.map((row) => {
              const _d = pctDir(row);
              const color = _d > 0 ? UP : (_d < 0 ? DOWN : FLAT);
              const trig = triggerMeta(row.trigger);
              const tip = row.macro
                ? ("高 " + (row.live ? formatPrice(row.high) : "-")
                   + " · 低 " + (row.live ? formatPrice(row.low) : "-")
                   + (row.unit ? " · 单位 " + row.unit : "")
                   + (row.stateNote ? " · " + row.stateNote : ""))
                : ("高 " + (row.live ? formatPrice(row.high) : "-") + " · 低 " + (row.live ? formatPrice(row.low) : "-") + " · 量 " + (row.live ? row.volume : "-"));
              return react.createElement("div", { key: row.code, className: "sk-row", onClick: () => setView({ code: row.code }), title: tip },
                react.createElement("span", { className: "sk-name" },
                  react.createElement("span", { className: "sk-name-row" },
                    react.createElement("span", { className: "sk-name-text", style: { color: row.live ? "var(--sk-text)" : FLAT } }, row.name),
                    row.macro ? null : boardChip(row.code),
                    // 写过理由就点一下：理由藏在详情里，列表上不提示等于没写
                    hasReason(row.code)
                      ? react.createElement("span", { className: "sk-why-badge", title: "写过买入/卖出理由（点开看）" }, "✍")
                      : null),
                  react.createElement("span", { className: "sk-code" },
                    row.code.replace(/^(sh|sz)/, ""),
                    tagChips(row.tags))),
                react.createElement(Sparkline, { prices: row.minutes, color }),
                react.createElement("span", { className: "sk-price", style: { color } }, row.live ? formatPrice(row.price) : "--"),
                react.createElement("span", { className: "sk-chg", style: { color } }, fmtPct(row)),
                trig
                  ? react.createElement("span", { className: "sk-trigger", style: { color: trig.c, borderColor: trig.c } }, trig.t)
                  : react.createElement("span", { className: "sk-trigger sk-trigger-none" }, "-"),
                // 宏观分组是虚拟分组（不入 DB buckets，不可删不可改名），
                // 所以它的行不给「删除」—— 点了也只能是空操作，不如不给
                row.macro
                  ? react.createElement("span", { className: "sk-del sk-del-macro", title: "宏观标的（内置分组，不可删除）" }, "")
                  : react.createElement("button", {
                      className: "sk-del",
                      title: "从列表删除 " + row.name,
                      onClick: (e) => { e.stopPropagation(); removeStock(row.code, row.name); },
                    }, "✕"));
            }));

      const footer = react.createElement("div", { className: "sk-footer" },
        react.createElement("span", { className: "sk-foot-left", title: data && data.diag && data.diag.firstError ? data.diag.firstError : "" },
          data && data.live ? "腾讯行情" : (error ? "行情获取失败" : (data ? (data.diag && data.diag.firstError ? "行情失败：" + data.diag.firstError : "无实时数据") : "—"))),
        react.createElement("span", { className: "sk-foot-mid" }, data ? "更新 " + new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : ""),
        react.createElement("span", { className: "sk-foot-right", title: "关注池来源：stock-panel DB（本地 8888）" },
          cfgSource === "db"
            ? "关注池：DB"
            : (cfgSource === "file" ? "关注池：DB（降级 settings.json）" : "关注池：本地缓存")));

      // 添加面板（菜单 / 股票搜索 / 分组创建）
      const addPanel = showAdd ? react.createElement("div", { className: "sk-add-mask" },
        react.createElement("div", { className: "sk-add-panel" },
          react.createElement("div", { className: "sk-add-head" },
            react.createElement("span", { className: "sk-add-title" },
              showAdd === "stock" ? "添加股票" : "添加分组"),
            react.createElement("button", { className: "sk-icon", onClick: () => setShowAdd(null), title: "关闭" }, "✕")),
          showAdd === "stock" && react.createElement("div", { className: "sk-add-stock" },
            react.createElement("input", {
              className: "sk-add-input",
              value: stockQuery,
              autoFocus: true,
              placeholder: "输入代码或名称搜索…",
              onChange: (e) => setStockQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === "Escape") setShowAdd(null); },
            }),
            stockResults === null
              ? react.createElement("div", { className: "sk-add-empty" }, "输入代码或名称开始搜索")
              : stockResults.length === 0
                ? react.createElement("div", { className: "sk-add-empty" }, "未找到匹配的股票")
                : react.createElement("div", { className: "sk-add-results" },
                    stockResults.map((s) => {
                      const inAny = (groupsCfg || []).some((g) => g.symbols.some((x) => x.code === s.code));
                      const inWO = (watchonly || []).some((w) => w.code === s.code);
                      const added = inAny || inWO;
                      const curG = (groupsCfg && groupsCfg[groupIndex]) || {};
                      const currentBucket = (curG._watchonly || !curG.bucket) ? "" : curG.bucket;
                      return react.createElement("div", {
                        key: s.code,
                        className: "sk-add-result" + (added ? " sk-add-result-added" : ""),
                      },
                        react.createElement("span", { className: "sk-add-result-code" }, s.code.replace(/^(sh|sz)/, "")),
                        react.createElement("span", { className: "sk-add-result-name" }, s.name),
                        boardChip(s.code),
                        added
                          ? react.createElement("span", { className: "sk-add-result-badge" }, inWO ? "盯盘中" : "已关注")
                          : [
                              react.createElement("button", { key: "in", className: "sk-add-result-act", title: "入库关注（写关注池，面板可见" + (currentBucket ? "，进「" + currentBucket + "」" : "") + "）", onClick: () => addStock(s.code, s.name, currentBucket) }, "入库"),
                              react.createElement("button", { key: "wo", className: "sk-add-result-act sk-add-result-wo", title: "临时盯盘（不入库，面板不可见）", onClick: () => addWatchOnly(s.code, s.name) }, "👁 盯盘"),
                            ]);
                    }))),
          showAdd === "group" && react.createElement("div", { className: "sk-add-group" },
            react.createElement("input", {
              className: "sk-add-input",
              value: groupName,
              autoFocus: true,
              placeholder: "分组名称…",
              onChange: (e) => setGroupName(e.target.value),
              onKeyDown: (e) => { if (e.key === "Enter") addGroup(); else if (e.key === "Escape") setShowAdd(null); },
            }),
            react.createElement("button", { className: "sk-add-confirm", onClick: addGroup }, "创建")))) : null;

      // 分组列表底部：添加股票 / 分组 按钮
      const addBar = react.createElement("div", { className: "sk-add-bar" },
        react.createElement("button", { className: "sk-add-bar-btn sk-add-bar-primary", onClick: () => setShowAdd("stock") }, "＋ 添加股票"),
        react.createElement("button", { className: "sk-add-bar-btn", onClick: () => setShowAdd("group") }, "🗂 添加分组"));

      return react.createElement("div", { className: "sk-panel sk-theme-" + theme, style: panelStyle }, header, body, addBar, footer, resizeHandles, addPanel);
    }

    // ------------------------------------------------------------------ 插件主体
    /** Required services: slots（布局挂载点）。 */
    const inject = ["slots"];

    /**
     * Client plugin body：在 shell.overlay 注册右上角盯盘弹窗。
     * @param ctx - client root context。
     */
    function apply(ctx) {
      const reactDom = require("react-dom");
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: "dsh-stock-watch",
      }, (props) => reactDom.createPortal(
        react.createElement(WatchPanel, Object.assign({}, props, {
          connection: ctx.get("connection"),
          sessionsService: ctx.get("sessions"),
        })),
        document.body
      )));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

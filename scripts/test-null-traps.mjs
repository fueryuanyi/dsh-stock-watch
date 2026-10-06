#!/usr/bin/env node
/**
 * 回归绊线：`Number(null) === 0` 这个 JS 陷阱。
 *
 * 2026-10-06 实际崩过（用户报「点一下股票，整块面板就没了」）：
 *   const chartDigits = Number.isFinite(Number(k && k.digits)) ? Number(k.digits) : 2;
 * k 为 null（刚点开股票、K线还没回来）时 `k && k.digits` = null，
 * Number(null) = 0、isFinite(0) = true → 走 true 分支 → 读 null.digits → TypeError。
 * 渲染期抛错 = React 卸载整棵子树 = 面板凭空消失（现在会被错误边界截住并显示出来）。
 *
 * 这条测试做两件事：① 运行时证明两种写法的差别；② 源码级禁止再出现这种写法。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ① 运行时：两种写法在 k = null 时的行为
const k = null;
assert.throws(
  () => { const _ = Number.isFinite(Number(k && k.digits)) ? Number(k.digits) : 2; },
  TypeError,
  "旧写法本应抛 TypeError（这条测试就是为它写的）",
);
assert.equal((k && Number.isFinite(Number(k.digits))) ? Number(k.digits) : 2, 2, "新写法应回落到默认值");
assert.equal(Number(null), 0, "陷阱的根源：Number(null) 是 0 而不是 NaN");

// ② 源码级：不允许「先 isFinite(Number(a && a.b))、再直接取 a.b」这种写法
const raw = readFileSync(new URL("../client.js", import.meta.url), "utf8");
// 注释里会引用旧写法（说明这个坑是怎么踩的），扫源码前先把整行注释去掉
const src = raw.split("\n").filter((ln) => {
  const t = ln.trim();
  return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
}).join("\n");
const bad = [...src.matchAll(/Number\.isFinite\(Number\((\w+) && \1\.(\w+)\)\)\s*\?\s*Number\(\1\.\2\)/g)];
assert.equal(
  bad.length, 0,
  "发现 Number(null) 陷阱写法：" + bad.map((m) => m[1] + "." + m[2]).join(", "),
);
assert.ok(src.includes("const chartDigits = (k && Number.isFinite(Number(k.digits)))"), "chartDigits 的空值判断必须在 isFinite 外面");

console.log("✅ 空值陷阱回归通过（point: 每次点开股票都会走这条路径）");

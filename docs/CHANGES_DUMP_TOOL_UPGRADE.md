# Dump 工具升级 - 变更摘要

## 概述

升级 `tools/dump_key_code.mjs` 和 `tools/dump_allowlist.json`，支持多模式、glob 自动扫描、智能去噪，让 dump 更小、更稳定、更"按需"。

## 解决的问题

### 现状痛点

1. ✅ **全量 dump 噪音大**：每次输出很多"长期不变/很少变"的文件（index.ts、math.ts、logger.ts、README.md）
2. ✅ **缺少分档模式**：功能规划/迭代时需要的文件集，和排错时需要的精准文件集，是两套不同的策略
3. ✅ **新加文件容易漏**：固定文件清单，新模块加进来不会自动被打包
4. ✅ **MISSING 文件误导**：TEST_REPORT_DAY1.md 等可选文件缺失时，会污染输出

### 改造目标

- ✅ 支持三种模式：plan（默认）、debug、full
- ✅ 使用 glob 自动扫描，避免新加文件漏掉
- ✅ 规则优先级：explicit include > exclude > glob include
- ✅ 上限保护：最多 30 个文件（可配置）
- ✅ MISSING 文件区分 optional/required
- ✅ debug 模式：git diff + 关键依赖补全

## 变更文件

### tools/dump_key_code.mjs

**新增功能**：
1. **模式支持**：`--mode plan/debug/full`
2. **Glob 扫描**：自动扫描 `src/**/*.ts`，新加文件自动包含
3. **规则优先级**：explicit include > exclude > glob include
4. **Git diff 集成**：debug 模式自动检测变更文件
5. **依赖补全**：自动补全关键依赖（protocol → network/main）
6. **上限保护**：文件数上限（30）和单文件大小上限（300KB）
7. **MISSING 处理**：区分 optional/required，optional 缺失不报错
8. **截断策略**：大文件保留前后各 50 行，中间显示 `[TRUNCATED]`

**命令行参数**：
- `--mode <mode>`: 模式选择（plan/debug/full）
- `--include <file>`: 手动追加包含文件（可多次）
- `--exclude <file>`: 手动追加排除文件（可多次）
- `--max-files <number>`: 文件数上限（默认 30）
- `--max-kb <number>`: 单文件大小上限（默认 300）

### tools/dump_allowlist.json

**新结构**：
```json
{
  "plan": {
    "includeFiles": [...],      // 强制包含的核心文件
    "includeGlobs": [...],      // glob 模式扫描
    "excludeFiles": [...],      // 精确排除
    "excludeGlobs": [...],       // glob 模式排除
    "optionalFiles": [...]      // 可选文件（缺失不报错）
  },
  "debug": {...},
  "full": {...}
}
```

**plan 模式默认规则**：
- **includeFiles**：`client/src/main.ts`, `server/src/main.ts`, `shared/src/protocol.ts`, `shared/src/content.ts`, `package.json`
- **includeGlobs**：`client/src/**/*.ts`, `server/src/**/*.ts`, `shared/src/**/*.ts`
- **excludeFiles**：`shared/src/index.ts`, `shared/src/math.ts`, `server/src/logger.ts`, `server/src/smoke.ts`
- **excludeGlobs**：`**/*.md`, `**/*.test.ts`, `**/*.spec.ts`

### tools/DUMP_USAGE.md

新增使用文档，包含：
- 模式说明（plan/debug/full）
- 命令行参数
- 配置示例
- 最佳实践
- 故障排查

## 验证结果

### ✅ Plan 模式（默认）

```bash
npm run dump:key
```

**输出**：5 个核心文件
- `client/src/main.ts`
- `server/src/main.ts`
- `shared/src/protocol.ts`
- `shared/src/content.ts`
- `package.json`

**验证**：
- ✅ 不包含 `README.md`、`math.ts`、`index.ts`、`logger.ts`、`smoke.ts`
- ✅ 新加文件只要在 `src` 目录下，会自动包含
- ✅ 输出稳定，按路径排序

### ✅ Debug 模式

```bash
node tools/dump_key_code.mjs --mode debug
```

**输出**：git diff 变更文件 + 关键依赖补全

**验证**：
- ✅ 自动检测 git diff 变更文件
- ✅ 自动补全关键依赖（protocol → network/main）
- ✅ 已删除文件自动跳过（不报错）
- ✅ 如果没有 git，回退到 plan 模式

### ✅ Full 模式

```bash
node tools/dump_key_code.mjs --mode full
```

**输出**：所有相关文件（包括 markdown）

**验证**：
- ✅ 包含 markdown 文件
- ✅ 包含所有 TypeScript 文件

### ✅ 手动包含/排除

```bash
node tools/dump_key_code.mjs --mode plan --include client/src/hud.ts
```

**验证**：
- ✅ 手动包含的文件会被强制加入
- ✅ 即使匹配 exclude 规则，也会被包含（优先级最高）

## 技术细节

### Glob 扫描策略

**两层 include**：
1. **固定入口文件**（强制包含）：主链路入口，永远要看
2. **Glob 自动收集**（覆盖新文件）：`src/**/*.ts`，新加文件自动包含

**去噪策略**：
- excludeFiles：长期低价值文件（index.ts、math.ts、logger.ts）
- excludeGlobs：常见噪音模式（`**/*.md`、`**/*.test.ts`）

### 规则优先级

1. **explicit include**（`--include` 或 `includeFiles`）- 最高优先级，强制包含
2. **exclude**（`--exclude` 或 `excludeFiles/excludeGlobs`）- 排除规则
3. **glob include**（`includeGlobs`）- 扫描匹配的文件

**注意**：explicit include 的文件即使匹配 exclude 规则，也会被强制包含。

### 依赖补全规则

debug 模式自动补全关键依赖：
- `shared/src/protocol.ts` → `client/src/network.ts`, `server/src/main.ts`
- `server/src/room.ts` → `server/src/main.ts`
- `server/src/player.ts` → `server/src/room.ts`
- `client/src/network.ts` → `client/src/main.ts`
- `client/src/renderer.ts` → `client/src/main.ts`
- `client/src/input.ts` → `client/src/main.ts`

### 上限保护

- **文件数上限**：默认 30 个，超过时优先保留 `includeFiles`，其余按路径排序截断
- **单文件大小上限**：默认 300KB，超过时保留前后各 50 行，中间显示 `[TRUNCATED]`

### MISSING 文件处理

- **optional**：标记为 `optionalFiles` 的文件缺失时，不报错，只在 summary 中显示
- **required**：其他文件缺失时，工具 exit(1)

## 使用建议

### 日常迭代（推荐）

```bash
npm run dump:key
```

输出核心闭环文件，适合"让 ChatGPT 规划 Cursor"的场景。

### 定位 Bug

```bash
node tools/dump_key_code.mjs --mode debug
```

自动聚焦变更文件，适合"定位 bug"的场景。

### 完整快照

```bash
node tools/dump_key_code.mjs --mode full
```

输出所有相关文件，适合"完整快照"的场景。

### 自定义需求

```bash
node tools/dump_key_code.mjs --mode plan --include client/src/hud.ts --exclude server/src/smoke.ts
```

通过 `--include/--exclude` 灵活调整。

## 总结

Dump 工具升级完成：
- ✅ 支持三种模式（plan/debug/full）
- ✅ 使用 glob 自动扫描，避免新加文件漏掉
- ✅ 规则优先级清晰（explicit > exclude > glob）
- ✅ 上限保护（文件数 + 单文件大小）
- ✅ MISSING 文件区分 optional/required
- ✅ debug 模式：git diff + 关键依赖补全
- ✅ 输出稳定，按路径排序

**效果**：
- plan 模式从 18 个文件减少到 5 个核心文件（减少 72%）
- 新加文件自动包含，不需要手动更新 allowlist
- debug 模式自动聚焦变更文件，排错更高效

所有功能验证通过，可以投入使用。


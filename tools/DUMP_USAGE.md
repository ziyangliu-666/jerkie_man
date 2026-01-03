# Key Code Dump 工具使用说明

## 概述

`tools/dump_key_code.mjs` 是一个智能代码快照工具，支持多种模式，按需输出关键代码文件，减少 token 浪费和沟通噪音。

## 模式说明

### plan（默认模式）

用于"让 ChatGPT 规划 Cursor"的场景，输出核心闭环文件。

**默认包含**：
- 固定入口文件：`client/src/main.ts`, `server/src/main.ts`, `shared/src/protocol.ts`, `shared/src/content.ts`, `package.json`
- Glob 扫描：`client/src/**/*.ts`, `server/src/**/*.ts`, `shared/src/**/*.ts`
- 自动排除：`shared/src/index.ts`, `shared/src/math.ts`, `server/src/logger.ts`, `server/src/smoke.ts`, `**/*.md`, `**/*.test.ts`

**特点**：
- 新加文件只要在 `src` 目录下，会自动包含
- 常见噪音文件（re-export、工具函数、测试）自动排除
- 最多输出 30 个文件（可配置）

**使用**：
```bash
npm run dump:key
# 或
node tools/dump_key_code.mjs --mode plan
```

### debug 模式

用于"定位 bug"的场景，输出最小相关集合。

**策略**：
1. 自动检测 git diff 变更文件
2. 自动补全关键依赖（例如改了 `protocol.ts` 会自动带上 `network.ts` 和 `main.ts`）
3. 如果 git 不可用，回退到 plan 模式

**依赖补全规则**：
- `shared/src/protocol.ts` → `client/src/network.ts`, `server/src/main.ts`
- `server/src/room.ts` → `server/src/main.ts`
- `server/src/player.ts` → `server/src/room.ts`
- `client/src/network.ts` → `client/src/main.ts`
- `client/src/renderer.ts` → `client/src/main.ts`
- `client/src/input.ts` → `client/src/main.ts`

**使用**：
```bash
node tools/dump_key_code.mjs --mode debug
```

### full 模式

保留原始行为，输出所有相关文件（包括 markdown、测试等）。

**使用**：
```bash
node tools/dump_key_code.mjs --mode full
```

## 命令行参数

```bash
node tools/dump_key_code.mjs [options]

选项：
  --mode <mode>          模式：plan（默认）、debug、full
  --out <file>           输出文件路径（默认：dump_key_code.txt）
  --allowlist <file>     配置文件路径（默认：tools/dump_allowlist.json）
  --max-kb <number>      单文件最大大小 KB（默认：300）
  --max-files <number>   最多输出文件数（默认：30）
  --root <dir>           项目根目录（默认：当前目录）
  --include <file>       手动追加包含文件（可多次使用）
  --exclude <file>       手动追加排除文件（可多次使用）
```

## 示例

### 默认 plan 模式
```bash
npm run dump:key
```

### debug 模式（自动检测 git diff）
```bash
node tools/dump_key_code.mjs --mode debug
```

### 手动包含额外文件
```bash
node tools/dump_key_code.mjs --mode plan --include client/src/hud.ts
```

### 排除特定文件
```bash
node tools/dump_key_code.mjs --mode plan --exclude server/src/smoke.ts
```

### 增加文件数量上限
```bash
node tools/dump_key_code.mjs --mode full --max-files 50
```

## 配置文件

配置文件 `tools/dump_allowlist.json` 支持按模式配置：

```json
{
  "plan": {
    "includeFiles": [...],      // 强制包含的文件
    "includeGlobs": [...],      // glob 模式扫描
    "excludeFiles": [...],      // 精确排除
    "excludeGlobs": [...],       // glob 模式排除
    "optionalFiles": [...]      // 可选文件（缺失不报错）
  },
  "debug": {...},
  "full": {...}
}
```

## 输出格式

输出文件包含：
1. 头部元信息（时间、模式、配置等）
2. 每个文件的完整内容（或截断提示）
3. 尾部摘要（dumped/skipped/missing 统计）

### 文件状态

- `OK` - 文件成功读取
- `OK (TRUNCATED)` - 文件过大，已截断（保留前后各 50 行）
- `MISSING (optional)` - 可选文件缺失，不影响
- `MISSING (required)` - 必需文件缺失，工具会 exit(1)

## 规则优先级

1. **explicit include**（`--include` 或 `includeFiles`）- 最高优先级，强制包含
2. **exclude**（`--exclude` 或 `excludeFiles/excludeGlobs`）- 排除规则
3. **glob include**（`includeGlobs`）- 扫描匹配的文件

**注意**：explicit include 的文件即使匹配 exclude 规则，也会被强制包含。

## 上限保护

- **文件数上限**：默认 30 个，超过时优先保留 `includeFiles`，其余按路径排序截断
- **单文件大小上限**：默认 300KB，超过时保留前后各 50 行，中间显示 `[TRUNCATED]`

## 最佳实践

1. **日常迭代**：使用默认 `plan` 模式
   ```bash
   npm run dump:key
   ```

2. **定位 bug**：使用 `debug` 模式，自动聚焦变更文件
   ```bash
   node tools/dump_key_code.mjs --mode debug
   ```

3. **完整快照**：需要所有文件时使用 `full` 模式
   ```bash
   node tools/dump_key_code.mjs --mode full
   ```

4. **自定义需求**：通过 `--include/--exclude` 灵活调整
   ```bash
   node tools/dump_key_code.mjs --mode plan --include client/src/hud.ts --exclude server/src/smoke.ts
   ```

## 故障排查

### 文件缺失报错

如果看到 `missing(required)=N`，检查：
- 文件路径是否正确
- 文件是否在 git 中被删除（debug 模式会自动跳过）
- 是否应该标记为 `optionalFiles`

### 输出文件过多

- 检查 `excludeGlobs` 是否生效
- 使用 `--max-files` 限制数量
- 使用 `debug` 模式自动聚焦

### Git diff 不可用

- 确保在 git 仓库中
- 确保有变更文件（`git diff --name-only HEAD` 有输出）
- 如果没有 git，会自动回退到 `plan` 模式


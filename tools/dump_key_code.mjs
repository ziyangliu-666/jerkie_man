#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
        return null;
    }
}

function safeStat(p) {
    try {
        return fs.statSync(p);
    } catch {
        return null;
    }
}

function normalizeRel(p) {
    return p.replaceAll("\\", "/");
}

// 简单的通配符匹配：支持 * 和 **
// 修复：** 应该匹配 0 个或多个路径段（包括空）
function matchPattern(pattern, filePath) {
    // 将模式转换为正则表达式
    // 处理 ** 和 * 的组合：
    // - ** 匹配 0 个或多个路径段（包括空）
    // - * 匹配单个路径段内的任意字符（不包括 /）
    // 例如：client/src/**/*.ts 应该匹配：
    //   - client/src/input.ts（** 匹配空，* 匹配 input）
    //   - client/src/subdir/file.ts（** 匹配 subdir/，* 匹配 file）
    
    let regexStr = pattern.replace(/\./g, "\\.");
    
    // 特殊处理 **/* 组合（必须在处理单独的 ** 和 * 之前）：
    // **/* 应该匹配：0 个或多个路径段 + 文件名
    // 例如：client/src/**/*.ts 应该匹配 client/src/input.ts（** 匹配空，* 匹配 input）
    // 转换：**/* -> (?:[^/]+/)*[^/]+（匹配 0 个或多个路径段 + 文件名）
    // 使用占位符避免后续替换干扰
    regexStr = regexStr.replace(/\*\*\/\*/g, "___DS_SLASH_STAR___");
    
    // 处理单独的 **（不在 **/* 组合中，匹配任意内容包括 /）
    regexStr = regexStr.replace(/\*\*/g, ".*");
    
    // 处理单独的 *（不在 **/* 组合中，匹配单个路径段）
    regexStr = regexStr.replace(/\*/g, "[^/]*");
    
    // 最后替换 **/* 组合的占位符（匹配 0 个或多个路径段 + 文件名）
    regexStr = regexStr.replace(/___DS_SLASH_STAR___/g, "(?:[^/]+/)*[^/]+");
    
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(filePath);
}

// 递归查找匹配模式的文件
function findMatchingFiles(root, pattern, excludeDirs = ["node_modules", ".git", "dist", "build"]) {
    const results = [];
    const normalizedPattern = normalizeRel(pattern);

    function walkDir(dir, relativePath = "") {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const entryName = entry.name;
                const fullPath = path.join(dir, entryName);
                const relPath = relativePath ? `${relativePath}/${entryName}` : entryName;
                const normalizedRelPath = normalizeRel(relPath);

                if (entry.isDirectory()) {
                    // 跳过排除目录
                    if (!excludeDirs.includes(entryName)) {
                        walkDir(fullPath, normalizedRelPath);
                    }
                } else if (entry.isFile()) {
                    // 检查是否匹配模式
                    if (matchPattern(normalizedPattern, normalizedRelPath)) {
                        results.push(normalizedRelPath);
                    }
                }
            }
        } catch (e) {
            // 忽略无法访问的目录
        }
    }

    walkDir(root);
    return results.sort(); // 排序保证固定顺序
}

// 检查文件是否匹配排除规则
function isExcluded(filePath, excludeFiles, excludeGlobs) {
    const normalized = normalizeRel(filePath);

    // 检查精确排除
    if (excludeFiles.some(f => normalizeRel(f) === normalized)) {
        return true;
    }

    // 检查 glob 排除
    if (excludeGlobs.some(glob => matchPattern(glob, normalized))) {
        return true;
    }

    return false;
}

// 获取 git diff 变更的文件（debug 模式）
function getGitDiffFiles(root) {
    try {
        const output = execSync("git diff --name-only HEAD", {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        });
        return output
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(normalizeRel);
    } catch (e) {
        return null; // git 不可用或不是 git 仓库
    }
}

// debug 模式：关键依赖补全规则
function getDependencyFiles(changedFiles) {
    const deps = new Set();

    for (const file of changedFiles) {
        // 如果改了 protocol，自动带上 network 和 main
        if (file.includes("shared/src/protocol.ts")) {
            deps.add("client/src/network.ts");
            deps.add("server/src/main.ts");
        }
        // 如果改了 room，自动带上 main
        if (file.includes("server/src/room.ts")) {
            deps.add("server/src/main.ts");
        }
        // 如果改了 player，自动带上 room
        if (file.includes("server/src/player.ts")) {
            deps.add("server/src/room.ts");
        }
        // 如果改了 network，自动带上 main
        if (file.includes("client/src/network.ts")) {
            deps.add("client/src/main.ts");
        }
        // 如果改了 renderer，自动带上 main
        if (file.includes("client/src/renderer.ts")) {
            deps.add("client/src/main.ts");
        }
        // 如果改了 input，自动带上 main
        if (file.includes("client/src/input.ts")) {
            deps.add("client/src/main.ts");
        }
    }

    return Array.from(deps);
}

function nowIso() {
    return new Date().toISOString();
}

function tryReadText(filePath, maxBytes) {
    const st = safeStat(filePath);
    if (!st) return { ok: false, reason: "MISSING" };
    if (!st.isFile()) return { ok: false, reason: "NOT_A_FILE" };
    if (st.size > maxBytes) {
        // 截断策略：读取前后各 50 行
        try {
            const text = fs.readFileSync(filePath, "utf8");
            const lines = text.split("\n");
            if (lines.length > 100) {
                const head = lines.slice(0, 50).join("\n");
                const tail = lines.slice(-50).join("\n");
                return {
                    ok: true,
                    text: `${head}\n\n... [TRUNCATED: ${lines.length - 100} lines] ...\n\n${tail}`,
                    truncated: true
                };
            }
            return { ok: true, text, truncated: false };
        } catch (e) {
            return { ok: false, reason: `READ_ERROR(${e?.message ?? "unknown"})` };
        }
    }

    try {
        const buf = fs.readFileSync(filePath);
        // 简单判断二进制：前 8KB 有 0x00 就跳过
        const head = buf.subarray(0, Math.min(buf.length, 8192));
        for (const b of head) {
            if (b === 0) return { ok: false, reason: "SKIP_BINARY" };
        }
        return { ok: true, text: buf.toString("utf8"), truncated: false };
    } catch (e) {
        return { ok: false, reason: `READ_ERROR(${e?.message ?? "unknown"})` };
    }
}

function parseArgs(argv) {
    const args = {
        mode: "plan",
        out: "dump_key_code.txt",
        allowlist: "tools/dump_allowlist.json",
        maxKb: 300,
        maxFiles: 30,
        root: process.cwd(),
        include: [],
        exclude: [],
    };

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--mode" && argv[i + 1]) {
            args.mode = argv[++i];
        } else if (a === "--out" && argv[i + 1]) {
            args.out = argv[++i];
        } else if (a === "--allowlist" && argv[i + 1]) {
            args.allowlist = argv[++i];
        } else if (a === "--max-kb" && argv[i + 1]) {
            args.maxKb = Number(argv[++i]);
        } else if (a === "--max-files" && argv[i + 1]) {
            args.maxFiles = Number(argv[++i]);
        } else if (a === "--root" && argv[i + 1]) {
            args.root = argv[++i];
        } else if (a === "--include" && argv[i + 1]) {
            args.include.push(normalizeRel(argv[++i]));
        } else if (a === "--exclude" && argv[i + 1]) {
            args.exclude.push(normalizeRel(argv[++i]));
        }
    }
    return args;
}

function collectFiles(args, config, root) {
    const allFiles = new Set();

    // 规则优先级：explicit include > exclude > glob include

    // 1. 先收集 explicit includes（强制包含）
    const explicitIncludes = [
        ...(config.includeFiles || []),
        ...args.include
    ].map(normalizeRel);

    for (const file of explicitIncludes) {
        allFiles.add(file);
    }

    // 2. 收集 glob includes
    const globIncludes = config.includeGlobs || [];
    for (const pattern of globIncludes) {
        const matches = findMatchingFiles(root, pattern);
        for (const match of matches) {
            allFiles.add(match);
        }
    }

    // 3. 应用 exclude 规则
    const excludeFiles = [
        ...(config.excludeFiles || []),
        ...args.exclude
    ].map(normalizeRel);
    const excludeGlobs = config.excludeGlobs || [];

    const filteredFiles = [];
    for (const file of allFiles) {
        if (!isExcluded(file, excludeFiles, excludeGlobs)) {
            filteredFiles.push(file);
        }
    }

    // 4. 最后再把 explicit includes 强制加入（防止被误排除）
    for (const file of explicitIncludes) {
        if (!filteredFiles.includes(file)) {
            filteredFiles.push(file);
        }
    }

    return filteredFiles;
}

function main() {
    const args = parseArgs(process.argv);
    const maxBytes = Math.max(1, args.maxKb) * 1024;

    const allowPath = path.resolve(args.root, args.allowlist);
    const allowConfig = readJson(allowPath);

    if (!allowConfig || typeof allowConfig !== "object") {
        console.error(`ERROR: allowlist not found or invalid JSON: ${normalizeRel(args.allowlist)}`);
        process.exit(1);
    }

    const mode = args.mode || "plan";
    const config = allowConfig[mode];

    if (!config) {
        console.error(`ERROR: mode "${mode}" not found in allowlist. Available: ${Object.keys(allowConfig).join(", ")}`);
        process.exit(1);
    }

    const lines = [];
    lines.push(`# key-code dump`);
    lines.push(`# time: ${nowIso()}`);
    lines.push(`# root: ${normalizeRel(args.root)}`);
    lines.push(`# mode: ${mode}`);
    lines.push(`# allowlist: ${normalizeRel(args.allowlist)}`);
    lines.push(`# max file size: ${maxBytes} bytes`);
    lines.push(`# max files: ${args.maxFiles}`);
    lines.push("");

    let relPaths = [];
    let fallbackReason = null;

    // debug 模式特殊处理
    if (mode === "debug") {
        const gitFiles = getGitDiffFiles(args.root);
        if (gitFiles && gitFiles.length > 0) {
            // 过滤掉不存在的文件（git diff 可能包含已删除的文件）
            const existingGitFiles = gitFiles.filter(f => {
                const abs = path.resolve(args.root, f);
                return safeStat(abs) !== null;
            });

            // 使用 git diff 的文件
            const deps = getDependencyFiles(existingGitFiles);
            relPaths = [...new Set([...existingGitFiles, ...deps])].map(normalizeRel);
            lines.push(`# debug mode: using git diff (${existingGitFiles.length} changed files + ${deps.length} dependencies, ${gitFiles.length - existingGitFiles.length} deleted files skipped)`);
        } else {
            // 回退到 plan 模式集合
            fallbackReason = "git not available or not a git repository";
            relPaths = collectFiles(args, config, args.root);
            lines.push(`# debug mode: fallback to plan mode (${fallbackReason})`);
        }
    } else {
        // plan 或 full 模式
        relPaths = collectFiles(args, config, args.root);
    }

    // 上限保护：最多保留 maxFiles 个文件
    const originalCount = relPaths.length;
    if (relPaths.length > args.maxFiles) {
        // 优先保留 includeFiles
        const includeFiles = (config.includeFiles || []).map(normalizeRel);
        const priorityFiles = new Set(includeFiles);
        const otherFiles = relPaths.filter(f => !priorityFiles.has(f));

        // 保留所有 includeFiles + 其他文件的前 N 个（按路径排序）
        const kept = [...includeFiles.filter(f => relPaths.includes(f)), ...otherFiles]
            .slice(0, args.maxFiles);
        relPaths = kept;
        lines.push(`# WARNING: truncated from ${originalCount} to ${args.maxFiles} files (kept ${includeFiles.length} priority files)`);
    }

    // 排序（固定顺序）
    relPaths.sort();

    const optionalFiles = new Set((config.optionalFiles || []).map(normalizeRel));
    let dumped = 0;
    let skipped = 0;
    let missingOptional = 0;
    let missingRequired = 0;
    let truncated = 0;

    for (const rel of relPaths) {
        const abs = path.resolve(args.root, rel);
        const got = tryReadText(abs, maxBytes);

        lines.push("=".repeat(90));
        lines.push(`FILE: ${rel}`);

        if (!got.ok) {
            const isOptional = optionalFiles.has(rel);
            if (isOptional) {
                lines.push(`STATUS: ${got.reason} (optional)`);
                missingOptional++;
            } else {
                lines.push(`STATUS: ${got.reason} (required)`);
                missingRequired++;
            }
            lines.push("");
            skipped++;
            continue;
        }

        lines.push(`STATUS: OK${got.truncated ? " (TRUNCATED)" : ""}`);
        if (got.truncated) truncated++;
        lines.push("-".repeat(90));
        lines.push(got.text.replace(/\r\n/g, "\n"));
        if (!got.text.endsWith("\n")) lines.push("");
        lines.push("");
        dumped++;
    }

    // Summary
    lines.push("=".repeat(90));
    lines.push("# SUMMARY");
    lines.push(`# dumped: ${dumped} files`);
    lines.push(`# skipped: ${skipped} files`);
    lines.push(`# missing (optional): ${missingOptional} files`);
    lines.push(`# missing (required): ${missingRequired} files`);
    if (truncated > 0) {
        lines.push(`# truncated: ${truncated} files`);
    }
    if (fallbackReason) {
        lines.push(`# fallback: ${fallbackReason}`);
    }
    if (originalCount > args.maxFiles) {
        lines.push(`# total collected: ${originalCount} files (limited to ${args.maxFiles})`);
    }

    const outPath = path.resolve(args.root, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join("\n"), "utf8");

    const summary = `dumped=${dumped} skipped=${skipped} missing(optional)=${missingOptional} missing(required)=${missingRequired}`;
    console.log(`OK: wrote ${normalizeRel(path.relative(args.root, outPath))} (${summary})`);

    // 如果有 required 文件缺失，退出码为 1
    if (missingRequired > 0) {
        process.exit(1);
    }
}

main();

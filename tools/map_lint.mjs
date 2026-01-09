#!/usr/bin/env node
/**
 * Map Linter CLI Tool
 * 
 * 用法:
 *   node tools/map_lint.mjs <map_file>           # 检测单个地图
 *   node tools/map_lint.mjs --all                # 检测所有地图
 *   node tools/map_lint.mjs --json <map_file>    # 输出 JSON 格式
 * 
 * 退出码:
 *   0 - 无错误（可能有警告）
 *   1 - 存在错误
 *   2 - 文件不存在或解析失败
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 动态导入编译后的 shared 模块
async function loadShared() {
    try {
        const shared = await import('../shared/dist/index.js');
        return shared;
    } catch (e) {
        console.error('❌ 无法加载 shared 模块，请先运行: npm run build --workspace=shared');
        console.error('   错误详情:', e.message);
        process.exit(2);
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
Map Linter - 地图检测工具

用法:
  npm run map:lint <map_file>           检测单个地图文件
  npm run map:lint --all                检测 shared/maps 下所有地图
  npm run map:lint --json <map_file>    输出 JSON 格式结果

示例:
  npm run map:lint shared/maps/elite_compound.map.txt
  npm run map:lint --all
  npm run map:lint --json shared/maps/example1.map.txt

检测规则:
  [ERROR] 障碍物越界
  [ERROR] 出生点被固体障碍物覆盖
  [ERROR] 撤离点被严重覆盖 (>30%)
  [ERROR] 房间组封闭无外部入口
  [WARN]  障碍物之间重叠
  [WARN]  撤离点被轻微覆盖
  [WARN]  草丛位于室内
  [WARN]  宝箱与墙壁重叠
  [WARN]  门口被堵

退出码:
  0 - 无错误（可能有警告）
  1 - 存在错误
  2 - 文件不存在或解析失败
`);
        process.exit(0);
    }

    const shared = await loadShared();
    const { parseMapTemplateTextWithRoomGroups, lintMap, formatLintResult } = shared;

    const jsonOutput = args.includes('--json');
    const lintAll = args.includes('--all');

    // 获取要检测的文件列表
    let files = [];

    if (lintAll) {
        const mapsDir = join(__dirname, '..', 'shared', 'maps');
        try {
            const allFiles = readdirSync(mapsDir);
            files = allFiles
                .filter(f => f.endsWith('.map.txt'))
                .map(f => join(mapsDir, f));
        } catch (e) {
            console.error('❌ 无法读取 shared/maps 目录:', e.message);
            process.exit(2);
        }
    } else {
        // 过滤掉选项参数
        files = args.filter(a => !a.startsWith('--'));
    }

    if (files.length === 0) {
        console.error('❌ 未指定地图文件');
        process.exit(2);
    }

    let totalErrors = 0;
    let totalWarnings = 0;
    const allResults = [];

    for (const file of files) {
        let content;
        try {
            content = readFileSync(file, 'utf-8');
        } catch (e) {
            console.error(`❌ 无法读取文件: ${file}`);
            console.error('   错误:', e.message);
            process.exit(2);
        }

        let template;
        let roomGroups;
        try {
            const parsed = parseMapTemplateTextWithRoomGroups(content);
            template = parsed.template;
            roomGroups = parsed.roomGroups;
        } catch (e) {
            console.error(`❌ 解析失败: ${file}`);
            console.error('   错误:', e.message);
            process.exit(2);
        }

        // 使用完整的 roomGroups 信息进行检测
        const result = lintMap(template, roomGroups);

        allResults.push({
            file: basename(file),
            path: file,
            result,
        });

        totalErrors += result.summary.errorCount;
        totalWarnings += result.summary.warningCount;
    }

    // 输出结果
    if (jsonOutput) {
        console.log(JSON.stringify(allResults, null, 2));
    } else {
        for (const { file, result } of allResults) {
            if (files.length > 1) {
                console.log(`\n📁 ${file}`);
            }
            console.log(formatLintResult(result));
        }

        // 汇总
        if (files.length > 1) {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📊 汇总: ${files.length} 个地图, ${totalErrors} 个错误, ${totalWarnings} 个警告`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }
    }

    // 设置退出码
    process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('❌ 未知错误:', e);
    process.exit(2);
});

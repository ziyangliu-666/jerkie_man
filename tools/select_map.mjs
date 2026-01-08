import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = path.resolve(__dirname, '..', 'shared', 'maps');

function getMaps() {
    if (!fs.existsSync(MAPS_DIR)) return [];
    const files = fs.readdirSync(MAPS_DIR)
        .filter(file => file.endsWith('.map.txt') || file.endsWith('.map'));

    const maps = [];
    for (const file of files) {
        const filePath = path.join(MAPS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        let id = null;
        let name = null;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('@meta')) {
                const idMatch = trimmed.match(/id=([^\s]+)/);
                if (idMatch) id = idMatch[1];

                const nameMatch = trimmed.match(/name="([^"]+)"/) || trimmed.match(/name=([^\s]+)/);
                if (nameMatch) name = nameMatch[1];

                if (id) break;
            }
        }

        if (!id || id === 'default') {
            id = file.replace(/\.map\.txt$/, '').replace(/\.map$/, '');
        }
        maps.push({ id, name: name || id });
    }
    return maps;
}

async function selectMap() {
    const maps = [{ id: 'random', name: 'Random Generation' }, ...getMaps()];

    console.log('\n--- Map Selection ---');
    maps.forEach((map, index) => {
        console.log(`${index}: ${map.name} (${map.id})`);
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('\nSelect a map by number (default 0): ', (answer) => {
            rl.close();
            const index = parseInt(answer, 10);
            if (isNaN(index) || index < 0 || index >= maps.length) {
                resolve(maps[0].id);
            } else {
                resolve(maps[index].id);
            }
        });
    });
}

const commandToRun = process.argv[2];

if (!commandToRun) {
    console.error('Usage: node select_map.mjs <npm-script>');
    process.exit(1);
}

// If MAP_TEMPLATE is already set, skip the selection prompt
let selectedMap = process.env.MAP_TEMPLATE;

if (!selectedMap) {
    selectedMap = await selectMap();
    console.log(`Starting ${commandToRun} with map: ${selectedMap}\n`);
} else {
    console.log(`Starting ${commandToRun} with predefined map: ${selectedMap}\n`);
}

const env = { ...process.env };
if (selectedMap && selectedMap !== 'random') {
    env.MAP_TEMPLATE = selectedMap;
}

const npx = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npx, ['run', commandToRun], {
    env,
    stdio: 'inherit',
    shell: true
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});

// 把 tests/fixtures/sessions 下的会话 fixture 播种进 scratch home：
// 解出 header 帧 → 改写 cwd 为本次 scratch 工作区路径 → 按 dsh 的写盘方式
// 重压缩（带 checksum）→ 与其余帧拼接 → 写到 header id/cwd 对应的
// `$DSH_HOME/sessions/<projectKey>/<id>/session.jsonl.zstd`。
//
// 用法：node scripts/plant-fixtures.mjs <fixturesDir> <sessionsRoot> <cwd>
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

const [fixturesDir, sessionsRoot, cwd] = process.argv.slice(2);
if (!fixturesDir || !sessionsRoot || !cwd) {
	throw new Error('usage: node scripts/plant-fixtures.mjs <fixturesDir> <sessionsRoot> <cwd>');
}

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** dsh-session-persistence-jsonl 的 projectKey：分隔符折叠为单个 '-'，其余不安全字符 ~XXXX。 */
function projectKey(path) {
	let readable = '';
	let separatorRun = false;
	for (const ch of path) {
		if (ch === '/' || ch === '\\' || ch === ':') {
			if (!separatorRun) readable += '-';
			separatorRun = true;
		} else if (/^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/** 拆出独立压缩的 zstd 帧偏移（fixture 由 dsh 自身写出，每帧一事件）。 */
function frameOffsets(buffer) {
	const offsets = [];
	let i = 0;
	while ((i = buffer.indexOf(MAGIC, i)) !== -1) { offsets.push(i); i += 1; }
	if (offsets.length === 0) throw new Error('fixture has no zstd frame');
	return offsets;
}

let planted = 0;
for (const entry of readdirSync(fixturesDir)) {
	const dir = join(fixturesDir, entry);
	if (!statSync(dir).isDirectory()) continue;
	const source = join(dir, 'session.jsonl.zstd');
	const buffer = readFileSync(source);
	const offsets = frameOffsets(buffer);

	// 第一帧 = header（独立可解码、以 \n 结尾）。
	const header = JSON.parse(zstdDecompressSync(buffer.subarray(offsets[0], offsets[1])).toString('utf8').trim());
	header.cwd = cwd;
	const headerFrame = zstdCompressSync(
		Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'),
		{ params: { [constants.ZSTD_c_checksumFlag]: 1 } },
	);
	const targetDir = join(sessionsRoot, projectKey(cwd), header.id);
	mkdirSync(targetDir, { recursive: true });
	writeFileSync(join(targetDir, 'session.jsonl.zstd'), Buffer.concat([headerFrame, buffer.subarray(offsets[1])]));
	console.log(`planted ${header.id} -> ${join(targetDir, 'session.jsonl.zstd')}`);
	planted += 1;
}
if (planted === 0) throw new Error(`no session fixtures found under ${fixturesDir}`);

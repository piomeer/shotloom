import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { requiredResources, ID, NAME, inside } from './candidate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'release/batch09');
const app = join(output, 'win-unpacked');
const helper = join(root, '.github/shotloom-electron-test');
const require = createRequire(join(root, 'package.json'));
function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function list(directory, base = directory) {
  const files = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('Unexpected packaged link: ' + path);
    if (item.isDirectory()) files.push(...list(path, base));
    else files.push(relative(base, path).replaceAll('\\', '/'));
  }
  return files.sort();
}
for (const file of requiredResources()) if (!existsSync(join(app, file)) || !statSync(join(app, file)).isFile()) throw new Error('Missing resource: ' + file);
const asar = require('@electron/asar');
const archive = join(app, 'resources/app.asar');
const entries = asar.listPackage(archive).map(p => p.replaceAll('\\', '/').replace(/^\/+/, ''));
for (const item of ['dist/electron/main.cjs', 'dist/electron/preload.cjs', 'dist/electron/native-menu.json', 'dist/renderer/index.html', 'dist/renderer/openreel/embedded-runtime.js', 'dist/renderer/director-desk-app/index.html']) if (!entries.includes(item)) throw new Error('Missing ASAR resource: ' + item);
if (!entries.some(p => p.startsWith('dist/renderer/openreel/assets/') && p.endsWith('.wasm')) || !entries.some(p => p.startsWith('dist/renderer/assets/') && p.endsWith('.js'))) throw new Error('Missing WASM or frontend asset');
const packageInfo = JSON.parse(asar.extractFile(archive, 'package.json'));
if (packageInfo.name !== 'shotloom-local-test' || packageInfo.productName !== NAME) throw new Error('Wrong candidate package identity');
const main = asar.extractFile(archive, 'dist/electron/main.cjs').toString();
if (!main.includes(ID) || !main.includes('Candidate runtime is not authorized') || main.includes('autoUpdater.checkForUpdates') || main.includes('quitAndInstall')) throw new Error('Candidate isolation/updater bundle check failed');
if (existsSync(join(app, 'resources/app-update.yml'))) throw new Error('Unexpected updater metadata');
const pluginsDir = join(app, 'resources/resources/provider-plugins');
const plugins = JSON.parse(readFileSync(join(pluginsDir, 'index.json'), 'utf8')).plugins;
if (!Array.isArray(plugins) || plugins.length === 0) throw new Error('Missing default plugin packages');
for (const plugin of plugins) {
  const path = resolve(pluginsDir, plugin.file);
  if (!inside(pluginsDir, path) || hash(path) !== plugin.sha256) throw new Error('Invalid plugin resource digest');
}
const host = join(app, 'resources/resources/agent-host');
const sourceHost = join(root, 'electron/resources/agent-host');
const sourceList = list(sourceHost);
const copiedList = list(host);
if (JSON.stringify(sourceList) !== JSON.stringify(copiedList)) throw new Error('Host resource closure differs');
for (const file of sourceList) if (hash(join(sourceHost, file)) !== hash(join(host, file))) throw new Error('Host copied resource mismatch: ' + file);
const runtime = JSON.parse(readFileSync(join(host, 'runtime.json'), 'utf8'));
if (runtime.node !== 'v22.19.0' || runtime.platform !== 'win32' || runtime.arch !== 'x64') throw new Error('Wrong bundled Node runtime');
const native = spawnSync(join(host, 'node.exe'), ['-e', "const DB=require('better-sqlite3');const db=new DB(':memory:');if(db.prepare('select 1 as value').get().value!==1)throw Error('SQLite native check');db.close();console.log('better-sqlite3 native memory database passed');for(const n of ['node-pty','koffi']){require(n);console.log(n+' loaded');}"], { cwd: host, encoding: 'utf8', timeout: 30000, windowsHide: true });
if (native.status !== 0) throw new Error('Bundled native loader check failed: ' + native.stderr);
const ffmpeg = spawnSync(join(app, 'resources/ffmpeg.exe'), ['-version'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
if (ffmpeg.status !== 0 || !ffmpeg.stdout.startsWith('ffmpeg version')) throw new Error('FFmpeg resource cannot execute');
mkdirSync(output, { recursive: true });
copyFileSync(join(helper, 'launch-candidate.ps1'), join(output, 'Start-Shotloom-Local-Test.ps1'));
writeFileSync(join(output, 'candidate-policy.json'), JSON.stringify({ applicationId: ID, localRunAuthorized: false, binaryDistributionAuthorized: false }, null, 2));
const files = list(app).map(file => ({ file: 'win-unpacked/' + file, bytes: statSync(join(app, file)).size, sha256: hash(join(app, file)) }));
writeFileSync(join(output, 'candidate-manifest.json'), JSON.stringify({ commit: process.env.GITHUB_SHA, applicationId: ID, productName: NAME, node: process.version, runtime, files, bytes: files.reduce((n, f) => n + f.bytes, 0), hostFiles: sourceList.length, plugins: plugins.length, candidateExecuted: false, nativeModulesLoaded: true, ffmpegVersionChecked: true, localRunAuthorized: false, uploaded: false }, null, 2));
console.log(JSON.stringify({ closure: 'PASS', candidateExecuted: false, fileCount: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), manifestSha256: hash(join(output, 'candidate-manifest.json')), nativeCheck: native.stdout, uploaded: false }));

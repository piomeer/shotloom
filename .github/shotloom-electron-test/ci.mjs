import { spawn, spawnSync } from 'node:child_process';
import { cpus, totalmem, freemem } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireApproval, parseTestSummary, executionModes, assertStageAllowed, assertValidationResults, BUILD_STAGES, VALIDATION_STAGES } from './candidate.mjs';
import { createHash } from 'node:crypto';
import { measureWorkspace, assertMeasurement, cacheEnvironment, assertCacheEnvironment, prepareTextEvidence, readEvidenceFile } from './audit-tools.mjs';
import { verifyFfmpegFile } from './controlled-deps.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = join(root, 'tmp/batch09');
const policy = JSON.parse(readFileSync(join(root, '.github/shotloom-electron-test/policy.json'), 'utf8'));
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function measurement() {
  return measureWorkspace(root, process.env.GITHUB_ACTIONS === 'true' ? [process.env.RUNNER_TOOL_CACHE] : []);
}
function assertLocks() {
  for (const [file, expected] of Object.entries(policy.lockSha256)) if (createHash('sha256').update(readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n')).digest('hex') !== expected) throw new Error('Lock drift: ' + file);
}
function context() { return { repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME }; }
function assertRunner() {
  requireApproval(policy, context());
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== '22.19.0' || readFileSync(join(root, '.node-version'), 'utf8').trim() !== '22.19.0') throw new Error('Wrong Windows/Node target');
  assertLocks();
  assertCacheEnvironment(root, process.env);
}
function check(additional = 0) {
  const m = measurement();
  assertMeasurement(m, policy, additional);
  return m;
}
const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const command = process.argv[2];
mkdirSync(scratch, { recursive: true });
function results() { return readdirSync(scratch).filter(n => n.endsWith('.result.json')).map(n => JSON.parse(readFileSync(join(scratch, n), 'utf8'))); }
try {
if (command === 'summary') {
  const records = results();
  console.log(JSON.stringify({ results: records, fullBuildApproved: policy.fullBuildApproved, buildStagesSkippedByPolicy: policy.fullBuildApproved !== true, textEvidenceUploadApproved: policy.textEvidenceUploadApproved === true, binaryUploaded: false, candidateLaunched: false }, null, 2));
  const summary = join(root, 'release/batch09/candidate-summary.json');
  if (existsSync(summary)) console.log('CANDIDATE_SUMMARY_JSON=' + readEvidenceFile(root, summary).replaceAll('\n', ''));
} else if (command === 'authorize') {
  console.log(JSON.stringify({ cpu: cpus().length, ramBytes: totalmem(), freeRamBytes: freemem(), node: process.version, versions: process.versions, disk: measurement() }, null, 2));
  assertRunner();
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', policy.upstreamBase, 'HEAD'], { cwd: root });
  if (ancestor.status !== 0) throw new Error('Unexpected source ancestry');
  for (const [file, expected] of Object.entries(policy.sourceSha256)) {
    const actual = createHash('sha256').update(readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n')).digest('hex');
    if (actual !== expected) throw new Error('Source drift: ' + file);
  }
  const modes = executionModes(policy);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'build=' + modes.build + '\n' + 'text=' + (modes.build && policy.textEvidenceUploadApproved === true) + '\n');
  console.log('Cloud validation approved; full build mode=' + modes.build);
} else if (command === 'evidence') {
  assertRunner();
  assertStageAllowed(policy, 'resources');
  assertValidationResults(results(), process.env.GITHUB_SHA);
  const completed = results().find(r => r.stage === 'resources');
  if (!completed?.pass || completed.commit !== process.env.GITHUB_SHA) throw new Error('Missing current resource evidence');
  console.log(JSON.stringify({ textEvidence: prepareTextEvidence(root, policy).map(p => p.slice(root.length + 1)), binaryUploaded: false }));
} else {
  requireApproval(policy, context());
  assertStageAllowed(policy, command);
  assertRunner();
  if (BUILD_STAGES.includes(command)) assertValidationResults(results(), process.env.GITHUB_SHA);
  const tasks = {
    'root-deps': { args: [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], extra: 2 },
    focused: { args: ['--test', 'tests/electron-recovery.test.mjs'], extra: 0.25, counts: { tests: 22, pass: 22, fail: 0, skipped: 0 } },
    typecheck: { args: [npm, 'run', 'typecheck:electron'], extra: 0.25 },
    related: { args: ['--test', 'tests/runtime-reliability.test.mjs', 'tests/electron-runtime-boundaries.test.mjs', 'tests/electron-storage-orm.test.mjs'], extra: 0.25, counts: { tests: 23, pass: 22, fail: 0, skipped: 1 } },
    architecture: { args: [npm, 'run', 'check:tests'], extra: 0.25 },
    'native-root': { args: ['.github/shotloom-electron-test/controlled-deps.mjs', 'ffmpeg'], extra: 2, scripts: true },
    'host-deps': { args: ['.github/shotloom-electron-test/controlled-deps.mjs', 'host'], extra: 3, scripts: true },
    'director-deps': { args: [npm, 'ci', '--ignore-scripts', '--prefix', 'vendor/shotloom-director-desk', '--no-audit', '--no-fund'], extra: 0.5, scripts: true },
    openreel: { args: ['.github/shotloom-electron-test/controlled-deps.mjs', 'openreel'], extra: 3, scripts: true },
    prepare: { args: ['.github/shotloom-electron-test/prepare.mjs'], extra: 0.25, scripts: true },
    'candidate-typecheck': { args: [npm, 'run', 'typecheck:electron'], extra: 0.25, scripts: true },
    package: { args: [npm, 'run', 'dist:electron', '--', '--dir'], extra: 3, scripts: true },
    resources: { args: ['.github/shotloom-electron-test/verify-candidate.mjs'], extra: 0.25, scripts: true },
  };
  const task = tasks[command];
  if (!task) throw new Error('Unknown stage');
  if (task.scripts && (!policy.dependencyScriptsReviewed || !policy.candidatePackagingApproved)) throw new Error('BLOCKED: native/vendor scripts and packaging require separate approval');
  if (command === 'package') {
    verifyFfmpegFile(join(root, 'node_modules/ffmpeg-static/ffmpeg.exe'));
    verifyFfmpegFile(join(root, 'electron/resources/ffmpeg.exe'));
  }
  const before = check(task.extra);
  console.log(JSON.stringify({ stage: command, before, node: process.version, npm: spawnSync(process.execPath, [npm, '--version'], { encoding: 'utf8' }).stdout.trim() }));
  const env = { ...process.env, ...cacheEnvironment(root), npm_config_ignore_scripts: task.scripts ? 'false' : 'true' };
  if (task.scripts) delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  const log = join(scratch, command + '.log');
  const { createWriteStream } = await import('node:fs');
  const out = createWriteStream(log);
  const start = Date.now();
  const child = spawn(process.execPath, task.args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  let stopped = null;
  const samples = [];
  const timer = setInterval(() => {
    try { samples.push({ elapsedSeconds: (Date.now() - start) / 1000, ...check() }); }
    catch (error) { stopped = String(error); }
    if (Date.now() - start > policy.stageTimeoutMinutes * 60000) stopped = 'Stage timeout';
    if (stopped) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  }, 5000);
  const exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  clearInterval(timer);
  await new Promise(done => out.end(done));
  const output = readFileSync(log, 'utf8');
  const counts = parseTestSummary(output);
  try { check(); } catch (error) { stopped = String(error); }
  let pass = exitCode === 0 && !stopped;
  if (task.counts && (!counts || Object.entries(task.counts).some(([k, v]) => counts[k] !== v))) pass = false;
  const result = { stage: command, commit: process.env.GITHUB_SHA, command: [process.execPath, ...task.args], node: process.version, exitCode, pass, stopped, counts, durationSeconds: (Date.now() - start) / 1000, before, after: measurement(), samples, logSha256: digest(log), log };
  writeFileSync(join(scratch, command + '.result.json'), JSON.stringify(result, null, 2));
  console.log(output.slice(-20000));
  if (command === 'resources' && pass) console.log('CANDIDATE_SUMMARY_JSON=' + readEvidenceFile(root, join(root, 'release/batch09/candidate-summary.json')).replaceAll('\n', ''));
  console.log(JSON.stringify(result, null, 2));
  assertLocks();
  if (!pass) process.exitCode = 1;
}

} catch (error) {
  const result = { stage: command, commit: process.env.GITHUB_SHA || null, node: process.version, exitCode: 1, pass: false, status: 'BLOCKED', reason: String(error) };
  // Record authorization/capacity refusals even before a child starts.
  const safeStage = ['authorize', ...VALIDATION_STAGES, ...BUILD_STAGES].includes(command) ? command : 'invalid-stage';
  writeFileSync(join(scratch, safeStage + '.result.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}

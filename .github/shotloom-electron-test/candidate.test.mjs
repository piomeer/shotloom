import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, join } from 'node:path';
import { planPaths, requireApproval, checkSpace, parseTestSummary, transformSources, requiredResources } from './candidate.mjs';

test('paths isolate app, WebView, profile, caches and projects in one fresh run', () => {
  const p = planPaths(resolve('tmp/candidate'), 'batch09-01234567');
  assert.equal(p.appData, join(p.root, 'application'));
  assert.equal(p.projects, join(p.appData, 'projects'));
  assert.equal(p.userData, join(p.root, 'webview'));
  assert.equal(p.sessionData, join(p.root, 'session'));
  assert.notEqual(p.appData, p.userData);
});
for (const id of ['../production', 'batch09-../x', '', 'com.shotloom.app']) {
  test('unsafe run id is rejected: ' + JSON.stringify(id), () => assert.throws(() => planPaths(resolve('tmp/candidate'), id), /run id/));
}
test('cloud approval is false by default and scope is fork/branch-specific', () => {
  const c = { repository: 'piomeer/shotloom', ref: 'refs/heads/test/windows-electron-candidate', event: 'push' };
  assert.throws(() => requireApproval({ cloudExecutionApproved: false }, c), /not authorized/);
  assert.equal(requireApproval({ cloudExecutionApproved: true }, c), true);
  for (const override of [{ repository: 'AstralFoundry/shotloom' }, { ref: 'refs/heads/main' }, { event: 'workflow_dispatch' }]) {
    assert.throws(() => requireApproval({ cloudExecutionApproved: true }, { ...c, ...override }), /scope/);
  }
});
test('space sampling has no prerequisite but stage boundaries retain reserve plus incremental budget', () => {
  assert.equal(checkSpace({ free: 12, used: 1, reserve: 10, additional: 2, cap: 8 }), true);
  assert.throws(() => checkSpace({ free: 11.9, used: 1, reserve: 10, additional: 2, cap: 8 }), /BLOCKED/);
  assert.throws(() => checkSpace({ free: 12, used: 9, reserve: 10, additional: 0, cap: 8 }), /BLOCKED/);
});
test('test summaries preserve pass, failure and existing skip counts', () => {
  assert.deepEqual(parseTestSummary('# tests 22\n# pass 21\n# fail 0\n# skipped 1'), { tests: 22, pass: 21, fail: 0, skipped: 1 });
  assert.deepEqual(parseTestSummary('ℹ tests 22\nℹ pass 22\nℹ fail 0\nℹ skipped 0'), { tests: 22, pass: 22, fail: 0, skipped: 0 });
  assert.equal(parseTestSummary('ERR_MODULE_NOT_FOUND'), null);
});
test('candidate transforms are narrowly anchored, disable updater and force dir/no-publish', () => {
  const s = {
    main: "import { app } from 'electron';\napp.setName('Shotloom');",
    paths: "export const APP_IDENTIFIER = 'com.shotloom.app';",
    updater: 'original updater',
    packaging: "export async function packageElectron({ dirOnly = CLI_ONLY_DIR() } = {}) {\nconst artifacts = await electronBuild({ projectDir: rootDir, ...(dirOnly ? { dir: true } : {}) });\n}",
  };
  const t = transformSources(s, 'disabled updater');
  assert.ok(t.main.startsWith("import './candidate-isolation';"));
  assert.ok(t.main.includes("app.setName('Shotloom Local Test')"));
  assert.ok(t.paths.includes('com.shotloom.localtest.batch09'));
  assert.equal(t.updater, 'disabled updater');
  assert.ok(t.packaging.includes("publish: 'never'"));
  assert.ok(t.packaging.includes('directory only'));
  assert.throws(() => transformSources({ ...s, main: 'upstream changed' }, 'x'), /anchor/);
  assert.throws(() => transformSources(t, 'x'), /anchor/);
});
test('resource closure requires more than an exe and includes Host, renderer and editor', () => {
  const files = requiredResources();
  for (const name of ['resources/app.asar', 'resources/ffmpeg.exe', 'resources/resources/agent-host/node.exe', 'resources/resources/agent-host/dist/main.js']) assert.ok(files.includes(name));
  assert.ok(files.includes('resources/resources/provider-plugins/index.json'));
  assert.ok(files.includes('ffmpeg.dll'));
});

import * as nodePath from 'node:path';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function boot({ authorized = true, link = false, mismatch = false } = {}) {
  const p = planPaths(resolve('tmp/candidate'), 'batch09-01234567');
  const writes = []; const setPaths = [];
  const env = { SHOTLOOM_CANDIDATE_ROOT: p.root, SHOTLOOM_APPDATA_DIR: mismatch ? 'wrong' : p.appData, SHOTLOOM_USER_DATA: p.userData };
  const fixture = {
    __paths: nodePath, __app: { setPath: (...args) => setPaths.push(args), setName() {}, setAppUserModelId() {}, setAppLogsPath() {}, commandLine: { appendSwitch() {} } },
    __fs: { existsSync: () => true, lstatSync: () => ({ isSymbolicLink: () => link }), mkdirSync: path => writes.push(path),
      realpathSync: path => path, writeFileSync: path => writes.push(path),
      readFileSync: path => JSON.stringify(path.endsWith('candidate-policy.json') ? { localRunAuthorized: authorized, applicationId: 'com.shotloom.localtest.batch09' } : { freshRun: true, applicationId: 'com.shotloom.localtest.batch09' }) },
    process: { platform: 'win32', execPath: join(resolve('tmp/candidate'), 'win-unpacked', 'shotloom-local-test.exe'), env },
  };
  const text = readFileSync(new URL('./isolation-bootstrap.ts', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');
  const prelude = 'const {app}= {app:__app}; const {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync}=__fs; const {dirname,isAbsolute,join,resolve,parse}=__paths;';
  return { run: () => runInNewContext(prelude + text, fixture), writes, setPaths, env, p };
}
test('runtime is denied before any data write when local approval is false', () => {
  const f = boot({ authorized: false });
  assert.throws(f.run, /not authorized/); assert.equal(f.writes.length, 0);
});
test('runtime refuses linked data paths before any data write', () => {
  const f = boot({ link: true });
  assert.throws(f.run, /cannot use links/); assert.equal(f.writes.length, 0);
});
test('runtime refuses inconsistent app/user override values before any write', () => {
  const f = boot({ mismatch: true });
  assert.throws(f.run, /overrides do not match/); assert.equal(f.writes.length, 0);
});
test('authorized mocked runtime sets all Electron paths before product imports', () => {
  const f = boot(); f.run();
  for (const key of ['appData', 'userData', 'sessionData', 'home', 'temp', 'logs', 'crashDumps', 'documents', 'downloads']) {
    assert.ok(f.setPaths.some(([name, path]) => name === key && path.startsWith(f.p.root)));
  }
  assert.equal(f.env.HOME, f.p.profile);
  assert.equal(f.env.TEMP, f.p.temp);
  assert.match(f.env.SHOTLOOM_WINDOW, /Shotloom Local Test/);
});

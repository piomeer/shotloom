import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const audit = await import('./audit-tools.mjs').catch(() => ({}));
const deps = await import('./controlled-deps.mjs').catch(() => ({}));
const abc = { bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
const dir = () => mkdtempSync(join(tmpdir(), 'batch13-test-'));
function put(root, file, text) { const p=join(root,file);mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,text);return p; }
const sha = 'a'.repeat(40);
const manifest = () => ({ schemaVersion: 1, commit: sha, applicationId: 'com.shotloom.localtest.batch09', productName: 'Shotloom Local Test',
 files: [{file:'win-unpacked/shotloom-local-test.exe',bytes:3,sha256:abc.sha256}], bytes:3,
 checks: {electron:true,host:true,native:true,ffmpeg:true,openreel:true,director:true,plugins:true,updaterDisabled:true,runtimeDenied:true},
 candidateLaunched:false,binaryUploaded:false });
function has(api, name) { assert.equal(typeof api[name], 'function', 'missing behavior: '+name); }
test('verified bytes accept literal known SHA and reject modified or truncated bytes', () => {
 has(audit,'verifyBytes');assert.equal(audit.verifyBytes(Buffer.from('abc'),abc),true);
 for(const b of ['abd','ab',''])assert.throws(()=>audit.verifyBytes(Buffer.from(b),abc),/digest|size/);
});
test('existing wrong cache is refused rather than trusted by filename', async () => {
 has(audit,'obtainVerified');const root=dir();const path=put(root,'cache/asset','bad');
 await assert.rejects(audit.obtainVerified(root,path,{...abc,url:'https://registry.npmjs.org/test.tgz'},()=>{throw Error('network should not run');}),/digest/);
 assert.equal(readFileSync(path,'utf8'),'bad');
});
test('unexpected initial download address is rejected before any network call', async () => {
 has(audit,'downloadVerified');let calls=0;
 await assert.rejects(audit.downloadVerified({...abc,url:'https://registry.npmjs.org/test.tgz'},async()=>{calls++;},{url:'https://evil.invalid/x'}),/address/);assert.equal(calls,0);
});
test('verified download rejects unexpected redirects and accepts literal fixture', async () => {
 has(audit,'downloadVerified');
 await assert.rejects(audit.downloadVerified({...abc,url:'https://registry.npmjs.org/test.tgz'},async()=>({status:302,headers:new Headers({location:'https://evil.invalid/x'})})),/origin/);
 const result=await audit.downloadVerified({...abc,url:'https://registry.npmjs.org/test.tgz'},async()=>new Response('abc'));
 assert.equal(result.toString(),'abc');
});
test('package identity rejects a wrong version before binary preparation', () => {
 has(deps,'packageIdentity');const root=dir();put(root,'package.json',JSON.stringify({name:'ffmpeg-static',version:'5.2.0'}));
 assert.throws(()=>deps.packageIdentity(root,'ffmpeg-static','5.3.0'),/version/);
});
test('cache environment confines actual LOCALAPPDATA, npm and Electron caches', () => {
 has(audit,'cacheEnvironment');has(audit,'assertCacheEnvironment');const root=dir();const env=audit.cacheEnvironment(root);
 assert.equal(audit.assertCacheEnvironment(root,env),true);
 for(const key of ['LOCALAPPDATA','APPDATA','npm_config_cache','ELECTRON_CACHE','TEMP'])assert.ok(env[key].startsWith(root));
 assert.throws(()=>audit.assertCacheEnvironment(root,{...env,LOCALAPPDATA:resolve(root,'../production')}),/cache/);
});
test('cache paths refuse a link to an external directory', () => {
 has(audit,'assertOwnedPath');const root=dir(),outside=dir();symlinkSync(outside,join(root,'linked'),'junction');
 assert.throws(()=>audit.assertOwnedPath(root,join(root,'linked/asset')),/link/);
});
test('one walk records overlapping groups without double counting workspace', () => {
 has(audit,'measureWorkspace');const root=dir();put(root,'node_modules/a','abc');put(root,'tmp/cache/b','12345');put(root,'dist/a','12');
 const m=audit.measureWorkspace(root);assert.equal(m.used,10);assert.equal(m.directories.rootNodeModules.bytes,3);
 assert.equal(m.directories.tmp.bytes,5);assert.equal(m.directories.dist.bytes,2);assert.equal(m.directories.hostNodeModules.bytes,0);assert.equal(m.filesScanned,3);
});
test('disk reserve and greater than 8GiB are denied from measured values', () => {
 has(audit,'assertMeasurement');const GiB=1024**3;const base={free:12*GiB,used:8*GiB,disks:[{free:12*GiB}]};
 assert.equal(audit.assertMeasurement(base,{diskReserveGiB:10,workspaceCapGiB:8},0),true);
 assert.throws(()=>audit.assertMeasurement({...base,used:8*GiB+1},{diskReserveGiB:10,workspaceCapGiB:8},0),/budget/);
 assert.throws(()=>audit.assertMeasurement({...base,disks:[{free:9*GiB}]},{diskReserveGiB:10,workspaceCapGiB:8},0),/reserve/);
});
test('Host plan disables every npm lifecycle and uses only explicit prebuilt check', () => {
 has(deps,'hostInstallPlan');const p=deps.hostInstallPlan('npm-cli.js');
 assert.deepEqual(p[0],['npm-cli.js','ci','--ignore-scripts','--prefix','harness/host','--no-audit','--no-fund']);
 assert.equal(p.length,1);
});
test('missing native prebuild fails before a loader or fallback command can execute', () => {
 has(deps,'assertPrebuiltFiles');const root=dir();
 assert.throws(()=>deps.assertPrebuiltFiles(root),/prebuilt/);
 assert.equal(existsSync(join(root,'build')),false);
});
test('pnpm install always freezes lock, ignores dependency scripts and fixes store', () => {
 has(deps,'pnpmArguments');const root=dir();const p=deps.pnpmArguments(root,['install','--frozen-lockfile']);
 assert.ok(p.includes('--frozen-lockfile'));assert.ok(p.includes('--ignore-scripts'));assert.ok(p.some(a=>a.startsWith('--store-dir=')));
});
for(const args of [['install'],['add','x'],['setup'],['env','use','--global','latest'],['--filter','@openreel/web','deploy']]) {
 test('unexpected pnpm/fallback command is refused: '+args.join(' '),()=>{
  has(deps,'pnpmArguments');assert.throws(()=>deps.pnpmArguments(dir(),args),/pnpm command/);
 });
}
test('summary contains exact EXE digest and binds raw full-manifest digest', () => {
 has(audit,'makeSummary');const m=manifest(),raw=JSON.stringify(m);const s=audit.makeSummary(m,raw);
 assert.equal(s.exe.path,'win-unpacked/shotloom-local-test.exe');assert.equal(s.exe.sha256,abc.sha256);assert.equal(s.exe.bytes,3);
 assert.equal(s.directoryBytes,3);assert.equal(s.fileCount,1);assert.equal(s.commit,sha);assert.equal(s.candidateLaunched,false);assert.equal(s.binaryUploaded,false);
 assert.match(s.manifestSha256,/^[a-f0-9]{64}$/);
});
test('manifest/summary mismatches and malformed paths are refused', () => {
 has(audit,'makeSummary');has(audit,'validateEvidence');
 for(const file of ['../secret','C:/outside','win-unpacked/../secret','win-unpacked\\x']) {
  const m=manifest();m.files[0].file=file;assert.throws(()=>audit.makeSummary(m,JSON.stringify(m)),/path/);
 }
 const m=manifest(),raw=JSON.stringify(m),s=audit.makeSummary(m,raw);
 assert.throws(()=>audit.validateEvidence(m,{...s,directoryBytes:4},raw),/summary/);
 m.bytes=4;assert.throws(()=>audit.makeSummary(m,JSON.stringify(m)),/bytes/);
});
test('text gate refuses by default before creating upload staging directory', () => {
 has(audit,'prepareTextEvidence');const root=dir();
 assert.throws(()=>audit.prepareTextEvidence(root,{}),/not authorized/);
 assert.equal(existsSync(join(root,'tmp/batch09/text-evidence')),false);
});
test('only checked summary and manifest are copied; binary neighbors never selected', () => {
 has(audit,'prepareTextEvidence');const root=dir(),m=manifest(),raw=JSON.stringify(m);
 has(audit,'makeSummary');put(root,'release/batch09/candidate-manifest.json',raw);
 put(root,'release/batch09/candidate-summary.json',JSON.stringify(audit.makeSummary(m,raw)));
 for(const f of ['secret.exe','secret.dll','secret.asar','user.sqlite'])put(root,'release/batch09/'+f,'private');
 const files=audit.prepareTextEvidence(root,{textEvidenceUploadApproved:true,validationExecutionApproved:true,fullBuildApproved:true,dependencyScriptsReviewed:true,candidatePackagingApproved:true});
 assert.deepEqual(files.map(p=>p.split(/[\\/]/).at(-1)),['candidate-summary.json','candidate-manifest.json']);
 assert.equal(existsSync(join(root,'tmp/batch09/text-evidence/secret.exe')),false);
});
test('text whitelist rejects extra fields, tokens, overlarge files and launched candidate', () => {
 has(audit,'makeSummary');
 for(const edit of [{token:'ghp_'+'x'.repeat(40)},{candidateLaunched:true},{binaryUploaded:true}]) {
  const m={...manifest(),...edit};assert.throws(()=>audit.makeSummary(m,JSON.stringify(m)),/schema|sensitive|launched|uploaded/);
 }
 has(audit,'readEvidenceFile');const root=dir();
 for(const f of ['x.exe','x.dll','x.asar']){const p=put(root,f,'{}');assert.throws(()=>audit.readEvidenceFile(root,p),/whitelist/);}
 const p=put(root,'candidate-summary.json',' '.repeat(16385));assert.throws(()=>audit.readEvidenceFile(root,p),/size/);
});

test('internal pnpm links are skipped once while external links stop the budget', () => {
 has(audit,'measureWorkspace');has(audit,'assertMeasurement');
 const root=dir();put(root,'store/a','abc');symlinkSync(join(root,'store'),join(root,'inside'),'junction');
 const m=audit.measureWorkspace(root);assert.equal(m.used,3);assert.equal(m.linksSkipped,1);
 assert.equal(audit.assertMeasurement(m,{diskReserveGiB:0,workspaceCapGiB:8}),true);
 symlinkSync(dir(),join(root,'outside'),'junction');
 assert.throws(()=>audit.assertMeasurement(audit.measureWorkspace(root),{diskReserveGiB:0,workspaceCapGiB:8}),/external|link/);
});
test('archive extraction refuses traversal, absolute paths, symlinks and hardlinks', () => {
 has(deps,'archiveMemberAllowed');
 for(const [p,t] of [['package/../escape','File'],['/absolute','File'],['package/link','SymbolicLink'],['package/link','Link']])assert.throws(()=>deps.archiveMemberAllowed(p,t),/archive/);
 assert.equal(deps.archiveMemberAllowed('package/bin/pnpm.mjs','File'),true);
});
test('modified pnpm bootstrap cannot use the version string to bypass digest verification', () => {
 has(deps,'verifyPnpmBootstrap');const root=dir();put(root,'package.json',JSON.stringify({name:'pnpm',version:'11.7.0'}));
 put(root,'bin/pnpm.mjs','unexpected executable code');
 assert.throws(()=>deps.verifyPnpmBootstrap(root),/digest|Missing/);
});

test('official media preparation cannot override the verified FFmpeg source', () => {
 has(audit,'cacheEnvironment');has(audit,'assertCacheEnvironment');const root=dir(),env=audit.cacheEnvironment(root);
 assert.equal(env.FFMPEG_BIN,join(root,'node_modules/ffmpeg-static/ffmpeg.exe'));
 assert.throws(()=>audit.assertCacheEnvironment(root,{...env,FFMPEG_BIN:join(root,'other.exe')}),/cache/);
});

test('directory telemetry tolerates a file removed after enumeration and records the race', async () => {
 has(audit,'measureWorkspace');
 const fs=(await import('node:fs')).default;const {syncBuiltinESMExports}=await import('node:module');
 const root=dir();put(root,'transient','abc');const original=fs.readdirSync;
 try {
  fs.readdirSync=function(path,options) {const entries=original(path,options);if(resolve(path)===root&&existsSync(join(root,'transient')))fs.unlinkSync(join(root,'transient'));return entries;};
  syncBuiltinESMExports();
  const m=audit.measureWorkspace(root);assert.equal(m.used,0);assert.ok(m.races>0);
 } finally {fs.readdirSync=original;syncBuiltinESMExports();}
});

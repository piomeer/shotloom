import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { digest, obtainVerified, verifyBytes, assertOwnedPath, cacheEnvironment, assertCacheEnvironment } from './audit-tools.mjs';
import { requireApproval, assertStageAllowed } from './candidate.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const supply=JSON.parse(readFileSync(new URL('./supply-chain.json',import.meta.url),'utf8'));
export function packageIdentity(path,name,version) {
  const p=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));
  if(p.name!==name||p.version!==version)throw new Error('Package name/version mismatch: '+name);
  return p;
}
export function hostInstallPlan(npm) {
  return [[npm,'ci','--ignore-scripts','--prefix','harness/host','--no-audit','--no-fund']];
}
const PREBUILT={
 'node_modules/better-sqlite3':['better-sqlite3','13.0.3',['prebuilds/win32-x64.node']],
 'node_modules/node-pty':['node-pty','1.2.0-beta.15',['prebuilds/win32-x64/conpty.node','prebuilds/win32-x64/conpty_console_list.node','prebuilds/win32-x64/conpty/conpty.dll','prebuilds/win32-x64/conpty/OpenConsole.exe']],
 'node_modules/koffi':['koffi','3.1.1',[]],
 'node_modules/@koromix/koffi-win32-x64':['@koromix/koffi-win32-x64','3.1.1',['win32_x64/koffi.node']],
 'node_modules/esbuild':['esbuild','0.28.1',[]],
 'node_modules/@esbuild/win32-x64':['@esbuild/win32-x64','0.28.1',['esbuild.exe']],
};
export function assertPrebuiltFiles(host) {
  for(const [sub,[name,version,files]] of Object.entries(PREBUILT)) {
    const dir=assertOwnedPath(host,join(host,sub));
    if(!existsSync(join(dir,'package.json')))throw new Error('Missing locked prebuilt package: '+name);
    packageIdentity(dir,name,version);
    for(const file of files) {
      const path=assertOwnedPath(host,join(dir,file));
      if(!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).size<1)throw new Error('Missing prebuilt: '+name+'/'+file);
    }
  }
  return true;
}
export function pnpmArguments(project,args) {
  if(JSON.stringify(args)===JSON.stringify(['install','--frozen-lockfile']))return [...args,'--ignore-scripts','--store-dir='+join(project,'tmp/batch09/pnpm-store')];
  for(const allowed of [['--filter','@openreel/core','build:wasm'],['--filter','@openreel/web','build:embedded']])if(JSON.stringify(args)===JSON.stringify(allowed))return args;
  throw new Error('Unreviewed pnpm command');
}
function run(args,cwd=root,env=process.env) {
  const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});
  if(result.error||result.status!==0)throw new Error('Controlled dependency command failed: '+(result.error?.message||result.status));
}
export async function prepareFfmpeg(project,fetcher=fetch) {
  const dir=join(project,'node_modules/ffmpeg-static');
  packageIdentity(dir,'ffmpeg-static','5.3.0');
  const cache=join(project,'tmp/batch09/profile/local/ffmpeg-static-nodejs/Cache/ffmpeg-win32-x64.gz');
  const exe=assertOwnedPath(project,join(dir,'ffmpeg.exe'));
  // Existing executable is never trusted by its filename, either.
  if(existsSync(exe))verifyBytes(readFileSync(exe),supply.ffmpegExecutable);
  const compressed=await obtainVerified(project,cache,supply.ffmpegGzip,fetcher);
  const bytes=gunzipSync(compressed,{maxOutputLength:supply.ffmpegExecutable.bytes});
  verifyBytes(bytes,supply.ffmpegExecutable);
  if(!existsSync(exe))writeFileSync(exe,bytes,{flag:'wx'});
  verifyBytes(readFileSync(exe),supply.ffmpegExecutable);
  const sidecar=assertOwnedPath(project,join(project,'electron/resources/ffmpeg.exe'));
  if(existsSync(sidecar))verifyBytes(readFileSync(sidecar),supply.ffmpegExecutable);
  else {mkdirSync(dirname(sidecar),{recursive:true});writeFileSync(sidecar,bytes,{flag:'wx'});}
  console.log(JSON.stringify({ffmpeg:'verified-before-execution',release:'b6.1.1',bytes:bytes.length,sha256:supply.ffmpegExecutable.sha256}));
}
export function verifyFfmpegFile(path) {
  verifyBytes(readFileSync(path),supply.ffmpegExecutable);return true;
}
export function archiveMemberAllowed(path,type) {
  const parts=path.replaceAll('\\','/').split('/');
  if(!path.startsWith('package/')||path.includes('\\')||isAbsolute(path)||parts.some(p=>p==='..'||p==='.')||!['File','Directory'].includes(type))throw new Error('Unsafe pnpm archive member');
  return true;
}
export function verifyPnpmBootstrap(target) {
  packageIdentity(target,'pnpm','11.7.0');
  for(const [file,expected] of Object.entries(supply.pnpmBootstrapSha256)) {
    const path=assertOwnedPath(target,join(target,file));
    if(!existsSync(path))throw new Error('Missing pnpm bootstrap');
    if(digest(readFileSync(path))!==expected)throw new Error('pnpm bootstrap digest mismatch');
  }
  return true;
}
async function preparePnpm(project) {
  const cache=join(project,'tmp/batch09/pnpm-11.7.0.tgz');
  await obtainVerified(project,cache,supply.pnpm);
  const target=assertOwnedPath(project,join(project,'tmp/batch09/pnpm-bootstrap'));
  if(!existsSync(target)) {
    mkdirSync(target,{recursive:true});
    const require=createRequire(join(project,'package.json'));
    let files=0,expanded=0;
    await require('tar').x({file:cache,cwd:target,strip:1,strict:true,preservePaths:false,
      filter:(path,entry)=>{archiveMemberAllowed(path,entry.type);expanded+=entry.size||0;if(++files>5000||expanded>128*1024**2)throw new Error('pnpm extraction budget');return true;}});
  }
  verifyPnpmBootstrap(target);
  const shim=join(project,'tmp/batch09/pnpm.cmd');
  for(const path of [process.execPath,join(project,'.github/shotloom-electron-test/controlled-deps.mjs')])if(/[%&|<>^!\r\n"]/.test(path))throw new Error('Unsafe shell shim path');
  writeFileSync(shim,'@"'+process.execPath+'" "'+join(project,'.github/shotloom-electron-test/controlled-deps.mjs')+'" pnpm %*\r\n');
}
function assertOpenReel(project) {
  const vendor=join(project,'vendor/openreel');
  if(JSON.parse(readFileSync(join(vendor,'package.json'),'utf8')).packageManager!=='pnpm@11.7.0')throw new Error('Unreviewed pnpm version');
  for(const file of ['.npmrc','.pnpmfile.cjs','.pnpmfile.mjs'])for(const base of [project,vendor])if(existsSync(join(base,file)))throw new Error('Unreviewed pnpm configuration hook');
  const policy=JSON.parse(readFileSync(join(project,'.github/shotloom-electron-test/policy.json'),'utf8'));
  // Frozen install plus exact input hashes; the guard is also used by later packaging.
  for(const file of ['vendor/openreel/package.json','vendor/openreel/pnpm-lock.yaml','vendor/openreel/pnpm-workspace.yaml']) {
    const expected=policy.lockSha256[file];
    const actual=createRequire(import.meta.url)('node:crypto').createHash('sha256').update(readFileSync(join(project,file),'utf8').replaceAll('\r\n','\n')).digest('hex');
    if(actual!==expected)throw new Error('OpenReel lock/config drift');
  }
  return vendor;
}
async function main() {
  const command=process.argv[2];
  const policy=JSON.parse(readFileSync(join(root,'.github/shotloom-electron-test/policy.json'),'utf8'));
  requireApproval(policy,{repository:process.env.GITHUB_REPOSITORY,ref:process.env.GITHUB_REF,event:process.env.GITHUB_EVENT_NAME});
  assertStageAllowed(policy,{ffmpeg:'native-root',host:'host-deps',openreel:'openreel',pnpm:'openreel'}[command]);
  if(process.platform!=='win32'||process.arch!=='x64'||process.version!=='v22.19.0')throw new Error('Requires approved Windows Node22 runner');
  assertCacheEnvironment(root,process.env);
  const env={...process.env,...cacheEnvironment(root)};
  if(command==='ffmpeg')await prepareFfmpeg(root);
  else if(command==='host') {
    const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
    for(const args of hostInstallPlan(npm))run(args,root,{...env,npm_config_ignore_scripts:'true'});
    const host=join(root,'harness/host');assertPrebuiltFiles(host);
    run(['-e',"const {createRequire}=require('node:module');const r=createRequire(process.cwd()+'/package.json');const DB=r('better-sqlite3');const db=new DB(':memory:');if(db.prepare('select 1 as v').get().v!==1)throw Error('SQLite');db.close();r('node-pty');r('koffi');if(!r('esbuild').transformSync('const value = 1',{format:'cjs'}).code)throw Error('esbuild prebuilt');console.log(r('esbuild').version);"],host,env);
  } else if(command==='openreel') {
    assertOpenReel(root);await preparePnpm(root);run(['scripts/prepare-openreel-agent.mjs'],root,env);
  } else if(command==='pnpm') {
    const vendor=assertOpenReel(root),args=pnpmArguments(root,process.argv.slice(3));
    verifyPnpmBootstrap(join(root,'tmp/batch09/pnpm-bootstrap'));
    run([join(root,'tmp/batch09/pnpm-bootstrap/bin/pnpm.mjs'),...args],vendor,{...env,npm_config_ignore_scripts:'true',pnpm_config_ignore_scripts:'true',pnpm_config_verify_deps_before_run:'warn'});
  } else throw new Error('Unknown controlled dependency stage');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(String(e));process.exitCode=1;});

# BATCH-09 candidate preparation

This directory belongs only to test/windows-electron-candidate. Do not copy it into the upstream memory-recovery PR.

- Workflow: ../workflows/windows-electron-candidate.yml (JSON is valid YAML).
- policy.json defaults to denying cloud execution, native/vendor script execution, packaging, local GUI execution and binary upload.
- Inventory runs before authorization/capacity checks. The fixed 10 GiB reserve is conservative; stage allowances (2/3 GiB etc.) are planning bounds, not measured peaks. Stop BLOCKED if they do not fit. Never lower these automatically or clean system files.
- Root npm ci uses ignore-scripts. Run the four exact Node 22 checks before any native preparation.
- Electron 44.10.2 has no install lifecycle hook. The electron-dist stage calls its lockfile-installed node_modules/electron/install.js explicitly; it uses the package's checksums.
- Host/director commands follow official setup-project lockfiles. Host includes registry.npmmirror.com URLs; no lockfile URLs or versions are rewritten. Complete lifecycle/source review is still required before enabling the native stages.
- OpenReel uses its pinned pnpm 11.7.0 and frozen workspace lock; WASM uses AssemblyScript. Cache and TEMP are job-owned. No shared Actions cache or binary artifact is uploaded.
- prepare.mjs applies exact-source-hash-guarded transformations only in the disposable Runner checkout. It prepends a fail-closed bootstrap before product imports, changes application identity/name, replaces the updater implementation entirely, and forces directory-only electron-builder with publish never.
- The bootstrap uses existing app/user overrides plus separate session/home/temp/log paths. It requires a fresh marker and independently approved runtime policy. Start-Shotloom-Local-Test.ps1 uses a fresh data directory and a child-only environment allowlist. Never launch the exe directly.
- verify-candidate.mjs checks Electron/ASAR/frontend/OpenReel WASM/director/plugin/Host/FFmpeg closure, copies and hashes the complete Host tree, loads native modules with an in-memory SQLite database, and checks FFmpeg version. It never starts Shotloom or sends a model request.
- The directory remains on the temporary Runner only. Do not assume it can be downloaded after job teardown. Distribution requires separate rights/channel/storage approval and another explicitly authorized build if needed.
- Local GUI execution stays blocked. Static path tests are not a Windows security sandbox or runtime access audit. Use an independent Windows test user before any runtime acceptance if same-user isolation cannot be proved.

Local static tests: node --test .github/shotloom-electron-test/candidate.test.mjs
The product's 22 recovery tests remain tests/electron-recovery.test.mjs.

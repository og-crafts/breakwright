import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('dist', { recursive: true })
await build({ entryPoints: { cli: 'src/cli.ts' }, bundle: true, platform: 'node', format: 'esm', target: 'node22', outdir: 'dist', outExtension: { '.js': '.mjs' }, banner: { js: "#!/usr/bin/env node\nimport{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" }, logLevel: 'warning' })
copyFileSync('src/inject/preload.cjs', 'dist/preload.cjs')

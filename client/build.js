import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 1. Bundle React TypeScript code
await esbuild.build({
  entryPoints: ['client/src/main.tsx'],
  bundle: true,
  outfile: 'public/bundle.js',
  minify: true,
  sourcemap: true,
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

// 2. Copy and bundle CSS
fs.copyFileSync('client/src/styles.css', 'public/bundle.css');

// 3. Copy index.html
fs.copyFileSync('client/index.html', 'public/index.html');

console.log('✅ React frontend successfully built into public/ (bundle.js, bundle.css, index.html)');

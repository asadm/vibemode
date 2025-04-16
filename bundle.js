import esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['source/cli.js'],
    outfile: 'dist/cli.js',
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as topLevelCreateRequire } from 'module';\n const require = topLevelCreateRequire(import.meta.url);",
    },
    bundle: true,
    sourcemap: false,
    minify: false, // left it false just for debugging
    splitting: false,
    define: {
        'process.env.NODE_ENV': '"production"'
    },
    format: 'esm',
    loader: { '.js': 'jsx' },
    platform: 'node',
    target: ['esnext'],
  });
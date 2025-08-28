import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const external = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {}), 'crypto']

/** @type {import('rollup').RollupOptions[]} */
export default [
  // ESM build - 生成类型声明
  {
    input: 'src/index.ts',
    output: {
      file: pkg.module,  // dist/index.mjs
      format: 'esm',
      sourcemap: true,
      exports: 'named',
    },
    external,
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,  // 只在 ESM 构建时生成 .d.ts
        declarationDir: './dist',
        declarationMap: true,  // 生成 .d.ts.map
        module: 'ESNext',
        outputToFilesystem: true,
      }),
    ],
  },
  // CJS build - 不生成类型声明
  {
    input: 'src/index.ts',
    output: {
      file: pkg.main,  // dist/index.cjs
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
      interop: 'auto',
    },
    external,
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,  // CJS 构建不需要生成类型
        declarationMap: false,  // 不生成 map
        module: 'ESNext',
        outputToFilesystem: true,
      }),
    ],
  },
]

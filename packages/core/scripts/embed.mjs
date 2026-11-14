// Copies the shared page blocks into a text file the code generators embed, so generated apps get the exact
// components the editor renders. Run after changing src/render/blocks.tsx: npm run embed
import { readFileSync, writeFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/render/blocks.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
writeFileSync(new URL('../src/render/blocks.source.txt', import.meta.url), source)
console.log('src/render/blocks.source.txt updated')

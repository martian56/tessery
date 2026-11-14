// Copies the shared renderers into text files the code generators embed, so generated apps get the exact
// components the editor renders. Run after changing src/render/blocks.tsx or tree.tsx: npm run embed
import { readFileSync, writeFileSync } from 'node:fs'

for (const name of ['blocks', 'tree']) {
  const source = readFileSync(new URL(`../src/render/${name}.tsx`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  writeFileSync(new URL(`../src/render/${name}.source.txt`, import.meta.url), source)
  console.log(`src/render/${name}.source.txt updated`)
}

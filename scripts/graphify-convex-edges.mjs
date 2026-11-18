#!/usr/bin/env node
// Adds call edges for Convex function references (`api.mod.fn`, `internal.mod.fn`)
// to graphify-out/graph.json. The generated `api` object is `anyApi` (a runtime
// proxy), so graphify's AST pass cannot see which Convex function a page or a
// scheduler call reaches. Idempotent: re-run after every `graphify update .`.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'

const GRAPH = 'graphify-out/graph.json'
const ORIGIN = 'convex-api-ref'
const REF = /(?<![\w$./])(api|internal)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)/g

if (!existsSync(GRAPH)) {
  console.error(`${GRAPH} not found - build the graph first.`)
  process.exit(1)
}

const graph = JSON.parse(readFileSync(GRAPH, 'utf8'))
const edgeKey = graph.links ? 'links' : 'edges'
const before = graph[edgeKey].length
graph[edgeKey] = graph[edgeKey].filter((e) => e._origin !== ORIGIN)
const removed = before - graph[edgeKey].length

const fileNode = new Map()
const fnNode = new Map()
for (const n of graph.nodes) {
  const file = n.source_file
  if (!file) continue
  if (n.source_location === 'L1' && n.label === basename(file)) fileNode.set(file, n.id)
  if (!file.startsWith('convex/')) continue
  const name = n.label.replace(/\(\)$/, '')
  const key = `${file.replace(/\.(ts|js)$/, '')}#${name}`
  // Exported Convex functions are labelled without "()"; prefer them over same-named helpers.
  if (!fnNode.has(key) || !n.label.endsWith('()')) fnNode.set(key, n.id)
}

const files = execFileSync('git', ['ls-files', '*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((f) => f && !f.startsWith('convex/_generated/') && !f.startsWith('archive/'))

let added = 0
const unresolved = new Map()
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('_generated/api')) continue
  const caller = fileNode.get(file)
  if (!caller) continue
  const seen = new Set()
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(REF)) {
      const parts = m[2].split('.')
      const fn = parts.pop()
      const target = fnNode.get(`convex/${parts.join('/')}#${fn}`)
      const ref = `${m[1]}.${m[2]}`
      if (!target) {
        unresolved.set(ref, (unresolved.get(ref) || 0) + 1)
        continue
      }
      if (seen.has(target)) continue
      seen.add(target)
      graph[edgeKey].push({
        source: caller,
        target,
        relation: 'calls',
        confidence: 'EXTRACTED',
        confidence_score: 1.0,
        source_file: file,
        source_location: `L${i + 1}`,
        weight: 1.0,
        context: ref,
        _origin: ORIGIN,
      })
      added++
    }
  })
}

writeFileSync(GRAPH, JSON.stringify(graph))
console.log(`Convex api edges: ${added} added, ${removed} stale removed, ${unresolved.size} unresolved refs`)
for (const [ref, n] of [...unresolved].slice(0, 25)) console.log(`  unresolved ${ref} (${n}x)`)

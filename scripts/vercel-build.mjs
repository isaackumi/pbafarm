#!/usr/bin/env node
// Vercel build entry point (package.json "vercel-build"). See lib/vercelBuild.mjs.
import { spawnSync } from 'node:child_process'
import { buildPlan } from '../lib/vercelBuild.mjs'

const plan = buildPlan(process.env)
console.log(`[vercel-build] ${plan.note}`)
const [cmd, args] = plan.command
const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)

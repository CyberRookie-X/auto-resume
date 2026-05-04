#!/usr/bin/env node
import { resolve } from "path"
import { dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = resolve(__dirname, "../dist/auto-resume-hook.js")

const module = await import(distPath)
await module.main()

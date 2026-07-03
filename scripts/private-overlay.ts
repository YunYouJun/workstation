#!/usr/bin/env node
import process from 'node:process'
import { runPrivateCommand } from '../packages/cli/src/private'

const actionArg = process.argv[2]
const args = actionArg?.startsWith('-') ? process.argv.slice(2) : process.argv.slice(3)

await runPrivateCommand(actionArg, args)

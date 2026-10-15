#!/usr/bin/env node
// Stands in for `claude -p`: records how it was called and answers with a fixed summary.
import { appendFileSync } from 'node:fs';

let input = '';

for await (const chunk of process.stdin) {
  input += chunk;
}

appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args: process.argv.slice(2), input, summarizing: process.env.TIMATIC_SUMMARIZING })}\n`);
process.stdout.write('"CSV-export voor de urenlijst."\n');

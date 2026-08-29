#!/usr/bin/env node
import { main } from '../src/cli.mjs';

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

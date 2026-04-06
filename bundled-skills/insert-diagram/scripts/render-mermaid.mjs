#!/usr/bin/env node

// Usage: node render-mermaid.mjs <input.mmd> <output.svg>
// Renders a Mermaid diagram source file to SVG using @mermaid-js/mermaid-cli.
// Requires: npm install (run in this script's directory to install dependencies)
// Falls back to: npx @mermaid-js/mermaid-cli if not locally installed

import { execFile, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node render-mermaid.mjs <input.mmd> <output.svg>');
  process.exit(1);
}

const resolvedInput = resolve(inputPath);
const resolvedOutput = resolve(outputPath);

if (!existsSync(resolvedInput)) {
  console.error(`Input file not found: ${resolvedInput}`);
  process.exit(1);
}

const args = ['-i', resolvedInput, '-o', resolvedOutput, '-b', 'transparent'];

// Try local node_modules first, then global npx fallback
const localMmdc = join(__dirname, 'node_modules', '.bin', 'mmdc');

function runMmdc(command, commandArgs) {
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`mmdc failed: ${stderr || error.message}`));
      } else {
        if (stderr) process.stderr.write(stderr);
        resolve(stdout);
      }
    });
  });
}

async function main() {
  // Strategy 1: Local installation in skill's scripts/ directory
  if (existsSync(localMmdc)) {
    try {
      await runMmdc(localMmdc, args);
      process.exit(0);
    } catch (err) {
      console.error(`Local mmdc failed: ${err.message}`);
    }
  }

  // Strategy 2: System-wide mmdc
  try {
    await runMmdc('mmdc', args);
    process.exit(0);
  } catch {
    // Not found system-wide, try npx
  }

  // Strategy 3: npx fallback
  try {
    execSync(
      `npx -y @mermaid-js/mermaid-cli -i "${resolvedInput}" -o "${resolvedOutput}" -b transparent`,
      { stdio: 'inherit', timeout: 60000 }
    );
    process.exit(0);
  } catch (err) {
    console.error(`All mmdc strategies failed. Ensure Node.js and npm are available.`);
    console.error(`Last error: ${err.message}`);
    process.exit(1);
  }
}

main();

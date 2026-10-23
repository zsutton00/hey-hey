#!/usr/bin/env node
/*
 * Removes operations and definitions listed as unused by find-unused-spec-content.js.
 *
 * Usage:
 *   node scripts/remove-unused-spec-content.js --report report.json
 *        [--operations unreferenced] [--definitions unused]
 *        [--file specs/schemas/conversations.yaml] [--spec api] [--tag Tag] [--root dir]
 *        [--allow-unchecked consumer] [--dry-run]
 *
 * Edits are textual (whole key blocks are deleted) so comments, quoting and ordering in the
 * remaining spec are untouched. Selection flags narrow what is removed so each run can be one
 * small, separate change. Only operations with the requested status and definitions with the
 * requested status are removed; handler-only, test-only and pinned content is never selected
 * unless named explicitly.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function parseArgs(argv) {
  const args = { allowUnchecked: [], root: DEFAULT_ROOT, report: null, operations: null, definitions: null, file: null, spec: null, tag: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--root') args.root = path.resolve(argv[(i += 1)]);
    else if (flag === '--report') args.report = argv[(i += 1)];
    else if (flag === '--operations') args.operations = argv[(i += 1)];
    else if (flag === '--definitions') args.definitions = argv[(i += 1)];
    else if (flag === '--file') args.file = argv[(i += 1)];
    else if (flag === '--spec') args.spec = argv[(i += 1)];
    else if (flag === '--tag') args.tag = argv[(i += 1)];
    else if (flag === '--allow-unchecked') args.allowUnchecked.push(argv[(i += 1)]);
    else if (flag === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument ${flag}`);
  }
  if (!args.report) throw new Error('--report is required');
  if (!args.operations && !args.definitions) throw new Error('Select --operations <status> and/or --definitions <status>');
  return args;
}

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === '';
const isComment = (line) => line.trim().startsWith('#');

function keyOf(line) {
  const match = line.match(/^(\s*)(?:'((?:[^']|'')*)'|"((?:[^"\\]|\\.)*)"|([^\s'"#\-][^\n]*?))\s*:(?:\s|$)/);
  if (!match) return null;
  const name = match[2] !== undefined ? match[2].replace(/''/g, "'") : match[3] !== undefined ? match[3] : match[4];
  return { indent: match[1].length, name };
}

// Range [start, end) of the child `name` inside the parent block that starts at `parentStart`.
function findChild(lines, parentStart, parentEnd, name) {
  let childIndent = null;
  for (let i = parentStart + 1; i < parentEnd; i += 1) {
    if (isBlank(lines[i]) || isComment(lines[i])) continue;
    const key = keyOf(lines[i]);
    if (!key) continue;
    if (childIndent === null) childIndent = key.indent;
    if (key.indent === childIndent && key.name === name) return { start: i, end: blockEnd(lines, i, parentEnd), indent: key.indent };
  }
  return null;
}

// End (exclusive) of the block that starts at `start`: stops at the next line at the same or
// lower indent, leaving blank lines and comments that precede that line to the next block.
function blockEnd(lines, start, limit) {
  const indent = indentOf(lines[start]);
  let stop = limit;
  for (let j = start + 1; j < limit; j += 1) {
    if (isBlank(lines[j])) continue;
    if (indentOf(lines[j]) <= indent && !(isComment(lines[j]) && indentOf(lines[j]) > indent)) {
      stop = j;
      break;
    }
  }
  let end = stop;
  while (end - 1 > start && (isBlank(lines[end - 1]) || (isComment(lines[end - 1]) && stop !== limit))) end -= 1;
  return end;
}

function topLevelRange(lines, key) {
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = keyOf(lines[i]);
    if (parsed && parsed.indent === 0 && parsed.name === key) return { start: i, end: blockEnd(lines, i, lines.length), indent: 0 };
  }
  return null;
}

// Locate the block for a key path such as ['components','schemas','Name'] or ['paths','/x','get'].
function locate(lines, keyPath) {
  let range = { start: -1, end: lines.length, indent: -1 };
  for (let depth = 0; depth < keyPath.length; depth += 1) {
    const found = depth === 0 ? topLevelRange(lines, keyPath[0]) : findChild(lines, range.start, range.end, keyPath[depth]);
    if (!found) return null;
    range = found;
  }
  return range;
}

function deleteRange(lines, range) {
  let { start } = range;
  // A comment directly above the key describes it, but a section banner (`# ====` / `# ----`, or the
  // title between two banners) heads the definitions that follow and stays.
  const isBanner = (line) => /^\s*#\s*[=\-]{3,}/.test(line);
  while (start - 1 >= 0 && isComment(lines[start - 1]) && !isBanner(lines[start - 1]) && indentOf(lines[start - 1]) === range.indent) {
    if (start - 2 >= 0 && isBanner(lines[start - 2])) break;
    start -= 1;
  }
  lines.splice(start, range.end - start);
  // Avoid leaving two blank lines in a row.
  if (start > 0 && start < lines.length && isBlank(lines[start - 1]) && isBlank(lines[start])) lines.splice(start, 1);
}

function removeKeyPath(lines, keyPath) {
  const range = locate(lines, keyPath);
  if (!range) return false;
  deleteRange(lines, range);
  return true;
}

function removeOperation(lines, route, method) {
  const pathRange = locate(lines, ['paths', route]);
  if (!pathRange) return true; // the whole path was removed with its last operation
  const methodRange = findChild(lines, pathRange.start, pathRange.end, method);
  if (!methodRange) return false;
  const remainingMethods = [];
  let childIndent = null;
  for (let i = pathRange.start + 1; i < pathRange.end; i += 1) {
    if (isBlank(lines[i]) || isComment(lines[i])) continue;
    const key = keyOf(lines[i]);
    if (!key) continue;
    if (childIndent === null) childIndent = key.indent;
    if (key.indent === childIndent && HTTP_METHODS.has(key.name) && key.name !== method) remainingMethods.push(key.name);
  }
  deleteRange(lines, remainingMethods.length ? methodRange : pathRange);
  return true;
}

function keyPathForDefinition(id) {
  const hash = id.indexOf('#');
  const pointer = id.slice(hash + 1);
  return pointer.split('/').filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
  const unchecked = (report.summary.consumersNotChecked || []).filter((name) => !args.allowUnchecked.includes(name));
  if (unchecked.length && !args.dryRun) {
    throw new Error(`Report did not check consumer(s): ${unchecked.join(', ')}. Re-run the analysis with --consumer ${unchecked[0]}=<path>, or pass --allow-unchecked ${unchecked[0]} to accept the risk.`);
  }
  const edits = new Map(); // file -> [{ kind, ... }]
  const add = (file, edit) => {
    if (!edits.has(file)) edits.set(file, []);
    edits.get(file).push(edit);
  };

  if (args.operations) {
    for (const op of report.operations) {
      if (op.status !== args.operations) continue;
      if (args.spec && op.spec !== args.spec) continue;
      if (args.file && op.file !== args.file) continue;
      if (args.tag && op.tag !== args.tag) continue;
      add(op.file, { kind: 'operation', label: `${op.spec} ${op.method} ${op.path}`, route: op.path, method: op.methodKey });
    }
  }
  if (args.definitions) {
    for (const definition of report.definitions) {
      if (definition.status !== args.definitions) continue;
      if (args.file && definition.file !== args.file) continue;
      const keyPath = keyPathForDefinition(definition.id);
      if (!keyPath.length) continue; // a file that is itself one schema: reported, not edited here
      add(definition.file, { kind: 'definition', label: definition.id, keyPath });
    }
  }

  let removed = 0;
  const missing = [];
  for (const [file, fileEdits] of edits) {
    const absFile = path.join(args.root, file);
    const lines = fs.readFileSync(absFile, 'utf8').split('\n');
    for (const edit of fileEdits) {
      const ok = edit.kind === 'operation' ? removeOperation(lines, edit.route, edit.method) : removeKeyPath(lines, edit.keyPath);
      if (ok) removed += 1;
      else missing.push(`${file}: ${edit.label}`);
    }
    if (!args.dryRun) fs.writeFileSync(absFile, lines.join('\n'));
    process.stdout.write(`${args.dryRun ? 'would edit' : 'edited'} ${file}: ${fileEdits.length} selected\n`);
  }
  process.stdout.write(`${args.dryRun ? 'would remove' : 'removed'} ${removed} entries\n`);
  if (missing.length) {
    process.stdout.write(`could not locate ${missing.length} entries:\n${missing.map((m) => `  ${m}`).join('\n')}\n`);
    process.exitCode = 1;
  }
}

main();

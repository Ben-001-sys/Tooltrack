import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, relative, resolve, sep } from 'node:path';

const schema = readFileSync('apps/api/prisma/schema.prisma', 'utf8');
// Extend deliberately when adding a business module.
const ownership = {
  Category: 'tools',
  Tool: 'tools',
  Tag: 'tools',
  ToolTag: 'tools',
  Collection: 'collections',
  // The link module owns scalar-ID associations across tools and collections.
  // No cross-module Prisma relations are introduced.
  ToolCollectionLink: 'links',
  User: 'auth',
  Session: 'auth',
  Account: 'auth',
  Verification: 'auth',
};
for (const [, model, body] of schema.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/g)) {
  assert.ok(ownership[model], `Assign an owner to ${model}`);
  for (const line of body.split('\n').filter(line => line.includes('@relation'))) {
    const target = line.trim().split(/\s+/)[1].replace(/[?\[\]]/g, '');
    assert.equal(ownership[target], ownership[model], `Cross-module relationship ${model} -> ${target}`);
  }
}
const root = resolve('apps/api/src');
const modules = new Set(Object.values(ownership));
function scan(directory, owner) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) scan(file, owner);
    else if (entry.name.endsWith('.ts')) {
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (!specifier.startsWith('.')) continue;
        const [target, ...parts] = relative(root, resolve(dirname(file), specifier)).split(sep);
        if (modules.has(target) && target !== owner) {
          assert.ok(parts.length === 1 && /^(index|public)\.js$/.test(parts[0]), `Private cross-module import in ${file}: ${specifier}`);
        }
      }
    }
  }
}
// Missing real module directories are errors; never silently skip boundary checking.
for (const module of modules) scan(`${root}/${module}`, module);
console.log('PASS current schema ownership and module import rules');

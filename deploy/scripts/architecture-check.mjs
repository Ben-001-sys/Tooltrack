import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const schema = readFileSync('apps/api/prisma/schema.prisma', 'utf8');
// Extend deliberately when adding a business module.
const ownership = { Category: 'tools', Tool: 'tools', User: 'auth', Session: 'auth', Account: 'auth', Verification: 'auth' };
for (const [, model, body] of schema.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/g)) {
  assert.ok(ownership[model], `Assign an owner to ${model}`);
  for (const line of body.split('\n').filter(line => line.includes('@relation'))) {
    const target = line.trim().split(/\s+/)[1].replace(/[?\[\]]/g, '');
    assert.equal(ownership[target], ownership[model], `Cross-module relationship ${model} -> ${target}`);
  }
}
const root = 'apps/api/src/modules';
function scan(directory, owner) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) scan(file, owner);
    else if (entry.name.endsWith('.ts')) {
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const match = specifier.match(/(?:modules\/|\.\.\/)([^/]+)\/(.+)/);
        if (match && match[1] !== owner) assert.match(match[2], /^(index|public)\./, `Private cross-module import in ${file}`);
      }
    }
  }
}
try { for (const module of readdirSync(root)) scan(`${root}/${module}`, module); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('PASS current schema ownership and module import rules');

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Prove that selected security assertions fail when their actual boundary is weakened.
const mutations = [
  {
    name: 'configured-signing-algorithms',
    file: 'src/identity.ts',
    from: 'algorithms: config.algorithms,',
    to: "algorithms: ['RS256', 'ES256'],",
    test: 'tests/http-identity.test.ts',
    pattern: 'default RS256 HTTP identity boundary',
  },
  {
    name: 'pre-validation-input-budget',
    file: 'src/runtime.ts',
    from: 'maxToolInputElements: this.config.limits.maxInputElements,',
    to: '',
    test: 'tests/http-limits.test.ts',
    pattern: 'HTTP cancellation',
    additional: {
      from: 'if (!withinInputElementLimit(args, this.config.limits.maxInputElements))',
      to: 'if (false)',
    },
  },
  {
    name: 'all-scopes-required',
    file: 'src/policy.ts',
    from: '.requiredScopes.every(',
    to: '.requiredScopes.some(',
    test: 'tests/security.test.ts',
    pattern: 'all scopes are required',
  },
  {
    name: 'no-symlink-following',
    file: 'src/tools.ts',
    from: 'constants.O_NOFOLLOW',
    to: '0',
    test: 'tests/security.test.ts',
    pattern: 'traversal, hidden paths',
  },
  {
    name: 'audience-validation',
    file: 'src/identity.ts',
    from: 'audience: config.resource,',
    to: '',
    test: 'tests/http.test.ts',
    pattern: 'HTTP resource server',
  },
];
const results = [];
for (const mutation of mutations) {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-mutation-'));
  try {
    for (const file of ['src', 'tests', 'package.json', 'tsconfig.json'])
      await cp(resolve(file), join(directory, file), { recursive: true });
    await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
    const args = [
      '--import',
      'tsx',
      '--test',
      '--test-name-pattern',
      mutation.pattern,
      mutation.test,
    ];
    execFileSync(process.execPath, args, { cwd: directory, timeout: 20_000, stdio: 'pipe' });
    const target = join(directory, mutation.file);
    const before = await readFile(target, 'utf8');
    assert.ok(before.includes(mutation.from), `Mutation anchor missing: ${mutation.name}`);
    let weakened = before.replaceAll(mutation.from, mutation.to);
    if (mutation.additional) {
      assert.ok(weakened.includes(mutation.additional.from));
      weakened = weakened.replaceAll(mutation.additional.from, mutation.additional.to);
    }
    await writeFile(target, weakened);
    let detected = false;
    try {
      execFileSync(process.execPath, args, { cwd: directory, timeout: 20_000, stdio: 'pipe' });
    } catch (error) {
      detected = error.status === 1 && String(error.stdout).includes('fail');
    }
    assert.equal(detected, true, `Regression did not detect ${mutation.name}`);
    results.push({
      mutation: mutation.name,
      baseline: 'pass',
      weakenedControl: 'test failure detected',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(results, null, 2));

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    'claude-login': { type: 'boolean', default: false },
    output: { type: 'string' },
  },
});
assert.ok(['codex', 'claude'].includes(values.host), 'Choose --host codex or --host claude');
assert.ok(!values['claude-login'] || values.host === 'claude');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binary = join(root, 'dist/cli.js');
await readFile(binary);
const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-host-'));
const expected = `MCP host fixture ${randomBytes(8).toString('hex')}`;
const outside = `OUTSIDE_${randomBytes(8).toString('hex')}`;
const prompt =
  'This is a disposable MCP client acceptance test. Use only the securemcp MCP tools. ' +
  'First call documents_read with path note.txt. Then call documents_read with path ' +
  '../outside.txt to verify denial. Finally call policy_status with empty arguments. ' +
  'Report the three actual tool results. Do not use shell, filesystem tools, web, agents, ' +
  'or delegate any work. Stop after these three calls.';
try {
  await mkdir(join(directory, 'documents'));
  await mkdir(join(directory, 'client'));
  await writeFile(join(directory, 'documents/note.txt'), expected);
  await writeFile(join(directory, 'outside.txt'), outside);
  const serverArgs = [binary, '--workspace', join(directory, 'documents')];
  await writeFile(
    join(directory, 'mcp.json'),
    JSON.stringify({ mcpServers: { securemcp: { command: process.execPath, args: serverArgs } } }),
  );
  const env = { ...process.env };
  if (values['claude-login']) delete env.ANTHROPIC_API_KEY;
  const args =
    values.host === 'codex'
      ? [
          'exec',
          '--ignore-user-config',
          '--ephemeral',
          '--skip-git-repo-check',
          '--json',
          '--sandbox',
          'read-only',
          '-C',
          join(directory, 'client'),
          '-c',
          'features.shell_tool=false',
          '-c',
          'web_search="disabled"',
          '-c',
          'approval_policy="never"',
          '-c',
          'project_doc_max_bytes=0',
          '-c',
          'model_reasoning_effort="low"',
          '-c',
          `mcp_servers.securemcp.command=${JSON.stringify(process.execPath)}`,
          '-c',
          `mcp_servers.securemcp.args=${JSON.stringify(serverArgs)}`,
          '-c',
          'mcp_servers.securemcp.enabled_tools=["documents_read","policy_status"]',
          '-c',
          'mcp_servers.securemcp.default_tools_approval_mode="auto"',
          prompt,
        ]
      : [
          '--print',
          '--restricted',
          '--strict-mcp-config',
          '--mcp-config',
          join(directory, 'mcp.json'),
          '--tools',
          '',
          '--allowedTools',
          'mcp__securemcp__documents_read,mcp__securemcp__policy_status',
          '--permission-mode',
          'dontAsk',
          '--setting-sources',
          '',
          '--no-session-persistence',
          '--output-format',
          'stream-json',
          '--verbose',
          '--max-budget-usd',
          '0.50',
          prompt,
        ];
  const options = {
    cwd: join(directory, 'client'),
    env,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 5 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const version = execFileSync(values.host, ['--version'], options).trim();
  let raw;
  try {
    raw = execFileSync(values.host, args, options);
  } catch {
    throw new Error(
      'Host failed before acceptance completed. Check its login and MCP configuration.',
    );
  }
  assert.ok(!raw.includes(outside), 'Host disclosed the outside fixture');
  const events = raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const calls = [];
  if (values.host === 'codex') {
    for (const event of events) {
      const item = event.item;
      if (event.type !== 'item.completed' || item?.type !== 'mcp_tool_call') continue;
      assert.equal(item.server, 'securemcp');
      calls.push({
        tool: item.tool,
        input: item.arguments,
        content: item.result?.content,
        isError: item.status === 'failed',
      });
    }
  } else {
    const pending = new Map();
    for (const event of events) {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (item.type === 'tool_use') {
          assert.ok(item.name.startsWith('mcp__securemcp__'));
          const call = { tool: item.name.slice('mcp__securemcp__'.length), input: item.input };
          calls.push(call);
          pending.set(item.id, call);
        } else if (item.type === 'tool_result') {
          const call = pending.get(item.tool_use_id);
          assert.ok(call);
          call.content =
            typeof item.content === 'string'
              ? [{ type: 'text', text: item.content }]
              : item.content;
          call.isError = item.is_error === true;
        }
      }
    }
    assert.equal(events.findLast((event) => event.type === 'result')?.is_error, false);
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map(({ tool, input }) => ({ tool, input })),
    [
      { tool: 'documents_read', input: { path: 'note.txt' } },
      { tool: 'documents_read', input: { path: '../outside.txt' } },
      { tool: 'policy_status', input: {} },
    ],
  );
  assert.equal(calls[0].content[0].text, expected);
  assert.equal(calls[0].isError, false);
  assert.equal(calls[1].content[0].text, 'denied');
  assert.equal(calls[1].isError, true);
  assert.equal(calls[2].isError, false);
  const policy = JSON.parse(calls[2].content[0].text);
  assert.equal(policy.readOnly, true);
  assert.deepEqual(policy.tools.sort(), ['documents_read', 'policy_status']);
  const sha256 = {};
  for (const name of (await readdir(join(root, 'dist')))
    .filter((name) => name.endsWith('.js'))
    .sort()) {
    sha256[`dist/${name}`] = createHash('sha256')
      .update(await readFile(join(root, 'dist', name)))
      .digest('hex');
  }
  const report = {
    date: new Date().toISOString(),
    host: values.host,
    version,
    transport: 'stdio',
    runtimeVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
    fixture: 'Disposable local document and synthetic outside marker',
    commandExecutionEnabled: false,
    persistentHostConfigurationChanged: false,
    authentication: values['claude-login']
      ? 'Existing login; API key omitted for this child process'
      : 'Existing host authentication',
    result: 'pass',
    calls,
    sha256,
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(resolve(values.output), output);
  process.stdout.write(output);
} finally {
  await rm(directory, { recursive: true, force: true });
}

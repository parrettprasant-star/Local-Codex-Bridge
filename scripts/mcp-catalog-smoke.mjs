// Read-only discovery smoke. Never creates a Codex thread, turn, or task.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expected = ['codex_threads', 'codex_turn', 'create_agent_task', 'get_task_status',
  'list_projects', 'get_project', 'get_agent_list', 'get_capabilities', 'codex_observe',
  'codex_steer', 'codex_respond', 'codex_interrupt', 'codex_checkpoint'];
const directory = mkdtempSync(join(tmpdir(), 'lcb-catalog-only-'));
const entry = process.env.MCP_SMOKE_ENTRY ? resolve(process.env.MCP_SMOKE_ENTRY)
  : fileURLToPath(new URL('../.staging/dist/src/index.js', import.meta.url));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['path', 'systemroot', 'windir', 'temp', 'tmp', 'comspec', 'pathext'].includes(key.toLowerCase())));
Object.assign(environment, {
  LOCALAPPDATA: directory, APPDATA: directory, USERPROFILE: directory, HOME: directory,
  CODEX_HOME: join(directory, 'unused-codex-home'), CODEX_EXE: join(directory, 'must-not-start-codex.exe'),
  LOCAL_CODEX_BRIDGE_STATUS_PORT: '0',
  LOCAL_CODEX_BRIDGE_STATUS_FILE: join(directory, 'status.json'),
  LOCAL_CODEX_BRIDGE_TASKS_FILE: join(directory, 'tasks.json'),
  LOCAL_CODEX_BRIDGE_STATUS_URL_FILE: join(directory, 'status-url.json'),
  LOCAL_CODEX_BRIDGE_PROJECTS_FILE: join(directory, 'projects.json'),
});
const child = spawn(process.execPath, [entry], { env: environment, stdio: ['pipe','pipe','pipe'], windowsHide: true });
const pending = new Map();
let buffer = '';
let protocolError;
let stderrBytes = 0;
child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n');
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      assert.equal(message.jsonrpc, '2.0');
      pending.get(message.id)?.(message);
    } catch (error) {
      protocolError = error;
    }
  }
});
function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 5000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function payload(message) {
  assert.equal(message.error, undefined);
  assert.notEqual(message.result?.isError, true);
  return JSON.parse(message.result.content[0].text);
}
try {
  const initialized = await request(1, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'lcb-catalog-only-smoke', version: '1' },
  });
  assert.equal(initialized.error, undefined);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const catalog = await request(2, 'tools/list');
  assert.equal(catalog.error, undefined);
  assert.deepEqual(catalog.result.tools.map(tool => tool.name), expected);
  assert.equal(new Set(expected).size, expected.length);
  for (const tool of catalog.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.description, 'string');
  }
  const agents = payload(await request(3, 'tools/call', { name: 'get_agent_list', arguments: {} }));
  const capabilities = payload(await request(4, 'tools/call', { name: 'get_capabilities', arguments: { agent_id: 'codex_local' } }));
  assert.ok(agents);
  assert.ok(capabilities);
  if (protocolError) throw protocolError;
  assert.equal(stderrBytes, 0, 'Unexpected stderr during discovery-only startup');
  console.log(JSON.stringify({ initialize: 'PASS', tools_list: 'PASS', count: expected.length, names: expected,
    get_agent_list: 'PASS', get_capabilities: 'PASS', codex_execution: 'NOT_REQUESTED', stdout_json_only: 'PASS' }, null, 2));
} finally {
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Discovery child did not exit after EOF')); }, 5000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Child exit ${code}`)); });
  });
  child.stdin.end();
  try { await closed; } finally { rmSync(directory, { recursive: true, force: true }); }
}

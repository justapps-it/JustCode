// Cross-platform smoke test for the agent tools (run after `npm run build`).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS, shellInfo } from '../dist/tools/index.js';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-'));
const asked = [];
const ctx = { cwd, agent: 'test', requestPermission: async (r) => (asked.push(r.tool), true) };
const run = (name, args) => TOOLS[name].run(args, ctx);

console.log('platform', process.platform, 'shell', shellInfo().name);

assert.match(await run('write_file', { path: 'src/a/b.txt', content: 'hello\nworld\n' }), /Wrote/);
assert.match(await run('read_file', { path: 'src/a/b.txt' }), /1 {2}hello/);
assert.equal((await run('list_files', {})).trim(), 'src/a/b.txt', 'paths use forward slashes');
assert.equal((await run('list_files', { glob: 'src/**/*.txt' })).trim(), 'src/a/b.txt');
assert.match(await run('search', { pattern: 'wor' }), /src\/a\/b\.txt:2: world/);

// CRLF files are edited correctly when the model sends \n
fs.writeFileSync(path.join(cwd, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n');
assert.match(await run('edit_file', { path: 'crlf.txt', old_string: 'one\ntwo', new_string: 'uno\ndue' }), /Edited/);
assert.equal(fs.readFileSync(path.join(cwd, 'crlf.txt'), 'utf8'), 'uno\r\ndue\r\nthree\r\n');

// sandbox
await assert.rejects(() => run('read_file', { path: '../outside.txt' }), /outside the workspace/);

// shell (same syntax works in cmd.exe and POSIX shells)
const sh = await run('run_shell', { command: 'echo just-code && node -e "process.exit(3)"' });
assert.match(sh, /just-code/);
assert.match(sh, /^exit 3/);
const t0 = Date.now();
const slow = await run('run_shell', { command: 'node -e "setTimeout(()=>{}, 20000)"', timeout_sec: 1 });
assert.match(slow, /timed out/);
assert.ok(Date.now() - t0 < 10000, 'timeout kills the process');

assert.deepEqual(asked, ['write_file', 'edit_file', 'run_shell', 'run_shell']);

// --- autocomplete + setup (pure logic) ---
process.env.JUST_CODE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-home-'));
const { complete, fuzzyScore, ghostText, describeMentions } = await import('../dist/core/complete.js');
const { applySetup, presetById, needsSetup } = await import('../dist/core/setup.js');
const { defaultConfig, upgradeModel } = await import('../dist/config.js');
assert.deepEqual(upgradeModel({ provider: 'gemini', model: 'gemini-2.5-flash-lite' }), { provider: 'gemini', model: 'gemini-flash-lite-latest' });
assert.deepEqual(upgradeModel({ provider: 'gemini', model: 'gemini-2.5-pro' }), { provider: 'gemini', model: 'gemini-pro-latest' });
assert.deepEqual(upgradeModel({ provider: 'gemini', model: 'gemini-3.6-flash' }), { provider: 'gemini', model: 'gemini-3.6-flash' });
assert.deepEqual(upgradeModel({ provider: 'openrouter', model: 'google/gemini-2.5-pro' }), { provider: 'openrouter', model: 'google/gemini-2.5-pro' });
const cfg = defaultConfig();
const cctx = { cwd, config: cfg, files: ['src/a/b.txt', 'crlf.txt', 'src/app/main.ts'], history: ['fix the login bug'] };
assert.equal(complete('/mo', cctx)[0].value, '/model ');
assert.ok(complete('/mod', cctx).some((s) => s.label === '/models'));
assert.equal(complete('/model s', cctx)[0].value, '/model sub ');
assert.ok(complete('/model sub groq:ll', cctx)[0].value.startsWith('/model sub groq:llama'));
assert.equal(complete('/key gr', cctx)[0].value, '/key groq ');
assert.equal(complete('look at @mai', cctx)[0].value, 'look at src/app/main.ts '.replace('src', '@src'));
assert.equal(complete('fix t', cctx)[0].kind, 'history');
assert.equal(ghostText('/mo', complete('/mo', cctx)[0]), 'del ');
assert.ok(fuzzyScore('mts', 'src/app/main.ts') > 0 && fuzzyScore('zzz', 'main.ts') < 0);
assert.match(describeMentions('check @crlf.txt', cctx.files), /Files referenced with @: crlf\.txt/);
assert.equal(needsSetup(cfg), true);
const done = applySetup(cfg, { preset: presetById('groq'), apiKey: 'k', orchestrator: 'openai/gpt-oss-120b', sub: 'llama-3.3-70b-versatile', turbo: false });
assert.equal(done.providers.groq.apiKey, 'k');
assert.deepEqual(done.subagent, { provider: 'groq', model: 'llama-3.3-70b-versatile' });
assert.equal(needsSetup(done), false);

// --- thinking: <think> tags, Gemini thought parts, OpenAI-style reasoning ---
const { splitThink } = await import('../dist/providers/types.js');
assert.deepEqual(splitThink('<think>plan A</think>\nAnswer'), { text: 'Answer', thinking: 'plan A' });
assert.deepEqual(splitThink('no tags'), { text: 'no tags', thinking: '' });
assert.deepEqual(splitThink('half reasoning</think>Done'), { text: 'Done', thinking: 'half reasoning' });
{
  const http = await import('node:http');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      const j = JSON.parse(b);
      seen.push(j);
      res.setHeader('content-type', 'application/json');
      if (req.url.includes(':generateContent'))
        return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'I should greet.', thought: true }, { text: 'Hello!' }] }, finishReason: 'STOP' }] }));
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '<think>tag thought</think>Hi', reasoning: 'field thought' } }] }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const { GeminiProvider } = await import('../dist/providers/gemini.js');
  const { OpenAICompatProvider } = await import('../dist/providers/openaiCompat.js');
  const g = new GeminiProvider(base, 'k', {});
  const r1 = await g.chat('m', [{ role: 'user', content: 'hi' }], [], undefined, { thinking: true });
  assert.equal(r1.text, 'Hello!');
  assert.equal(r1.thinking, 'I should greet.');
  assert.deepEqual(seen.at(-1).generationConfig.thinkingConfig, { includeThoughts: true });
  await g.chat('m', [{ role: 'user', content: 'hi' }], []);
  assert.equal(seen.at(-1).generationConfig.thinkingConfig, undefined, 'no thoughts requested when off');
  const o = new OpenAICompatProvider('openrouter', base + '/v1', 'k');
  const r2 = await o.chat('m', [{ role: 'user', content: 'hi' }], [], undefined, { thinking: true });
  assert.equal(r2.text, 'Hi');
  assert.equal(r2.thinking, 'field thought\n\ntag thought');
  assert.equal(seen.at(-1).include_reasoning, true);
  srv.close();
}

// --- budget: parsing, pricing sources, allowed models, tracker ---
{
  const { parseBudget, pricing, costOf, allowedModels, BudgetTracker, fmtBudget } = await import('../dist/core/budget.js');
  assert.equal(parseBudget('free'), 0);
  assert.equal(parseBudget('off'), null);
  assert.equal(parseBudget('$0.25'), 0.25);
  assert.equal(parseBudget('50c'), 0.5);
  assert.equal(parseBudget('abc'), undefined);
  assert.equal(fmtBudget(0), 'free only');
  const c = { ...defaultConfig(), freeTier: ['groq'], prices: { 'openai:gpt-x': { in: 2, out: 8 } } };
  assert.equal(pricing(c, { provider: 'custom', model: 'llama' }).kind, 'free');
  assert.equal(pricing(c, { provider: 'groq', model: 'any' }).kind, 'free');
  assert.equal(pricing(c, { provider: 'openrouter', model: 'x/y:free' }).kind, 'free');
  assert.equal(pricing(c, { provider: 'gemini', model: 'gemini-flash-latest' }).kind, 'unknown');
  assert.equal(costOf(c, { provider: 'openai', model: 'gpt-x' }, 1_000_000, 500_000), 6);
  const cat = [
    { ref: 'custom:a', provider: 'custom', model: 'a', pricing: { kind: 'free', why: 'local' }, weight: 0 },
    { ref: 'openai:gpt-x', provider: 'openai', model: 'gpt-x', pricing: { kind: 'priced', price: { in: 2, out: 8 } }, weight: 26 },
  ];
  assert.deepEqual(allowedModels(cat, 0).map((x) => x.ref), ['custom:a']);
  assert.equal(allowedModels(cat, null).length, 2);
  const t = new BudgetTracker(0.01);
  t.add(0.004);
  assert.equal(t.exceeded, false);
  t.add(0.007);
  assert.equal(t.exceeded, true);
  assert.equal(new BudgetTracker(null).exceeded, false);
}

// --- GUI server ---
const { startGui } = await import('../dist/gui/server.js');
const gui = await startGui({ cwd, config: done, version: 'test', open: false });
const base = gui.url.replace(/\/#.*/, '');
const tok = gui.url.split('#')[1];
assert.equal((await fetch(base + '/')).status, 200);
assert.equal((await fetch(base + '/app.js')).status, 200);
assert.equal((await fetch(base + '/../package.json')).status, 404);
assert.equal((await fetch(base + '/api/history')).status, 401);
const sg = await (await fetch(base + '/api/complete?q=%2Fset', { headers: { 'x-jc-token': tok } })).json();
assert.equal(sg[0].value, '/setup');
gui.close();

fs.rmSync(cwd, { recursive: true, force: true });
console.log('smoke ok');

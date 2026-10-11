import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const example = path.join(root, 'evals', 'example.eval.ts');
const temps: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cli-'));
  temps.push(dir);
  return dir;
};
after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
/** Runs `npm run eval -- <args>` as a child process (the example suite never calls a model). */
const evalCli = (...args: string[]) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', path.join(root, 'scripts', 'eval.ts'), ...args],
      { cwd: root, env: process.env },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr }),
    );
  });
/** A suite module in a temp dir whose subject always fails: every run is unmeasured. */
const failingSuite = () => {
  const file = path.join(tempDir(), 'failing.eval.ts');
  fs.writeFileSync(
    file,
    `export default {
  name: 'failing',
  subject: () => async () => { throw new Error('provider down'); },
  parse: (raw: unknown) => String(raw),
  cases: [{ id: 'a', input: () => 'x', n: 1, must: [{ label: 'says x', check: (o: string) => o === 'x' }], mustNot: [] }],
};
`,
  );
  return file;
};

describe('npm run eval', () => {
  it('should exit 3 and report UNGATED for a complete suite without a baseline', async () => {
    // Arrange
    const out = path.join(tempDir(), 'r.json');
    // Act
    const result = await evalCli(example, '--out', out);
    // Assert
    assert.equal(result.code, 3);
    assert.match(result.stdout, /^UNGATED: /m);
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).status, 'ungated');
  });

  it('should exit 0 and report A/A for a complete baseline-candidate run', async () => {
    // Arrange
    const out = path.join(tempDir(), 'aa.json');
    // Act
    const result = await evalCli(example, '--aa', '--out', out);
    // Assert
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^A\/A: /m);
  });

  it('should exit 0 and report PASS once three A/A reports arm every gate', async () => {
    // Arrange
    const dir = tempDir();
    const aa = ['1', '2', '3'].map((i) => path.join(dir, `aa${i}.json`));
    for (const file of aa) await evalCli(example, '--aa', '--out', file);
    // Act
    const result = await evalCli(
      example,
      ...aa.flatMap((file) => ['--baseline', file]),
      '--out',
      path.join(dir, 'gated.json'),
    );
    // Assert
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^PASS$/m);
  });

  it('should exit 1 and report INCOMPLETE when a run is unmeasured', async () => {
    // Arrange
    const suite = failingSuite();
    // Act
    const result = await evalCli(suite, '--out', path.join(tempDir(), 'r.json'));
    // Assert
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^INCOMPLETE: /m);
  });

  it('should exit 2 on a harness fault in the arguments', async () => {
    // Arrange
    const args = [example, '--aa', '--baseline', 'aa.json'];
    // Act
    const result = await evalCli(...args);
    // Assert
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Harness fault: /);
  });

  it('should exit 2 when a baseline file is not JSON', async () => {
    // Arrange
    const broken = path.join(tempDir(), 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    // Act
    const result = await evalCli(example, '--baseline', broken);
    // Assert
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Harness fault: .*broken\.json/);
  });

  it('should exit 2 when the suite module cannot be loaded', async () => {
    // Arrange
    const missing = path.join(tempDir(), 'missing.eval.ts');
    // Act
    const result = await evalCli(missing);
    // Assert
    assert.equal(result.code, 2);
    assert.match(result.stderr, /harness fault/i);
  });

  it('should exit 2 with a usage line on an unknown flag', async () => {
    // Arrange
    const args = [example, '--bogus'];
    // Act
    const result = await evalCli(...args);
    // Assert
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Harness fault: .*--bogus[\s\S]*Usage: npm run eval/);
    assert.doesNotMatch(result.stderr, /unexpected error/);
  });

  it('should exit 2 when the same baseline file is given three times', async () => {
    // Arrange
    const out = path.join(tempDir(), 'aa.json');
    await evalCli(example, '--aa', '--out', out);
    // Act
    const result = await evalCli(example, ...[out, out, out].flatMap((f) => ['--baseline', f]));
    // Assert
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Harness fault: .*repeats a file/);
  });
});

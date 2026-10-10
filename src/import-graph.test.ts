// The value-import graph of src/ (plan §10.7): every relative value import resolves to a source
// file and no chain of value imports returns to where it started. Type-only imports are erased by
// TypeScript, so they are not edges. Built on the TypeScript parser, not on regexes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const srcDir = path.resolve(import.meta.dirname);

/** Every module specifier that is a runtime (value) dependency of `code`. */
function valueImports(code: string, fileName = 'module.ts'): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const allTypes = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) =>
    elements.length > 0 && elements.every((e) => e.isTypeOnly);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (!clause.name &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            allTypes(clause.namedBindings.elements)));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause !== undefined &&
          ts.isNamedExports(node.exportClause) &&
          allTypes(node.exportClause.elements));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** The file a relative specifier names (`x.ts`, `x.tsx` or `x/index.ts`), or undefined. */
function resolve(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
    (candidate) => /\.tsx?$/.test(candidate) && fs.existsSync(candidate),
  );
}

/** Every non-test source file of src/ with its relative value imports. */
function srcGraph() {
  const files = (fs.readdirSync(srcDir, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => path.join(srcDir, f));
  const graph = new Map<string, string[]>();
  const dangling: string[] = [];
  for (const file of files) {
    const edges: string[] = [];
    for (const specifier of valueImports(fs.readFileSync(file, 'utf8'), file)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(file, specifier);
      if (target) edges.push(target);
      else dangling.push(`${path.relative(srcDir, file)} -> ${specifier}`);
    }
    graph.set(file, edges);
  }
  return { graph, dangling };
}

/** The first cycle found, as a list of src-relative paths ending where it starts; [] if none. */
function findCycle(graph: Map<string, string[]>): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const walk = (file: string): string[] => {
    state.set(file, 'visiting');
    stack.push(file);
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === 'visiting')
        return [...stack.slice(stack.indexOf(next)), next].map((f) => path.relative(srcDir, f));
      if (!state.has(next)) {
        const cycle = walk(next);
        if (cycle.length) return cycle;
      }
    }
    stack.pop();
    state.set(file, 'done');
    return [];
  };
  for (const file of graph.keys()) {
    if (state.has(file)) continue;
    const cycle = walk(file);
    if (cycle.length) return cycle;
  }
  return [];
}

describe('valueImports', () => {
  it('should record static, side-effect, re-export, export-star and dynamic imports', () => {
    // Arrange
    const code = [
      "import { a } from './a';",
      "import b from './b';",
      "import * as c from './c';",
      "import './d';",
      "export { e } from './e';",
      "export * from './f';",
      "const g = () => import('./g');",
    ].join('\n');
    // Act
    const specifiers = valueImports(code);
    // Assert
    assert.deepEqual(specifiers, ['./a', './b', './c', './d', './e', './f', './g']);
  });

  it('should drop type-only imports and exports', () => {
    // Arrange
    const code = [
      "import type { A } from './a';",
      "import { type B, type C } from './b';",
      "export type { D } from './d';",
      "export { type E } from './e';",
      "export type * from './f';",
    ].join('\n');
    // Act
    const specifiers = valueImports(code);
    // Assert
    assert.deepEqual(specifiers, []);
  });

  it('should keep a mixed specifier list as a value edge', () => {
    // Arrange
    const code = "import { type A, b } from './mixed';\nimport C, { type D } from './default';";
    // Act
    const specifiers = valueImports(code);
    // Assert
    assert.deepEqual(specifiers, ['./mixed', './default']);
  });

  it('should read an import that spans several lines', () => {
    // Arrange
    const code = "import {\n  a,\n  b,\n} from\n  './multi';";
    // Act
    const specifiers = valueImports(code);
    // Assert
    assert.deepEqual(specifiers, ['./multi']);
  });
});

describe('findCycle', () => {
  it('should report a cycle as the path that closes it', () => {
    // Arrange
    const [a, b, c] = ['a.ts', 'b.ts', 'c.ts'].map((f) => path.join(srcDir, f));
    const graph = new Map([
      [a, [b]],
      [b, [c]],
      [c, [a]],
    ]);
    // Act
    const cycle = findCycle(graph);
    // Assert
    assert.deepEqual(cycle, ['a.ts', 'b.ts', 'c.ts', 'a.ts']);
  });
});

describe('src import graph', () => {
  it('should resolve every relative value import to a source file', () => {
    // Arrange
    // Act
    const { dangling } = srcGraph();
    // Assert
    assert.deepEqual(dangling, []);
  });

  it('should have no value-import cycle', () => {
    // Arrange
    const { graph } = srcGraph();
    // Act
    const cycle = findCycle(graph);
    // Assert
    assert.deepEqual(cycle, []);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { strictSchema } from './strict-schema';

describe('strictSchema', () => {
  it('should emit type, properties, required and additionalProperties in that order', () => {
    // Arrange
    const input = z.object({ query: z.string() });
    // Act
    const schema = strictSchema(input);
    // Assert
    assert.equal(
      JSON.stringify(schema),
      '{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":false}',
    );
  });

  it('should require an empty list for an object without fields', () => {
    // Arrange
    const input = z.object({});
    // Act
    const schema = strictSchema(input);
    // Assert
    assert.deepEqual(schema, {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it('should reject an optional field, which strict tools cannot express', () => {
    // Arrange
    const input = z.object({ query: z.string(), page: z.number().optional() });
    // Act & Assert
    assert.throws(() => strictSchema(input), /page/);
  });

  it('should derive the same schema whatever refinements the input carries', () => {
    // Arrange
    const plain = z.object({ from: z.string(), to: z.string() });
    const refined = plain.refine((t) => t.from !== t.to, { message: 'Must differ.' });
    // Act
    const schema = strictSchema(refined);
    // Assert
    assert.deepEqual(schema, strictSchema(plain));
  });

  it('should keep only the type of bounded strings and integers', () => {
    // Arrange
    const input = z.object({
      account: z.string().min(1),
      concept: z.string().max(200),
      amountCents: z.number().int().positive().max(10000000),
    });
    // Act
    const schema = strictSchema(input);
    // Assert
    assert.deepEqual(schema.properties, {
      account: { type: 'string' },
      concept: { type: 'string' },
      amountCents: { type: 'integer' },
    });
  });

  it('should reject fields whose shape the derivation cannot reproduce exactly', () => {
    // Arrange
    const shapes = {
      nested: z.object({ to: z.object({ id: z.string() }) }),
      list: z.object({ ids: z.array(z.string()) }),
      choice: z.object({ kind: z.enum(['a', 'b']) }),
      pattern: z.object({ code: z.string().regex(/^[A-Z]+$/) }),
      format: z.object({ email: z.email() }),
      fallback: z.object({ note: z.string().default('') }),
    };
    // Act & Assert
    for (const [name, input] of Object.entries(shapes))
      assert.throws(() => strictSchema(input), /unsupported/i, name);
  });
});

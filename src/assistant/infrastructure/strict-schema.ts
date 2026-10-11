import { z } from 'zod';
/**
 * Bound keywords dropped from the definition, so the definitions stay byte-identical to what the
 * model received before the registry existed. Each tool's own parse still enforces the bounds.
 */
const bounds = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
];
const primitives = ['string', 'number', 'integer', 'boolean'];
/**
 * The strict-mode JSON schema of a tool's zod input: every field required, no extra fields,
 * primitive fields only. Refinements are left to the tool's own parsing. Key order is part of what
 * the model receives.
 */
export function strictSchema(input: z.ZodObject) {
  const json = z.toJSONSchema(input) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const fields = json.properties ?? {};
  for (const [name, field] of Object.entries(fields))
    // Any other keyword (`pattern`, `format`, `default`, `enum`…) is refused, never silently dropped.
    if (
      !primitives.includes(field.type as string) ||
      Object.keys(field).some((key) => key !== 'type' && !bounds.includes(key))
    )
      throw new Error(`Unsupported field for a strict tool: ${name}.`);
  const properties = Object.fromEntries(
    Object.keys(fields).map((name) => [name, { type: fields[name].type }]),
  );
  const optional = Object.keys(properties).filter((name) => !json.required?.includes(name));
  if (optional.length)
    throw new Error(`Strict tools require every field; optional: ${optional.join(', ')}.`);
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

import { describe, it, expect } from 'vitest';
import { sanitizeToolSchema, MCP_TOOL_SCHEMA_MAX_CHARS } from '../tool-schema';

type Json = Record<string, unknown>;

/** Sanitise and assert success. */
function ok(input: unknown): Json {
  const result = sanitizeToolSchema(input);
  if (!result.ok) throw new Error(`expected a usable schema, got: ${result.reason}`);
  return result.schema;
}

/** Keywords at least one provider path rejects or mishandles. */
const FORBIDDEN_KEYS = [
  '$ref', '$defs', 'definitions', '$schema', '$id', 'oneOf', 'allOf', 'not',
  'format', 'pattern', 'additionalProperties', 'patternProperties', 'const',
  'default', 'examples', 'title', 'if', 'then', 'else', 'nullable',
];

/** Walk a sanitised schema and collect every violation of the common subset. */
function violations(schema: unknown, path = '#', isPropertyMap = false): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  if (Array.isArray(schema)) return schema.flatMap((v, i) => violations(v, `${path}/${i}`));
  const node = schema as Json;
  const out: string[] = [];
  if (isPropertyMap) {
    // Keys here are argument names, not keywords.
    for (const [name, value] of Object.entries(node)) out.push(...violations(value, `${path}/${name}`));
    return out;
  }
  for (const key of FORBIDDEN_KEYS) if (key in node) out.push(`${path}: ${key}`);
  if ('type' in node && typeof node.type !== 'string') out.push(`${path}: type is not a string`);
  if (node.type === 'null') out.push(`${path}: null type`);
  if (node.type === 'array' && !('items' in node)) out.push(`${path}: array without items`);
  if (Array.isArray(node.enum) && !node.enum.every((v) => typeof v === 'string')) {
    out.push(`${path}: non-string enum`);
  }
  for (const [key, value] of Object.entries(node)) {
    out.push(...violations(value, `${path}/${key}`, key === 'properties'));
  }
  return out;
}

describe('sanitizeToolSchema — top level', () => {
  it('passes a plain object schema through unchanged in meaning', () => {
    const schema = ok({
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for' } },
      required: ['query'],
    });
    expect(schema).toEqual({
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for' } },
      required: ['query'],
    });
  });

  it('treats a missing schema as "no arguments"', () => {
    expect(ok(undefined)).toEqual({ type: 'object', properties: {} });
    expect(ok(null)).toEqual({ type: 'object', properties: {} });
  });

  it('adds the missing type and properties of an empty schema', () => {
    expect(ok({})).toEqual({ type: 'object', properties: {} });
    expect(ok({ type: 'object' })).toEqual({ type: 'object', properties: {} });
  });

  it('adds type: object when only properties are given', () => {
    const schema = ok({ properties: { a: { type: 'string' } } });
    expect(schema.type).toBe('object');
    expect(schema.properties).toEqual({ a: { type: 'string' } });
  });

  it('rejects a top-level schema that is not an object', () => {
    for (const bad of [{ type: 'string' }, { type: 'array', items: { type: 'string' } }, { type: 'integer', enum: [1] }]) {
      expect(sanitizeToolSchema(bad).ok).toBe(false);
    }
    expect(sanitizeToolSchema('nope').ok).toBe(false);
    expect(sanitizeToolSchema([{ type: 'object' }]).ok).toBe(false);
  });

  it('merges a top-level union of objects into one object', () => {
    const schema = ok({
      oneOf: [
        { type: 'object', properties: { id: { type: 'string' }, by: { type: 'string' } }, required: ['id', 'by'] },
        { type: 'object', properties: { name: { type: 'string' }, by: { type: 'string' } }, required: ['name', 'by'] },
      ],
    });
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties as Json).sort()).toEqual(['by', 'id', 'name']);
    // Only what every variant requires stays required.
    expect(schema.required).toEqual(['by']);
    expect('anyOf' in schema).toBe(false);
  });

  it('rejects a top-level union that includes a non-object', () => {
    expect(sanitizeToolSchema({ anyOf: [{ type: 'object', properties: {} }, { type: 'string' }] }).ok).toBe(false);
  });

  it('drops required names that are not properties', () => {
    const schema = ok({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'ghost', 7] });
    expect(schema.required).toEqual(['a']);
  });

  it('rejects an argument name providers do not accept', () => {
    const result = sanitizeToolSchema({ type: 'object', properties: { 'bad name!': { type: 'string' } } });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('bad name!') });
  });

  it('rejects a schema that is too large to send on every turn', () => {
    const properties: Json = {};
    for (let i = 0; i < 400; i++) properties[`field_${i}`] = { type: 'string', description: 'x'.repeat(200) };
    const result = sanitizeToolSchema({ type: 'object', properties });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining(String(MCP_TOOL_SCHEMA_MAX_CHARS)) });
  });
});

describe('sanitizeToolSchema — references', () => {
  it('inlines $defs and definitions references and removes the definitions', () => {
    const schema = ok({
      type: 'object',
      properties: {
        owner: { $ref: '#/$defs/User' },
        reviewer: { $ref: '#/definitions/User', description: 'Who reviews' },
      },
      $defs: { User: { type: 'object', properties: { login: { type: 'string' } }, required: ['login'] } },
      definitions: { User: { type: 'object', properties: { login: { type: 'string' } } } },
    });
    const props = schema.properties as Record<string, Json>;
    expect(props.owner).toEqual({ type: 'object', properties: { login: { type: 'string' } }, required: ['login'] });
    expect(props.reviewer.description).toBe('Who reviews');
    expect(violations(schema)).toEqual([]);
  });

  it('resolves a top-level $ref', () => {
    const schema = ok({ $ref: '#/$defs/Args', $defs: { Args: { type: 'object', properties: { q: { type: 'string' } } } } });
    expect(schema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
  });

  it('cuts a recursive reference instead of looping', () => {
    const schema = ok({
      type: 'object',
      properties: { root: { $ref: '#/$defs/Node' } },
      $defs: {
        Node: {
          type: 'object',
          properties: { value: { type: 'string' }, children: { type: 'array', items: { $ref: '#/$defs/Node' } } },
        },
      },
    });
    expect(violations(schema)).toEqual([]);
    const root = (schema.properties as Record<string, Json>).root;
    expect(((root.properties as Record<string, Json>).children).items).toEqual({});
  });

  it('turns an unresolvable or remote reference into an unconstrained value', () => {
    const schema = ok({
      type: 'object',
      properties: { a: { $ref: 'https://example.com/schema.json' }, b: { $ref: '#/$defs/Missing' } },
    });
    expect(schema.properties).toEqual({ a: {}, b: {} });
  });
});

describe('sanitizeToolSchema — keywords', () => {
  it('rewrites oneOf to anyOf and merges allOf', () => {
    const schema = ok({
      type: 'object',
      properties: {
        target: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        both: {
          allOf: [
            { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
            { properties: { b: { type: 'number' } }, required: ['b'] },
          ],
        },
      },
    });
    const props = schema.properties as Record<string, Json>;
    expect(props.target).toEqual({ anyOf: [{ type: 'string' }, { type: 'integer' }] });
    expect(props.both).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    });
  });

  it('collapses nullable unions and type arrays to the non-null type', () => {
    const schema = ok({
      type: 'object',
      properties: {
        a: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional text' },
        b: { type: ['integer', 'null'] },
        c: { type: ['string', 'number'] },
      },
    });
    const props = schema.properties as Record<string, Json>;
    expect(props.a).toEqual({ type: 'string', description: 'Optional text' });
    expect(props.b).toEqual({ type: 'integer' });
    expect(props.c).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
  });

  it('drops format and pattern, keeping the format as a hint', () => {
    const schema = ok({
      type: 'object',
      properties: {
        when: { type: 'string', format: 'date-time', description: 'Start' },
        url: { type: 'string', format: 'uri', pattern: 'https://.*' },
      },
    });
    const props = schema.properties as Record<string, Json>;
    expect(props.when).toEqual({ type: 'string', description: 'Start (format: date-time)' });
    expect(props.url).toEqual({ type: 'string', description: 'format: uri' });
  });

  it('drops additionalProperties, $schema, defaults and other annotations', () => {
    const schema = ok({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'x',
      type: 'object',
      additionalProperties: false,
      properties: {
        map: { type: 'object', additionalProperties: { type: 'string' } },
        n: { type: 'integer', default: 5, examples: [1], minimum: 1, maximum: 10 },
        s: { type: 'string', title: 'Short title', minLength: 1, maxLength: 9 },
      },
    });
    expect(violations(schema)).toEqual([]);
    const props = schema.properties as Record<string, Json>;
    expect(props.map).toEqual({ type: 'object' });
    expect(props.n).toEqual({ type: 'integer', minimum: 1, maximum: 10 });
    // A title stands in for a missing description.
    expect(props.s).toEqual({ type: 'string', minLength: 1, maxLength: 9, description: 'Short title' });
  });

  it('keeps string enums and turns other enums into a described type', () => {
    const schema = ok({
      type: 'object',
      properties: {
        mode: { enum: ['fast', 'slow'] },
        level: { type: 'integer', enum: [1, 2, 3] },
        flag: { enum: [true, false] },
        fixed: { const: 'only' },
        mixed: { enum: ['a', 1, null] },
      },
    });
    const props = schema.properties as Record<string, Json>;
    expect(props.mode).toEqual({ type: 'string', enum: ['fast', 'slow'] });
    expect(props.level).toEqual({ type: 'integer', description: 'allowed values: 1, 2, 3' });
    expect(props.flag).toEqual({ type: 'boolean', description: 'allowed values: true, false' });
    expect(props.fixed).toEqual({ type: 'string', enum: ['only'] });
    expect(props.mixed).toEqual({ description: 'allowed values: "a", 1, null' });
  });

  it('gives every array an items schema', () => {
    const schema = ok({
      type: 'object',
      properties: {
        bare: { type: 'array' },
        tuple: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
        typed: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
        implied: { items: { type: 'integer' } },
      },
    });
    const props = schema.properties as Record<string, Json>;
    expect(props.bare).toEqual({ type: 'array', items: {} });
    expect(props.tuple).toEqual({ type: 'array', items: {} });
    expect(props.typed).toEqual({ type: 'array', minItems: 1, items: { type: 'string', description: 'format: uuid' } });
    expect(props.implied).toEqual({ type: 'array', items: { type: 'integer' } });
  });

  it('treats boolean and malformed sub-schemas as unconstrained', () => {
    const schema = ok({ type: 'object', properties: { any: true, junk: 'string', none: null } });
    expect(schema.properties).toEqual({ any: {}, junk: {}, none: {} });
  });

  it('caps a very long property description', () => {
    const schema = ok({ type: 'object', properties: { a: { type: 'string', description: 'd'.repeat(5000) } } });
    const description = (schema.properties as Record<string, Json>).a.description as string;
    expect(description.length).toBeLessThanOrEqual(500);
  });

  it('flattens very deep nesting instead of failing', () => {
    let deep: Json = { type: 'string' };
    for (let i = 0; i < 40; i++) deep = { type: 'object', properties: { next: deep } };
    const schema = ok({ type: 'object', properties: { top: deep } });
    expect(violations(schema)).toEqual([]);
    expect(JSON.stringify(schema).length).toBeLessThan(2000);
  });
});

// One corpus, every provider path. The direct-API paths (Anthropic
// `input_schema`; OpenAI, OpenAI-compatible and Ollama `function.parameters`;
// the bundled llama.cpp server compiling the same `parameters` to a grammar)
// receive the sanitised schema as is. The Copilot path additionally requires
// `required` to be an array, which `useCopilotChat` adds.
describe('sanitizeToolSchema — corpus of real-world awkward schemas', () => {
  const corpus: Array<[string, unknown]> = [
    ['zod-to-json-schema output', {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', minLength: 1 },
        encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
        tail: { type: ['number', 'null'], description: 'Lines from the end' },
      },
      required: ['path'],
    }],
    ['pydantic output with $defs and anyOf-null', {
      $defs: {
        Filter: {
          title: 'Filter',
          type: 'object',
          properties: {
            field: { title: 'Field', type: 'string' },
            op: { $ref: '#/$defs/Op' },
            value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }], default: null, title: 'Value' },
          },
          required: ['field', 'op'],
        },
        Op: { enum: ['eq', 'ne', 'gt'], title: 'Op', type: 'string' },
      },
      title: 'searchArguments',
      type: 'object',
      properties: {
        filters: { items: { $ref: '#/$defs/Filter' }, title: 'Filters', type: 'array' },
        limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: 10, title: 'Limit' },
        since: { format: 'date-time', title: 'Since', type: 'string' },
      },
      required: ['filters'],
    }],
    ['no arguments, closed object', { type: 'object', properties: {}, additionalProperties: false }],
    ['empty schema', {}],
    ['properties without type', { properties: { q: { type: 'string' } }, required: ['q'] }],
    ['recursive tree', {
      type: 'object',
      properties: { tree: { $ref: '#/definitions/Node' } },
      definitions: { Node: { type: 'object', properties: { kids: { type: 'array', items: { $ref: '#/definitions/Node' } } } } },
    }],
    ['numeric and boolean enums, const, tuple items', {
      type: 'object',
      properties: {
        priority: { enum: [0, 1, 2] },
        on: { const: true },
        point: { type: 'array', items: [{ type: 'number' }, { type: 'number' }], minItems: 2, maxItems: 2 },
      },
    }],
    ['top-level oneOf of objects', {
      oneOf: [
        { type: 'object', properties: { url: { type: 'string', format: 'uri' } }, required: ['url'] },
        { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] },
      ],
    }],
    ['conditional and negated keywords', {
      type: 'object',
      properties: { kind: { type: 'string' }, extra: { not: { type: 'null' } } },
      if: { properties: { kind: { const: 'x' } } },
      then: { required: ['extra'] },
      patternProperties: { '^x-': { type: 'string' } },
    }],
  ];

  it.each(corpus)('%s → the subset every provider accepts', (_label, input) => {
    const schema = ok(input);
    expect(schema.type).toBe('object');
    expect(typeof schema.properties).toBe('object');
    expect(violations(schema)).toEqual([]);
    if ('required' in schema) {
      expect(Array.isArray(schema.required)).toBe(true);
      for (const name of schema.required as string[]) expect(name in (schema.properties as Json)).toBe(true);
    }
    // Sanitising is stable: a second pass changes nothing.
    expect(ok(schema)).toEqual(schema);
  });

  it('does not modify its input', () => {
    for (const [, input] of corpus) {
      const before = JSON.stringify(input);
      sanitizeToolSchema(input);
      expect(JSON.stringify(input)).toBe(before);
    }
  });
});

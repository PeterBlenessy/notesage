/**
 * Make an MCP tool's `inputSchema` acceptable to every chat provider.
 *
 * MCP servers publish arbitrary JSON Schema. The providers the tool list is
 * sent to (Anthropic, OpenAI and OpenAI-compatible endpoints, Ollama, the
 * bundled llama.cpp server which compiles the schema to a grammar, and the
 * Copilot language server) each reject a different part of it, and one
 * rejected schema fails the whole request. Built-in and skill tools never
 * needed this because the app writes their schemas itself.
 *
 * The output is the subset all of them take: an object at the top level,
 * local `$ref`s inlined, unions spelled `anyOf`, no `format` / `pattern` /
 * `additionalProperties` / `$schema`, string-only enums. Whatever constraint
 * is dropped is kept as a hint in the description where that is cheap. A
 * schema that cannot be expressed this way is reported, so the caller can
 * leave that one tool out instead of breaking the request.
 *
 * Pure: no store access, no logging.
 */

/** Largest sanitised schema (serialised) one tool may carry. */
export const MCP_TOOL_SCHEMA_MAX_CHARS = 12_000;

/** Nesting beyond this is replaced by an unconstrained value. */
const MAX_SCHEMA_DEPTH = 12;

/** Longest description kept on a property inside a schema. */
const PROPERTY_DESCRIPTION_MAX = 500;

/** Property names Anthropic (the strictest) accepts. */
const PROPERTY_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

const SIMPLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

/** Numeric / length constraints every provider accepts unchanged. */
const PASSTHROUGH_NUMBER_KEYS = [
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
] as const;

type JsonObject = Record<string, unknown>;

export type SanitizedToolSchema =
  | { ok: true; schema: JsonObject }
  | { ok: false; reason: string };

class UnusableSchema extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function appendHint(description: string | undefined, hint: string): string {
  return description ? `${description} (${hint})` : hint;
}

/** Follow a local JSON pointer (`#/$defs/Name`) from the root schema. */
function resolvePointer(root: JsonObject, ref: string): unknown {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = decodeURIComponent(rawSegment).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(node) || !(segment in node)) return undefined;
    node = node[segment];
  }
  return node;
}

/** Shallow-merge `allOf` members into one schema (properties and required unioned). */
function mergeAllOf(base: JsonObject, members: unknown[]): JsonObject {
  const merged: JsonObject = { ...base };
  delete merged.allOf;
  for (const member of members) {
    if (!isObject(member)) continue;
    for (const [key, value] of Object.entries(member)) {
      if (key === 'properties' && isObject(value)) {
        merged.properties = { ...(isObject(merged.properties) ? merged.properties : {}), ...value };
      } else if (key === 'required' && Array.isArray(value)) {
        const existing = Array.isArray(merged.required) ? merged.required : [];
        merged.required = [...new Set([...existing, ...value])];
      } else if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function sanitizeNode(input: unknown, root: JsonObject, refStack: readonly string[], depth: number): JsonObject {
  // Boolean schemas (`true` = anything) and anything malformed: unconstrained.
  if (!isObject(input)) return {};
  if (depth > MAX_SCHEMA_DEPTH) return {};

  let node = input;

  // Inline local references. A cycle, or a reference to something outside the
  // document, cannot be inlined and becomes an unconstrained value.
  if (typeof node.$ref === 'string') {
    const ref = node.$ref;
    const { $ref: _ref, ...siblings } = node;
    if (refStack.includes(ref)) return typeof siblings.description === 'string'
      ? { description: clip(siblings.description, PROPERTY_DESCRIPTION_MAX) }
      : {};
    const target = resolvePointer(root, ref);
    if (!isObject(target)) return typeof siblings.description === 'string'
      ? { description: clip(siblings.description, PROPERTY_DESCRIPTION_MAX) }
      : {};
    const resolved = sanitizeNode(target, root, [...refStack, ref], depth + 1);
    const description = typeof siblings.description === 'string'
      ? clip(siblings.description, PROPERTY_DESCRIPTION_MAX)
      : resolved.description;
    return description === undefined ? resolved : { ...resolved, description };
  }

  if (Array.isArray(node.allOf)) node = mergeAllOf(node, node.allOf);

  const out: JsonObject = {};
  let description = typeof node.description === 'string' && node.description.trim()
    ? node.description
    : typeof node.title === 'string' && node.title.trim()
      ? node.title
      : undefined;

  // --- type -------------------------------------------------------------
  let typeAlternatives: string[] | null = null;
  if (typeof node.type === 'string') {
    if (SIMPLE_TYPES.has(node.type)) out.type = node.type;
  } else if (Array.isArray(node.type)) {
    // `["string", "null"]` and friends: nullability is not portable, a
    // genuine multi-type becomes a union below.
    const types = node.type.filter((t): t is string => typeof t === 'string' && SIMPLE_TYPES.has(t));
    if (types.length === 1) out.type = types[0];
    else if (types.length > 1) typeAlternatives = types;
  }

  // --- enum / const -----------------------------------------------------
  const enumValues = Array.isArray(node.enum)
    ? node.enum
    : 'const' in node
      ? [node.const]
      : null;
  if (enumValues && enumValues.length > 0) {
    if (enumValues.every((v) => typeof v === 'string')) {
      out.enum = enumValues;
      if (out.type === undefined && !typeAlternatives) out.type = 'string';
    } else {
      // Some providers only accept string enums; keep the constraint as text.
      const listed = enumValues.map((v) => JSON.stringify(v)).join(', ');
      description = appendHint(description, `allowed values: ${clip(listed, 200)}`);
      if (out.type === undefined && !typeAlternatives) {
        const kinds = new Set(enumValues.map((v) => typeof v));
        if (kinds.size === 1) {
          const kind = [...kinds][0];
          if (kind === 'number') out.type = enumValues.every((v) => Number.isInteger(v)) ? 'integer' : 'number';
          else if (kind === 'boolean') out.type = 'boolean';
        }
      }
    }
  }

  if (typeof node.format === 'string' && node.format) {
    description = appendHint(description, `format: ${node.format}`);
  }

  for (const key of PASSTHROUGH_NUMBER_KEYS) {
    if (typeof node[key] === 'number' && Number.isFinite(node[key])) out[key] = node[key];
  }

  // --- object -----------------------------------------------------------
  if (isObject(node.properties)) {
    const properties: JsonObject = {};
    for (const [name, value] of Object.entries(node.properties)) {
      if (!PROPERTY_NAME_PATTERN.test(name)) {
        // An argument cannot be renamed without breaking the call.
        throw new UnusableSchema(`property name ${JSON.stringify(clip(name, 40))} is not accepted by providers`);
      }
      properties[name] = sanitizeNode(value, root, refStack, depth + 1);
    }
    out.properties = properties;
    if (out.type === undefined && !typeAlternatives) out.type = 'object';
    if (Array.isArray(node.required)) {
      const required = node.required.filter(
        (name): name is string => typeof name === 'string' && name in properties,
      );
      if (required.length > 0) out.required = [...new Set(required)];
    }
  }

  // --- array ------------------------------------------------------------
  if (out.type === 'array' || node.items !== undefined) {
    if (out.type === undefined && !typeAlternatives) out.type = 'array';
    if (out.type === 'array') {
      // Tuple-style `items: [...]` is not portable; OpenAI rejects an array
      // schema with no `items` at all.
      out.items = isObject(node.items) ? sanitizeNode(node.items, root, refStack, depth + 1) : {};
    }
  }

  // --- unions -----------------------------------------------------------
  const rawUnion = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : null;
  if (rawUnion) {
    const variants = rawUnion
      .filter((v) => !(isObject(v) && v.type === 'null'))
      .map((v) => sanitizeNode(v, root, refStack, depth + 1));
    if (variants.length === 1) {
      // `anyOf: [X, null]` is just X.
      for (const [key, value] of Object.entries(variants[0])) {
        if (key === 'description') {
          if (description === undefined && typeof value === 'string') description = value;
        } else if (!(key in out)) {
          out[key] = value;
        }
      }
    } else if (variants.length > 1) {
      out.anyOf = variants;
    }
  } else if (typeAlternatives) {
    out.anyOf = typeAlternatives.map((type) => (type === 'array' ? { type, items: {} } : { type }));
  }

  if (description !== undefined) out.description = clip(description, PROPERTY_DESCRIPTION_MAX);
  return out;
}

/** Collapse a top-level union of object schemas into one object schema. */
function collapseRootUnion(schema: JsonObject): JsonObject {
  if (!Array.isArray(schema.anyOf)) return schema;
  const variants = schema.anyOf as JsonObject[];
  if (!variants.every((v) => v.type === 'object')) {
    throw new UnusableSchema('top-level schema is a union that is not made of objects');
  }
  const properties: JsonObject = isObject(schema.properties) ? { ...schema.properties } : {};
  let required: string[] | null = null;
  for (const variant of variants) {
    if (isObject(variant.properties)) {
      for (const [name, value] of Object.entries(variant.properties)) {
        if (!(name in properties)) properties[name] = value;
      }
    }
    // Only what EVERY variant requires is required of the merged object.
    const variantRequired = Array.isArray(variant.required) ? (variant.required as string[]) : [];
    required = required === null ? variantRequired : required.filter((name) => variantRequired.includes(name));
  }
  const { anyOf: _anyOf, ...rest } = schema;
  const baseRequired = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const mergedRequired = [...new Set([...baseRequired, ...(required ?? [])])];
  const merged: JsonObject = { ...rest, type: 'object', properties };
  if (mergedRequired.length > 0) merged.required = mergedRequired;
  else delete merged.required;
  return merged;
}

/**
 * Sanitise an MCP tool's input schema for the tool-definition channel.
 * A missing schema means "no arguments". Never throws.
 */
export function sanitizeToolSchema(input: unknown): SanitizedToolSchema {
  if (input === undefined || input === null) {
    return { ok: true, schema: { type: 'object', properties: {} } };
  }
  if (!isObject(input)) {
    return { ok: false, reason: 'input schema is not an object' };
  }
  try {
    let schema = sanitizeNode(input, input, [], 0);
    schema = collapseRootUnion(schema);
    if (schema.type === undefined) schema.type = 'object';
    if (schema.type !== 'object') {
      return { ok: false, reason: `top-level schema type is "${String(schema.type)}", not "object"` };
    }
    if (!isObject(schema.properties)) schema.properties = {};
    delete schema.enum;
    delete schema.items;
    if (JSON.stringify(schema).length > MCP_TOOL_SCHEMA_MAX_CHARS) {
      return { ok: false, reason: `schema is larger than ${MCP_TOOL_SCHEMA_MAX_CHARS} characters` };
    }
    return { ok: true, schema };
  } catch (error) {
    if (error instanceof UnusableSchema) return { ok: false, reason: error.message };
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

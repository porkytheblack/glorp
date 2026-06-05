/** Minimal JSON-Schema → TypeScript rendering for MCP tool inputs. */

type Schema = Record<string, any>;

// Tool schemas are server-provided and finite; cap depth so recursion is bounded.
const MAX_DEPTH = 8;

/** Render a TS type expression for one schema node. */
export function tsType(schema: Schema | undefined, depth = 0): string {
  if (!schema || typeof schema !== "object" || depth > MAX_DEPTH) return "unknown";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((v: unknown) => JSON.stringify(v)).join(" | ");
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union) && union.length > 0) {
    return union.map((s: Schema) => tsType(s, depth + 1)).join(" | ");
  }
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `Array<${tsType(schema.items, depth + 1)}>`;
    case "object":
      return objectType(schema, depth);
    default:
      return schema.properties ? objectType(schema, depth) : "unknown";
  }
}

function objectType(schema: Schema, depth: number): string {
  const props = (schema.properties ?? {}) as Record<string, Schema>;
  const keys = Object.keys(props);
  if (keys.length === 0) return "Record<string, unknown>";
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const fields = keys.map(
    (k) => `  ${safeKey(k)}${required.has(k) ? "" : "?"}: ${tsType(props[k], depth + 1)};`,
  );
  return `{\n${fields.join("\n")}\n}`;
}

function safeKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Render `export interface <name> { ... }` for a tool's input schema. */
export function inputInterface(name: string, schema: Schema | undefined): string {
  const props = (schema?.properties ?? {}) as Record<string, Schema>;
  const keys = Object.keys(props);
  if (keys.length === 0) {
    return `export interface ${name} {\n  [key: string]: unknown;\n}`;
  }
  const required = new Set<string>(Array.isArray(schema?.required) ? (schema as Schema).required : []);
  const fields = keys.map((k) => {
    const opt = required.has(k) ? "" : "?";
    const desc = typeof props[k]?.description === "string" ? `  /** ${oneLine(props[k].description)} */\n` : "";
    return `${desc}  ${safeKey(k)}${opt}: ${tsType(props[k], 1)};`;
  });
  return `export interface ${name} {\n${fields.join("\n")}\n}`;
}

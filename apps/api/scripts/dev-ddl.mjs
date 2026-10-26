// DEV/TEST-ONLY schema bootstrap.
//
// Builds PostgreSQL DDL from the Prisma schema's DMMF so integration tests can
// run where Prisma's native schema engine cannot be downloaded (restricted
// sandboxes). It is NOT the production migration: real migrations come from
// `prisma migrate diff` / `prisma migrate dev` and are committed under
// prisma/migrations. CI runs a drift check that would fail if they disagree.
//
// Usage: node scripts/dev-ddl.mjs > /tmp/bootstrap.sql
import { readFileSync } from 'node:fs';
import wasm from '@prisma/prisma-schema-wasm';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: [['schema.prisma', schema]] })));
const { enums, models, indexes } = dmmf.datamodel;

const q = (id) => `"${id}"`;
const modelByName = new Map(models.map((m) => [m.name, m]));
const tableOf = (m) => m.dbName ?? m.name;
const colOf = (m, fieldName) => {
  const f = m.fields.find((x) => x.name === fieldName);
  return f.dbName ?? f.name;
};
const enumDb = new Map(enums.map((e) => [e.name, e.dbName ?? e.name]));

function sqlType(f) {
  if (f.kind === 'enum') return q(enumDb.get(f.type)) + (f.isList ? '[]' : '');
  const [nt, args] = f.nativeType ?? [null, []];
  const list = f.isList ? '[]' : '';
  if (nt) {
    const map = {
      Uuid: 'UUID', VarChar: `VARCHAR(${args[0]})`, Char: `CHAR(${args[0]})`, Citext: 'CITEXT', Inet: 'INET',
      Timestamptz: 'TIMESTAMPTZ', Date: 'DATE', Time: `TIME(${args[0] ?? 6})`, SmallInt: 'SMALLINT',
      Decimal: `DECIMAL(${args.join(',')})`, Text: 'TEXT',
    };
    if (!map[nt]) throw new Error(`Unmapped native type ${nt} on ${f.name}`);
    return map[nt] + list;
  }
  const scalar = { String: 'TEXT', Int: 'INTEGER', Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Json: 'JSONB', Bytes: 'BYTEA', Decimal: 'DECIMAL(65,30)', BigInt: 'BIGINT' };
  return scalar[f.type] + list;
}

function sqlDefault(f) {
  if (!f.hasDefaultValue || f.default === undefined) return '';
  const d = f.default;
  if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
    if (d.name === 'now') return ' DEFAULT CURRENT_TIMESTAMP';
    throw new Error(`Unsupported default fn ${d.name}`);
  }
  if (Array.isArray(d)) return d.length === 0 ? ` DEFAULT ARRAY[]::${sqlType(f)}` : (() => { throw new Error('array default'); })();
  if (f.kind === 'enum') return ` DEFAULT '${d}'`;
  if (typeof d === 'string') return ` DEFAULT '${d.replace(/'/g, "''")}'`;
  return ` DEFAULT ${d}`;
}

const out = ['CREATE EXTENSION IF NOT EXISTS citext;', 'CREATE EXTENSION IF NOT EXISTS pg_trgm;', ''];
for (const e of enums) out.push(`CREATE TYPE ${q(e.dbName ?? e.name)} AS ENUM (${e.values.map((v) => `'${v.dbName ?? v.name}'`).join(', ')});`);
out.push('');

const fks = [];
for (const m of models) {
  const cols = m.fields
    .filter((f) => f.kind !== 'object')
    .map((f) => `  ${q(f.dbName ?? f.name)} ${sqlType(f)}${f.isRequired && !f.isList ? ' NOT NULL' : f.isList ? ' NOT NULL' : ''}${sqlDefault(f)}`);
  const idField = m.fields.find((f) => f.isId);
  const pkCols = idField ? [idField.dbName ?? idField.name] : m.primaryKey.fields.map((n) => colOf(m, n));
  cols.push(`  CONSTRAINT ${q(`${tableOf(m)}_pkey`)} PRIMARY KEY (${pkCols.map(q).join(', ')})`);
  out.push(`CREATE TABLE ${q(tableOf(m))} (\n${cols.join(',\n')}\n);`);
  for (const f of m.fields.filter((x) => x.kind === 'object' && x.relationFromFields?.length)) {
    const target = modelByName.get(f.type);
    const onDelete = { Cascade: 'CASCADE', SetNull: 'SET NULL', Restrict: 'RESTRICT', NoAction: 'NO ACTION' }[f.relationOnDelete] ?? (f.isRequired ? 'RESTRICT' : 'SET NULL');
    const from = f.relationFromFields.map((n) => colOf(m, n));
    const to = f.relationToFields.map((n) => colOf(target, n));
    fks.push(`ALTER TABLE ${q(tableOf(m))} ADD CONSTRAINT ${q(`${tableOf(m)}_${from.join('_')}_fkey`)} FOREIGN KEY (${from.map(q).join(', ')}) REFERENCES ${q(tableOf(target))}(${to.map(q).join(', ')}) ON DELETE ${onDelete} ON UPDATE CASCADE;`);
  }
}
out.push('');
for (const ix of indexes) {
  if (ix.type === 'id') continue;
  const m = modelByName.get(ix.model);
  const cols = ix.fields.map((f) => q(colOf(m, f.name)) + (f.operatorClass ? ` ${f.operatorClass}` : '') + (f.sortOrder === 'desc' ? ' DESC' : ''));
  const name = ix.dbName ?? `${tableOf(m)}_${ix.fields.map((f) => colOf(m, f.name)).join('_')}_${ix.type === 'unique' ? 'key' : 'idx'}`;
  const using = ix.algorithm ? ` USING ${ix.algorithm.toUpperCase()}` : '';
  out.push(`CREATE ${ix.type === 'unique' ? 'UNIQUE ' : ''}INDEX ${q(name)} ON ${q(tableOf(m))}${using} (${cols.join(', ')});`);
}
out.push('', ...fks, '');
process.stdout.write(out.join('\n'));

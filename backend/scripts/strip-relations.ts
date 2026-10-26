/**
 * Strip problematic relation fields from Prisma schema that lack opposite fields.
 * Keeps scalar fields and optional relation annotations.
 */
import { readFileSync, writeFileSync } from 'fs';

const schema = readFileSync('prisma/schema.prisma', 'utf-8');

// Remove relation lines that reference other models (field declarations like `model fieldname?[]`)
// but keep scalar fields. We identify lines like:
//   fieldname  TargetModel  @relation(...)
//   fieldname  TargetModel? @relation(...)
//   fieldname  TargetModel[]  @relation(...)
// and comment them out, keeping the scalar_id fields.

const lines = schema.split('\n');
const result: string[] = [];

for (const line of lines) {
  const trimmed = line.trim();

  // Skip lines that are pure relation declarations (not scalar data fields)
  // Pattern: starts with a field name, then a model name, then @relation or is an array of models
  if (trimmed.match(/^\w+\s+\w+(\?|\[\])?\s+@relation\(/) || trimmed.match(/^\w+\s+\w+\[\]/)) {
    // Comment out the relation field
    result.push(`  // [REMOVED] relation: ${trimmed}`);
  } else {
    result.push(line);
  }
}

writeFileSync('prisma/schema.prisma', result.join('\n'));
console.log('Done. Removed problematic relation fields.');

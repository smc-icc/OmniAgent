import type { Job } from 'bullmq';
import { readFile } from 'node:fs/promises';
import { prisma } from './prisma.js';
import type { ImportJob } from './types.js';

/**
 * Import queue processor — processes data imports (CSV/JSON).
 *
 * Job names:
 *   - contacts — import contacts from CSV/JSON file
 *
 * Expected CSV format: name, email, phone_number, identifier
 * Expected JSON format: [{ name, email, phone_number, identifier }]
 */

interface ContactRow {
  name?: string;
  email?: string;
  phone_number?: string;
  identifier?: string;
}

function parseCSV(content: string): ContactRow[] {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim());
    const row: ContactRow = {};
    headers.forEach((h, i) => {
      if (h === 'name') row.name = values[i];
      if (h === 'email') row.email = values[i];
      if (h === 'phone_number') row.phone_number = values[i];
      if (h === 'identifier') row.identifier = values[i];
    });
    return row;
  });
}

export async function importProcessor(job: Job): Promise<{ imported: boolean; count: number; errors?: string[] }> {
  const { account_id, data_type, file_path } = job.data as ImportJob;
  const accountId = Number(account_id);

  if (data_type !== 'contacts') {
    return { imported: false, count: 0, errors: [`Unsupported data type: ${data_type}`] };
  }

  try {
    const content = await readFile(file_path, 'utf-8');

    let rows: ContactRow[];
    if (file_path.endsWith('.json')) {
      rows = JSON.parse(content) as ContactRow[];
    } else {
      rows = parseCSV(content);
    }

    if (!rows.length) {
      return { imported: true, count: 0 };
    }

    let imported = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        if (!row.email && !row.phone_number && !row.identifier) {
          errors.push(`Row missing contact identifier: ${JSON.stringify(row)}`);
          continue;
        }

        // Check for existing contact
        const existing = await prisma.contacts.findFirst({
          where: {
            account_id: accountId,
            OR: [
              ...(row.email ? [{ email: row.email }] : []),
              ...(row.phone_number ? [{ phone_number: row.phone_number }] : []),
              ...(row.identifier ? [{ identifier: row.identifier }] : []),
            ],
          } as any,
        });

        if (!existing) {
          await (prisma.contacts as any).create({
            data: {
              account_id: accountId,
              name: row.name ?? '',
              email: row.email ?? '',
              phone_number: row.phone_number ?? '',
              identifier: row.identifier ?? '',
            },
          });
          imported++;
        }
      } catch (err) {
        errors.push(`Failed to import row: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { imported: true, count: imported, errors: errors.length > 0 ? errors : undefined };
  } catch (err) {
    return {
      imported: false,
      count: 0,
      errors: [`Failed to read import file: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

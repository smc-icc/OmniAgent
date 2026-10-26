import { cleanupKnowledgeOriginals } from '../modules/knowledge/knowledge.cleanup.js';
import { prisma } from '../plugins/db.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) {
  throw new Error('Usage: node dist/tools/cleanup-knowledge-originals.js [--dry-run|--apply]');
}
try {
  let cursor: string | undefined;
  do {
    const page = await cleanupKnowledgeOriginals({ apply: args.includes('--apply'), cursor });
    console.log(JSON.stringify(page));
    cursor = page.nextCursor;
  } while (cursor);
}
finally { await prisma.$disconnect(); }

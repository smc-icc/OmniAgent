import { createPool, type Pool } from 'mysql2/promise';

export function createStandaloneMysqlPool(): Pool | null {
  if (process.env.ICC_MYSQL_DISABLED === '1') return null;
  return createPool({
    host: process.env.ICC_MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.ICC_MYSQL_PORT || 3306),
    user: process.env.ICC_MYSQL_USER || 'root',
    password: process.env.ICC_MYSQL_PASSWORD || '',
    database: process.env.ICC_MYSQL_DB || 'icc',
    charset: 'utf8mb4',
    connectionLimit: 8,
  });
}

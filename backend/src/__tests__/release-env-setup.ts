// Synthetic values only. Ports deliberately closed; no developer/VM services.
import { devNull } from 'node:os';
process.env.DOTENV_CONFIG_PATH = devNull;
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic',
  REDIS_URL: 'redis://127.0.0.1:1',
  ICC_MYSQL_HOST: '127.0.0.1',
  ICC_MYSQL_PORT: '1',
  ICC_MYSQL_DISABLED: '1',
  CCS_AGENT_OBJ: '',
  ACD_OBJ: '',
  HUB_ENABLED: '0',
  ITR_WS_ENABLE: '0',
  ASR_OBJ: '',
  JWT_SECRET: 'synthetic-test-only-not-a-production-secret',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1',
});

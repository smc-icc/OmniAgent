/** Disable CCS TARS bridge during unit tests unless explicitly configured. */
process.env.CCS_AGENT_OBJ = process.env.CCS_AGENT_OBJ ?? '';
process.env.HUB_ENABLED = process.env.HUB_ENABLED ?? '0';
process.env.ICC_MYSQL_DISABLED = process.env.ICC_MYSQL_DISABLED ?? '1';
process.env.ITR_WS_ENABLE = process.env.ITR_WS_ENABLE ?? '0';
process.env.ASR_OBJ = process.env.ASR_OBJ ?? '';

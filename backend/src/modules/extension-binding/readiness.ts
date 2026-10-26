import { database, rows } from '../access/access.db.js';
import { AppError } from '../../shared/errors/index.js';
let readiness: Promise<void> | null = null;
export async function assertBindingSchemaReady(): Promise<void> {
  if (!readiness)
    readiness = (async () => {
      const db = await database();
      const names = [
        't_user_users',
        't_icc_base_extension',
        't_icc_sip_directory',
        't_icc_telag_staticlogin',
        't_omni_extension_binding',
        't_omni_extension_request',
        't_omni_extension_operation',
        't_omni_extension_voice',
        't_omni_extension_audit',
        't_omni_extension_migration',
      ];
      const tables = await rows<{ name: string; engine: string }>(
        db,
        'SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (' +
          names.map(() => '?').join(',') +
          ')',
        names,
      );
      if (tables.length !== names.length || tables.some((t) => t.engine !== 'InnoDB'))
        throw new AppError(503, '分机绑定表尚未完成 InnoDB 迁移');
      const guards = await rows<{ name: string }>(
        db,
        "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('omni_extension_update_guard','omni_extension_insert_guard','omni_extension_delete_guard')",
      );
      if (guards.length !== 3) throw new AppError(503, '旧分机写入口尚未收口，请完成分机绑定迁移');
      const seed = await rows(
        db,
        "SELECT ID FROM t_omni_extension_migration WHERE ID='initial-admin-grants'",
      );
      if (!seed.length) throw new AppError(503, '分机独立权限尚未初始化');
      const columns = await rows(
        db,
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_omni_extension_operation' AND COLUMN_NAME IN ('SelfOperation','ActiveUserID','ActiveTargetNum','NotifiedAt')",
      );
      if (columns.length !== 4) throw new AppError(503, '分机执行阶段表版本不匹配');
    })().catch((e) => {
      readiness = null;
      throw e;
    });
  return readiness;
}

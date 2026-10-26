// Repair only this rollout's supervisor template; preserve historical orphan memberships.
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
const db = await mysql.createConnection({ host: process.env.ICC_MYSQL_HOST, port: Number(process.env.ICC_MYSQL_PORT || 3306), user: process.env.ICC_MYSQL_USER, password: process.env.ICC_MYSQL_PASSWORD, database: process.env.ICC_MYSQL_DB || 'icc' });
try {
  const [[lock]] = await db.query("SELECT GET_LOCK('omniagent.access.write',10) AS acquired"); assert.equal(lock.acquired,1);
  await db.beginTransaction();
  const [role] = await db.query("SELECT ID FROM t_user_role WHERE ID=11 AND Name='Omni全媒体班长' AND IsSystem=0 AND VDNID=1");
  if (role.length) {
    const [members] = await db.query('SELECT UserID,VDNID FROM t_user_usertorole WHERE RoleID=11');
    const historical = [10599,10601,10602,10603,10604,10605,10606,10607,10608,10609,10610,10611,10596].sort((a,b)=>a-b);
    assert.deepEqual(members.map(m=>m.UserID).sort((a,b)=>a-b),historical); assert.ok(members.every(m=>m.VDNID===1));
    const [[other]] = await db.query('SELECT COUNT(*) AS n FROM t_user_grantpower g JOIN t_user_power p ON p.ID=g.PowerId WHERE g.OwnerType=1 AND g.OwnerId=11 AND (p.SubSystemType<>90 OR g.VDNID<>1)'); assert.equal(other.n,0);
    const [[next]] = await db.query(`SELECT MAX(CAST(id AS SIGNED))+1 AS id FROM (
      SELECT COALESCE(MAX(ID),0) AS id FROM t_user_role UNION ALL SELECT COALESCE(MAX(RoleID),0) FROM t_user_usertorole
      UNION ALL SELECT COALESCE(MAX(OwnerId),0) FROM t_user_grantpower WHERE OwnerType=1
      UNION ALL SELECT COALESCE(MAX(OwnerId),0) FROM t_omni_access_scope WHERE OwnerType=1) reserved`);
    await db.query('UPDATE t_user_role SET ID=? WHERE ID=11 AND VDNID=1', [next.id]);
    await db.query('UPDATE t_user_grantpower SET OwnerId=? WHERE OwnerType=1 AND OwnerId=11 AND VDNID=1',[next.id]);
    await db.query('UPDATE t_omni_access_scope SET OwnerId=? WHERE OwnerType=1 AND OwnerId=11 AND VDNID=1',[next.id]);
    console.log(JSON.stringify({ movedTemplate:next.id, historicalMembershipsPreserved:13, supervisorMembers:0 }));
  } else console.log('Template ID already repaired');
  await db.commit();
} catch(e) { await db.rollback(); throw e; }
finally { await db.query("SELECT RELEASE_LOCK('omniagent.access.write')"); await db.end(); }

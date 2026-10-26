-- 满意度（对照 S_ICIP_RPT_A_Satisfaction）
SELECT
  datestr,
  vdnid,
  agentgroupname,
  agentname,
  workno,
  callcount,
  pass1,
  pass2,
  pass3,
  pass4,
  pass5,
  pass0,
  passlv
FROM icc.v_rpt_agent_satisfaction
WHERE datestr >= {{start_date}}
  AND datestr < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
  [[AND workno = {{work_no}}]]
ORDER BY datestr, workno;

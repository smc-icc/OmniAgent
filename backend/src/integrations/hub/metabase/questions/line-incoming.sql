-- 线路呼入详单（对照 S_ICIP_RPT_P_LineIncoming）
SELECT
  pid,
  vdnid,
  vdnname,
  begintime,
  endtime,
  callingno,
  calledno,
  talktimelong
FROM icc.v_rpt_line_incoming
WHERE begintime >= {{start_date}}
  AND begintime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
ORDER BY begintime DESC
LIMIT 5000;

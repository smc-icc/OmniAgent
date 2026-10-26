-- 全媒体接入（对照 S_ICIP_RPT_P_FullMediaAccess）
SELECT media, vdnid, count(*) AS qty
FROM icc.v_rpt_full_media_access
WHERE occurred_at >= {{start_date}}
  AND occurred_at < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
GROUP BY 1, 2
ORDER BY 1, 2;

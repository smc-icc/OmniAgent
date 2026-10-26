-- 客户呼入地域（对照 S_ICIP_RPT_P_CustomerIByRegion；无号段表时省/市为「未知」）
SELECT
  province,
  city,
  pom,
  count(*) AS callcount,
  coalesce(sum(talktimelong), 0) AS sumtalktimelong
FROM icc.v_rpt_customer_by_region
WHERE begintime >= {{start_date}}
  AND begintime < {{end_date}}
  [[AND vdnid = {{vdn_id}}]]
GROUP BY 1, 2, 3
ORDER BY callcount DESC;

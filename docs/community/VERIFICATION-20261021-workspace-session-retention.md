# Community 未完成会话跨登录保留修复验收

日期：2026-10-21（Asia/Shanghai）。

## 同步范围

从main的6eb2c2acde597b5468411756463ad3cbf98c6a3b通过cherry-pick -x同步到Community的fa36c46。Community原基线1918157的模块授权、ICC开关和路由保护保留。只移植该次会话保留修复，未合并main的其他提交。

签出持久保存未完成会话参与关系，电话和已结束待完成记录保留负责人；活动Web仍可释放实时接待。ITR分配和电话呼入补参与关系。只有手动完成进入历史，挂机或签出不代替完成。前端按账号及用户记住电话/全媒体选择；旧版未保存偏好，首次需手选一次电话。

两个提交的git patch-id --stable均为54c72ae6b9696b2857fd3ea8939fc56ebbc90281；原修复11文件完整移植，无冲突。

## 本分支验证

在独立Community工作树执行，共40项通过、0跳过：

- backend: node --test scripts/workspace-retention.test.mjs：4项。
- backend: vitest run --config vitest.workspace.config.ts：3文件20项。
- backend: vitest run --config vitest.community.config.ts：2文件8项，覆盖Community模块及前端分类策略。
- frontend: node --test scripts/workspace-channel-preference.test.mjs scripts/router-permission-guard.test.mjs：8项，包含渠道恢复、身份隔离和禁用ICC的路由保护。
- backend npm run build：通过。
- frontend npm run build（vue-tsc和Vite）：通过。
- git diff 1918157 fa36c46 --check：通过。

构建依赖复用原工作区的node_modules（两个package清单依赖与锁文件无差异，Community仅多一条test:community脚本）。独立检出首次前端构建因缺少原工作区未跟踪的frontend/public/mobile-brand/original/app-icon.png而失败，复制现有图标后复测通过；图标仍未纳入本修复提交。因此构建通过依赖补充既有品牌资源，不宣称从纯Git检出即可独立构建。既有Vite分包和第三方注释警告不影响构建退出状态。

本次只同步本地Community分支及验收文档，没有向远端Git推送，也没有部署Community或重启服务。main工作区保持在6eb2c2a。原Local数据恢复及部署验收见主工作区HANDOVER-20261019.md和docker/releases/workspace-session-retention-20261021；不把main部署验收算作Community部署验收。

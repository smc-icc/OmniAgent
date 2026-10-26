# OmniAgent Community

全媒体智能客服平台，提供统一坐席工作台、客户与会话管理，并支持按授权扩展 ICC 语音、视频话务能力。

Omnichannel customer service platform with a unified agent workspace, customer and conversation management, and licensed ICC voice and video telephony integration.

## 项目结构

- backend/：Node.js / TypeScript 后端，使用 Fastify、Prisma、pnpm。
- frontend/：Vue 坐席工作台前端，使用 npm。
- docs/community/：Community 能力与发布说明。
- tools/：公开源码导出工具。

## 版本范围

Community 提供 Omni 线上全媒体客服。ICC 核心与企业流程设计器不包含在此仓库，通过独立商业组件和签名插件提供。话务、智能外呼、智能质检等商业入口由 ConfServer 能力接口按授权和安装状态控制。

ConfServer 公共工程位于 GitHub 的 smc-icc/smc-confserver 仓库。原生并发硬限制等当前交付边界请查阅相关 Community 文档，不能把入口控制视为底层完整授权验收。

## 开发与构建

Node.js 22。后端和前端分别安装依赖，使用随仓库提供的锁文件。

~~~bash
# 从仓库根目录进入后端
cd backend
corepack enable
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm build
~~~

~~~bash
# 从仓库根目录进入前端
cd frontend
npm ci
npm run build
~~~

运行需要配置自己的 PostgreSQL、Redis 及服务端凭据。先参考 backend/.env.example；开发 seed 和测试账号只用于本地演示。商业能力需要配置 ConfServer 的能力接口、部署标识和服务端认证令牌。

~~~bash
# 在 backend/ 执行 Community 回归
pnpm test:community
~~~

诊断上报默认关闭，仅在操作者显式设置 SMC_DEBUG_INGEST_URL 后启用；公开源码不包含固定开发者日志接收地址。

## License

Apache-2.0；见 LICENSE。第三方依赖和原有源码声明仍遵循各自许可，见 THIRD_PARTY_NOTICES.md。原生 SIP 依赖的许可需按实际链接和交付内容单独满足。

[公开快照来源与范围](PUBLICATION.md)

# Community 版本运行、安装与交付手册

## 交付范围

两个现有工程均在 Community 分支实施。ConfServer 管理签名授权、组件状态、TARS 安装任务和企业流程工具；OmniAgent 前后端消费能力并执行入口防护。企业编辑器源工程保存在工作区同级 EnterpriseFlowDesigner，不能随公共 Git 历史或源码包分发。

本期采用本地签名插件包，不增加第三个线上服务。固定的 ConfServer 路由通过验签后的 backend.cjs 分派编辑操作，浏览器在同源 iframe 中加载独立页面。更新配置和安装工具无需重新注册 Koa 路由。首次连接 ICC 仍允许受控重启 Omni 后端。

## 版本和功能

| 能力 | Community | Registered | Enterprise |
|---|---|---|---|
| 基础全媒体、客户、会话、登录 | 保留 | 保留 | 保留 |
| 已安装 ICC 的话务入口 | 关闭 | 可启用 | 可启用 |
| 话务坐席配额 | 0 | 2 | 签名授权数量 |
| SIP 中继配置配额 | 0 | 2 | 签名授权数量 |
| 并发通话 | 0 | 单列配额，默认 2 | 单列配额 |
| IVR / ITR 运行 | 默认关闭商业运行模块 | 已授权预置流程 | 已授权流程 |
| 图形编辑器及任意流程发布 | 不交付 | 不交付 | 安装工具包后提供 |
| IVR 策略 | disabled | template_audio_only | full |

模块目录：omni、icc、ivr、itr、outbound、aiqc、flow-designer。ivr 和 outbound 依赖 icc；itr 不强制依赖 icc。omni 不允许停用。installed / enabled / licensed 独立记录；健康状态不替代授权。

**权限边界：** 本期流程工具仅向系统管理员开放。原有工程文件采用全局目录，不能仅凭 URL 的 vdnId 就允许普通 VDN 管理员编辑。需要逐 VDN 编辑时，必须先扩展项目归属元数据和文件级校验，不能移除管理员限制。

组件管理与企业工具要求开启真实登录并使用系统管理员身份；关闭登录的开发模式不会自动放行商业安装。

## 部署前配置

ConfServer 设置：

- SMC_DEPLOYMENT_ID：当前部署固定、唯一的标识。签名授权和组件计划必须匹配。
- SMC_COMMUNITY_STATE_DIR：独立持久化目录，默认 ConfServer/data/community。使用单个管理进程作为安装协调者（进程内按文件和模块串行化，状态原子替换，不依赖崩溃遗留的锁文件）；不要让多个独立 ConfServer 实例同时操作同一目录。
- SMC_LICENSE_PUBLIC_KEY_FILE：供应商授权签名公钥文件。
- SMC_PLUGIN_PUBLIC_KEY_FILE：供应商插件及组件计划签名公钥文件。
- SMC_MODULE_SERVICE_TOKEN：至少 32 字符的随机服务凭据。

Omni 后端设置：

- SMC_MODULE_AUTHORITY_URL：例如 http://confserver:4001/api/smcicc/community/runtime，必须是后端能够访问的固定地址。
- SMC_MODULE_SERVICE_TOKEN：与 ConfServer 一致，只保存在服务端。
- SMC_DEPLOYMENT_ID：建议设置，客户端会检查权威响应的部署标识。
- 原有 TARS 注册中心等配置照常保留。CCS_AGENT_OBJ 未显式配置时，允许从已确认 ICC 安装收据的 connections.ccsAgentObj 获取；显式配置优先，不覆盖已有连接。

没有配置权威端时 Omni 按 Community 工作。配置了权威端但连接失败、响应无效或授权到期时，商业能力关闭；不会清空用户数据或把客户数据库恢复到旧快照。Omni 能力缓存最长 5 秒，前端在登录、路由变化及工作台定时刷新时更新。

**现有 ICC 生产部署不要直接覆盖：** 先配置公钥、部署标识和服务凭据，准备授权与安装收据，再进行受控切换。Community 默认关闭商业能力是新版本规则，不能把已有 ICC 部署误当成空白 Community 部署。

## 授权文档

供应商持有私钥。客户仅持有公钥及签名文档。签发端 JSON 示例：

~~~json
{
  "kind": "smc-license/1",
  "deploymentId": "customer-a",
  "licenseId": "license-001",
  "revision": 1,
  "edition": "registered",
  "notBefore": "2026-10-20T00:00:00Z",
  "expiresAt": "2027-10-20T00:00:00Z",
  "modules": ["icc", "ivr", "itr"],
  "limits": {"voiceSeats": 2, "sipTrunks": 2, "concurrentCalls": 2}
}
~~~

企业版使用 enterprise，并按授权增加 flow-designer 等模块。Registered 即使错误地包含 flow-designer 或超大坐席数量，也不会获得企业编辑器或超过固定注册版配额。

签发命令（仅供应商执行）：

~~~text
node ConfServer/tools/sign-community.cjs license-payload.json /secure/vendor-license-private.pem customer-license.json
~~~

签名格式是 {payload, signature}，payload 是原始 UTF-8 JSON 的 base64，signature 是 Ed25519 签名的 base64。修订号在同一部署内全局递增。格式、时间、部署和签名验证通过后，才原子替换授权；重复或旧修订拒绝。到期不会删除安装记录和既有流程。

## 安装 TARS 组件

第一版复用已经上传到当前 TARS 发布中心的发布包，不假定存在供应商下载仓库。安装计划由供应商签名并绑定目标部署，包含 module、version、services。每项服务包含 application、serverName、nodeName、patchId；新服务再提供 deploy（现有 TARS 部署字段及 adapters），以及 configs 数组 [{filename,content}]。

已有服务只有在计划声明 allowExisting:true 时才允许复用；已有配置不覆盖，只补缺失文件。新建服务配置请使用实际的模板、适配器端口及节点地址。不要直接复制其他客户的配置。

最小计划示意（用于已有服务；patchId 必须是本环境实际发布包）：

~~~json
{
  "kind": "smc-component/1",
  "deploymentId": "customer-a",
  "module": "icc",
  "version": "1.0.0",
  "connections": {"ccsAgentObj": "SMC-ICC.CCSServer.AgentObj"},
  "services": [
    {"application":"SMC-ICC","serverName":"CCSServer","nodeName":"target-node","patchId":123,"allowExisting":true}
  ]
}
~~~

这是结构示例，不是完整 ICC 依赖清单。正式 ICC 包须列出部署实际依赖的 CCS、ACD、TAS 等服务及匹配的接口版本。用插件签发私钥签署该计划；管理员在“版本与功能组件”导入。当前 UI 直接使用签名计划中明确的目标节点，不自行猜测节点。

安装阶段：prepared → deploying → patch_tars → start_tars → verifying → complete。任务编号在提交前保存；查询和页面重开不会重复发布已成功阶段。明确失败的任务支持重试；提交结果不确定时先查原 taskNo，查询失败不会当作缺失；明确缺失且管理员重试时才以原 taskNo/itemNo 重提。非发布任务从 TARS 内存丢失时，先确认服务已 active，避免重复启动。检查节点与注册中心状态都为 active 后才记为 installed，管理员再启用模块。首次启用 ICC 后，必须受控重启 Omni 后端，使其读取新能力与连接配置，再刷新或重新登录工作台；这一步尚未由页面自动重启服务。

若原生 TARS 在写入任务元数据时发生部分失败，且无法确认执行情况，应保留 unknown 状态并由管理员核对原任务；安装器不会自动删除原生任务记录或猜测回滚。

收据和任务保存在独立目录。失败不会执行全库还原、删除旧服务或删除业务数据。若有初始化 SQL，必须先做独立、版本化、可重复的增量迁移；当前组件安装器不执行任意 SQL，也不导入整库初始化脚本。

## 构建与安装企业流程工具

私有源码目录：<workspace>/EnterpriseFlowDesigner。它不属于两个公共工程。先在其私有版本管理中保存，再发布。

~~~text
node ConfServer/tools/build-flow-plugin.cjs --source EnterpriseFlowDesigner --out <private-output> --version 1.0.0 --key /secure/vendor-plugin-private.pem
~~~

省略 --key 时仅生成 .unsigned.json 审查包，生产安装会拒绝。插件使用一个 backend.cjs 和 web/ 下的静态资源；包中的路径、散列、总大小、协议版本、签名均在写入前校验。插件文件总量上限 32 MiB，最多 2048 个文件；不接受路径穿越及源码映射文件。

管理员导入工具包后，在模块列表启用 flow-designer。VDN 管理页才显示 IVR / ITR 页签。卸载式停用是关闭模块，不删除原有工程、运行时流程或放音文件。现有流程继续由 IVR / ITR 运行服务处理。

编辑器专属文件和 callFlowExport 已移到私有源码。核心中的流程下拉查询只返回运行流程标签，不返回画布和节点定义。旧的保存、删除、调色板和发布 URL 统一经过企业插件守卫，不能靠旧 API 绕过。

首次升级基础 ConfServer 请使用干净镜像或新的程序发布目录，不要把新 client/dist 增量叠加到旧目录，以免残留历史编辑器 chunk。业务数据继续放在原持久化目录或挂载卷。

## 构建与公共交付

~~~text
# ConfServer/client 目录
npm run build:community

# ConfServer 目录：扫描已有构建目录
node tools/check-community-release.cjs --web <conf-web-output>

# 两个工程分别执行，目标必须是全新且位于工程外的目录
node tools/export-community.cjs <new-community-source-directory>
~~~

导出器仅导出已纳入 Git 版本管理的文件，排除未跟踪开发文件、.git、运行数据、备份、旧 dist、凭据文件和企业源文件，输出 SHA-256 文件清单。Docker 上下文额外排除旧备份与发布包，防止旧编辑器进入镜像。

**不要直接把现有仓库历史公开。** 删除当前分支中的文件不会删除 Git 历史里的旧编辑器。公共源代码应使用无历史导出快照或重新建立干净的公开仓库；此次没有重写任何已有 Git 历史。

## 验证命令

~~~text
# ConfServer
npm run test:community
node --test tools/conf-tenancy-safety.test.js tools/smcicc-contract-shapes.test.js

# OmniAgent/backend
npm run test:community
node node_modules/typescript/bin/tsc --noEmit

# OmniAgent/frontend
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
npm run build
~~~

验证记录和构建审查产物在本工作区 .codex-tmp/community-20261020。浏览器检查使用隔离的模拟身份和后端响应，不访问生产数据。

## 明确的边界

1. 模块停用控制 ConfServer/Omni 入口，不会自动停止 TARS 服务；原生 SIP 呼入准入和彻底停用需要运行服务联动。
2. 这两个工程负责交付、入口控制与配额契约，不宣称已经在 CCS/ACD/TAS 中实施跨实例硬配额。两坐席、并发和中继硬限制需由相应资源准入服务验证并补齐。
3. 未验证底层驱动的在线通道池扩容；首次连接 ICC 后可受控重启 Omni。单实例重启存在短暂连接中断，不等于数据丢失。
4. 注册版标准放音复用现有语音资源配置与预置流程；设计器的任意图形编辑和发布仅企业插件可用。标准模板完整性在实际运行入口的强制校验仍需与 IVR 服务联调。
5. 尚未连接客户 TARS 集群、SIP 中继或生产数据库进行真实安装和通话验收。供应商公私钥与真实发布包必须在交付时配置，测试密钥不能用于生产。
6. 已开启的商业接口仍执行原用户、租户和数据范围校验。现有通话的挂断、签出及释放操作保留，未启用模块不能申请新的商业资源。

# Community 实施与验证记录

日期：2026-10-20；环境：Windows / Node.js 22.16.0。两个工程分支均为 Community。

## 实施结果

- ConfServer 增加签名授权、模块状态、组件安装任务、管理页面和插件资产接口。
- 默认 Community；Registered 固定 ICC / IVR / ITR 范围，配额契约为 2 话务坐席、2 SIP 中继；企业编辑器要求独立签名包。
- 企业编辑器、画布、资源及编辑控制器移出公共工程，保存在同级 EnterpriseFlowDesigner；私有源码另有 tgz 备份。
- Omni 前后端统一模块判断，登录/恢复登录/Socket 重连不再在关闭 ICC 时查询分机或 CCS，SIP 注册也有独立保护。
- 停用后保留现有通话的挂断与签出；核心客户、身份、会话数据未迁移。
- 公共源码导出仅包含已纳入版本管理的文件，并排除历史、数据、缓存、密钥、商业包；公共前端扫描排除编辑器实现和 source map。

## 验证证据

- ConfServer 新增与相关回归：44 tests passed（39 项 Community 测试 + 5 项原有安全回归）。
- Omni 后端新增模块测试：8 tests passed；原权限套件：91 tests passed。
- Omni 前端登录、分机及路由回归：23 tests passed。
- Omni 后端 tsc --noEmit 和前端 vue-tsc --noEmit 通过。
- ConfServer、Omni 两个前端生产构建通过；企业流程工具独立构建通过。
- 完整私有工具审查包共 13 文件、13,347,690 字节。临时测试密钥下验证实际包签名、安装、启用、页面及 Unicode 图标、停用后拒绝访问。真实签发私钥未生成或嵌入源码。
- 公共 ConfServer 构建扫描检查 98 文件，未发现编辑器实现或 source map。
- 浏览器：使用已安装 Chrome 与 Playwright（Browser plugin not available），后端为隔离测试响应。组件管理页面可刷新；企业 IVR 可切换 ITR；Omni 桌面客户页和移动个人页没有电话入口，均未请求话务初始化接口；最终没有页面异常和相关控制台错误。截图与 JSON 记录见工作区 .codex-tmp/community-20261020。

## 独立审查及恢复回归

独立复核发现未知提交无法恢复、同模块并发创建、崩溃后遗留锁三个问题。已添加回归并修复：按模块串行化创建和推进；未知提交先查询，明确缺失且显式重试时保留 taskNo/itemNo；查询失败不当作任务缺失；旧任务不能覆盖新计划；状态写入改用单协调进程内按文件共享队列，不依赖遗留磁盘锁。TARS 非发布任务丢失时先检查服务已 active，避免重复启动。进一步覆盖 current 预留与任务落盘之间的中断窗口，先预留 current，再保存任务，同一计划可以在重启后补齐。

## 原有失败及边界

额外运行原有 call-media-authority.test.mjs：3 项中 1 项失败。该用例期望不允许视频时降级音频，当前 call-coordinator.ts 实现拒绝视频应答。该源文件与 main 相同（git diff HEAD -- 此文件为空），本次未修改，未通过改写它来消除失败。此项不计入本次通过的测试。

没有连接生产数据库、TARS 集群或 SIP 中继，没有部署/重启生产服务。CCS/ACD/TAS 的跨实例硬配额和驱动在线扩容未改；标准模板运行时强校验仍需联调。首次启用 ICC 需受控重启 Omni。企业编辑器当前仅开放给系统管理员，避免现有全局工程文件跨 VDN 暴露。

## Git 与数据保护

原 main 分支不变。构建必需的原有未跟踪源文件单独记录为基线提交；原有缓存、原生构建输出和历史包保持在工作区，不混入功能提交。功能提交只包含两个主要工程及本次文档与测试。私有工具源码不进入 Community 提交。


## 2026-10-21：Docker Desktop smc-icc-test 实机验证

本轮在既有 Docker Compose 项目 smc-icc-test 验证。ConfServer 从 e3b6d42、OmniAgent 从 38d8814 的 Community 分支继续。主工作区现均在 Community；原会话保留工作树停留在 38d8814（detached），其文件未清理。

### 环境与数据

- ConfServer：宿主端口 3100；Omni 页面：3002；Omni API：3001。数据库、Redis、TARS 使用原测试项目的容器与数据卷。
- Omni 使用新建专用镜像 smc-icc/omniagent-backend:community-20261021；ConfServer 复用原镜像依赖，并挂载当前分支运行源码与新构建页面。此为本地验证部署，不是可分发的 ConfServer 发布镜像。
- 本机持续启动配置：%LOCALAPPDATA%/SMC-ICC/smc-icc-test-community/community.compose.private.json。原容器配置保留为同目录 restore.compose.private.json；含本机服务凭据，不提交或对外分发。配置只管理 confserver / omni-backend / omni-frontend，不能使用 --remove-orphans。
- 覆盖前已备份 MySQL、PostgreSQL、ConfServer/data 和原前端文件。证据保存在 %TEMP%/smc-icc-community-docker-20261021；其中数据库备份、票据、签名测试私钥属于本机私有材料，不得整体发布。
- 原测试库滞后：仅补充 db_user_system.t_user_info.email（varchar(254)，允许 NULL），并审阅执行当前 Prisma 增量迁移。未导入建库初始化 SQL，未覆盖原密码，未删除原业务数据。其他旧库升级前也应先核对字段和迁移记录。
- 按原备份逐行比较：原有 users 23、contacts 256、conversations 101、messages 3087 均无丢失；users / contacts / 原 messages 内容无变化。运行期间新增 2 条会话、1 条消息；原会话 304 的 updated_at / contact_last_seen_at / last_activity_at 更新，不能把本轮描述为数据库完全无写入。
- 临时 Omni 账号（ID 26）和临时 admin SSO 票据已删除。企业签名测试状态归档到 ConfServer/data/community-docker-test-reviewed-20261021 与 community-docker-test-reviewed-viewport-20261021；最终运行目录 community-docker-test 为默认 Community，未激活商业模块。

### 真实容器中发现并修复

1. Community 首页资料仍访问分机绑定、CCS 会话与视频配置；现按 ICC 能力跳过。dashboardProfile 等待资料 Promise，错误由 Fastify 转成 HTTP 响应，避免未处理拒绝导致进程重启。
2. 首页“话务管理”和质检快捷入口未过滤；现按模块能力过滤，保留工单、知识库、客户等在线功能。
3. 国际化中间件把插件 Buffer 响应转为 JSON；现保持原始字节，HTML / JS / 图片能够实际加载。
4. 企业流程工具与运行组件独立安装时，流程列表被运行模块门禁阻挡；仅对 IVR / ITR 列表允许已启用企业工具访问，仍要求真实系统管理员，其余话务门禁保持有效。
5. 安装计划拒绝真实应用名 SMC-ICC；现接受应用名中的连字符，继续拒绝路径与命令分隔符。
6. 独立插件缺少原宿主页的尺寸约束，画布不断增高；构建工具补充独立页样式，IVR / ITR 实测页面尺寸均为 1440×1000，无横向溢出或无限增高。测试插件版本 1.0.1。

### 验证结果

- ConfServer：42 项 Community 测试、5 项相关安全回归通过；公共产物检查 98 文件通过，无编辑器实现和 source map。
- Omni：12 项 Community 测试、91 项权限回归、1 项视频资料兼容测试、23 项前端登录/路由/分机回归通过；后端 TypeScript、前端构建及类型检查通过。企业插件完整构建通过。
- 真实 HTTP：无服务凭据的权威接口返回 401；Community 直连 SIP 和旧编辑 API 返回 403。SSO 未登录接口沿用原框架的 HTTP 200 + ret_code 500 拒绝格式。
- 真实授权：Registered 将夸大的话务坐席 / SIP 中继配额压至 2，未安装 ICC 不能启用，企业编辑器不获授权且拒绝安装；Enterprise 完整签名插件安装成功，错误签名拒绝，安装后默认停用，可从页面启用，重启后状态保留，停用后资源拒绝访问。
- 真实浏览器：现有 Chrome + Playwright（未配置独立 Browser 插件），桌面 1440×1000、移动 390×844。Omni 使用临时账号真实密码登录，桌面客户页和移动个人页可用；登录及恢复登录无话务初始化 API 请求。动态 JavaScript 分块的下载不计作话务 API 调用。企业 IVR / ITR 均实际加载原流程，无页面 JavaScript 异常；未保存或发布原流程。
- 权威服务短暂停止后 Omni 保留基础能力并关闭商业能力，恢复后 authorityStatus 为 ready，最终 edition 为 community。修复后 Omni 容器 RestartCount 为 0。
- /api/access/tenants 返回 409“尚未启用 ConfManager 租户联动”，对应既有测试配置未开启联动；本轮未擅自改成多租户部署。
- 原有 scripts/call-media-authority.test.mjs 为 2 通过 / 1 失败：禁止视频时，测试期望降级音频，实际实现拒绝接听。call-coordinator.ts 与 main 无差异，本轮未改动该行为。

### 未验证范围

TARS 已验证真实签名计划的预检、实际发布包查询和已有服务复用保护（409），没有重发或覆盖现有原生二进制。TARS 真正发布/启动/故障恢复、ICC 首次启用后的接线、SIP 实呼、原生坐席与中继配额硬限制、IVR 模板完整性和不停话升级仍需专项验证；不能用本轮页面与授权结果代替这些原生能力验收。


### 2026-10-21：按用户截图补齐会话工作台的话务门禁

前一轮主要覆盖首页、客户页及个人页，没有覆盖 /omnichannel 完整工作台。用户截图暴露：当日话务、电话切换、旧电话视图偏好和电话历史缺少模块判断。真实坐席 1001 修复前能获得 3 条电话历史，直接访问电话会话 c289 的消息接口也返回 200。

修复内容：
- 工作台根据 ICC 能力隐藏当日话务、电话筛选及电话会话；旧浏览器电话偏好在 ICC 不可用时按多媒体展示，原偏好不删除。未授权的新来电及迟到的电话会话事件不会重新打开电话视图，原通话释放事件仍可处理。
- 在线会话列表、历史和 CSV 仅返回多媒体数据；显式 phone 查询与导出返回 403。会话资源校验查询实际 inbox 类型，绕过列表直接访问电话详情也返回 403；历史记录没有删除。
- 复用的在线工具明确命名为抢接会话、会话协作、会话监控、旁观会话等；电话模式工具在 ICC 不可用时隐藏，在线协作的强制状态面板只允许多媒体模式。原 RBAC 与在线会话访问保留。
- 未启用 ITR 时不发送其队列状态轮询。

验证：22 项 Community 后端/策略回归、91 项权限回归、3 项原有多媒体工作台回归、23 项前端登录/权限回归、4 项视图偏好回归通过；后端 tsc 与前端生产构建通过。真实 Docker 接口确认 Community / icc=false，默认列表 9 条和在线历史 8 条均仅 media；电话列表、电话 CSV、c289 消息、SIP 凭据均返回 403。Chrome 1440×960 使用真实坐席与预存 phone 偏好，电话按钮、电话行和电话工具栏计数均为 0，迟到事件注入后状态不变；没有页面 JavaScript 异常。截图和 HTTP 记录在 %TEMP%/smc-community-voice-20261021。

已将本地 smc-icc-test 后端更新为 smc-icc/omniagent-backend:community-voice-20261021，前端仍由原 Nginx 容器挂载新 dist。ConfServer 管理密码没有改动。电话历史 c289 与其消息数量、客户总数在修复前后保持一致。

范围边界：现有 TARS 服务是旧测试环境中保留的运行实例，模块开关尚未联动原生进程启停，也没有在原生服务层完成坐席/中继额度限制。浏览器还观察到原有 /api/access/tenants 409（未启用租户联动）及 /api/agent/internal-chats 400（旧 CCS 在线身份依赖）；本轮未把内部坐席协作改造成独立于 CCS 的服务，不能宣称整个全媒体工作台已完成无 ICC 依赖验收。

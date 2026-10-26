# @omniagent/omni-sip

移动坐席的原生能力插件，提供两个 Capacitor 插件：

| 插件 | 作用 | 对应 Vue 侧 |
| --- | --- | --- |
| `OmniSip` | PJSIP 注册、呼叫控制、DTMF、音频路由、系统电话集成 | `src/services/sip/` |
| `OmniPush` | 取推送 token 与刷新事件 | `src/services/mobile-push.ts` |

职责边界：插件不做任何业务判断。**是否应答、是否退队、双腿如何关联全部在 Vue 侧**
（`src/services/sip/call-coordinator.ts`），这样 Android / iOS / 鸿蒙三端行为一致。

## 一、先编译 PJSIP

插件的 Kotlin 代码直接依赖 `org.pjsip.pjsua2`，产物不在仓库里，必须先编译。

推荐用容器，工具链（JDK 21 / SDK 35 / NDK 26.3 / swig）都是现成的，
Windows 上也能跑 —— 见 [`docker/mobile-build`](../../../../docker/mobile-build/README.md)：

```powershell
bash docker/mobile-build/build.sh                        # 首次：构建镜像
cd docker/mobile-build
docker compose run --rm build pjsip-android              # 或 ... pjsip-android arm64-v8a
```

想在宿主直接编也可以，需要 Linux / macOS / WSL —— Windows 原生 shell 跑不通
NDK 的 configure：

```bash
export ANDROID_NDK_ROOT="$HOME/Android/Sdk/ndk/26.3.11579264"
sudo apt install -y swig build-essential curl   # macOS: brew install swig
cd OmniAgent/frontend/native/plugins/omni-sip/scripts
./build-pjsip-android.sh                        # 或 ./build-pjsip-android.sh arm64-v8a
```

脚本做的事：拉 PJSIP / OpenSSL / Opus 源码 → 按 ABI 交叉编译 →
套用 `scripts/config_site.h`（开 TLS、SRTP、Opus、PCMA/PCMU、WebRTC AEC，关视频）→
跑官方 SWIG Java 绑定 → 把 `libpjsua2.so` 与 `org/pjsip/pjsua2/*.java`
放进 `android/src/pjsua2/`。

首次编译约 20–40 分钟，之后 OpenSSL 与 Opus 会复用缓存（缓存目录带版本号，
改版本会自动重编，不会悄悄用旧库）。

### 依赖版本与为什么是这几个

脚本顶部三个 `*_VERSION` 是唯一的版本来源，三端（Android/iOS/鸿蒙）保持一致：

| 依赖 | 版本 | 理由 |
| --- | --- | --- |
| PJSIP | 2.17 | 相比 2.14.1 修掉 14 个公开漏洞，含 1 个 critical（pjmedia-codec 解析 RTP 载荷栈溢出），以及 Opus 解码堆溢出、DNS 解析器堆溢出、ICE 的 UAF 与长 username 溢出 —— 后面这几个正好都在我们启用的功能上 |
| OpenSSL | 3.5.8 | 3.0 分支的 LTS 支持期已于 2026-09 结束；3.5 是 LTS，维护到 2030-04 |
| Opus | 1.5.2 | 1.5 的深度学习丢包隐藏对移动弱网直接有收益 |

升级 PJSIP 后务必重编并重跑 Kotlin 编译：SWIG 的产物路径与生成风格在小版本间变过
（2.14 → 2.17 就把输出从 `java/android/app/src/main` 挪到了 `java/android/pjsua2/src/main`）。

需要注意的是，2026 年 6 月后披露的约 20 个问题在 2.17 里仍无修复版本。多数落在编译时
就关掉的组件（视频/H.263/VPX/AVI、telnet CLI、UPnP IGD、PIDF presence），但
SDP 的 `a=crypto` 解析、TLS 证书 SubjectAltName 嵌入 NUL 导致的主机名校验绕过、
DNS 响应校验不足这三类碰得到。真正的防线是「App 只与自家 SBC 通过 TLS 对话」这条架构
约束 —— 端上不接受任意对端的 SIP，攻击者得先能 MITM TLS 或打进 SBC。

### 与 pjsua2 Java 绑定打交道的三个坑

都是实测踩出来的，改 Kotlin 时记得：

1. SWIG 把 pjsip 的 C 枚举生成成**只放 `int` 常量的 final class**，不是 Java 枚举。
   所以没有 `swigValue()`，接口收发的都是 `Int`，别把 `pjsip_transport_type_e`
   当类型用。
2. 容器类（`CallMediaInfoVector`、`CodecInfoVector2` 等）继承
   `java.util.AbstractList`，Kotlin 侧要用 `.size` 属性，`.size()` 编不过。
3. 生成的 Java 源码在同一个模块里，Kotlin 只能通过 `import` 引用，
   内联全限定名（`org.pjsip.pjsua2.Endpoint.instance()`）会报
   `Unresolved reference 'pjsip'`。

### Android 视频

Android 构建使用 `scripts/config_site_android.h` 覆盖共享语音配置，开启
Camera2、MediaCodec H.264、OpenGL ES 和 libyuv。iOS 和鸿蒙仍保持语音配置。
普通呼叫显式禁用视频；用户选择视频接听或开启视频时才申请摄像头权限。
视频画面使用原生 SurfaceView，支持本地预览、切换摄像头、静音与挂断。
构建与验证步骤见 [`docs/mobile/android-video.md`](../../../../docs/mobile/android-video.md)。

## 二、接进宿主 App

本地依赖已写进 `frontend/package.json`（`"@omniagent/omni-sip": "file:native/plugins/omni-sip"`），
克隆下来只需常规安装与同步：

```bash
cd OmniAgent/frontend
npm install                            # 建立 node_modules/@omniagent/omni-sip 链接
npm run cap:init                       # 首次：生成 android 工程（已有则跳过）
npm run cap:sync                       # 应输出 Found 1 Capacitor plugin: @omniagent/omni-sip
```

同步后 `android/capacitor.settings.gradle` 会出现 `include ':omniagent-omni-sip'`，
`android/app/capacitor.build.gradle` 会出现 `implementation project(':omniagent-omni-sip')`。
两个文件都是生成的，不要手改。

宿主 `android/app` 还需要补两件事（`cap sync` 不会自动做）：

1. **FCM**：把 `google-services.json` 放进 `android/app/`，在 `android/build.gradle`
   加 `classpath 'com.google.gms:google-services:4.4.2'`，在 `android/app/build.gradle`
   顶部 `apply plugin: 'com.google.gms.google-services'`。没有这个 json 就别加插件，
   `processDebugGoogleServices` 会直接让构建失败。
2. **省电白名单**：华为/小米/OPPO/vivo 需要引导用户把 App 加入白名单并允许自启，
   否则锁屏久置后进程仍会被杀 —— 这是前台服务无法绕开的，必须靠推送唤醒兜底。

麦克风与通知权限不用宿主操心：`register()` 会一次性申请两者，麦克风被拒直接 reject
（否则接通必然单通），通知被拒只警告不阻断（仅影响后台全屏来电提醒）。

## 三、系统集成的取舍

**Telecom 用自管理连接（`CAPABILITY_SELF_MANAGED`）**，不是 `CALL_PROVIDER`。
自管理不需要 App 成为默认电话应用，代价是来电界面得自己画
（`IncomingCallNotifier` 的全屏通知 + `IncomingCallActivity` 点屏拉起 WebView）。
换来的是系统级能力：与运营商来电互斥、蜂窝来电打断时自动保持、蓝牙与车机按键可控。

`TelecomBridge.reportIncoming()` 返回 false（无权限、厂商裁剪、系统正忙）时，
自动退回纯通知路径，不影响接听。

**静音在本机做**（停掉采集设备到通话的传输），不走 CCS 的 `DoAgentBeginMute`：
本机静音更即时，也不影响 FreeSWITCH 侧录音完整性。保持（hold）相反，必须走 CCS，
因为要给对端放等待音乐。

**DTMF 走 RFC2833**（`Call.dialDtmf`）。CCS 只有 `DoAgentReceiveDTMF`（收），
没有下发 DTMF 的接口，所以外发 DTMF 只能由 PJSIP 负责。

## 四、iOS

```bash
# 只能在 macOS 上编译
cd OmniAgent/frontend/native/plugins/omni-sip/scripts
./build-pjsip-ios.sh                  # 产出 ios/Frameworks/pjsua2.xcframework
cd ../../../ && npm run cap:sync && npx cap open ios
```

宿主 `ios/App` 需要补：

1. **Capabilities**：Background Modes 勾选 `Voice over IP` 与 `Audio`；
   Push Notifications 打开。
2. **Info.plist**：`NSMicrophoneUsageDescription`（说明用于坐席通话）。
3. **APNs VoIP 证书/密钥**：后端用的是 token 鉴权（`PUSH_APNS_KEY*`），
   topic 固定是 `<bundle-id>.voip`。

iOS 与 Android 的行为差异（都封在插件里，Vue 侧无感）：

| 能力 | Android | iOS |
| --- | --- | --- |
| 来电界面 | 自管理 Telecom + 全屏通知（自己画） | CallKit 提供系统界面 |
| 唤醒 | FCM 高优先级 data 消息 | PushKit VoIP push，**必须**在回调内立刻 report 来电 |
| 音频路由 | `setCommunicationDevice` 可精确指定 | 只能 `overrideOutputAudioPort`，蓝牙/有线由系统选 |
| 保活 | 前台服务 + 省电白名单 | 无需常驻，靠 VoIP push 唤醒 |

VoIP push 的时序有个坑：push 到得比 SIP INVITE 早，而 iOS 要求立刻 report，
所以插件先用 CCS 的 `call_id` 占位报一通，等 INVITE 到达时用
`CallKitManager.adoptPlaceholder` 改挂到真正的 SIP callId 上，避免系统里出现两通呼叫。

## 五、授权

`libpjsua2.so` 受 PJSIP 授权约束（GPLv2 或商业授权二选一）。
对外发布前先确认商业授权已到位，见 `OmniAgent/docs/mobile/pjsip-license.md`。

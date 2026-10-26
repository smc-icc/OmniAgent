# OmniAgent 鸿蒙 (HarmonyOS) 壳

本目录为 **ArkWeb WebView** 壳工程，加载 `entry/src/main/resources/rawfile/web` 中的前端静态资源。

离线资源通过受控的 `https://localhost` 页面来源映射到 rawfile，而不是直接使用
`resource://rawfile` 作为页面 URL。后者会被 ArkWeb 的 ES module/CSS CORS 策略
拦截并导致白屏。页面启动前注入鸿蒙平台标识，云端 API 不经过本地资源映射。

## 前置条件

- [DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/) 5.0+
- HarmonyOS SDK API 12+（支持 ArkWeb）

## 打包步骤

```bash
cd OmniAgent/frontend
npm run build:native
npm run harmony:pack
```

然后在 DevEco Studio 中打开 `native/harmonyos`，连接设备或模拟器，执行 **Build HAP** / **Run**。

## 配置后端地址

默认读取打包时 `.env.native` 中的 `VITE_API_BASE` 和 `VITE_SOCKET_URL`。
当前二者均为 `https://omni.seami.cloud`。修改后需重新构建并同步 Web 资源。
只有构建时未指定 `VITE_API_BASE` 时，才会读取以下本地存储设置：

```js
localStorage.setItem('omni_api_base', 'http://你的服务器:3001')
location.reload()
```

## 移动坐席能力（JSBridge / 语音 / 推送）

壳里现在带了一层 ArkTS ↔ Web 的桥，Web 侧通过 `window.OmniHarmonyNative` 调用，
原生通过 `window.__omniHarmonyEvent(name, jsonPayload)` 回灌事件。
桥的实现在 `entry/src/main/ets/bridge/`，Web 侧对接在
`frontend/src/services/sip/harmony-bridge.ts` 与 `harmony-sip-engine.ts`。

约定：**方法名与事件名和 Android / iOS 完全一致**，所以 Vue 业务代码里没有任何鸿蒙分支。

三块能力的现状：

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 多媒体会话（微信/短信/网页/邮件） | 可用 | 纯 Web 能力，不依赖原生 |
| 推送（来电唤醒） | 可用 | Push Kit，`pushToken()` + `pushTokenReady` 事件 |
| 长时任务保活 | 可用 | `keepAlive(true/false)`，与话务签入状态绑定 |
| 语音（PJSIP + OHAudio） | 已接入并通过原生链接，待真机验收 | SIP 注册、双向采集播放、静音、保持及故障处理 |

### 过渡版本（推荐先交付这个）

不编译 PJSIP 也能出包：此时话务页显示「本机无语音能力」，坐席在鸿蒙上处理多媒体会话，
语音走 PC 或 Android。要出过渡版本，把 `entry/build-profile.json5` 里的
`externalNativeOptions` 整块注释掉即可（否则会因缺 `third_party/pjsip` 而编译失败）。

### 完整版本（含语音）

```bash
export OHOS_SDK_NATIVE=/path/to/DevEco/sdk/default/openharmony/native
cd OmniAgent/frontend/native/plugins/omni-sip/scripts
./build-pjsip-harmony.sh arm64-v8a      # 产出 entry/src/main/cpp/third_party/pjsip/<abi>
```

然后在 DevEco Studio 里编译 entry 模块，产出 `libomnisip.so`。
NAPI 封装在 `entry/src/main/cpp/`：`OmniSipNapi.cpp` 是 pjsua2 的包装，
`napi_init.cpp` 做绑定，事件走 threadsafe function（pjsip 回调在自己的线程上，
不能直接碰 ArkTS 的 napi_env）。

### 视频版本

视频构建使用 `config_site_harmony.h`，开启 PJSIP 视频、OpenH264 H.264 和
libyuv。CameraKit 输出到 NativeImage consumer surface，原生将 YUV 帧交给
PJSIP；解码后的画面通过 XComponent surface 显示，不经 WebView 传输像素。
移动话务页可选择视频接听或在通话中开启视频，原生页面提供本地预览、
切换前后摄像头、开关摄像头、静音和挂断。摄像头权限只在用户选择视频时
申请，退到后台或退出视频页时停止采集与发送。

构建详情和验证边界见 [harmony-video.md](../../../docs/mobile/harmony-video.md)。
当前本机工程使用已有开发者签名配置，可生成 `entry-default-signed.hap`；它仅适用于该配置允许的设备。`entry-default-unsigned.hap` 不能作为签名安装包使用，正式发布仍需相应证书及 Provision Profile。

### 真机待验证项

- 鸿蒙没有 CallKit / ConnectionService 的等价能力，来电界面只能自己画（当前就是 Vue 页面），
  锁屏来电体验弱于 Android 与 iOS。
- 音频采集播放已通过 HarmonyAudio.cpp 接入 OHAudio/PJMEDIA；使用有界 PCM 缓冲和串行控制，
  启动失败回滚，运行故障报告错误并保留呼叫。仍需在真机上验证双向声音、路由、延迟与回声。
- 编译通过不代表音视频链路已验收；当前无鸿蒙真机安装、通话和长时保活验证结果。

## 说明

- 鸿蒙无官方 Capacitor/Tauri 一键通道，采用 **ArkWeb + rawfile 离线包** 方案。
- 截图、录屏等能力在 WebView 内受系统权限与 ArkWeb 能力限制，与桌面浏览器类似。

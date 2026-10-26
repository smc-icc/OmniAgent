# OmniAgent 前端原生应用构建指南

将 Vue 前端打包为 **Windows / macOS / Linux / Android / 鸿蒙** 原生应用。

## 架构概览

| 平台 | 技术栈 | 输出 |
|------|--------|------|
| Windows / macOS / Linux | [Tauri 2](https://v2.tauri.app/) | `.exe` / `.msi`、`.dmg`、`.AppImage` / `.deb` |
| Android | [Capacitor](https://capacitorjs.com/) | Android Studio 构建 APK/AAB |
| 鸿蒙 HarmonyOS | ArkWeb + rawfile 离线包 | DevEco Studio 构建 HAP |

## 通用准备

```bash
cd OmniAgent/frontend
npm install
npm run native:prepare    # 生成 .env.native
```

编辑 `.env.native`，配置后端地址：

```env
VITE_NATIVE_APP=true
VITE_API_BASE=http://你的服务器IP:3001
VITE_SOCKET_URL=http://你的服务器IP:3001
```

运行时也可在浏览器控制台覆盖：

```js
localStorage.setItem('omni_api_base', 'http://192.168.1.100:3001')
location.reload()
```

---

## Windows / macOS / Linux（Tauri）

### 环境

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)（`rustup`）
- **Windows**：Visual Studio Build Tools（C++ 桌面开发）、WebView2（Win10+ 通常已自带）
- **macOS**：Xcode Command Line Tools
- **Linux**：`webkit2gtk` 等（见 [Tauri 文档](https://v2.tauri.app/start/prerequisites/)）

### 生成图标（首次）

```bash
npm run native:icon
```

### 开发调试

```bash
npm run tauri:dev
```

### 打包

```bash
npm run tauri:build
```

产物目录：`src-tauri/target/release/bundle/`

平台专用：

```bash
npm run tauri:build:win
npm run tauri:build:mac
npm run tauri:build:linux
```

---

## Android（Capacitor）

### 环境

- [Android Studio](https://developer.android.com/studio)（含 SDK、JDK 17）
- 设置 `ANDROID_HOME`

### 首次初始化

```bash
npm run cap:init
```

### 同步 Web 资源并打开工程

```bash
npm run cap:android
```

在 Android Studio 中 **Run** 或 **Build > Generate Signed Bundle/APK**。

---

## 鸿蒙 HarmonyOS

### 环境

- [DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/) 5.0+
- HarmonyOS SDK API 12+

### 打包

```bash
npm run build:native
npm run harmony:pack
```

用 DevEco Studio 打开 `native/harmonyos`，配置签名后构建 HAP。

详见 [native/harmonyos/README.md](./native/harmonyos/README.md)。

---

## npm 脚本速查

| 脚本 | 说明 |
|------|------|
| `npm run build:native` | 以 `native` 模式构建 `dist/`（`base: './'`） |
| `npm run native:prepare` | 创建 `.env.native` |
| `npm run native:icon` | 从 SVG 生成 Tauri 多尺寸图标 |
| `npm run tauri:dev` | 桌面端开发 |
| `npm run tauri:build` | 桌面端打包（当前平台） |
| `npm run cap:sync` | 构建并同步到 Capacitor |
| `npm run cap:android` | 打开 Android Studio |
| `npm run harmony:pack` | 复制 dist 到鸿蒙 rawfile |

---

## 能力说明

- 原生壳内嵌 WebView，业务逻辑与 Web 版相同。
- 截图、录屏、Socket 等依赖 Web API，在桌面 WebView2 / WKWebView / ArkWeb 上行为接近浏览器。
- 生产环境请使用 **HTTPS** 或配置 Android `network_security_config` / 鸿蒙网络权限。

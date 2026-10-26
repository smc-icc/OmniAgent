#!/usr/bin/env bash
#
# 把 PJSIP（含 pjsua2）编译成 pjsua2.xcframework，供 iOS 插件链接。
# 只能在 macOS 上跑（需要 Xcode 命令行工具）。
#
# 用法：
#   ./build-pjsip-ios.sh              # device(arm64) + simulator(arm64/x86_64)
#   ./build-pjsip-ios.sh device       # 只出真机切片
#
set -euo pipefail

PJSIP_VERSION="${PJSIP_VERSION:-2.17}"
OPENSSL_VERSION="${OPENSSL_VERSION:-3.5.8}"
OPUS_VERSION="${OPUS_VERSION:-1.5.2}"
IOS_MIN="${IOS_MIN:-14.0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="${PJSIP_WORK_DIR:-$PLUGIN_DIR/.pjsip-build-ios}"
OUT_DIR="$PLUGIN_DIR/ios/Frameworks"

die() { echo "错误：$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "iOS 产物只能在 macOS 上编译"
command -v xcodebuild >/dev/null || die "缺少 Xcode 命令行工具"

TARGETS=("${@:-device simulator}")
# shellcheck disable=SC2206
TARGETS=(${TARGETS[*]})

mkdir -p "$WORK_DIR" "$OUT_DIR"

fetch() {
  local url="$1" file="$2"
  [[ -f "$WORK_DIR/$file" ]] && return 0
  echo "下载 $file"
  curl -fL --retry 3 -o "$WORK_DIR/$file" "$url"
}

fetch "https://github.com/pjsip/pjproject/archive/refs/tags/$PJSIP_VERSION.tar.gz" "pjproject-$PJSIP_VERSION.tar.gz"
fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz" "openssl-$OPENSSL_VERSION.tar.gz"
fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz" "opus-$OPUS_VERSION.tar.gz"

for t in "pjproject-$PJSIP_VERSION" "openssl-$OPENSSL_VERSION" "opus-$OPUS_VERSION"; do
  [[ -d "$WORK_DIR/$t" ]] || tar -xzf "$WORK_DIR/$t.tar.gz" -C "$WORK_DIR"
done

PJ_DIR="$WORK_DIR/pjproject-$PJSIP_VERSION"

sdk_of() { [[ "$1" == "device" ]] && echo "iphoneos" || echo "iphonesimulator"; }
arch_of() { [[ "$1" == "device" ]] && echo "arm64" || echo "$(uname -m)"; }

build_openssl() {
  local target="$1" prefix="$WORK_DIR/deps/$target/openssl-$OPENSSL_VERSION"
  [[ -f "$prefix/lib/libssl.a" ]] && return 0
  echo "== 编译 OpenSSL（$target）"
  local cfg="ios64-xcrun"
  [[ "$target" == "simulator" ]] && cfg="iossimulator-xcrun"
  local src="$WORK_DIR/openssl-src-$target"
  rm -rf "$src"
  cp -r "$WORK_DIR/openssl-$OPENSSL_VERSION" "$src"
  (
    cd "$src"
    ./Configure "$cfg" no-shared no-tests no-ui-console --prefix="$prefix"
    make -j"$(sysctl -n hw.ncpu)" build_libs
    make install_dev
  )
}

build_opus() {
  local target="$1" prefix="$WORK_DIR/deps/$target/opus-$OPUS_VERSION"
  [[ -f "$prefix/lib/libopus.a" ]] && return 0
  echo "== 编译 Opus（$target）"
  local sdk; sdk="$(sdk_of "$target")"
  local arch; arch="$(arch_of "$target")"
  local sysroot; sysroot="$(xcrun --sdk "$sdk" --show-sdk-path)"
  local src="$WORK_DIR/opus-src-$target"
  rm -rf "$src"
  cp -r "$WORK_DIR/opus-$OPUS_VERSION" "$src"
  (
    cd "$src"
    export CC="$(xcrun -f clang)"
    export CFLAGS="-arch $arch -isysroot $sysroot -mios-version-min=$IOS_MIN"
    ./configure --host="${arch}-apple-darwin" --prefix="$prefix" \
      --enable-static --disable-shared --disable-doc --disable-extra-programs
    make -j"$(sysctl -n hw.ncpu)"
    make install
  )
}

build_pjsip() {
  local target="$1"
  echo "== 编译 PJSIP（$target）"
  local ssl="$WORK_DIR/deps/$target/openssl-$OPENSSL_VERSION"
  local opus="$WORK_DIR/deps/$target/opus-$OPUS_VERSION"
  local sdk; sdk="$(sdk_of "$target")"
  local arch; arch="$(arch_of "$target")"

  cp "$SCRIPT_DIR/config_site.h" "$PJ_DIR/pjlib/include/pj/config_site.h"
  # iOS 用 coreaudio，而不是 Android 的 OpenSL
  cat >> "$PJ_DIR/pjlib/include/pj/config_site.h" <<'EOF'

/* iOS 专用：音频走 CoreAudio，视频彻底关掉 */
#define PJMEDIA_AUDIO_DEV_HAS_COREAUDIO 1
#define PJMEDIA_AUDIO_DEV_HAS_OPENSL 0
#define PJMEDIA_VIDEO_DEV_HAS_IOS 0
EOF

  (
    cd "$PJ_DIR"
    make distclean >/dev/null 2>&1 || true
    export DEVPATH="$(xcode-select -p)/Platforms/$( [[ "$target" == device ]] && echo iPhoneOS || echo iPhoneSimulator ).platform/Developer"
    export ARCH="-arch $arch"
    export IPHONESDK="$(basename "$(xcrun --sdk "$sdk" --show-sdk-path)")"
    export CFLAGS="-mios-version-min=$IOS_MIN"
    ./configure-iphone --with-ssl="$ssl" --with-opus="$opus" \
      --disable-video --disable-libyuv --disable-openh264 --disable-vpx --disable-ffmpeg \
      --disable-g7221-codec --disable-ilbc-codec --disable-gsm-codec \
      --disable-speex-codec --disable-speex-aec
    make dep
    make -j"$(sysctl -n hw.ncpu)"
  )

  # 把所有 .a 合成一个，便于打进 framework
  local stage="$WORK_DIR/stage/$target"
  rm -rf "$stage"
  mkdir -p "$stage"
  find "$PJ_DIR" -name '*.a' -path '*-apple-darwin*' -print0 | xargs -0 libtool -static -o "$stage/libpjsua2-all.a"
  echo "$stage/libpjsua2-all.a"
}

make_framework() {
  local target="$1" lib="$2"
  local fw="$WORK_DIR/frameworks/$target/pjsua2.framework"
  rm -rf "$fw"
  mkdir -p "$fw/Headers"
  cp "$lib" "$fw/pjsua2"
  # pjsua2.hpp 及其依赖的 pj* 头文件全部带上
  for d in pjlib pjlib-util pjnath pjmedia pjsip; do
    rsync -a --include='*/' --include='*.h' --include='*.hpp' --exclude='*' \
      "$PJ_DIR/$d/include/" "$fw/Headers/"
  done
  rsync -a --include='*/' --include='*.hpp' --include='*.h' --exclude='*' \
    "$PJ_DIR/pjsip/include/pjsua2/" "$fw/Headers/pjsua2/"
  cp "$PJ_DIR/pjsip/include/pjsua2.hpp" "$fw/Headers/"
  cat > "$fw/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>org.pjsip.pjsua2</string>
  <key>CFBundleName</key><string>pjsua2</string>
  <key>CFBundleExecutable</key><string>pjsua2</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>MinimumOSVersion</key><string>$IOS_MIN</string>
</dict>
</plist>
EOF
  echo "$fw"
}

ARGS=()
for target in "${TARGETS[@]}"; do
  build_openssl "$target"
  build_opus "$target"
  lib="$(build_pjsip "$target" | tail -n1)"
  fw="$(make_framework "$target" "$lib" | tail -n1)"
  ARGS+=(-framework "$fw")
done

rm -rf "$OUT_DIR/pjsua2.xcframework"
xcodebuild -create-xcframework "${ARGS[@]}" -output "$OUT_DIR/pjsua2.xcframework"

echo
echo "完成：$OUT_DIR/pjsua2.xcframework"
echo "提醒：PJSIP 授权约束见 OmniAgent/docs/mobile/pjsip-license.md"

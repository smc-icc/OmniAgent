#!/usr/bin/env bash
#
# 编译 PJSIP 2.x 的 Android 产物（libpjsua2.so + SWIG Java 绑定），
# 并把结果放进 Capacitor 插件的 src/pjsua2/ 下。
#
# 只在 Linux / macOS / WSL 上跑：NDK 的 configure 依赖 POSIX 工具链，
# Windows 原生 shell 走不通（README 有说明）。
#
# 用法：
#   export ANDROID_NDK_ROOT=$HOME/Android/Sdk/ndk/26.3.11579264
#   ./build-pjsip-android.sh            # 编译全部 ABI
#   ./build-pjsip-android.sh arm64-v8a  # 只编译一个 ABI
#
set -euo pipefail

PJSIP_VERSION="${PJSIP_VERSION:-2.17}"
OPENSSL_VERSION="${OPENSSL_VERSION:-3.5.8}"
OPUS_VERSION="${OPUS_VERSION:-1.5.2}"
ANDROID_API="${ANDROID_API:-24}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="${PJSIP_WORK_DIR:-$PLUGIN_DIR/.pjsip-build}"
OUT_JNI="$PLUGIN_DIR/android/src/pjsua2/jniLibs"
OUT_JAVA="$PLUGIN_DIR/android/src/pjsua2/java"

ABIS=("${@:-arm64-v8a armeabi-v7a}")
# shellcheck disable=SC2206
ABIS=(${ABIS[*]})

die() { echo "错误：$*" >&2; exit 1; }

[[ -n "${ANDROID_NDK_ROOT:-}" ]] || die "请先设置 ANDROID_NDK_ROOT"
[[ -d "$ANDROID_NDK_ROOT" ]] || die "ANDROID_NDK_ROOT 不存在：$ANDROID_NDK_ROOT"
command -v swig >/dev/null || die "缺少 swig（apt install swig / brew install swig）"
command -v make >/dev/null || die "缺少 make"

HOST_TAG="linux-x86_64"
[[ "$(uname -s)" == "Darwin" ]] && HOST_TAG="darwin-x86_64"
TOOLCHAIN="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/$HOST_TAG"
[[ -d "$TOOLCHAIN" ]] || die "找不到 NDK toolchain：$TOOLCHAIN"

mkdir -p "$WORK_DIR" "$OUT_JNI" "$OUT_JAVA"

# ─────────────────────────────── 依赖源码

fetch() {
  local url="$1" file="$2"
  [[ -f "$WORK_DIR/$file" ]] && return 0
  echo "下载 $file"
  curl -fL --retry 3 -o "$WORK_DIR/$file" "$url"
}

fetch "https://github.com/pjsip/pjproject/archive/refs/tags/$PJSIP_VERSION.tar.gz" "pjproject-$PJSIP_VERSION.tar.gz"
fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz" "openssl-$OPENSSL_VERSION.tar.gz"
fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz" "opus-$OPUS_VERSION.tar.gz"

extract() {
  local tarball="$1" dir="$2"
  [[ -d "$WORK_DIR/$dir" ]] && return 0
  tar -xzf "$WORK_DIR/$tarball" -C "$WORK_DIR"
}

extract "pjproject-$PJSIP_VERSION.tar.gz" "pjproject-$PJSIP_VERSION"
extract "openssl-$OPENSSL_VERSION.tar.gz" "openssl-$OPENSSL_VERSION"
extract "opus-$OPUS_VERSION.tar.gz" "opus-$OPUS_VERSION"

PJ_DIR="$WORK_DIR/pjproject-$PJSIP_VERSION"

# ─────────────────────────────── 每个 ABI 的工具链参数

abi_triple() {
  case "$1" in
    arm64-v8a) echo "aarch64-linux-android" ;;
    armeabi-v7a) echo "armv7a-linux-androideabi" ;;
    x86_64) echo "x86_64-linux-android" ;;
    *) die "不支持的 ABI：$1" ;;
  esac
}

openssl_target() {
  case "$1" in
    arm64-v8a) echo "android-arm64" ;;
    armeabi-v7a) echo "android-arm" ;;
    x86_64) echo "android-x86_64" ;;
  esac
}

build_openssl() {
  local abi="$1" prefix="$WORK_DIR/deps/$abi/openssl-$OPENSSL_VERSION"
  [[ -f "$prefix/lib/libssl.a" ]] && return 0
  echo "== 编译 OpenSSL（$abi）"
  local src="$WORK_DIR/openssl-src-$abi"
  rm -rf "$src"
  cp -r "$WORK_DIR/openssl-$OPENSSL_VERSION" "$src"
  (
    cd "$src"
    export ANDROID_NDK_ROOT PATH="$TOOLCHAIN/bin:$PATH"
    ./Configure "$(openssl_target "$abi")" no-shared no-tests no-ui-console \
      -D__ANDROID_API__="$ANDROID_API" --prefix="$prefix"
    make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)" build_libs
    make install_dev
  )
}

build_opus() {
  local abi="$1" prefix="$WORK_DIR/deps/$abi/opus-$OPUS_VERSION"
  [[ -f "$prefix/lib/libopus.a" ]] && return 0
  echo "== 编译 Opus（$abi）"
  local triple; triple="$(abi_triple "$abi")"
  local src="$WORK_DIR/opus-src-$abi"
  rm -rf "$src"
  cp -r "$WORK_DIR/opus-$OPUS_VERSION" "$src"
  (
    cd "$src"
    export CC="$TOOLCHAIN/bin/${triple}${ANDROID_API}-clang"
    export AR="$TOOLCHAIN/bin/llvm-ar" RANLIB="$TOOLCHAIN/bin/llvm-ranlib"
    ./configure --host="$(abi_triple "$abi" | sed 's/armv7a/arm/')" \
      --prefix="$prefix" --enable-static --disable-shared \
      --disable-doc --disable-extra-programs
    make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
    make install
  )
}

build_pjsip() {
  local abi="$1"
  echo "== 编译 PJSIP（$abi）"
  local ssl="$WORK_DIR/deps/$abi/openssl-$OPENSSL_VERSION"
  local opus="$WORK_DIR/deps/$abi/opus-$OPUS_VERSION"

  cp "$SCRIPT_DIR/config_site.h" "$PJ_DIR/pjlib/include/pj/config_site_base.h"
  cp "$SCRIPT_DIR/config_site_android.h" "$PJ_DIR/pjlib/include/pj/config_site.h"

  (
    cd "$PJ_DIR"
    make distclean >/dev/null 2>&1 || true
    export ANDROID_NDK_ROOT TARGET_ABI="$abi" APP_PLATFORM="android-$ANDROID_API"
    ./configure-android --use-ndk-cflags \
      --with-ssl="$ssl" \
      --with-opus="$opus" \
      --disable-sdl \
      --disable-openh264 \
      --disable-vpx \
      --disable-ffmpeg \
      --disable-g7221-codec \
      --disable-ilbc-codec \
      --disable-speex-codec \
      --disable-speex-aec \
      --disable-gsm-codec
    grep -q '#define PJMEDIA_HAS_ANDROID_MEDIACODEC 1' pjmedia/include/pjmedia-codec/config_auto.h \
      || die "Android MediaCodec H.264 未启用，拒绝产出不支持视频的原生库"
    make dep
    make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

    # SWIG Java 绑定：官方 pjsua2 绑定，不用第三方分支
    cd pjsip-apps/src/swig
    make clean >/dev/null 2>&1 || true
    make java
  )

  # 2.14 起 swig 的产物挪到了 java/android/pjsua2/src/main，早期版本在 java/android/app/src/main
  local swig_root="$PJ_DIR/pjsip-apps/src/swig/java/android"
  local swig_out=""
  local cand
  for cand in "$swig_root/pjsua2/src/main" "$swig_root/app/src/main"; do
    if [[ -f "$cand/jniLibs/$abi/libpjsua2.so" ]]; then
      swig_out="$cand"
      break
    fi
  done
  [[ -n "$swig_out" ]] || die "没有产出 libpjsua2.so（$abi），检查上面的编译日志"

  mkdir -p "$OUT_JNI/$abi"
  cp "$swig_out/jniLibs/$abi/libpjsua2.so" "$OUT_JNI/$abi/"
  # libc++_shared.so 是 pjsua2 的运行时依赖，漏了就是启动即 UnsatisfiedLinkError
  cp "$swig_out/jniLibs/$abi/libc++_shared.so" "$OUT_JNI/$abi/" \
    || die "缺 libc++_shared.so（$abi）"
  # Java 绑定与 ABI 无关，拷一次即可
  rm -rf "$OUT_JAVA/org"
  cp -r "$swig_out/java/org" "$OUT_JAVA/"
}

for abi in "${ABIS[@]}"; do
  build_openssl "$abi"
  build_opus "$abi"
  build_pjsip "$abi"
done

echo
echo "完成。产物："
find "$OUT_JNI" -name '*.so' -exec ls -lh {} \;
echo "Java 绑定：$OUT_JAVA/org/pjsip/pjsua2"
echo
echo "提醒：libpjsua2.so 受 PJSIP 授权约束，对外发布前先确认商业授权已到位"
echo "（见 OmniAgent/docs/mobile/pjsip-license.md）。"

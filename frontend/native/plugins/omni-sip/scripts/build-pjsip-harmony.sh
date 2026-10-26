#!/usr/bin/env bash
#
# 把 PJSIP 交叉编译成鸿蒙（OpenHarmony / HarmonyOS NEXT）产物，
# 供 native/harmonyos/entry/src/main/cpp 链接成 libomnisip.so。
#
# 需要 HarmonyOS SDK 里的 native 工具链（DevEco Studio 自带）：
#   export OHOS_SDK_NATIVE=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native
#
# 用法：
#   ./build-pjsip-harmony.sh                 # arm64-v8a
#   ./build-pjsip-harmony.sh arm64-v8a armeabi-v7a
#
set -euo pipefail

PJSIP_VERSION="${PJSIP_VERSION:-2.17}"
OPENSSL_VERSION="${OPENSSL_VERSION:-3.5.8}"
OPUS_VERSION="${OPUS_VERSION:-1.5.2}"
OPENH264_VERSION="${OPENH264_VERSION:-2.6.0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HARMONY_CPP="$(cd "$PLUGIN_DIR/../../harmonyos/entry/src/main/cpp" && pwd)"
WORK_DIR="${PJSIP_WORK_DIR:-$PLUGIN_DIR/.pjsip-build-harmony}"

die() { echo "错误：$*" >&2; exit 1; }

[[ -n "${OHOS_SDK_NATIVE:-}" ]] || die "请先设置 OHOS_SDK_NATIVE（指向 SDK 的 native 目录）"
[[ -d "$OHOS_SDK_NATIVE/llvm/bin" ]] || die "找不到 OHOS 工具链：$OHOS_SDK_NATIVE/llvm/bin"

ABIS=("${@:-arm64-v8a}")
# shellcheck disable=SC2206
ABIS=(${ABIS[*]})

mkdir -p "$WORK_DIR"

fetch() {
  local url="$1" file="$2"
  [[ -f "$WORK_DIR/$file" ]] && return 0
  echo "下载 $file"
  curl -fL --retry 3 -o "$WORK_DIR/$file" "$url"
}

fetch "https://github.com/pjsip/pjproject/archive/refs/tags/$PJSIP_VERSION.tar.gz" "pjproject-$PJSIP_VERSION.tar.gz"
fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz" "openssl-$OPENSSL_VERSION.tar.gz"
fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz" "opus-$OPUS_VERSION.tar.gz"
fetch "https://codeload.github.com/cisco/openh264/tar.gz/refs/tags/v$OPENH264_VERSION" "openh264-$OPENH264_VERSION.tar.gz"

for t in "pjproject-$PJSIP_VERSION" "openssl-$OPENSSL_VERSION" "opus-$OPUS_VERSION" "openh264-$OPENH264_VERSION"; do
  [[ -d "$WORK_DIR/$t" ]] || tar -xzf "$WORK_DIR/$t.tar.gz" -C "$WORK_DIR"
done

PJ_DIR="$WORK_DIR/pjproject-$PJSIP_VERSION"

# Windows 的 CreateProcess 把超长参数截断，llvm-ar 打包 libcrypto.a 会失败。
# 写进响应文件再交给 llvm-ar.exe。Linux/macOS 的 llvm-ar 没有这个限制。
ohos_ar_tool() {
  local ar="$1"
  [[ "$ar" == *.exe ]] || { echo "$ar"; return 0; }
  local wrap="$WORK_DIR/ohos-ar"
  cat > "$wrap" <<EOF
#!/usr/bin/env bash
set -euo pipefail
resp=\$(mktemp)
args=()
for a in "\$@"; do
  if [[ "\$a" == /* ]]; then
    args+=("\$(cygpath -w "\$a")")
  else
    args+=("\$a")
  fi
done
printf '%s\n' "\${args[@]}" > "\$resp"
win=\$(cygpath -w "\$resp")
MSYS2_ARG_CONV_EXCL='*' "$ar" "@\${win}"
status=\$?
rm -f "\$resp"
exit \$status
EOF
  chmod +x "$wrap"
  echo "$wrap"
}

triple_of() {
  case "$1" in
    arm64-v8a) echo "aarch64-linux-ohos" ;;
    armeabi-v7a) echo "arm-linux-ohos" ;;
    x86_64) echo "x86_64-linux-ohos" ;;
    *) die "不支持的 ABI：$1" ;;
  esac
}

# clang 必须用 ohos 三元组，才能连上 sysroot 里的 musl。
# Opus / PJSIP 自带的 config.sub 还不认识 ohos，autoconf 的 --host 用 gnu 三元组。
host_of() {
  case "$1" in
    arm64-v8a) echo "aarch64-linux-gnu" ;;
    armeabi-v7a) echo "arm-linux-gnueabi" ;;
    x86_64) echo "x86_64-linux-gnu" ;;
    *) die "不支持的 ABI：$1" ;;
  esac
}

build_one() {
  local abi="$1"
  local triple; triple="$(triple_of "$abi")"
  local prefix="$WORK_DIR/deps/$abi-ssl$OPENSSL_VERSION-opus$OPUS_VERSION"
  local out="$HARMONY_CPP/third_party/pjsip/$abi"

  local bin="$OHOS_SDK_NATIVE/llvm/bin"
  local clang="clang" cxx="clang++" ar="llvm-ar" ranlib="llvm-ranlib"
  # DevEco Windows SDK 的工具是 clang.exe。Git Bash 能直接跑它们。
  # Git Bash 里 -x clang 在只有 clang.exe 时也成立，所以用 -f 判断是不是 Windows SDK。
  if [[ -f "$bin/clang.exe" ]]; then
    clang="clang.exe"
    cxx="clang++.exe"
    ar="llvm-ar.exe"
    ranlib="llvm-ranlib.exe"
  fi
  # autoconf 要在 PATH 里找到名为 ld 的链接器。Windows SDK 只提供 ld.lld.exe。
  local shims="$WORK_DIR/shims"
  if [[ "$clang" == *.exe ]]; then
    mkdir -p "$shims"
    cat > "$shims/ld" <<EOF
#!/usr/bin/env bash
exec "$bin/ld.lld.exe" "\$@"
EOF
    chmod +x "$shims/ld"
    export PATH="$shims:$bin:$PATH"
  else
    export PATH="$bin:$PATH"
  fi
  export CC="${OHOS_CC_OVERRIDE:-$bin/$clang --target=$triple}"
  export CXX="${OHOS_CXX_OVERRIDE:-$bin/$cxx --target=$triple}"
  export AR="${OHOS_AR_OVERRIDE:-$(ohos_ar_tool "$bin/$ar")}"
  export RANLIB="${OHOS_RANLIB_OVERRIDE:-$bin/$ranlib}"
  export SYSROOT="$OHOS_SDK_NATIVE/sysroot"
  export CFLAGS="--sysroot=$SYSROOT -D__MUSL__=1 -fPIC ${OHOS_TARGET_CFLAGS:-}"
  export CXXFLAGS="$CFLAGS"
  export LDFLAGS="--sysroot=$SYSROOT ${OHOS_TARGET_LDFLAGS:-}"

  echo "== OpenSSL（$abi）"
  if [[ ! -f "$prefix/openssl/lib/libssl.a" ]]; then
    local src="$WORK_DIR/openssl-src-$abi"
    rm -rf "$src"
    cp -r "$WORK_DIR/openssl-$OPENSSL_VERSION" "$src"
    (
      cd "$src"
      # OHOS 的 musl 环境用 linux-aarch64/linux-generic32 目标即可
      local cfg="linux-aarch64"
      [[ "$abi" == "armeabi-v7a" ]] && cfg="linux-generic32"
      ./Configure "$cfg" no-shared no-tests no-ui-console --prefix="$prefix/openssl"
      make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)" build_libs
      make install_dev
    )
  fi

  echo "== Opus（$abi）"
  if [[ ! -f "$prefix/opus/lib/libopus.a" ]]; then
    local src="$WORK_DIR/opus-src-$abi"
    rm -rf "$src"
    cp -r "$WORK_DIR/opus-$OPUS_VERSION" "$src"
    (
      cd "$src"
      ./configure --host="$(host_of "$abi")" --prefix="$prefix/opus" \
        --disable-maintainer-mode \
        --enable-static --disable-shared --disable-doc --disable-extra-programs
      make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
      make install
    )
  fi

  echo "== OpenH264（$abi）"
  local h264="$prefix/openh264-$OPENH264_VERSION"
  local h264_config="$CC|$CXX|$CFLAGS"
  if [[ ! -f "$h264/lib/libopenh264.a" ]] ||
     [[ ! -f "$h264/build-config.txt" ]] ||
     [[ "$(<"$h264/build-config.txt")" != "$h264_config" ]]; then
    local h264_arch="arm64"
    [[ "$abi" == "armeabi-v7a" ]] && h264_arch="arm"
    [[ "$abi" == "x86_64" ]] && h264_arch="x86_64"
    (
      cd "$WORK_DIR/openh264-$OPENH264_VERSION"
      make clean >/dev/null 2>&1 || true
      make -j8 OS=linux ARCH="$h264_arch" CC="$CC" CXX="$CXX" AR="$AR" \
        CFLAGS="$CFLAGS" CXXFLAGS="$CXXFLAGS -std=c++11" libopenh264.a
      make OS=linux ARCH="$h264_arch" PREFIX="$h264" install-static
      printf '%s\n' "$h264_config" > "$h264/build-config.txt"
    )
  fi

  echo "== PJSIP（$abi）"
  cp "$SCRIPT_DIR/config_site.h" "$PJ_DIR/pjlib/include/pj/config_site_base.h"
  cp "$SCRIPT_DIR/config_site_harmony.h" "$PJ_DIR/pjlib/include/pj/config_site.h"
  # PJSIP assumes GNU libstdc++ for OpenH264; HarmonyOS uses LLVM libc++.
  sed -i 's/OPENH264_LIBS="-lopenh264 -lstdc++"/OPENH264_LIBS="-lopenh264 -lc++"/' "$PJ_DIR/aconfigure"

  (
    cd "$PJ_DIR"
    make distclean >/dev/null 2>&1 || true
    # 静态 libssl 不会自己带上 libcrypto，检测 SSL_CTX_new 时要显式加上。
    ./configure --host="$(host_of "$abi")" --disable-maintainer-mode \
      --with-ssl="$prefix/openssl" \
      --with-opus="$prefix/opus" \
      --with-openh264="$h264" \
      LIBS="-L$prefix/openssl/lib -lcrypto -pthread ${OHOS_TARGET_LIBS:-}" \
      --disable-sdl --disable-v4l2 --disable-vpx --disable-ffmpeg \
      --disable-g7221-codec --disable-ilbc-codec --disable-gsm-codec \
      --disable-speex-codec --disable-speex-aec \
      --disable-sound
    grep -q 'PJMEDIA_HAS_OPENH264_CODEC=1' build.mak \
      || die "OpenH264 检测失败，拒绝生成缺少 H.264 的鸿蒙库"
    make dep
    # 只要静态库。顶层 all 还会链 pjsip-test，缺符号时会把已经编好的库一起判失败。
    make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)" lib
  )

  echo "== 收集产物到 $out"
  rm -rf "$out"
  mkdir -p "$out/include" "$out/lib"
  for d in pjlib pjlib-util pjnath pjmedia pjsip; do
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --include='*/' --include='*.h' --include='*.hpp' --exclude='*' \
        "$PJ_DIR/$d/include/" "$out/include/"
    else
      # Git Bash 没有 rsync，按相对路径把头文件拷出去
      local inc="$PJ_DIR/$d/include"
      while IFS= read -r hdr; do
        local rel="${hdr#"$inc"/}"
        mkdir -p "$out/include/$(dirname "$rel")"
        cp "$hdr" "$out/include/$rel"
      done < <(find "$inc" -type f \( -name '*.h' -o -name '*.hpp' \))
    fi
  done
  cp "$PJ_DIR/pjsip/include/pjsua2.hpp" "$out/include/"
  # 库名里的三元组是 autoconf 的 host（linux-gnu），不是 clang 的 ohos target
  find "$PJ_DIR" -name '*.a' -exec cp {} "$out/lib/" \;
  cp "$prefix/openssl/lib/"lib*.a "$out/lib/" 2>/dev/null || true
  cp "$prefix/opus/lib/"lib*.a "$out/lib/" 2>/dev/null || true
  cp "$h264/lib/libopenh264.a" "$out/lib/"
  cp -r "$h264/include/wels" "$out/include/"
  cp -r "$PJ_DIR/third_party/yuv/include/libyuv" "$out/include/"
  cp "$PJ_DIR/third_party/yuv/include/libyuv.h" "$out/include/"

  # 静态库按依赖顺序写。路径用 CMAKE_CURRENT_LIST_DIR，DevEco 在 Windows 上也能找到。
  {
    echo "# 由 build-pjsip-harmony.sh 生成，勿手工编辑"
    echo "set(PJSIP_LIBS"
    local seen=" "
    local pat base
    for pat in \
      'libpjsua2-*.a' 'libpjsua-*.a' 'libpjsip-ua-*.a' 'libpjsip-simple-*.a' \
      'libpjsip-*.a' 'libpjsdp-*.a' 'libpjmedia-codec-*.a' 'libpjmedia-audiodev-*.a' \
      'libpjmedia-videodev-*.a' 'libpjmedia-*.a' 'libsrtp-*.a' 'libwebrtc-*.a' \
      'libresample-*.a' 'libpjnath-*.a' 'libpjlib-util-*.a' 'libpj-*.a' \
      'libyuv-*.a' 'libopenh264.a' 'libopus.a' 'libssl.a' 'libcrypto.a'
    do
      local f
      for f in "$out/lib"/$pat; do
        [[ -f "$f" ]] || continue
        base="$(basename "$f")"
        case "$seen" in
          *" $base "*) continue ;;
        esac
        seen="$seen$base "
        echo "    \"\${CMAKE_CURRENT_LIST_DIR}/$base\""
      done
    done
    echo ")"
  } > "$out/lib/pjsip_libs.cmake"
}

for abi in "${ABIS[@]}"; do
  build_one "$abi"
done

echo
echo "完成。接下来在 DevEco Studio 里编译 entry 模块即可产出 libomnisip.so。"
echo "提醒：PJSIP 授权约束见 OmniAgent/docs/mobile/pjsip-license.md"

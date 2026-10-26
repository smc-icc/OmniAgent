/*
 * OmniAgent 移动坐席的 PJSIP 编译开关。
 * 放在 pjproject/pjlib/include/pj/config_site.h，由 build-pjsip-android.sh 拷入。
 *
 * 原则：只开坐席话务用得到的能力，其它一律关掉，减小 so 体积与攻击面。
 */

#define PJ_CONFIG_ANDROID 1
#include <pj/config_site_sample.h>

/* ── 视频全关：坐席只做语音，视频会把 so 体积翻倍 ── */
#undef PJMEDIA_HAS_VIDEO
#define PJMEDIA_HAS_VIDEO 0
#define PJMEDIA_HAS_FFMPEG 0
#define PJMEDIA_HAS_OPENH264_CODEC 0
#define PJMEDIA_HAS_VPX_CODEC 0

/* ── 安全：SBC 侧强制 TLS + SRTP ── */
#define PJSIP_HAS_TLS_TRANSPORT 1
#define PJMEDIA_HAS_SRTP 1
/* DTLS-SRTP 用不到（不走 WebRTC），关掉省依赖 */
#define PJMEDIA_SRTP_HAS_DTLS 0

/* ── 编解码：Opus 优先，PCMA/PCMU 保底与 FreeSWITCH 直通 ── */
#define PJMEDIA_HAS_OPUS_CODEC 1
#define PJMEDIA_HAS_G711_CODEC 1
#define PJMEDIA_HAS_L16_CODEC 0
#define PJMEDIA_HAS_GSM_CODEC 0
#define PJMEDIA_HAS_ILBC_CODEC 0
#define PJMEDIA_HAS_SPEEX_CODEC 0
#define PJMEDIA_HAS_G722_CODEC 1
#define PJMEDIA_HAS_G7221_CODEC 0

/* ── 回声消除：移动端用 WebRTC AEC3，听筒/免提切换后的回声主要靠它 ── */
#define PJMEDIA_HAS_WEBRTC_AEC 1
/* 关掉 speex AEC：codec 关了 libspeex 就不参与构建，
   这里不关 echo_common.c 仍会引用 speex_aec_* 而链接失败 */
#define PJMEDIA_HAS_SPEEX_AEC 0
#define PJMEDIA_WSOLA_IMP PJMEDIA_WSOLA_IMP_WSOLA

/* ── 弱网：抖动缓冲放宽，地铁电梯场景下少断 ── */
#define PJMEDIA_SOUND_BUFFER_COUNT 12

/* ── 注册与保活：移动网络 NAT 映射短，保活要比默认更勤 ── */
#define PJSIP_TCP_KEEP_ALIVE_INTERVAL 90
#define PJSIP_TLS_KEEP_ALIVE_INTERVAL 90
#define PJSIP_UDP_KEEP_ALIVE_INTERVAL 15

/* 切网后立刻重注册而不是等超时 */
#define PJSUA_REG_AUTO_REG_REFRESH 1

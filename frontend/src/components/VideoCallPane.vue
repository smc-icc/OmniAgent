<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Microphone, Mute, VideoCamera, VideoPause, Phone, Close, Grid, Headset } from '@element-plus/icons-vue'
import type { SipCall, SipEngine } from '@/services/sip'

const props = withDefaults(defineProps<{
  engine: SipEngine
  call: SipCall | null
  answerable?: boolean
  audioOnly?: boolean
  showControls?: boolean
  showStatus?: boolean
  showKeypad?: boolean
  muteRemoteAudio?: boolean
}>(), { showControls: true, showStatus: true, showKeypad: true })
const emit = defineEmits<{ answer: []; hangup: []; error: [message: string] }>()
const remote = ref<HTMLVideoElement | null>(null)
const remoteAudio = ref<HTMLAudioElement | null>(null)
const local = ref<HTMLVideoElement | null>(null)
const muted = ref(false)
const camera = ref(true)
const hasRemoteVideo = ref(false)
const playbackBlocked = ref(false)
const keypad = ref(false)
const off: Array<() => void> = []
const status = computed(() => ({ incoming: '来电', calling: '连接中', early: '等待接通', connecting: '接通中', confirmed: '通话中', held: '保持中', disconnected: '已结束' }[props.call?.state ?? 'disconnected']))
async function sync() {
  await nextTick()
  const streams = props.call ? props.engine.mediaStreams?.(props.call.callId) : null
  const remoteTracks = streams?.remote?.getVideoTracks() ?? []
  hasRemoteVideo.value = remoteTracks.some(track => track.readyState === 'live')
  const localTracks = streams?.local?.getVideoTracks() ?? []
  if (localTracks.length) camera.value = localTracks.some(track => track.enabled && track.readyState === 'live')
  const player = props.audioOnly ? remoteAudio.value : remote.value
  if (player) {
    player.srcObject = streams?.remote ?? null
    if (streams?.remote) await player.play().then(() => { playbackBlocked.value = false }).catch(() => { playbackBlocked.value = true })
  }
  if (local.value) local.value.srcObject = streams?.local ?? null
}
async function control(action: () => Promise<void>) {
  try { await action() } catch (e) { emit('error', e instanceof Error ? e.message : '操作失败') }
}
async function toggleCamera() {
  if (!props.call) return
  const next = !camera.value
  await control(async () => { await props.engine.setVideo?.(props.call!.callId, next); camera.value = next })
}
async function toggleMute() {
  await control(async () => { await props.engine.mute(!muted.value); muted.value = !muted.value })
}
watch(() => props.call?.callId, () => { muted.value = false; camera.value = true; hasRemoteVideo.value = false; void sync() })
onMounted(() => {
  off.push(props.engine.on('mediaStateChanged', event => {
    if (event.callId !== props.call?.callId) return
    hasRemoteVideo.value = event.remoteVideo === true
    camera.value = event.localVideo === true
    void sync()
  }))
  void sync()
})
onBeforeUnmount(() => { off.forEach(fn => fn()); if (local.value) local.value.srcObject = null; if (remote.value) remote.value.srcObject = null; if (remoteAudio.value) remoteAudio.value.srcObject = null })
</script>

<template>
  <section class="video-call">
    <audio v-if="audioOnly" ref="remoteAudio" autoplay />
    <p v-if="audioOnly && call && showStatus !== false" class="voice-status">{{ call.remoteDisplayName || call.remoteNumber }} · {{ status }}</p>
    <el-button v-if="audioOnly && playbackBlocked" class="play-audio" @click="sync"><el-icon><Headset /></el-icon>播放声音</el-button>
    <div v-if="!audioOnly" class="video-stage">
      <video ref="remote" autoplay playsinline :muted="muteRemoteAudio" class="remote-video" />
      <div v-if="!hasRemoteVideo" class="video-empty"><el-icon :size="44"><Headset /></el-icon><span>{{ call ? status : '暂无通话' }}</span></div>
      <video v-show="call?.videoOffered" ref="local" autoplay playsinline muted class="local-video" />
      <span v-if="call" class="call-status">{{ call.remoteDisplayName || call.remoteNumber }} · {{ status }}</span>
      <el-button v-if="playbackBlocked" class="play-audio" @click="sync"><el-icon><Headset /></el-icon>播放声音</el-button>
    </div>
    <div v-if="showControls !== false" class="video-controls">
      <el-tooltip :content="muted ? '开启麦克风' : '静音'"><el-button circle :disabled="!call" :type="muted ? 'warning' : 'default'" aria-label="切换麦克风" @click="toggleMute"><el-icon><Mute v-if="muted" /><Microphone v-else /></el-icon></el-button></el-tooltip>
      <el-tooltip v-if="call?.videoOffered" :content="camera ? '关闭摄像头' : '开启摄像头'"><el-button circle aria-label="切换摄像头" @click="toggleCamera"><el-icon><VideoCamera v-if="camera" /><VideoPause v-else /></el-icon></el-button></el-tooltip>
      <el-popover v-if="showKeypad" v-model:visible="keypad" trigger="click" :width="180">
        <template #reference><el-button circle :disabled="!call" title="拨号键盘" aria-label="拨号键盘"><el-icon><Grid /></el-icon></el-button></template>
        <div class="dtmf-grid"><el-button v-for="digit in '123456789*0#'" :key="digit" @click="control(() => engine.sendDtmf(digit, call?.callId))">{{ digit }}</el-button></div>
      </el-popover>
      <el-button v-if="answerable && call?.state === 'incoming'" type="success" @click="emit('answer')"><el-icon><Phone /></el-icon>接听</el-button>
      <el-button :disabled="!call" type="danger" aria-label="结束通话" @click="emit('hangup')"><el-icon><Close /></el-icon>挂断</el-button>
    </div>
  </section>
</template>

<style scoped>
.video-call { min-width: 0; width: 100%; }
.video-stage { position: relative; aspect-ratio: 16 / 9; min-height: 220px; background: #202326; overflow: hidden; }
.remote-video { width: 100%; height: 100%; object-fit: contain; }
.video-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: #e0e5e3; pointer-events: none; }
.local-video { position: absolute; right: 16px; bottom: 16px; width: 24%; max-width: 220px; aspect-ratio: 4 / 3; object-fit: cover; background: #363a3d; border: 1px solid #737b80; }
.call-status { position: absolute; top: 14px; left: 14px; color: white; font-size: 13px; max-width: calc(100% - 28px); overflow-wrap: anywhere; }
.play-audio { position: absolute; left: 16px; bottom: 16px; }
.voice-status { margin: 0 0 8px; text-align: center; font-size: 16px; color: #252a28; }
.video-controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; padding: 16px 0; }
.video-controls .el-button { margin: 0; min-height: 40px; }
.dtmf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.dtmf-grid .el-button { margin: 0; height: 40px; }
@media (max-width: 600px) { .video-stage { aspect-ratio: 4 / 3; } .local-video { right: 8px; bottom: 8px; width: 28%; } }
</style>

package com.smcloud.omnisip

import android.util.Log
import org.pjsip.pjsua2.Account
import org.pjsip.pjsua2.AudioMedia
import org.pjsip.pjsua2.Call
import org.pjsip.pjsua2.CallInfo
import org.pjsip.pjsua2.Endpoint
import org.pjsip.pjsua2.OnCallMediaStateParam
import org.pjsip.pjsua2.OnCallStateParam
import org.pjsip.pjsua2.OnStreamDestroyedParam
import org.pjsip.pjsua2.OnCallRxOfferParam
import org.pjsip.pjsua2.pjmedia_type
import org.pjsip.pjsua2.pjsip_inv_state
import org.pjsip.pjsua2.pjsip_role_e
import org.pjsip.pjsua2.pjsua_call_media_status

/**
 * pjsua2 Call 子类。负责两件事：音频通路的接驳/断开，以及把状态快照抛给 SipCore。
 */
class OmniCall(account: Account, callId: Int) : Call(account, callId) {
    internal var mobileCorrelation = MobileCallCorrelation(false, false)
    internal val callInstanceId = java.util.UUID.randomUUID().toString()
    internal val video = CallVideo(this)
    @Volatile internal var videoRequested = false
    @Volatile internal var lastSnapshot: CallSnapshot? = null

    /** 通话音频媒体；静音就是在它与采集设备之间停传 */
    private var audioMedia: AudioMedia? = null

    @Volatile
    var hasAudio: Boolean = false
        private set

    private var connectedAtMs: Long = 0

    fun key(): String = id.toString()

    fun snapshot(): CallSnapshot {
        val ci: CallInfo = info
        val remote = parseUri(ci.remoteUri)
        return CallSnapshot(
            callId = key(),
            sipCallId = ci.callIdString ?: "",
            remoteNumber = remote.second,
            remoteDisplayName = remote.first,
            direction = if (ci.role == pjsip_role_e.PJSIP_ROLE_UAS) "inbound" else "outbound",
            state = mapState(ci),
            connectedAt = connectedAtMs,
            videoOffered = ci.remVideoCount > 0,
            hasVideo = video.active,
            offerId = mobileCorrelation.offerId,
            attemptId = mobileCorrelation.attemptId,
            callInstanceId = callInstanceId,
            mobileCorrelationPresent = mobileCorrelation.present,
            mobileCorrelationValid = mobileCorrelation.valid,
        ).also { lastSnapshot = it }
    }

    /** "Name" <sip:1001@realm> → (Name, 1001) */
    private fun parseUri(uri: String?): Pair<String, String> {
        if (uri.isNullOrBlank()) return "" to ""
        val name = Regex("^\"?([^\"<]*)\"?\\s*<").find(uri)?.groupValues?.get(1)?.trim() ?: ""
        val user = Regex("sip[s]?:([^@>;]+)").find(uri)?.groupValues?.get(1) ?: ""
        return name to user
    }

    private fun mapState(ci: CallInfo): String = when (ci.state) {
        pjsip_inv_state.PJSIP_INV_STATE_INCOMING -> "incoming"
        pjsip_inv_state.PJSIP_INV_STATE_CALLING -> "calling"
        pjsip_inv_state.PJSIP_INV_STATE_EARLY -> "early"
        pjsip_inv_state.PJSIP_INV_STATE_CONNECTING -> "connecting"
        pjsip_inv_state.PJSIP_INV_STATE_CONFIRMED -> if (isOnHold(ci)) "held" else "confirmed"
        else -> "disconnected"
    }

    private fun isOnHold(ci: CallInfo): Boolean {
        for (i in 0 until ci.media.size) {
            val m = ci.media[i]
            if (m.type != pjmedia_type.PJMEDIA_TYPE_AUDIO) continue
            if (m.status == pjsua_call_media_status.PJSUA_CALL_MEDIA_LOCAL_HOLD
                || m.status == pjsua_call_media_status.PJSUA_CALL_MEDIA_REMOTE_HOLD
            ) {
                return true
            }
        }
        return false
    }

    override fun onCallState(prm: OnCallStateParam) {
        val ci = runCatching { info }.getOrNull() ?: return
        if (ci.state == pjsip_inv_state.PJSIP_INV_STATE_CONFIRMED && connectedAtMs == 0L) {
            connectedAtMs = System.currentTimeMillis()
            SipCore.onCallActive()
        }
        SipCore.emitCallState(this)
        if (ci.state == pjsip_inv_state.PJSIP_INV_STATE_DISCONNECTED) {
            SipCore.log("call ${key()} disconnected: ${ci.lastStatusCode} ${ci.lastReason}")
            detachAudio()
            SipCore.releaseVideo(this)
            SipCore.untrack(this)
            // pjsua2 要求在 DISCONNECTED 后释放对象，否则 native 侧会泄漏
            runCatching { delete() }
        }
    }

    override fun onCallMediaState(prm: OnCallMediaStateParam) {
        val ci = runCatching { info }.getOrNull() ?: return
        for (i in 0 until ci.media.size) {
            val m = ci.media[i]
            if (m.type != pjmedia_type.PJMEDIA_TYPE_AUDIO) continue
            if (m.status != pjsua_call_media_status.PJSUA_CALL_MEDIA_ACTIVE) continue
            val media = runCatching { getMedia(i.toLong()) }.getOrNull() ?: continue
            val am = AudioMedia.typecastFromMedia(media)
            audioMedia = am
            hasAudio = true
            val mgr = Endpoint.instance().audDevManager()
            runCatching {
                am.startTransmit(mgr.playbackDevMedia)
                if (!SipCore.muted) mgr.captureDevMedia.startTransmit(am)
            }.onFailure { Log.w("OmniSip", "connect audio failed", it) }
        }
        SipCore.emitMedia(this)
        SipCore.refreshVideo(this)
    }

    override fun onCallRxOffer(prm: OnCallRxOfferParam) {
        prm.opt.videoCount = VideoPolicy.streamCount(videoRequested, SipCore.cameraGranted())
    }

    override fun onStreamDestroyed(prm: OnStreamDestroyedParam) {
        hasAudio = false
        audioMedia = null
    }

    /**
     * 读一次 RTCP 统计。MOS 不自己估：端上没有足够信息算准，
     * 宁可只报丢包/抖动/RTT 三个客观值，由服务端侧统一评估通话质量。
     */
    fun pollQuality() {
        val ci = runCatching { info }.getOrNull() ?: return
        if (ci.state != pjsip_inv_state.PJSIP_INV_STATE_CONFIRMED) return
        val stat = runCatching { getStreamStat(0) }.getOrNull() ?: return
        val rx = stat.rtcp.rxStat
        val received = rx.pkt.toDouble()
        val lost = rx.loss.toDouble()
        val lossPercent = if (received + lost > 0) lost / (received + lost) * 100.0 else 0.0
        SipCore.emitQuality(
            key(),
            mos = null,
            loss = lossPercent,
            jitter = rx.jitterUsec.mean / 1000.0,
            rtt = stat.rtcp.rttUsec.mean / 1000.0,
        )
    }

    /** 采集设备与通话之间通断，实现本机静音 */
    fun applyMute(on: Boolean) {
        val am = audioMedia ?: return
        val capture = Endpoint.instance().audDevManager().captureDevMedia
        runCatching {
            if (on) capture.stopTransmit(am) else capture.startTransmit(am)
        }.onFailure { Log.w("OmniSip", "mute toggle failed", it) }
    }

    private fun detachAudio() {
        val am = audioMedia ?: return
        runCatching {
            val mgr = Endpoint.instance().audDevManager()
            mgr.captureDevMedia.stopTransmit(am)
            am.stopTransmit(mgr.playbackDevMedia)
        }
        audioMedia = null
        hasAudio = false
    }
}

package com.smcloud.omnisip

import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import androidx.core.content.ContextCompat
import org.pjsip.PjCameraInfo2
import android.util.Log
import org.pjsip.pjsua2.AccountShutdownParam
import org.pjsip.pjsua2.AccountConfig
import org.pjsip.pjsua2.AuthCredInfo
import org.pjsip.pjsua2.CallOpParam
import org.pjsip.pjsua2.CodecInfoVector2
import org.pjsip.pjsua2.IpChangeParam
import org.pjsip.pjsua2.OnIpChangeProgressParam
import org.pjsip.pjsua2.pjsua_ip_change_op
import org.pjsip.pjsua2.Endpoint
import org.pjsip.pjsua2.EpConfig
import org.pjsip.pjsua2.TransportConfig
import org.pjsip.pjsua2.pjmedia_srtp_use
import org.pjsip.pjsua2.pjsip_status_code
import org.pjsip.pjsua2.pjsip_transport_type_e
import org.pjsip.pjsua2.pjsua_call_flag
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * PJSIP（pjsua2）唯一持有者。
 *
 * 线程模型：pjsua2 的所有 API 都必须在已向 pjlib 注册过的线程上调用，
 * 因此这里固定一条 HandlerThread，所有调用都 post 过去串行执行。
 * 回调由 pjsip 自己的线程发起，已经是注册过的线程，只做数据整理后转给监听者。
 *
 * 本类不含任何业务判断（是否应答、是否退队都在 Vue 侧决策），只暴露能力。
 */
object SipCore {
    private const val TAG = "OmniSip"

    private val thread = HandlerThread("omnisip-pjsip").apply { start() }
    private val handler = Handler(thread.looper)

    private var ep: Endpoint? = null
    @Volatile private var account: OmniAccount? = null
    private var appContext: Context? = null
    private var audio: AudioRouter? = null

    /** key 为 pjsua 的 callId（Int 转 String），与 JS 侧的 SipCall.callId 一致 */
    private val calls = ConcurrentHashMap<String, OmniCall>()
    /** Shared by Vue, notification and Telecom commands on the SIP actor queue. */
    private val sipCommandGate = NativeCallActionGate()

    @Volatile
    var registrationState: String = RegState.UNREGISTERED
        private set

    @Volatile
    var muted: Boolean = false
        private set

    private var listener: SipCoreListener? = null
    private var lastConfig: SipConfigIn? = null
    private var networkMonitor: NativeNetworkMonitor? = null
    private val networkTracker = NetworkChangeTracker()
    private var networkRecoveryInFlight = false
    private var queuedNetworkEpoch: Long? = null
    private var handlingNetworkEpoch: Long? = null

    private fun configureNetworkRecovery(context: Context, enabled: Boolean) {
        if (!enabled) { networkMonitor?.stop(); networkMonitor = null; return }
        if (networkMonitor != null) return
        val monitor = NativeNetworkMonitor(context) { path ->
            post("networkPathChanged") {
                val change = networkTracker.observe(path.pathKey)
                listener?.onNativeNetworkChanged(path, change.epoch, networkRecoveryInFlight)
                if (!change.changed) return@post
                // Any observation of the old route is invalid now. No unregister/account deletion.
                queuedNetworkEpoch = if (change.recoverSignaling) change.epoch else null
                if (change.recoverSignaling && !networkRecoveryInFlight) recoverNetworkPath()
            }
        }
        networkMonitor = monitor
        try { monitor.start() } catch (error: Exception) { networkMonitor = null; throw error }
    }

    private fun recoverNetworkPath() {
        val epoch = queuedNetworkEpoch ?: return
        val endpoint = ep ?: return
        if (account == null || lastConfig?.nativeNetworkRecovery != true) return
        queuedNetworkEpoch = null
        handlingNetworkEpoch = epoch
        networkRecoveryInFlight = true
        val params = IpChangeParam().apply { restartListener = true; shutdownTransport = true }
        try {
            endpoint.libRegisterThread("omnisip-pjsip")
            endpoint.handleIpChange(params)
        } catch (error: Exception) {
            networkRecoveryInFlight = false
            handlingNetworkEpoch = null
            listener?.onError("network_recovery_failed", "原生网络连接恢复失败", null)
        } finally { params.delete() }
    }

    private fun onIpChangeProgress(op: Int, status: Int) {
        post("ipChangeProgress") {
            if (op == pjsua_ip_change_op.PJSUA_IP_CHANGE_OP_COMPLETED) {
                networkRecoveryInFlight = false
                handlingNetworkEpoch = null
                // Stack completion is not evidence of recovered media or a new server ready proof.
                if (status != 0) listener?.onError("network_recovery_failed", "原生网络连接恢复失败", null)
                if (queuedNetworkEpoch != null) recoverNetworkPath()
            }
        }
    }

    fun attach(context: Context, listener: SipCoreListener?) {
        appContext = context.applicationContext
        NativeIncomingCallRuntime.init(context.applicationContext)
        this.listener = listener
        if (audio == null) audio = AudioRouter(context.applicationContext)
    }

    fun currentRoute(): String = audio?.current ?: AudioRoute.EARPIECE

    fun cameraGranted(): Boolean = appContext?.let {
        ContextCompat.checkSelfPermission(it, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    } ?: false

    fun cachedCall(callId: String): CallSnapshot? = calls[callId]?.lastSnapshot

    internal fun videoFor(callId: String): CallVideo? = calls[callId]?.video

    private fun post(tag: String, onFailure: ((Throwable) -> Unit)? = null, block: () -> Unit) {
        handler.post {
            try {
                block()
            } catch (e: Throwable) {
                Log.e(TAG, "$tag failed", e)
                listener?.onError(tag, e.message ?: tag, null)
                onFailure?.invoke(e)
            }
        }
    }

    // ---------------------------------------------------------------- 生命周期

    private fun ensureEndpoint(stunServerHost: String? = null): Endpoint {
        ep?.let { return it }
        System.loadLibrary("pjsua2")
        val context = appContext ?: error("SIP context is unavailable")
        PjCameraInfo2.SetCameraManager(context.getSystemService(Context.CAMERA_SERVICE) as CameraManager)
        val endpoint = object : Endpoint() {
            override fun onIpChangeProgress(prm: OnIpChangeProgressParam) {
                this@SipCore.onIpChangeProgress(prm.op, prm.status)
            }
        }
        endpoint.libCreate()

        val cfg = EpConfig()
        // 不设 filename：SIP 报文里带鉴权信息，日志只留在 logcat，不落磁盘
        cfg.logConfig.level = 3
        cfg.logConfig.consoleLevel = 3
        cfg.uaConfig.apply {
            userAgent = "OmniAgent-Mobile/1.0"
            if (!stunServerHost.isNullOrBlank()) stunServer.add(stunServerHost)
            threadCnt = 1
            mainThreadOnly = false
        }
        cfg.medConfig.apply {
            // 8kHz/20ms：PCMA/PCMU 直通不重采样，弱网下 CPU 与丢包表现最稳
            clockRate = 16000
            sndClockRate = 16000
            audioFramePtime = 20
            noVad = false
            ecTailLen = 200
        }
        endpoint.libInit(cfg)
        val videoCodecs = endpoint.videoCodecEnum2()
        try {
            log("video codecs=${videoCodecs.joinToString { it.codecId }} devices=${endpoint.vidDevManager().devCount}")
        } finally {
            videoCodecs.delete()
        }
        ep = endpoint
        return endpoint
    }

    // 返回 Int 而不是 pjsip_transport_type_e：SWIG 生成的同名 final class 只是
    // int 常量的容器，pjsua2 的接口收发的都是 int
    private fun transportOf(transport: String): Int = when (transport) {
        "udp" -> pjsip_transport_type_e.PJSIP_TRANSPORT_UDP
        "tcp" -> pjsip_transport_type_e.PJSIP_TRANSPORT_TCP
        else -> pjsip_transport_type_e.PJSIP_TRANSPORT_TLS
    }

    private fun srtpOf(srtp: String): Int = when (srtp) {
        "required" -> pjmedia_srtp_use.PJMEDIA_SRTP_MANDATORY
        "disabled" -> pjmedia_srtp_use.PJMEDIA_SRTP_DISABLED
        else -> pjmedia_srtp_use.PJMEDIA_SRTP_OPTIONAL
    }

    /**
     * 按坐席下发的顺序设置编解码优先级，未列出的一律降到 0。
     * 顺序由服务端配置决定，端上不写死，方便运维按线路换编码。
     */
    private fun applyCodecs(endpoint: Endpoint, wanted: List<String>) {
        val infos: CodecInfoVector2 = endpoint.codecEnum2()
        val prefer = wanted.map { it.lowercase() }
        // 容器类继承 java.util.AbstractList，Kotlin 侧是 size 属性而非 size()
        for (i in 0 until infos.size) {
            val id = infos[i].codecId
            val idx = prefer.indexOfFirst { id.lowercase().startsWith(it) }
            val priority = if (idx >= 0) (255 - idx * 10).coerceAtLeast(1) else 0
            endpoint.codecSetPriority(id, priority.toShort())
        }
    }

    fun register(cfg: SipConfigIn, onDone: (Throwable?) -> Unit) {
        post("register", { onDone(it) }) {
            if (calls.values.any { it.snapshot().state != "disconnected" }) error("当前仍有活动通话，禁止重新注册")
            val endpoint = ensureEndpoint(cfg.stunServer)
            appContext?.let { configureNetworkRecovery(it, cfg.nativeNetworkRecovery) }
            endpoint.libRegisterThread("omnisip-pjsip")

            if (account == null) {
                val tcfg = TransportConfig().apply { port = 0 }
                endpoint.transportCreate(transportOf(cfg.transport), tcfg)
                endpoint.libStart()
                applyCodecs(endpoint, cfg.codecs)
            }

            val proxy = "sip:${cfg.proxyHost}:${cfg.proxyPort};transport=${cfg.transport}"
            val accCfg = AccountConfig().apply {
                idUri = if (cfg.displayName.isNullOrBlank()) {
                    "sip:${cfg.username}@${cfg.realm}"
                } else {
                    "\"${cfg.displayName}\" <sip:${cfg.username}@${cfg.realm}>"
                }
                regConfig.registrarUri = "sip:${cfg.proxyHost}:${cfg.proxyPort};transport=${cfg.transport}"
                regConfig.timeoutSec = cfg.registerExpiresS.toLong()
                // 注册续期提前量交给 pjsip 默认策略，弱网下比自己算更稳
                regConfig.retryIntervalSec = 10
                regConfig.firstRetryIntervalSec = 5
                sipConfig.authCreds.add(AuthCredInfo("digest", cfg.realm, cfg.username, 0, cfg.password))
                sipConfig.proxies.add(proxy)
                mediaConfig.srtpUse = srtpOf(cfg.srtp)
                mediaConfig.srtpSecureSignaling = if (cfg.transport == "tls") 1 else 0
                videoConfig.autoShowIncoming = false
                videoConfig.autoTransmitOutgoing = false
                val cameras = endpoint.vidDevManager().enumDev2()
                try {
                    cameras.firstOrNull { it.driver == "Android" && it.name == "Front camera" }?.let {
                        videoConfig.defaultCaptureDevice = it.id
                    }
                } finally {
                    cameras.delete()
                }
                ipChangeConfig.hangupCalls = false
                ipChangeConfig.shutdownTp = true
                ipChangeConfig.reinviteFlags = (pjsua_call_flag.PJSUA_CALL_REINIT_MEDIA or
                    pjsua_call_flag.PJSUA_CALL_UPDATE_CONTACT or pjsua_call_flag.PJSUA_CALL_UPDATE_VIA).toLong()
                natConfig.iceEnabled = cfg.iceEnabled
                if (!cfg.stunServer.isNullOrBlank()) {
                    natConfig.sdpNatRewriteUse = 1
                }
            }

            val existing = account
            if (existing != null && existing.registrationId != cfg.registrationId) {
                val shutdown = AccountShutdownParam().apply { force = false }
                try { existing.shutdown2(shutdown) } finally { shutdown.delete() }
                account = null
                existing.delete()
            }
            lastConfig = cfg
            registrationState = RegState.REGISTERING
            listener?.onRegistrationChanged(RegState.REGISTERING, 0, "", cfg.registrationId)

            if (existing != null && existing.registrationId == cfg.registrationId) {
                existing.modify(accCfg)
                existing.setRegistration(true)
            } else {
                account = null
                val acc = OmniAccount(cfg.registrationId)
                account = acc
                try { acc.create(accCfg) } catch (error: Throwable) {
                    account = null
                    acc.delete()
                    throw error
                }
            }
            onDone(null)
        }
    }

    fun unregister(registrationId: String? = null, onDone: (Throwable?) -> Unit) {
        post("unregister", { onDone(it) }) {
            if (registrationId != null && account?.registrationId != registrationId) { onDone(null); return@post }
            if (registrationId != null && calls.values.any { it.snapshot().state != "disconnected" }) error("当前仍有活动通话，不能清理注册")
            ep?.libRegisterThread("omnisip-pjsip")
            // shutdown2 initiates unregistration and invalidates the native account.
            // Never call setRegistration on it afterward: PJSIP aborts the process.
            if (registrationId == null) hangupAllInternal()
            account?.let { current ->
                if (current.isValid) {
                    val shutdown = AccountShutdownParam().apply { force = false }
                    try { current.shutdown2(shutdown) } finally { shutdown.delete() }
                }
                // Keep the current account attached if safe shutdown rejects active calls.
                account = null
                current.delete()
            }
            registrationState = RegState.UNREGISTERED
            listener?.onRegistrationChanged(RegState.UNREGISTERED, 0, "manual", lastConfig?.registrationId ?: "")
            lastConfig = null
            networkMonitor?.stop()
            networkMonitor = null
            queuedNetworkEpoch = null
            onDone(null)
        }
    }

    /** 进程退出前释放；libDestroy 必须在同一条线程上调用 */
    fun shutdown() {
        post("shutdown") {
            networkMonitor?.stop()
            networkMonitor = null
            queuedNetworkEpoch = null
            ep?.let {
                it.libRegisterThread("omnisip-pjsip")
                hangupAllInternal()
                runCatching { account?.delete() }
                account = null
                runCatching { it.libDestroy() }
                runCatching { it.delete() }
            }
            ep = null
            registrationState = RegState.UNREGISTERED
        }
    }

    // ------------------------------------------------------------------ 呼叫

    fun makeCall(number: String, video: Boolean = false, onDone: (CallSnapshot?, Throwable?) -> Unit) {
        post("call", { onDone(null, it) }) {
            val acc = account ?: throw IllegalStateException("分机未注册")
            ep?.libRegisterThread("omnisip-pjsip")
            val cfg = lastConfig ?: throw IllegalStateException("缺少 SIP 配置")
            val uri = if (number.startsWith("sip:")) number else "sip:$number@${cfg.realm}"
            check(!video || cameraGranted()) { "未授予摄像头权限" }
            val call = OmniCall(acc, -1)
            call.videoRequested = video
            val prm = CallOpParam(true).apply {
                opt.audioCount = 1
                opt.videoCount = VideoPolicy.streamCount(video, cameraGranted())
            }
            try {
                call.makeCall(uri, prm)
            } catch (e: Throwable) {
                call.delete()
                throw e
            } finally {
                prm.delete()
            }
            track(call)
            onDone(call.snapshot(), null)
        }
    }

    fun answer(callId: String, video: Boolean = false, expectedInstanceId: String? = null, onDone: (Throwable?) -> Unit) {
        post("answer", { onDone(it) }) {
            val call = calls[callId] ?: throw IllegalStateException("呼叫已不存在")
            if (expectedInstanceId != null && call.callInstanceId != expectedInstanceId) error("呼叫已变化")
            ep?.libRegisterThread("omnisip-pjsip")
            val snapshot = call.snapshot()
            // Existing cloud mode has no v2 acceptance-permit adapter. Never bypass it via Vue.
            if (call.mobileCorrelation.present) error("当前来电协议尚未授权")
            if (snapshot.state in setOf("confirmed", "held", "connecting")) { onDone(null); return@post }
            if (snapshot.state !in setOf("incoming", "early")) error("当前呼叫不可接听")
            sipCommandGate.observe(callId, call.callInstanceId, snapshot.state, false)
            if (!sipCommandGate.reserve(callId, call.callInstanceId, NativeCallAction.ANSWER)) { onDone(null); return@post }
            audio?.onCallActive()
            val count = VideoPolicy.answerStreamCount(call.info.remVideoCount, video, cameraGranted())
            call.videoRequested = count > 0
            val prm = CallOpParam(true).apply {
                statusCode = pjsip_status_code.PJSIP_SC_OK
                opt.audioCount = 1
                opt.videoCount = count
            }
            try {
                call.answer(prm)
            } catch (error: Throwable) {
                sipCommandGate.completed(callId, call.callInstanceId, NativeCallAction.ANSWER, false)
                throw error
            } finally {
                prm.delete()
            }
            onDone(null)
        }
    }

    fun hangup(callId: String, expectedInstanceId: String? = null, onDone: (Throwable?) -> Unit) {
        post("hangup", { onDone(it) }) {
            val call = calls[callId]
            if (expectedInstanceId != null && call?.callInstanceId != expectedInstanceId) error("呼叫已变化")
            ep?.libRegisterThread("omnisip-pjsip")
            if (call != null) {
                val snapshot = call.snapshot()
                sipCommandGate.observe(callId, call.callInstanceId, snapshot.state, call.mobileCorrelation.present)
                if (!sipCommandGate.reserve(callId, call.callInstanceId, NativeCallAction.END)) { onDone(null); return@post }
                val params = CallOpParam(true)
                try { call.hangup(params) } catch (error: Throwable) {
                    sipCommandGate.completed(callId, call.callInstanceId, NativeCallAction.END, false)
                    throw error
                } finally { params.delete() }
            }
            onDone(null)
        }
    }

    fun hold(callId: String, on: Boolean, onDone: (Throwable?) -> Unit) {
        post("hold") {
            val call = calls[callId] ?: throw IllegalStateException("呼叫已不存在")
            ep?.libRegisterThread("omnisip-pjsip")
            if (on) {
                call.setHold(CallOpParam(true).apply {
                    opt.videoCount = VideoPolicy.streamCount(call.videoRequested, cameraGranted())
                })
            } else {
                val prm = CallOpParam(true)
                prm.opt.videoCount = VideoPolicy.streamCount(call.videoRequested, cameraGranted())
                prm.opt.flag = pjsua_call_flag.PJSUA_CALL_UNHOLD.toLong()
                call.reinvite(prm)
            }
            onDone(null)
        }
    }

    /**
     * 静音在本机做：停掉采集设备到通话的传输。
     * 比走服务端静音即时，也不影响 FreeSWITCH 侧录音的完整性。
     */
    fun mute(on: Boolean, onDone: (Throwable?) -> Unit) {
        post("mute") {
            ep?.libRegisterThread("omnisip-pjsip")
            muted = on
            calls.values.forEach { it.applyMute(on) }
            calls.values.firstOrNull()?.let { emitMedia(it) }
            onDone(null)
        }
    }

    fun sendDtmf(digits: String, callId: String?, onDone: (Throwable?) -> Unit) {
        post("sendDtmf") {
            val call = (callId?.let { calls[it] } ?: activeCall())
                ?: throw IllegalStateException("没有通话中的呼叫")
            ep?.libRegisterThread("omnisip-pjsip")
            // RFC2833 带内信号；SBC 与 FS 都按此配置，不用 SIP INFO
            call.dialDtmf(digits)
            onDone(null)
        }
    }

    fun setAudioRoute(route: String, onDone: (Throwable?) -> Unit) {
        post("setAudioRoute") {
            audio?.apply(route)
            activeCall()?.let { emitMedia(it) }
            onDone(null)
        }
    }

    // Capacitor calls this from its plugin executor, which is not registered
    // with pjlib. Only SIP callbacks/our registered handler may read Call.info.
    // The volatile snapshot is refreshed by those callbacks before notification.
    fun snapshots(): List<CallSnapshot> = calls.values.mapNotNull { it.lastSnapshot }

    private fun activeCall(): OmniCall? = calls.values.firstOrNull {
        runCatching { it.snapshot().state != "disconnected" }.getOrDefault(false)
    }

    private fun hangupAllInternal() {
        calls.values.forEach { runCatching { it.hangup(CallOpParam(true)) } }
        calls.clear()
    }

    internal fun refreshVideo(call: OmniCall) {
        val id = call.key()
        post("video-media") {
            if (calls[id] !== call) return@post
            call.video.refresh(call.info)
            log("video call=$id active=${call.video.active} local=${call.video.local} remote=${call.video.remote}")
            emitMedia(call)
        }
    }

    internal fun releaseVideo(call: OmniCall) {
        call.video.release()
    }

    fun setVideo(callId: String, on: Boolean, onDone: (Throwable?) -> Unit) {
        videoOperation(callId, onDone) { call ->
            check(!on || cameraGranted()) { "未授予摄像头权限" }
            val prm = CallOpParam(true).apply {
                opt.audioCount = 1
                opt.videoCount = VideoPolicy.streamCount(on, cameraGranted())
            }
            val before = call.videoRequested
            call.videoRequested = on
            try {
                call.reinvite(prm)
            } catch (e: Throwable) {
                call.videoRequested = before
                throw e
            } finally {
                prm.delete()
            }
        }
    }

    fun setCamera(callId: String, on: Boolean, onDone: (Throwable?) -> Unit) {
        videoOperation(callId, onDone) { it.video.setCamera(on) }
    }

    fun switchCamera(callId: String, onDone: (Throwable?) -> Unit) {
        videoOperation(callId, onDone) { it.video.switchCamera() }
    }

    fun setVideoVisible(callId: String, visible: Boolean, rotation: Int) {
        videoOperation(callId, {}) {
            it.video.setVisible(visible)
            if (visible) it.video.setRotation(rotation)
        }
    }

    fun setVideoSurface(callId: String, local: Boolean, surface: Surface?) {
        val detached = CountDownLatch(1)
        handler.post {
            try {
                ep?.libRegisterThread("omnisip-pjsip")
                calls[callId]?.video?.setSurface(local, surface)
            } catch (e: Throwable) {
                Log.w(TAG, "video surface failed", e)
            } finally {
                detached.countDown()
            }
        }
        // SurfaceHolder releases the native window when surfaceDestroyed returns.
        if (surface == null && !detached.await(2, TimeUnit.SECONDS)) {
            Log.w(TAG, "video surface detach timed out")
        }
    }

    private fun videoOperation(callId: String, onDone: (Throwable?) -> Unit, block: (OmniCall) -> Unit) {
        handler.post {
            try {
                ep?.libRegisterThread("omnisip-pjsip")
                val call = calls[callId] ?: error("呼叫已不存在")
                block(call)
                emitMedia(call)
                onDone(null)
            } catch (e: Throwable) {
                Log.w(TAG, "video operation failed", e)
                listener?.onError("video", e.message ?: "Video operation failed", callId)
                onDone(e)
            }
        }
    }

    // ------------------------------------------------------- pjsua2 回调入口

    internal fun track(call: OmniCall) {
        calls[call.key()] = call
        if (muted) runCatching { call.applyMute(true) }
        startQualityPoll()
    }

    internal fun untrack(call: OmniCall) {
        calls.remove(call.key())
        if (calls.isEmpty()) {
            audio?.onCallEnded()
            stopQualityPoll()
        }
    }

    // 通话质量每 5 秒采一次：够定位弱网，又不至于让 CPU 一直醒着
    private const val QUALITY_INTERVAL_MS = 5_000L
    private var qualityPolling = false
    private val qualityTask = object : Runnable {
        override fun run() {
            if (!qualityPolling) return
            ep?.libRegisterThread("omnisip-pjsip")
            calls.values.forEach { runCatching { it.pollQuality() } }
            handler.postDelayed(this, QUALITY_INTERVAL_MS)
        }
    }

    private fun startQualityPoll() {
        if (qualityPolling) return
        qualityPolling = true
        handler.postDelayed(qualityTask, QUALITY_INTERVAL_MS)
    }

    private fun stopQualityPoll() {
        qualityPolling = false
        handler.removeCallbacks(qualityTask)
    }

    internal fun emitIncoming(call: OmniCall) {
        audio?.onIncomingCall()
        val snapshot = call.snapshot()
        NativeIncomingCallRuntime.incoming(snapshot)
        listener?.onIncomingCall(snapshot)
    }

    internal fun emitCallState(call: OmniCall) {
        val snapshot = call.snapshot()
        sipCommandGate.observe(snapshot.callId, snapshot.callInstanceId, snapshot.state, call.mobileCorrelation.present)
        NativeIncomingCallRuntime.observe(snapshot)
        listener?.onCallStateChanged(snapshot)
    }

    internal fun emitMedia(call: OmniCall) {
        val snap = runCatching { call.snapshot() }.getOrNull() ?: return
        listener?.onMediaStateChanged(
            snap.callId,
            localAudio = !muted && call.hasAudio,
            remoteAudio = call.hasAudio,
            route = currentRoute(),
            muted = muted,
            localVideo = call.video.local,
            remoteVideo = call.video.remote,
        )
    }

    internal fun emitQuality(
        callId: String,
        mos: Double?,
        loss: Double?,
        jitter: Double?,
        rtt: Double?,
    ) {
        listener?.onQualityChanged(callId, mos, loss, jitter, rtt)
    }

    internal fun emitRegistration(state: String, code: Int, reason: String, registrationId: String) {
        if (account?.registrationId != registrationId) return
        registrationState = state
        listener?.onRegistrationChanged(state, code, reason, registrationId)
    }

    internal fun onCallActive() {
        audio?.onCallActive()
    }

    internal fun log(message: String) {
        Log.i(TAG, message)
    }

    /** 供 FCM 唤醒后补注册：凭据还在内存里就直接重注册，否则等 JS 侧重新下发 */
    fun reRegisterIfPossible() {
        val cfg = lastConfig ?: return
        register(cfg) { }
    }

    fun hasCredentials(): Boolean = lastConfig != null
}

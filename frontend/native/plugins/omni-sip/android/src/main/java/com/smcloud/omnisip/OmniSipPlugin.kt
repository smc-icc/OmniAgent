package com.smcloud.omnisip

import android.Manifest
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * OmniSip 插件：Vue 侧 SipEngine 接口的 Android 实现。
 *
 * 这里只做参数搬运与事件转发，任何「该不该应答/该不该退队」的判断都在 Vue 侧，
 * 保证三端行为一致（见 src/services/sip/call-coordinator.ts）。
 */
@CapacitorPlugin(
    name = "OmniSip",
    permissions = [
        Permission(alias = OmniSipPlugin.ALIAS_MIC, strings = [Manifest.permission.RECORD_AUDIO]),
        Permission(alias = OmniSipPlugin.ALIAS_PHONE, strings = [Manifest.permission.MANAGE_OWN_CALLS]),
        Permission(alias = OmniSipPlugin.ALIAS_NOTIFY, strings = [Manifest.permission.POST_NOTIFICATIONS]),
        Permission(alias = OmniSipPlugin.ALIAS_CAMERA, strings = [Manifest.permission.CAMERA]),
    ],
)
class OmniSipPlugin : Plugin(), SipCoreListener {

    companion object {
        const val ALIAS_MIC = "microphone"
        const val ALIAS_PHONE = "phone"
        const val ALIAS_NOTIFY = "notifications"
        const val ALIAS_CAMERA = "camera"
    }

    /** 权限回调里要用到的原始 register 调用 */
    private var pendingRegister: PluginCall? = null
    private var presentedVideoCall: String? = null
    private var foreground = true

    override fun handleOnResume() {
        super.handleOnResume()
        foreground = true
    }

    override fun handleOnPause() {
        foreground = false
        super.handleOnPause()
    }

    override fun load() {
        SipCore.attach(context, this)
        TelecomBridge.init(context)
    }

    override fun handleOnDestroy() {
        SipCore.attach(context, null)
        super.handleOnDestroy()
    }

    // ---------------------------------------------------------------- 方法

    @PluginMethod
    fun register(call: PluginCall) {
        val missing = missingAliases()
        if (missing.isNotEmpty()) {
            pendingRegister = call
            call.setKeepAlive(true)
            requestPermissionForAliases(missing.toTypedArray(), call, "onCallPermissions")
            return
        }
        doRegister(call)
    }

    /**
     * 注册前要齐的两个权限：麦克风（没有就只会是单通）与通知（后台来电全屏提醒的载体）。
     * 通知权限只在 Android 13+ 存在，低版本 checkSelfPermission 恒为 DENIED，
     * 不按版本过滤会弹一个系统根本不认的框。
     */
    private fun missingAliases(): List<String> {
        val need = mutableListOf<String>()
        if (getPermissionState(ALIAS_MIC) != PermissionState.GRANTED) need += ALIAS_MIC
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState(ALIAS_NOTIFY) != PermissionState.GRANTED
        ) {
            need += ALIAS_NOTIFY
        }
        return need
    }

    @PermissionCallback
    private fun onCallPermissions(call: PluginCall) {
        bridge.execute {
            val original = pendingRegister ?: return@execute
            if (original.callbackId != call.callbackId) return@execute
            pendingRegister = null
            if (getPermissionState(ALIAS_MIC) != PermissionState.GRANTED) {
                original.reject("未授予麦克风权限，无法接听")
                return@execute
            }
            // 通知被拒只影响后台来电提醒，前台仍能接听，不该卡住注册
            doRegister(original)
        }
    }

    private fun doRegister(call: PluginCall) {
        val cfg = try {
            SipConfigIn(
                username = call.getString("username") ?: return call.reject("缺少 username"),
                password = call.getString("password") ?: return call.reject("缺少 password"),
                realm = call.getString("realm") ?: return call.reject("缺少 realm"),
                proxyHost = call.getString("proxyHost") ?: return call.reject("缺少 proxyHost"),
                proxyPort = call.getInt("proxyPort") ?: 5061,
                transport = call.getString("transport") ?: "tls",
                srtp = call.getString("srtp") ?: "required",
                codecs = call.getArray("codecs")?.toList<String>() ?: listOf("PCMA", "PCMU"),
                registerExpiresS = call.getInt("registerExpiresS") ?: 300,
                stunServer = call.getString("stunServer"),
                nativeNetworkRecovery = call.getBoolean("nativeNetworkRecovery") ?: false,
                iceEnabled = call.getBoolean("iceEnabled") ?: false,
                displayName = call.getString("displayName"),
                registrationId = call.getString("registrationId") ?: return call.reject("缺少 registrationId"),
            )
        } catch (e: Exception) {
            return call.reject(e.message ?: "配置解析失败")
        }

        // 注册前先把前台服务拉起来，否则注册刚成功进程就可能被回收
        try {
            SipForegroundService.start(context)
        } catch (error: Exception) {
            // Android can refuse a new foreground service while the screen/app
            // is in the background. Return a retryable bridge rejection instead
            // of crashing the entire Capacitor plugin thread.
            call.reject("当前系统不允许后台启动话务，请回到应用前台后重试")
            return
        }
        SipCore.register(cfg) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "注册失败")
        }
    }

    @PluginMethod
    fun unregister(call: PluginCall) {
        val registrationId = call.getString("registrationId")
        if (registrationId == null || pendingRegister?.getString("registrationId") == registrationId) {
            pendingRegister?.reject("SIP 注册已取消")
            pendingRegister = null
        }
        SipCore.unregister(registrationId) { err ->
            if (err == null && SipCore.registrationState == RegState.UNREGISTERED) SipForegroundService.stop(context)
            if (err == null) call.resolve() else call.reject(err.message ?: "注销失败")
        }
    }

    @PluginMethod
    fun registrationState(call: PluginCall) {
        call.resolve(JSObject().put("state", SipCore.registrationState))
    }

    @PluginMethod
    fun call(call: PluginCall) {
        val number = call.getString("number")
        if (number.isNullOrBlank()) return call.reject("缺少号码")
        val video = call.getBoolean("video") ?: false
        if (video && !SipCore.cameraGranted()) {
            requestPermissionForAlias(ALIAS_CAMERA, call, "onCameraPermission")
            return
        }
        SipCore.makeCall(number, video) { snap, err ->
            when {
                err != null -> call.reject(err.message ?: "外呼失败")
                snap != null -> call.resolve(snap.toJs())
                else -> call.reject("外呼失败")
            }
        }
    }

    @PluginMethod
    fun answer(call: PluginCall) {
        val callId = call.getString("callId") ?: return call.reject("缺少 callId")
        val video = call.getBoolean("video") ?: false
        if (video && !SipCore.cameraGranted()) {
            requestPermissionForAlias(ALIAS_CAMERA, call, "onCameraPermission")
            return
        }
        doAnswer(call, callId, video)
    }

    private fun doAnswer(call: PluginCall, callId: String, video: Boolean) {
        SipCore.answer(callId, video) { err ->
            if (err == null) {
                IncomingCallNotifier.cancel(context)
                call.resolve()
            } else {
                call.reject(err.message ?: "应答失败")
            }
        }
    }

    @PermissionCallback
    private fun onCameraPermission(call: PluginCall) {
        val granted = SipCore.cameraGranted()
        if (call.methodName == "answer") {
            val id = call.getString("callId") ?: return call.reject("缺少 callId")
            doAnswer(call, id, granted)
            return
        }
        if (!granted) return call.reject("未授予摄像头权限")
        when (call.methodName) {
            "call" -> this.call(call)
            "setVideo" -> setVideo(call)
            "setCamera" -> setCamera(call)
            else -> call.reject("未知视频操作")
        }
    }

    @PluginMethod
    fun setVideo(call: PluginCall) {
        val id = call.getString("callId") ?: return call.reject("缺少 callId")
        val on = call.getBoolean("on") ?: true
        if (on && !SipCore.cameraGranted()) {
            requestPermissionForAlias(ALIAS_CAMERA, call, "onCameraPermission")
            return
        }
        SipCore.setVideo(id, on) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "视频协商失败")
        }
    }

    @PluginMethod
    fun showVideo(call: PluginCall) {
        val id = call.getString("callId") ?: return call.reject("缺少 callId")
        if (SipCore.cachedCall(id)?.hasVideo != true) return call.reject("当前呼叫没有视频流")
        activity.runOnUiThread {
            VideoCallActivity.show(activity, id)
            call.resolve()
        }
    }

    @PluginMethod
    fun setCamera(call: PluginCall) {
        val id = call.getString("callId") ?: return call.reject("缺少 callId")
        val on = call.getBoolean("on") ?: false
        if (on && !SipCore.cameraGranted()) {
            requestPermissionForAlias(ALIAS_CAMERA, call, "onCameraPermission")
            return
        }
        SipCore.setCamera(id, on) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "摄像头切换失败")
        }
    }

    @PluginMethod
    fun switchCamera(call: PluginCall) {
        val id = call.getString("callId") ?: return call.reject("缺少 callId")
        SipCore.switchCamera(id) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "摄像头切换失败")
        }
    }

    @PluginMethod
    fun hangup(call: PluginCall) {
        val callId = call.getString("callId") ?: return call.reject("缺少 callId")
        SipCore.hangup(callId) { err ->
            IncomingCallNotifier.cancel(context)
            if (err == null) call.resolve() else call.reject(err.message ?: "挂断失败")
        }
    }

    @PluginMethod
    fun hold(call: PluginCall) {
        val callId = call.getString("callId") ?: return call.reject("缺少 callId")
        val on = call.getBoolean("on") ?: true
        SipCore.hold(callId, on) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "保持失败")
        }
    }

    @PluginMethod
    fun mute(call: PluginCall) {
        val on = call.getBoolean("on") ?: false
        SipCore.mute(on) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "静音失败")
        }
    }

    @PluginMethod
    fun sendDtmf(call: PluginCall) {
        val digits = call.getString("digits")
        if (digits.isNullOrEmpty()) return call.reject("缺少按键")
        SipCore.sendDtmf(digits, call.getString("callId")) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "DTMF 发送失败")
        }
    }

    @PluginMethod
    fun setAudioRoute(call: PluginCall) {
        val route = call.getString("route") ?: AudioRoute.EARPIECE
        SipCore.setAudioRoute(route) { err ->
            if (err == null) call.resolve() else call.reject(err.message ?: "音频路由切换失败")
        }
    }

    @PluginMethod
    fun calls(call: PluginCall) {
        val arr = JSArray()
        SipCore.snapshots().forEach { arr.put(it.toJs()) }
        call.resolve(JSObject().put("calls", arr))
    }

    // ---------------------------------------------------------------- 事件

    override fun onNativeNetworkChanged(path: NativeNetworkPath, epoch: Long, recovering: Boolean) {
        notifyListeners("networkChanged", JSObject()
            .put("networkEpoch", epoch).put("bearer", path.bearer)
            .put("osValidation", path.osValidation).put("ipFamilies", JSArray(path.ipFamilies))
            .put("metered", path.metered).put("recovering", recovering))
    }

    override fun onRegistrationChanged(state: String, code: Int, reason: String, registrationId: String) {
        notifyListeners(
            "registrationChanged",
            JSObject().put("state", state).put("code", code).put("reason", reason).put("registrationId", registrationId),
        )
    }

    override fun onIncomingCall(call: CallSnapshot) {
        notifyListeners("incomingCall", call.toJs())
    }

    override fun onCallStateChanged(call: CallSnapshot) {
        if (call.state == "disconnected" && presentedVideoCall == call.callId) presentedVideoCall = null
        maybeShowVideo(call.callId)
        notifyListeners("callStateChanged", call.toJs())
    }

    override fun onMediaStateChanged(
        callId: String,
        localAudio: Boolean,
        remoteAudio: Boolean,
        route: String,
        muted: Boolean,
        localVideo: Boolean,
        remoteVideo: Boolean,
    ) {
        notifyListeners(
            "mediaStateChanged",
            JSObject()
                .put("callId", callId)
                .put("localAudio", localAudio)
                .put("remoteAudio", remoteAudio)
                .put("route", route)
                .put("muted", muted)
                .put("localVideo", localVideo)
                .put("remoteVideo", remoteVideo),
        )
        maybeShowVideo(callId)
    }

    private fun maybeShowVideo(callId: String) {
        val call = SipCore.cachedCall(callId) ?: return
        if (!call.hasVideo || call.state != "confirmed" || presentedVideoCall == callId || !foreground) return
        presentedVideoCall = callId
        activity.runOnUiThread {
            if (foreground && !activity.isFinishing) VideoCallActivity.show(activity, callId)
        }
    }

    override fun onQualityChanged(
        callId: String,
        mos: Double?,
        lossPercent: Double?,
        jitterMs: Double?,
        rttMs: Double?,
    ) {
        val payload = JSObject().put("callId", callId)
        mos?.let { payload.put("mos", it) }
        lossPercent?.let { payload.put("lossPercent", it) }
        jitterMs?.let { payload.put("jitterMs", it) }
        rttMs?.let { payload.put("rttMs", it) }
        notifyListeners("qualityChanged", payload)
    }

    override fun onError(code: String, message: String, callId: String?) {
        val payload = JSObject().put("code", code).put("message", message)
        callId?.let { payload.put("callId", it) }
        notifyListeners("error", payload)
    }

    private fun CallSnapshot.toJs(): JSObject = JSObject()
        .put("callId", callId)
        .put("sipCallId", sipCallId)
        .put("callInstanceId", callInstanceId)
        .also { value ->
            if (offerId != null && attemptId != null) {
                value.put("offerId", offerId).put("attemptId", attemptId)
            }
        }
        .put("remoteNumber", remoteNumber)
        .put("remoteDisplayName", remoteDisplayName)
        .put("direction", direction)
        .put("state", state)
        .put("connectedAt", connectedAt)
        .put("videoOffered", videoOffered)
        .put("hasVideo", hasVideo)
}

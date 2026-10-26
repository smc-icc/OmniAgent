package com.smcloud.omnisip

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Telecom 接入。
 *
 * 用「自管理」（SELF_MANAGED）账号而不是 CALL_PROVIDER：自管理不需要成为默认电话应用，
 * 代价是来电界面要自己画（见 IncomingCallNotifier）。换来的是系统级的能力：
 * 与运营商来电互斥、通话中被蜂窝来电打断时自动保持、蓝牙与车机按键能控住这通 VoIP。
 */
@RequiresApi(Build.VERSION_CODES.O)
class OmniConnectionService : ConnectionService() {

    override fun onCreateIncomingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ): Connection = OmniConnection().apply {
        val callId = request?.extras?.getString(TelecomBridge.EXTRA_CALL_ID).orEmpty()
        val caller = request?.extras?.getString(TelecomBridge.EXTRA_CALLER).orEmpty()
        bind(callId)
        setAddress(Uri.fromParts("tel", caller.ifBlank { "unknown" }, null), TelecomManager.PRESENTATION_ALLOWED)
        setCallerDisplayName(caller, TelecomManager.PRESENTATION_ALLOWED)
        setRinging()
        TelecomBridge.attach(callId, this)
    }

    override fun onCreateOutgoingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ): Connection = OmniConnection().apply {
        val callId = request?.extras?.getString(TelecomBridge.EXTRA_CALL_ID).orEmpty()
        bind(callId)
        setAddress(request?.address, TelecomManager.PRESENTATION_ALLOWED)
        setDialing()
        TelecomBridge.attach(callId, this)
    }

    override fun onCreateIncomingConnectionFailed(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ) {
        // 系统拒绝建连（通常是正在通蜂窝电话）：直接把 SIP 腿收掉，别让对端一直听回铃
        val callId = request?.extras?.getString(TelecomBridge.EXTRA_CALL_ID).orEmpty()
        Log.w("OmniSip", "telecom refused incoming connection for $callId")
        if (callId.isNotEmpty()) SipCore.hangup(callId) { }
    }
}

/** 一通呼叫对应一个 Connection；系统的接听/挂断/保持按钮最终都落到 SipCore */
@RequiresApi(Build.VERSION_CODES.O)
class OmniConnection : Connection() {

    private var callId: String = ""
    private var instanceId: String = ""

    fun bind(callId: String) {
        this.callId = callId
        this.instanceId = NativeIncomingCallRuntime.current(callId)?.callInstanceId.orEmpty()
        connectionProperties = PROPERTY_SELF_MANAGED
        audioModeIsVoip = true
        connectionCapabilities = CAPABILITY_HOLD or CAPABILITY_SUPPORT_HOLD or CAPABILITY_MUTE
    }

    override fun onAnswer() {
        NativeIncomingCallRuntime.perform(callId,instanceId,NativeCallAction.ANSWER) { error ->
            if (error != null && NativeIncomingCallRuntime.snapshot(callId,instanceId)?.state == "disconnected") {
                setDisconnected(DisconnectCause(DisconnectCause.ERROR)); destroy()
            }
        }
        // Only confirmed SIP state via TelecomBridge.syncState may mark this active.
    }

    override fun onReject() {
        NativeIncomingCallRuntime.perform(callId,instanceId,NativeCallAction.END) { error ->
            if(error==null) { setDisconnected(DisconnectCause(DisconnectCause.REJECTED)); destroy() }
        }
    }

    override fun onDisconnect() {
        NativeIncomingCallRuntime.perform(callId,instanceId,NativeCallAction.END) { error ->
            if(error==null) { setDisconnected(DisconnectCause(DisconnectCause.LOCAL)); destroy() }
        }
    }

    override fun onHold() {
        SipCore.hold(callId, true) { }
        setOnHold()
    }

    override fun onUnhold() {
        SipCore.hold(callId, false) { }
        setActive()
    }

    override fun onPlayDtmfTone(c: Char) {
        SipCore.sendDtmf(c.toString(), callId) { }
    }

    override fun onShowIncomingCallUi() {
        // 自管理连接由 App 自己弹来电界面
        IncomingCallNotifier.notify(applicationContextOrNull() ?: return, "", callId)
    }

    private fun applicationContextOrNull(): Context? = TelecomBridge.appContext
}

/**
 * Telecom 与 SipCore 之间的胶水：注册 PhoneAccount、报告来电、同步呼叫状态。
 * Telecom 不可用（无权限、低版本、厂商裁剪）时全部降级为通知路径。
 */
object TelecomBridge {

    const val EXTRA_CALL_ID = "com.smcloud.omnisip.CALL_ID"
    const val EXTRA_CALLER = "com.smcloud.omnisip.CALLER"

    @Volatile
    var appContext: Context? = null
        private set

    private var handle: PhoneAccountHandle? = null
    private val connections = HashMap<String, Any>()

    fun init(context: Context) {
        appContext = context.applicationContext
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        runCatching { registerAccount(context.applicationContext) }
            .onFailure { Log.w("OmniSip", "telecom account register failed, fallback to notification", it) }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    @SuppressLint("MissingPermission")
    private fun registerAccount(context: Context) {
        val tm = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        val h = PhoneAccountHandle(
            ComponentName(context, OmniConnectionService::class.java),
            "OmniAgentSip",
        )
        val account = PhoneAccount.builder(h, "OmniAgent 坐席")
            .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
            .addSupportedUriScheme("sip")
            .addSupportedUriScheme("tel")
            .build()
        tm.registerPhoneAccount(account)
        handle = h
    }

    fun attach(callId: String, connection: Any) {
        if (callId.isNotEmpty()) connections[callId] = connection
    }

    /**
     * 报告来电给系统。返回 false 表示走不通（无权限或低版本），
     * 调用方需要自己弹通知。
     */
    @SuppressLint("MissingPermission")
    fun reportIncoming(callId: String, caller: String): Boolean {
        val context = appContext ?: return false
        val h = handle ?: return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return runCatching {
            val tm = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            val extras = Bundle().apply {
                putString(EXTRA_CALL_ID, callId)
                putString(EXTRA_CALLER, caller)
            }
            tm.addNewIncomingCall(h, extras)
            true
        }.getOrElse {
            Log.w("OmniSip", "addNewIncomingCall failed", it)
            false
        }
    }

    /** SIP 侧状态变化回灌给系统，保持系统通话状态与真实通话一致 */
    @RequiresApi(Build.VERSION_CODES.O)
    fun syncState(callId: String, state: String) {
        val conn = connections[callId] as? OmniConnection ?: return
        when (state) {
            "confirmed" -> conn.setActive()
            "held" -> conn.setOnHold()
            "disconnected" -> {
                conn.setDisconnected(DisconnectCause(DisconnectCause.REMOTE))
                conn.destroy()
                connections.remove(callId)
            }
        }
    }

    fun clear(callId: String) {
        connections.remove(callId)
    }
}

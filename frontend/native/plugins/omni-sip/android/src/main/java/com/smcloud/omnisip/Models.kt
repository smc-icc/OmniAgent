package com.smcloud.omnisip

/** 与 src/services/sip/SipEngine.ts 的 SipConfig 一一对应 */
data class SipConfigIn(
    val username: String,
    val password: String,
    val realm: String,
    val proxyHost: String,
    val proxyPort: Int,
    /** tls / tcp / udp */
    val transport: String,
    /** required / optional / disabled */
    val srtp: String,
    val codecs: List<String>,
    val registerExpiresS: Int,
    val stunServer: String?,
    val iceEnabled: Boolean,
    val displayName: String?,
    val registrationId: String,
    val nativeNetworkRecovery: Boolean = false,
)

/** 与 SipEngine.ts 的 SipCall 一一对应；callId 是引擎内部句柄，sipCallId 是 SIP Call-ID */
data class CallSnapshot(
    val callId: String,
    val sipCallId: String,
    val remoteNumber: String,
    val remoteDisplayName: String,
    val direction: String,
    val state: String,
    val connectedAt: Long,
    val videoOffered: Boolean = false,
    val hasVideo: Boolean = false,
    val offerId: String? = null,
    val attemptId: String? = null,
    val callInstanceId: String = "",
    val mobileCorrelationPresent: Boolean = false,
    val mobileCorrelationValid: Boolean = false,
)

/** 与 SipEngine.ts 的 SipRegistrationState 一一对应 */
object RegState {
    const val UNREGISTERED = "unregistered"
    const val REGISTERING = "registering"
    const val REGISTERED = "registered"
    const val FAILED = "failed"
}

object AudioRoute {
    const val EARPIECE = "earpiece"
    const val SPEAKER = "speaker"
    const val BLUETOOTH = "bluetooth"
    const val WIRED = "wired"
}

interface SipCoreListener {
    fun onNativeNetworkChanged(path: NativeNetworkPath, epoch: Long, recovering: Boolean) {}
    fun onRegistrationChanged(state: String, code: Int, reason: String, registrationId: String)
    fun onIncomingCall(call: CallSnapshot)
    fun onCallStateChanged(call: CallSnapshot)
    fun onMediaStateChanged(
        callId: String,
        localAudio: Boolean,
        remoteAudio: Boolean,
        route: String,
        muted: Boolean,
        localVideo: Boolean,
        remoteVideo: Boolean,
    )

    fun onQualityChanged(callId: String, mos: Double?, lossPercent: Double?, jitterMs: Double?, rttMs: Double?)
    fun onError(code: String, message: String, callId: String?)
}

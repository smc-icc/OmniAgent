package com.smcloud.omnisip

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * 来电唤醒。后端发的是 data-only 高优先级消息（见 backend/src/shared/services/push.ts），
 * 收到后要做的事只有两件：把进程拉成前台、补上 SIP 注册，然后弹来电提醒。
 *
 * 注意不在这里应答呼叫：真正的 INVITE 稍后由 PJSIP 收到，应答决策在 Vue 侧。
 */
class OmniPushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        PushTokenHub.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["kind"] != "incoming_call") return

        val caller = data["caller"].orEmpty()
        Log.i("OmniSip", "push wake for incoming call from $caller")

        // 进程可能刚被系统拉起：先起前台服务并补注册，才有可能收到 INVITE
        SipForegroundService.wake(this)

        // callId 此时还没有 SIP 腿，用 CCS 的 call_id 占位；应答走 Vue 侧协调器
        IncomingCallNotifier.notify(this, caller, data["call_id"].orEmpty())
    }
}

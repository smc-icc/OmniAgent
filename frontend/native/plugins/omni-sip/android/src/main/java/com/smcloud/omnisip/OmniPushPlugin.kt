package com.smcloud.omnisip

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/**
 * OmniPush 插件：只做 token 取用与刷新通知，token 的上报由 Vue 侧
 * services/mobile-push.ts 调后端接口完成。
 */
@CapacitorPlugin(name = "OmniPush")
class OmniPushPlugin : Plugin() {

    override fun load() {
        PushTokenHub.plugin = this
    }

    override fun handleOnDestroy() {
        if (PushTokenHub.plugin === this) PushTokenHub.plugin = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getToken(call: PluginCall) {
        try {
            // FCM is optional. APKs without google-services.json have no default
            // FirebaseApp; never let that synchronous error escape the bridge.
            val configured = FirebaseApp.getApps(context).any {
                it.name == FirebaseApp.DEFAULT_APP_NAME
            }
            if (!configured) {
                call.resolve(payload("").put("available", false).put("reason", "fcm_not_configured"))
                return
            }
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    PushTokenHub.lastToken = token
                    call.resolve(payload(token))
                }
                .addOnFailureListener { err ->
                    call.reject(err.message ?: "获取推送 token 失败")
                }
        } catch (error: Exception) {
            call.reject("推送服务初始化失败")
        }
    }

    internal fun emitTokenRefreshed(token: String) {
        notifyListeners("tokenRefreshed", payload(token))
    }

    private fun payload(token: String): JSObject = JSObject()
        .put("token", token)
        .put("provider", "fcm")
        // Android 没有 VoIP 专用通道，走高优先级 data 消息
        .put("voip", false)
}

/** FirebaseMessagingService 与插件实例之间的桥；服务可能在插件未加载时就收到 token */
object PushTokenHub {
    @Volatile
    var plugin: OmniPushPlugin? = null

    @Volatile
    var lastToken: String = ""

    fun onNewToken(token: String) {
        lastToken = token
        plugin?.emitTokenRefreshed(token)
    }
}

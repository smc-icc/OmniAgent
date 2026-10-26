package com.smcloud.omnisip

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * 来电提醒。Telecom 自管理连接不提供系统来电界面，所以锁屏与后台的来电
 * 靠高优先级通知与系统允许的全屏 Intent 展示原生页面，不依赖 Vue。
 */
object IncomingCallNotifier {

    private const val CHANNEL_ID = "omni_sip_incoming"
    private const val NOTIFICATION_ID = 4802

    private val tags = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    fun notify(context: Context, caller: String, callId: String, instanceId: String = "") {
        createChannel(context)
        val actual = NativeIncomingCallRuntime.current(callId)
        val instance = instanceId.ifBlank { actual?.callInstanceId.orEmpty() }
        val tag = "omni-call:$callId:$instance"
        val full = Intent(context, IncomingCallActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            data = android.net.Uri.Builder().scheme("omni-call").authority("incoming").appendPath(callId).appendPath(instance).build()
            putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
            putExtra(IncomingCallActivity.EXTRA_CALLER, caller)
            putExtra(IncomingCallActivity.EXTRA_INSTANCE_ID, instance)
        }
        fun pending(action: String, request: Int) = PendingIntent.getActivity(context, request,
            Intent(full).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val fullPending = pending(IncomingCallActivity.ACTION_SHOW, 1)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(if (instance.isBlank()) "来电提醒，请打开工作台恢复连接" else "来电")
            .setContentText(caller.ifBlank { "未知号码" })
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(instance.isNotBlank())
            .setAutoCancel(false)
            .setContentIntent(fullPending)
        if (instance.isNotBlank()) {
            builder.setFullScreenIntent(fullPending, true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "拒接", pending(IncomingCallActivity.ACTION_END, 2))
                .addAction(android.R.drawable.ic_menu_call, "接听", pending(IncomingCallActivity.ACTION_ANSWER, 3))
        } else builder.setTimeoutAfter(30000)
        tags.add(tag)
        manager(context).notify(tag, NOTIFICATION_ID, builder.build())
    }

    fun cancel(context: Context, callId: String, instanceId: String) {
        val tag = "omni-call:$callId:$instanceId"
        manager(context).cancel(tag, NOTIFICATION_ID)
        tags.remove(tag)
    }
    /** Legacy logout/teardown entry; per-call lifecycle uses the scoped overload. */
    fun cancel(context: Context) {
        tags.toList().forEach { tag -> manager(context).cancel(tag, NOTIFICATION_ID); tags.remove(tag) }
        manager(context).cancel(NOTIFICATION_ID)
    }

    private fun manager(context: Context) =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = manager(context)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "来电提醒", NotificationManager.IMPORTANCE_HIGH)
        channel.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        channel.enableVibration(true)
        channel.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        nm.createNotificationChannel(channel)
    }
}

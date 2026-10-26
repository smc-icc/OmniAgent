package com.smcloud.omnisip

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * 值机期间常驻的前台服务。
 *
 * 唯一职责是让进程别被回收，从而保住 PJSIP 的注册与 UDP/TLS 长连接。
 * 注册逻辑仍在 SipCore，服务只负责「活着」和一条不可划掉的通知。
 *
 * 局限要写进说明书：厂商省电策略（华为/小米/OPPO/vivo）仍可能杀掉进程，
 * 所以推送唤醒是必须的第二道保险，不能只靠前台服务。
 */
class SipForegroundService : Service() {

    companion object {
        private const val CHANNEL_ID = "omni_sip_service"
        private const val NOTIFICATION_ID = 4801
        const val ACTION_START = "com.smcloud.omnisip.START"
        const val ACTION_STOP = "com.smcloud.omnisip.STOP"
        /** 由推送唤醒：拉起进程并补注册 */
        const val ACTION_WAKE = "com.smcloud.omnisip.WAKE"

        fun start(context: Context) {
            val intent = Intent(context, SipForegroundService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun wake(context: Context) {
            val intent = Intent(context, SipForegroundService::class.java).setAction(ACTION_WAKE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, SipForegroundService::class.java).setAction(ACTION_STOP),
            )
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                releaseWakeLock()
                stopForeground(true)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_WAKE -> {
                promote()
                acquireWakeLock()
                // 凭据还在内存里就直接补注册；进程刚被拉起时由 JS 侧重新下发
                SipCore.reRegisterIfPossible()
            }
            else -> {
                promote()
                acquireWakeLock()
            }
        }
        // START_STICKY：被系统回收后尽量重启，重启时 intent 为 null 走默认分支
        return START_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun promote() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val registered = SipCore.registrationState == RegState.REGISTERED
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("坐席值机中")
            .setContentText(if (registered) "分机已注册，可接听来电" else "分机未注册，正在重试")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(open)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        // LOW：常驻通知不应该响铃，来电提醒走独立的高优先级通道
        val channel = NotificationChannel(CHANNEL_ID, "坐席值机", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        nm.createNotificationChannel(channel)
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        // PARTIAL：只保 CPU，不亮屏；10 分钟超时兜底，避免异常路径下漏放
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OmniSip:wake").apply {
            setReferenceCounted(false)
            acquire(10 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
        wakeLock = null
    }
}

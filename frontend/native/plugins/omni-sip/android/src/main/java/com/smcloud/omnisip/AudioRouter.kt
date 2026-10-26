package com.smcloud.omnisip

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.util.Log

/**
 * 通话音频焦点与出声设备管理。
 *
 * 音频焦点必须在接通前就拿到，否则某些厂商 ROM 会把 PJSIP 的采集通道静掉；
 * 通话结束要立刻还回去，不然音乐类 App 会一直被压着。
 */
class AudioRouter(private val context: Context) {

    private val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    @Volatile
    var current: String = AudioRoute.EARPIECE
        private set

    private var focusRequest: AudioFocusRequest? = null
    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var focusHeld = false

    /** 来电振铃阶段：只切模式，不抢独占焦点，避免压掉系统铃声 */
    fun onIncomingCall() {
        runCatching { am.mode = AudioManager.MODE_RINGTONE }
    }

    fun onCallActive() {
        requestFocus()
        runCatching { am.mode = AudioManager.MODE_IN_COMMUNICATION }
        // 默认听筒；用户点免提再切
        apply(if (isWiredHeadsetOn()) AudioRoute.WIRED else current)
    }

    fun onCallEnded() {
        stopBluetooth()
        runCatching {
            am.mode = previousMode
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice()
        }
        abandonFocus()
        current = AudioRoute.EARPIECE
    }

    fun apply(route: String) {
        current = route
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            applyModern(route)
        } else {
            applyLegacy(route)
        }
    }

    @SuppressLint("NewApi")
    private fun applyModern(route: String) {
        val wanted = when (route) {
            AudioRoute.SPEAKER -> intArrayOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
            AudioRoute.BLUETOOTH -> intArrayOf(
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_BLE_HEADSET,
            )
            AudioRoute.WIRED -> intArrayOf(
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_USB_HEADSET,
            )
            else -> intArrayOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
        }
        val device = am.availableCommunicationDevices.firstOrNull { d -> wanted.any { it == d.type } }
        if (device == null) {
            Log.w("OmniSip", "route $route unavailable, keep current")
            return
        }
        if (!am.setCommunicationDevice(device)) {
            Log.w("OmniSip", "setCommunicationDevice failed for $route")
        }
    }

    @Suppress("DEPRECATION")
    private fun applyLegacy(route: String) {
        when (route) {
            AudioRoute.SPEAKER -> {
                stopBluetooth()
                am.isSpeakerphoneOn = true
            }
            AudioRoute.BLUETOOTH -> {
                am.isSpeakerphoneOn = false
                if (am.isBluetoothScoAvailableOffCall) {
                    am.startBluetoothSco()
                    am.isBluetoothScoOn = true
                }
            }
            else -> {
                stopBluetooth()
                am.isSpeakerphoneOn = false
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun stopBluetooth() {
        runCatching {
            if (am.isBluetoothScoOn) {
                am.isBluetoothScoOn = false
                am.stopBluetoothSco()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun isWiredHeadsetOn(): Boolean =
        am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_HEADSET
        }

    private fun requestFocus() {
        if (focusHeld) return
        previousMode = am.mode
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        focusHeld = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener { }
                .build()
            focusRequest = req
            am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN,
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    private fun abandonFocus() {
        if (!focusHeld) return
        focusHeld = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { am.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(null)
        }
    }
}

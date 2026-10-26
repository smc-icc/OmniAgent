package com.smcloud.omnisip

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** Lock-screen SIP controls. Does not dismiss keyguard or instantiate the WebView to answer. */
class IncomingCallActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_CALL_ID = "callId"
        const val EXTRA_CALLER = "caller"
        const val EXTRA_INSTANCE_ID = "callInstanceId"
        const val ACTION_SHOW = "com.smcloud.omnisip.SHOW_INCOMING"
        const val ACTION_ANSWER = "com.smcloud.omnisip.ANSWER_INCOMING"
        const val ACTION_END = "com.smcloud.omnisip.END_INCOMING"
    }
    private var callId=""
    private var instance=""
    private var removeObserver: (() -> Unit)?=null
    private lateinit var status: TextView
    private lateinit var answer: Button
    private lateinit var end: Button
    private lateinit var caller: TextView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true); setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        buildView()
        removeObserver=NativeIncomingCallRuntime.subscribe { call ->
            if (call.callId == callId && call.callInstanceId == instance) render(call)
        }
        receive(intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); receive(intent) }
    override fun onDestroy() { removeObserver?.invoke(); removeObserver=null; super.onDestroy() }
    private fun buildView() {
        val density=resources.displayMetrics.density
        val layout=LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL; gravity=Gravity.CENTER
            setPadding((24*density).toInt(),(36*density).toInt(),(24*density).toInt(),(36*density).toInt())
            setBackgroundColor(Color.rgb(20,27,43))
        }
        caller=TextView(this).apply { textSize=28f;setTextColor(Color.WHITE);gravity=Gravity.CENTER }
        status=TextView(this).apply { textSize=18f;setTextColor(Color.LTGRAY);gravity=Gravity.CENTER;setPadding(0,24,0,32) }
        answer=Button(this).apply { text="接听";setOnClickListener { perform(NativeCallAction.ANSWER) } }
        end=Button(this).apply { text="拒接";setOnClickListener { perform(NativeCallAction.END) } }
        layout.addView(caller);layout.addView(status)
        for (button in listOf(answer,end)) layout.addView(button,LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=(12*density).toInt() })
        val open=Button(this).apply { text="打开工作台";setOnClickListener {
            packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it); finish() }
        } }
        layout.addView(open,LinearLayout.LayoutParams(-1,-2))
        setContentView(layout)
    }
    private fun receive(intent: Intent) {
        callId=intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
        instance=intent.getStringExtra(EXTRA_INSTANCE_ID).orEmpty()
        caller.text="来电"
        val call=NativeIncomingCallRuntime.snapshot(callId,instance)
        if (call == null) {
            status.text=if (instance.isBlank()) "尚未恢复来电连接，请打开工作台" else "来电已结束"
            answer.isEnabled=false;end.isEnabled=false
            if (instance.isNotBlank()) finish()
            return
        }
        render(call)
        when(intent.action) {
            ACTION_ANSWER -> perform(NativeCallAction.ANSWER)
            ACTION_END -> perform(NativeCallAction.END)
        }
        intent.action=ACTION_SHOW // Rotation or activity reuse must not re-submit a button action.
    }
    private fun render(call: CallSnapshot) {
        caller.text=call.remoteNumber.ifBlank { "未知号码" }
        val ringing=call.state in setOf("incoming","early")
        answer.visibility=if (ringing) android.view.View.VISIBLE else android.view.View.GONE
        answer.isEnabled=ringing && !call.mobileCorrelationPresent;end.isEnabled=call.state != "disconnected"
        end.text=if(ringing) "拒接" else "挂断"
        status.text=when(call.state) {
            "incoming","early" -> "来电中"
            "connecting" -> "正在接通"
            "confirmed" -> "通话中"
            "held" -> "通话保持中"
            "disconnected" -> "通话已结束"
            else -> "连接中"
        }
        if (call.state == "disconnected") finish()
    }
    private fun perform(action: NativeCallAction) {
        if (instance.isBlank()) return
        if (action == NativeCallAction.ANSWER) { answer.isEnabled=false; status.text="正在接通" }
        else { end.isEnabled=false;status.text="正在结束" }
        NativeIncomingCallRuntime.perform(callId,instance,action) { error ->
            if (isFinishing || isDestroyed) return@perform
            if(error!=null) {
                NativeIncomingCallRuntime.snapshot(callId,instance)?.let { render(it) }
                status.text=if(action==NativeCallAction.ANSWER) "未能接听，请重试或打开工作台" else "未能挂断，请重试"
            }
        }
    }
}

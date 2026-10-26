package com.smcloud.omnisip

import org.pjsip.pjsua2.Account
import org.pjsip.pjsua2.OnIncomingCallParam
import org.pjsip.pjsua2.OnRegStateParam

/**
 * pjsua2 Account 子类：只把注册态与来电事件转给 SipCore，不做任何决策。
 * 回调运行在 pjsip 自己的线程上，这里不能调用耗时或阻塞的东西。
 */
class OmniAccount(val registrationId: String) : Account() {

    override fun onRegState(prm: OnRegStateParam) {
        // SWIG 把 pjsip 的枚举生成成只放 int 常量的 final class，没有 swigValue()
        val code = prm.code
        val active = runCatching { info.regIsActive }.getOrDefault(false)
        val state = when {
            active && code / 100 == 2 -> RegState.REGISTERED
            // 注销成功也是 2xx，但 regIsActive 已经是 false
            code / 100 == 2 -> RegState.UNREGISTERED
            else -> RegState.FAILED
        }
        SipCore.emitRegistration(state, code, prm.reason ?: "", registrationId)
    }

    override fun onIncomingCall(prm: OnIncomingCallParam) {
        val call = OmniCall(this, prm.callId)
        // Parse the original INVITE header block only; do not infer identity from caller/time.
        call.mobileCorrelation = MobileCallCorrelation.parse(runCatching { prm.rdata.wholeMsg }.getOrNull())
        SipCore.track(call)
        SipCore.emitIncoming(call)
    }
}

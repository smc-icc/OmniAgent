import AVFoundation
import Capacitor
import Foundation

/**
 * OmniSip 插件的 iOS 实现：方法名、参数名、事件名与 Android 完全一致，
 * Vue 侧不出现任何平台判断（见 src/services/sip/）。
 *
 * iOS 与 Android 的差别只有两处，都藏在插件内部：
 *   1. 来电界面由 CallKit 提供，不需要自己弹全屏通知；
 *   2. 音频路由通过 AVAudioSession 的 overrideOutputAudioPort 切换。
 */
@objc(OmniSipPlugin)
public class OmniSipPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "OmniSipPlugin"
    public let jsName = "OmniSip"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registrationState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "call", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "answer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hangup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hold", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendDtmf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAudioRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calls", returnType: CAPPluginReturnPromise),
    ]

    private let core = OmniSipCore.shared
    private let registrationQueue = DispatchQueue(label: "com.smcloud.omnisip.registration")
    private var registrationGeneration = 0
    private var pendingRegistrationId: String?
    private lazy var callKit = CallKitManager(core: core)

    override public func load() {
        core.delegate = self
        callKit.activate()
        // VoIP push 收到时要能同步 report 来电，所以把同一个 CallKit 实例交给推送中心
        VoipPushCenter.shared.callKit = callKit
        observeAudioInterruptions()
    }

    // ------------------------------------------------------------- 方法

    @objc func register(_ call: CAPPluginCall) {
        registrationQueue.async { [self] in
            guard let registrationId = call.getString("registrationId"), !registrationId.isEmpty else { call.reject("缺少 registrationId"); return }
            registrationGeneration += 1
            let generation = registrationGeneration
            pendingRegistrationId = registrationId
            // 没有麦克风权限接通只会是单通，先要权限
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                guard let self else { return }
                self.registrationQueue.async {
                    guard self.registrationGeneration == generation else { call.reject("SIP 注册已取消"); return }
                    guard granted else {
                        call.reject("未授予麦克风权限，无法接听")
                        return
                    }
                    var cfg: [String: Any] = [:]
                    for key in ["username", "password", "realm", "proxyHost", "transport", "srtp", "displayName", "stunServer", "registrationId"] {
                        if let value = call.getString(key) { cfg[key] = value }
                    }
                    cfg["proxyPort"] = call.getInt("proxyPort") ?? 5061
                    cfg["registerExpiresS"] = call.getInt("registerExpiresS") ?? 300
                    cfg["iceEnabled"] = call.getBool("iceEnabled") ?? false
                    cfg["codecs"] = call.getArray("codecs", String.self) ?? ["PCMA", "PCMU"]

                    guard cfg["username"] != nil, cfg["password"] != nil, cfg["realm"] != nil, cfg["proxyHost"] != nil else {
                        call.reject("SIP 配置不完整")
                        return
                    }
                    do {
                        try self.core.register(withConfig: cfg)
                        call.resolve()
                    } catch {
                        call.reject(error.localizedDescription)
                    }
                }
            }
        }
    }

    @objc func unregister(_ call: CAPPluginCall) {
        registrationQueue.async { [self] in
            let registrationId = call.getString("registrationId")
            if registrationId == nil || registrationId == pendingRegistrationId {
                registrationGeneration += 1
                pendingRegistrationId = nil
            }
            if let registrationId {
                do { try core.unregisterRegistration(registrationId); call.resolve() }
                catch { call.reject(error.localizedDescription) }
                return
            }
            core.unregisterAccount()
            call.resolve()
        }
    }

    @objc func registrationState(_ call: CAPPluginCall) {
        call.resolve(["state": core.registrationState])
    }

    @objc func call(_ call: CAPPluginCall) {
        guard let number = call.getString("number"), !number.isEmpty else {
            call.reject("缺少号码")
            return
        }
        do {
            let snapshot = try core.makeCall(number)
            // 外呼也要报给 CallKit，否则系统不会给我们音频会话
            callKit.reportOutgoing(callId: snapshot["callId"] as? String ?? "", handle: number)
            call.resolve(snapshot)
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func answer(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("缺少 callId")
            return
        }
        do {
            try core.answerCall(callId)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func hangup(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("缺少 callId")
            return
        }
        do {
            try core.hangupCall(callId)
            callKit.endCall(callId: callId)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func hold(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("缺少 callId")
            return
        }
        do {
            try core.holdCall(callId, on: call.getBool("on") ?? true)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func mute(_ call: CAPPluginCall) {
        do {
            try core.setMuted(call.getBool("on") ?? false)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func sendDtmf(_ call: CAPPluginCall) {
        guard let digits = call.getString("digits"), !digits.isEmpty else {
            call.reject("缺少按键")
            return
        }
        do {
            try core.sendDtmf(digits, callId: call.getString("callId"))
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func setAudioRoute(_ call: CAPPluginCall) {
        let route = call.getString("route") ?? "earpiece"
        do {
            try AudioRouter.apply(route)
            notifyRoute(route)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func calls(_ call: CAPPluginCall) {
        call.resolve(["calls": core.activeCalls()])
    }

    // ------------------------------------------------------------- 音频中断

    /**
     * 系统来电、Siri、闹钟都会打断音频会话。中断结束后必须显式重新激活，
     * 否则通话虽然还在，但两边都听不到声音。
     */
    private func observeAudioInterruptions() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                self?.core.audioSessionActivated(false)
            case .ended:
                try? AVAudioSession.sharedInstance().setActive(true)
                self?.core.audioSessionActivated(true)
            @unknown default:
                break
            }
        }

        NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyRoute(AudioRouter.currentRoute())
        }
    }

    private func notifyRoute(_ route: String) {
        guard let callId = core.activeCalls().first?["callId"] as? String else { return }
        notifyListeners("mediaStateChanged", data: [
            "callId": callId,
            "localAudio": !core.muted,
            "remoteAudio": true,
            "route": route,
            "muted": core.muted,
        ])
    }
}

// ------------------------------------------------------------------- 事件

extension OmniSipPlugin: OmniSipCoreDelegate {

    public func sipRegistrationChanged(_ state: String, code: Int32, reason: String, registrationId: String) {
        notifyListeners("registrationChanged", data: [
            "state": state,
            "code": Int(code),
            "reason": reason,
            "registrationId": registrationId,
        ])
    }

    public func sipIncomingCall(_ call: [AnyHashable: Any]) {
        let payload = call as? [String: Any] ?? [:]
        let callId = payload["callId"] as? String ?? ""
        let caller = payload["remoteNumber"] as? String ?? ""
        // 推送可能已经占位报过一通，这里接管它而不是再报一通
        callKit.adoptPlaceholder(callId: callId, handle: caller)
        notifyListeners("incomingCall", data: payload)
    }

    public func sipCallStateChanged(_ call: [AnyHashable: Any]) {
        let payload = call as? [String: Any] ?? [:]
        let callId = payload["callId"] as? String ?? ""
        switch payload["state"] as? String {
        case "confirmed":
            callKit.reportConnected(callId: callId)
        case "disconnected":
            callKit.endCall(callId: callId)
        default:
            break
        }
        notifyListeners("callStateChanged", data: payload)
    }

    public func sipMediaStateChanged(_ info: [AnyHashable: Any]) {
        var payload = info as? [String: Any] ?? [:]
        payload["route"] = AudioRouter.currentRoute()
        notifyListeners("mediaStateChanged", data: payload)
    }

    public func sipQualityChanged(_ info: [AnyHashable: Any]) {
        notifyListeners("qualityChanged", data: info as? [String: Any] ?? [:])
    }

    public func sipError(_ code: String, message: String, callId: String?) {
        var payload: [String: Any] = ["code": code, "message": message]
        if let callId { payload["callId"] = callId }
        notifyListeners("error", data: payload)
    }
}

/** 麦克风权限：AVAudioSession 的 API 在 iOS 17 换了名字，这里统一一层 */
private extension AVAudioSession {
    func requestRecordPermission(_ handler: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: handler)
        } else {
            requestRecordPermission(completionHandler: handler)
        }
    }
}

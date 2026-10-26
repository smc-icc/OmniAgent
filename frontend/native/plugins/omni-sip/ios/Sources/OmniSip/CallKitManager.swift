import AVFoundation
import CallKit
import Foundation

/**
 * CallKit 接入。
 *
 * iOS 不允许 App 自己画来电界面，来电必须交给 CallKit；而且收到 VoIP push 后
 * 必须「立刻」report 一通来电，否则系统会逐步限制直至吊销 VoIP push 能力。
 * 所以 reportIncoming 允许在 SIP INVITE 到达之前先用 CCS 的 call_id 占位报一通，
 * 之后 SIP 腿到达时用 updateHandle 补齐号码。
 */
final class CallKitManager: NSObject {

    private let core: OmniSipCore
    private let provider: CXProvider
    private let controller = CXCallController()
    /** callId ↔ CallKit UUID 双向映射 */
    private var uuids: [String: UUID] = [:]
    private var callIds: [UUID: String] = [:]
    /** VoIP push 先行占位的那通（key 是 CCS 的 call_id，不是 SIP callId） */
    private var placeholderId: String?

    init(core: OmniSipCore) {
        self.core = core
        let cfg = CXProviderConfiguration()
        cfg.supportsVideo = false
        cfg.maximumCallsPerCallGroup = 1
        cfg.maximumCallGroups = 1
        cfg.supportedHandleTypes = [.phoneNumber, .generic]
        provider = CXProvider(configuration: cfg)
        super.init()
    }

    func activate() {
        provider.setDelegate(self, queue: nil)
    }

    /**
     * 报一通来电。placeholder=true 表示这是 VoIP push 触发的占位
     * （此时 callId 是 CCS 的 call_id，SIP 腿还没到）。
     */
    @discardableResult
    func reportIncoming(callId: String, handle: String, placeholder: Bool = false) -> UUID {
        if placeholder { placeholderId = callId }
        if let existing = uuids[callId] {
            updateHandle(uuid: existing, handle: handle)
            return existing
        }
        let uuid = UUID()
        uuids[callId] = uuid
        callIds[uuid] = callId
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .phoneNumber, value: handle.isEmpty ? "未知号码" : handle)
        update.hasVideo = false
        update.supportsHolding = true
        update.supportsDTMF = true
        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error {
                NSLog("[OmniSip] reportNewIncomingCall failed: %@", error.localizedDescription)
            }
        }
        return uuid
    }

    /**
     * SIP 腿到达时调用：有占位就改挂到真正的 SIP callId 上，没有就正常报一通。
     * 不接管占位会出现「系统里一通、SIP 里另一通」的两通呼叫。
     */
    func adoptPlaceholder(callId: String, handle: String) {
        guard let placeholder = placeholderId, let uuid = uuids[placeholder], placeholder != callId else {
            reportIncoming(callId: callId, handle: handle)
            return
        }
        placeholderId = nil
        uuids.removeValue(forKey: placeholder)
        uuids[callId] = uuid
        callIds[uuid] = callId
        updateHandle(uuid: uuid, handle: handle)
    }

    func reportOutgoing(callId: String, handle: String) {
        let uuid = UUID()
        uuids[callId] = uuid
        callIds[uuid] = callId
        let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .phoneNumber, value: handle))
        controller.request(CXTransaction(action: action)) { error in
            if let error {
                NSLog("[OmniSip] start call transaction failed: %@", error.localizedDescription)
            }
        }
    }

    func reportConnected(callId: String) {
        guard let uuid = uuids[callId] else { return }
        provider.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    func endCall(callId: String) {
        guard let uuid = uuids[callId] else { return }
        provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
        uuids.removeValue(forKey: callId)
        callIds.removeValue(forKey: uuid)
        if placeholderId == callId { placeholderId = nil }
    }

    private func updateHandle(uuid: UUID, handle: String) {
        guard !handle.isEmpty else { return }
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .phoneNumber, value: handle)
        provider.reportCall(with: uuid, updated: update)
    }
}

extension CallKitManager: CXProviderDelegate {

    func providerDidReset(_ provider: CXProvider) {
        // 系统重置（通常是 App 崩溃恢复）：把 SIP 腿也收干净，避免留下无主通话
        for callId in uuids.keys {
            try? core.hangupCall(callId)
        }
        uuids.removeAll()
        callIds.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let callId = callIds[action.callUUID] else {
            action.fail()
            return
        }
        do {
            try core.answerCall(callId)
            action.fulfill()
        } catch {
            action.fail()
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let callId = callIds[action.callUUID] {
            try? core.hangupCall(callId)
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        guard let callId = callIds[action.callUUID] else {
            action.fail()
            return
        }
        do {
            try core.holdCall(callId, on: action.isOnHold)
            action.fulfill()
        } catch {
            action.fail()
        }
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        try? core.setMuted(action.isMuted)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXPlayDTMFCallAction) {
        let callId = callIds[action.callUUID]
        try? core.sendDtmf(action.digits, callId: callId)
        action.fulfill()
    }

    /** CallKit 拿到音频会话后才能出声，必须在这里通知 pjsua2 挂上音频设备 */
    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        try? AudioRouter.configureForCall()
        core.audioSessionActivated(true)
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        core.audioSessionActivated(false)
    }
}

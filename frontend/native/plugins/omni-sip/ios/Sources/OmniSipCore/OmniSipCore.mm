#import "OmniSipCore.h"

#include <pjsua2.hpp>

#include <map>
#include <string>

using namespace pj;

/**
 * 与 Android 的 SipCore.kt 一一对应的 iOS 实现。
 *
 * 线程模型：pjsua2 要求调用线程先注册到 pjlib，这里固定一条串行队列，
 * 所有 pjsua2 调用都在上面执行；回调来自 pjsip 自己的线程，只做数据整理后回主队列。
 */

static NSString *const kRegUnregistered = @"unregistered";
static NSString *const kRegRegistering = @"registering";
static NSString *const kRegRegistered = @"registered";
static NSString *const kRegFailed = @"failed";

@class OmniSipCore;

namespace {

/** 把 pjsua2 的呼叫状态映射成 SipEngine.ts 的 SipCallState */
NSString *MapCallState(const CallInfo &ci) {
    bool onHold = false;
    for (unsigned i = 0; i < ci.media.size(); i++) {
        if (ci.media[i].type != PJMEDIA_TYPE_AUDIO) continue;
        if (ci.media[i].status == PJSUA_CALL_MEDIA_LOCAL_HOLD ||
            ci.media[i].status == PJSUA_CALL_MEDIA_REMOTE_HOLD) {
            onHold = true;
        }
    }
    switch (ci.state) {
        case PJSIP_INV_STATE_INCOMING: return @"incoming";
        case PJSIP_INV_STATE_CALLING: return @"calling";
        case PJSIP_INV_STATE_EARLY: return @"early";
        case PJSIP_INV_STATE_CONNECTING: return @"connecting";
        case PJSIP_INV_STATE_CONFIRMED: return onHold ? @"held" : @"confirmed";
        default: return @"disconnected";
    }
}

/** "Name" <sip:1001@realm> → number / display name */
void ParseUri(const std::string &uri, NSString **number, NSString **name) {
    *number = @"";
    *name = @"";
    NSString *s = [NSString stringWithUTF8String:uri.c_str()];
    if (s == nil) return;
    NSRange lt = [s rangeOfString:@"<"];
    if (lt.location != NSNotFound && lt.location > 0) {
        NSString *raw = [[s substringToIndex:lt.location] stringByTrimmingCharactersInSet:
                         [NSCharacterSet characterSetWithCharactersInString:@" \""]];
        *name = raw;
    }
    NSRange colon = [s rangeOfString:@"sip:"];
    if (colon.location == NSNotFound) colon = [s rangeOfString:@"sips:"];
    if (colon.location != NSNotFound) {
        NSString *tail = [s substringFromIndex:colon.location + colon.length];
        NSCharacterSet *stop = [NSCharacterSet characterSetWithCharactersInString:@"@>;"];
        NSRange end = [tail rangeOfCharacterFromSet:stop];
        *number = end.location == NSNotFound ? tail : [tail substringToIndex:end.location];
    }
}

}  // namespace

// ─────────────────────────────────────────────── pjsua2 子类

class OmniIosCall;
class OmniIosAccount;

/** C++ 侧回调的落点，指回 OmniSipCore 实例 */
static __weak OmniSipCore *gCore = nil;

@interface OmniSipCore ()
- (void)onRegState:(NSString *)state code:(int)code reason:(NSString *)reason registrationId:(NSString *)registrationId;
- (void)onIncoming:(OmniIosCall *)call;
- (void)unregisterOnSipQueue;
- (void)onCallState:(OmniIosCall *)call;
- (void)onMedia:(OmniIosCall *)call;
- (void)trackCall:(OmniIosCall *)call;
- (void)untrackCall:(OmniIosCall *)call;
@end

class OmniIosCall : public Call {
public:
    OmniIosCall(Account &acc, int call_id = PJSUA_INVALID_ID) : Call(acc, call_id) {}

    NSString *key() { return [NSString stringWithFormat:@"%d", getId()]; }

    NSDictionary *snapshot() {
        CallInfo ci;
        try {
            ci = getInfo();
        } catch (...) {
            return @{};
        }
        NSString *number = nil;
        NSString *name = nil;
        ParseUri(ci.remoteUri, &number, &name);
        return @{
            @"callId": key(),
            @"sipCallId": [NSString stringWithUTF8String:ci.callIdString.c_str()] ?: @"",
            @"remoteNumber": number ?: @"",
            @"remoteDisplayName": name ?: @"",
            @"direction": ci.role == PJSIP_ROLE_UAS ? @"inbound" : @"outbound",
            @"state": MapCallState(ci),
            @"connectedAt": @(connectedAtMs),
        };
    }

    void onCallState(OnCallStateParam &prm) override {
        CallInfo ci;
        try {
            ci = getInfo();
        } catch (...) {
            return;
        }
        if (ci.state == PJSIP_INV_STATE_CONFIRMED && connectedAtMs == 0) {
            connectedAtMs = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
        }
        [gCore onCallState:this];
        if (ci.state == PJSIP_INV_STATE_DISCONNECTED) {
            detachAudio();
            [gCore untrackCall:this];
            // pjsua2 要求 DISCONNECTED 之后释放对象，否则 native 侧泄漏
            delete this;
        }
    }

    void onCallMediaState(OnCallMediaStateParam &prm) override {
        CallInfo ci;
        try {
            ci = getInfo();
        } catch (...) {
            return;
        }
        for (unsigned i = 0; i < ci.media.size(); i++) {
            if (ci.media[i].type != PJMEDIA_TYPE_AUDIO) continue;
            if (ci.media[i].status != PJSUA_CALL_MEDIA_ACTIVE) continue;
            try {
                audioMedia = getAudioMedia(i);
                hasAudio = true;
                AudDevManager &mgr = Endpoint::instance().audDevManager();
                audioMedia.startTransmit(mgr.getPlaybackDevMedia());
                if (!muted) mgr.getCaptureDevMedia().startTransmit(audioMedia);
            } catch (Error &err) {
                NSLog(@"[OmniSip] connect audio failed: %s", err.info().c_str());
            }
        }
        [gCore onMedia:this];
    }

    /** 本机静音：断开采集设备到通话的传输，不影响服务端录音 */
    void applyMute(bool on) {
        muted = on;
        if (!hasAudio) return;
        try {
            AudDevManager &mgr = Endpoint::instance().audDevManager();
            if (on) {
                mgr.getCaptureDevMedia().stopTransmit(audioMedia);
            } else {
                mgr.getCaptureDevMedia().startTransmit(audioMedia);
            }
        } catch (Error &err) {
            NSLog(@"[OmniSip] mute toggle failed: %s", err.info().c_str());
        }
    }

    void detachAudio() {
        if (!hasAudio) return;
        try {
            AudDevManager &mgr = Endpoint::instance().audDevManager();
            mgr.getCaptureDevMedia().stopTransmit(audioMedia);
            audioMedia.stopTransmit(mgr.getPlaybackDevMedia());
        } catch (...) {
        }
        hasAudio = false;
    }

    bool hasAudio = false;
    long long connectedAtMs = 0;

private:
    AudioMedia audioMedia;
    bool muted = false;
};

class OmniIosAccount : public Account {
public:
    const std::string registrationId;
    explicit OmniIosAccount(const std::string &id) : registrationId(id) {}
    void onRegState(OnRegStateParam &prm) override {
        int code = (int)prm.code;
        bool active = false;
        try {
            active = getInfo().regIsActive;
        } catch (...) {
        }
        NSString *state;
        if (active && code / 100 == 2) {
            state = kRegRegistered;
        } else if (code / 100 == 2) {
            state = kRegUnregistered;  // 注销成功也是 2xx
        } else {
            state = kRegFailed;
        }
        [gCore onRegState:state code:code reason:[NSString stringWithUTF8String:prm.reason.c_str()] ?: @"" registrationId:[NSString stringWithUTF8String:registrationId.c_str()]];
    }

    void onIncomingCall(OnIncomingCallParam &prm) override {
        OmniIosCall *call = new OmniIosCall(*this, prm.callId);
        [gCore trackCall:call];
        [gCore onIncoming:call];
    }
};

// ─────────────────────────────────────────────── Objective-C 实现

@implementation OmniSipCore {
    Endpoint *_ep;
    OmniIosAccount *_account;
    std::map<std::string, OmniIosCall *> _calls;
    dispatch_queue_t _queue;
    NSDictionary *_lastConfig;
    BOOL _started;
}

@synthesize registrationState = _registrationState;
@synthesize muted = _muted;

+ (OmniSipCore *)shared {
    static OmniSipCore *instance = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        instance = [[OmniSipCore alloc] init];
        gCore = instance;
    });
    return instance;
}

- (instancetype)init {
    if (self = [super init]) {
        _queue = dispatch_queue_create("com.smcloud.omnisip.pjsip", DISPATCH_QUEUE_SERIAL);
        _registrationState = kRegUnregistered;
        _muted = NO;
    }
    return self;
}

- (NSError *)errorWithMessage:(NSString *)message {
    return [NSError errorWithDomain:@"OmniSip" code:-1 userInfo:@{NSLocalizedDescriptionKey: message}];
}

- (void)runSync:(void (^)(void))block {
    dispatch_sync(_queue, ^{
        if (self->_ep) {
            try {
                self->_ep->libRegisterThread("omnisip-ios");
            } catch (...) {
            }
        }
        block();
    });
}

// ------------------------------------------------------------- 生命周期

- (BOOL)registerWithConfig:(NSDictionary *)cfg error:(NSError **)error {
    __block NSString *failure = nil;
    [self runSync:^{
        try {
            if (!self->_ep) {
                self->_ep = new Endpoint();
                self->_ep->libCreate();
                EpConfig epCfg;
                epCfg.logConfig.level = 3;
                epCfg.logConfig.consoleLevel = 3;
                epCfg.uaConfig.userAgent = "OmniAgent-Mobile/1.0";
                epCfg.uaConfig.threadCnt = 1;
                epCfg.medConfig.clockRate = 16000;
                epCfg.medConfig.audioFramePtime = 20;
                epCfg.medConfig.ecTailLen = 200;
                self->_ep->libInit(epCfg);
            }

            NSString *transport = cfg[@"transport"] ?: @"tls";
            if (!self->_started) {
                TransportConfig tcfg;
                tcfg.port = 0;
                pjsip_transport_type_e type = PJSIP_TRANSPORT_TLS;
                if ([transport isEqualToString:@"udp"]) type = PJSIP_TRANSPORT_UDP;
                if ([transport isEqualToString:@"tcp"]) type = PJSIP_TRANSPORT_TCP;
                self->_ep->transportCreate(type, tcfg);
                self->_ep->libStart();
                [self applyCodecs:cfg[@"codecs"]];
                self->_started = YES;
            }

            NSString *username = cfg[@"username"];
            NSString *realm = cfg[@"realm"];
            NSString *host = cfg[@"proxyHost"];
            int port = [cfg[@"proxyPort"] intValue] ?: 5061;
            NSString *display = cfg[@"displayName"];

            AccountConfig accCfg;
            NSString *idUri = display.length > 0
                ? [NSString stringWithFormat:@"\"%@\" <sip:%@@%@>", display, username, realm]
                : [NSString stringWithFormat:@"sip:%@@%@", username, realm];
            NSString *registrar = [NSString stringWithFormat:@"sip:%@:%d;transport=%@", host, port, transport];
            accCfg.idUri = idUri.UTF8String;
            accCfg.regConfig.registrarUri = registrar.UTF8String;
            accCfg.regConfig.timeoutSec = [cfg[@"registerExpiresS"] intValue] ?: 300;
            accCfg.regConfig.retryIntervalSec = 10;
            accCfg.regConfig.firstRetryIntervalSec = 5;
            accCfg.sipConfig.authCreds.push_back(
                AuthCredInfo("digest", realm.UTF8String, username.UTF8String, 0,
                             [cfg[@"password"] UTF8String]));
            accCfg.sipConfig.proxies.push_back(registrar.UTF8String);
            NSString *srtp = cfg[@"srtp"] ?: @"required";
            accCfg.mediaConfig.srtpUse = [srtp isEqualToString:@"required"] ? PJMEDIA_SRTP_MANDATORY
                : ([srtp isEqualToString:@"disabled"] ? PJMEDIA_SRTP_DISABLED : PJMEDIA_SRTP_OPTIONAL);
            accCfg.mediaConfig.srtpSecureSignaling = [transport isEqualToString:@"tls"] ? 1 : 0;
            accCfg.natConfig.iceEnabled = [cfg[@"iceEnabled"] boolValue];

            if (!self->_calls.empty()) throw Error(PJ_EBUSY, "register", "当前仍有活动通话，禁止重新注册", __FILE__, __LINE__);
            NSString *registrationId = cfg[@"registrationId"] ?: @"";
            self->_lastConfig = [cfg copy];
            self->_registrationState = kRegRegistering;
            dispatch_async(dispatch_get_main_queue(), ^{
                [self.delegate sipRegistrationChanged:kRegRegistering code:0 reason:@"" registrationId:registrationId];
            });

            std::string attempt = registrationId.UTF8String;
            if (self->_account && self->_account->registrationId == attempt) {
                self->_account->modify(accCfg);
                self->_account->setRegistration(true);
            } else {
                OmniIosAccount *previous = self->_account;
                if (previous) { AccountShutdownParam shutdown; shutdown.force = false; previous->shutdown2(shutdown); }
                self->_account = nullptr;
                delete previous;
                self->_account = new OmniIosAccount(attempt);
                self->_account->create(accCfg);
            }
        } catch (Error &err) {
            failure = [NSString stringWithUTF8String:err.info().c_str()];
        }
    }];
    if (failure) {
        if (error) *error = [self errorWithMessage:failure];
        return NO;
    }
    return YES;
}

/** 按服务端下发的顺序设置编解码优先级，未列出的降到 0 */
- (void)applyCodecs:(NSArray<NSString *> *)codecs {
    if (codecs.count == 0) return;
    try {
        CodecInfoVector2 infos = _ep->codecEnum2();
        for (auto &info : infos) {
            NSString *codecId = [NSString stringWithUTF8String:info.codecId.c_str()];
            NSUInteger idx = NSNotFound;
            for (NSUInteger i = 0; i < codecs.count; i++) {
                if ([codecId.lowercaseString hasPrefix:codecs[i].lowercaseString]) {
                    idx = i;
                    break;
                }
            }
            int priority = idx == NSNotFound ? 0 : MAX(1, 255 - (int)idx * 10);
            _ep->codecSetPriority(info.codecId, (pj_uint8_t)priority);
        }
    } catch (Error &err) {
        NSLog(@"[OmniSip] applyCodecs failed: %s", err.info().c_str());
    }
}

- (void)unregisterOnSipQueue {
    for (auto &pair : self->_calls) {
        try {
            CallOpParam prm(true);
            pair.second->hangup(prm);
        } catch (...) {
        }
    }
    self->_calls.clear();
    if (self->_account) {
        try {
            self->_account->setRegistration(false);
        } catch (...) {
        }
        delete self->_account;
        self->_account = nullptr;
    }
    NSString *registrationId = self->_lastConfig[@"registrationId"] ?: @"";
    self->_lastConfig = nil;
    self->_registrationState = kRegUnregistered;
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.delegate sipRegistrationChanged:kRegUnregistered code:0 reason:@"manual" registrationId:registrationId];
    });
}

- (void)unregisterAccount {
    [self runSync:^{ [self unregisterOnSipQueue]; }];
}

- (BOOL)unregisterRegistration:(NSString *)registrationId error:(NSError **)error {
    __block NSString *failure = nil;
    [self runSync:^{
        if (!self->_account || self->_account->registrationId != std::string(registrationId.UTF8String)) return;
        if (!self->_calls.empty()) { failure = @"当前仍有活动通话，不能清理注册"; return; }
        try { AccountShutdownParam shutdown; shutdown.force = false; self->_account->shutdown2(shutdown); }
        catch (const Error &err) { failure = [NSString stringWithUTF8String:err.info().c_str()]; return; }
        [self unregisterOnSipQueue];
    }];
    if (failure) { if (error) *error = [self errorWithMessage:failure]; return NO; }
    return YES;
}

- (void)shutdown {
    [self runSync:^{
        if (!self->_ep) return;
        try {
            self->_ep->libDestroy();
        } catch (...) {
        }
        delete self->_ep;
        self->_ep = nullptr;
        self->_started = NO;
        self->_registrationState = kRegUnregistered;
    }];
}

// ------------------------------------------------------------------ 呼叫

- (nullable NSDictionary *)makeCall:(NSString *)number error:(NSError **)error {
    __block NSDictionary *snapshot = nil;
    __block NSString *failure = nil;
    [self runSync:^{
        if (!self->_account) {
            failure = @"分机未注册";
            return;
        }
        try {
            OmniIosCall *call = new OmniIosCall(*self->_account);
            NSString *realm = self->_lastConfig[@"realm"] ?: @"";
            NSString *uri = [number hasPrefix:@"sip:"]
                ? number
                : [NSString stringWithFormat:@"sip:%@@%@", number, realm];
            CallOpParam prm(true);
            call->makeCall(uri.UTF8String, prm);
            self->_calls[call->key().UTF8String] = call;
            snapshot = call->snapshot();
        } catch (Error &err) {
            failure = [NSString stringWithUTF8String:err.info().c_str()];
        }
    }];
    if (failure) {
        if (error) *error = [self errorWithMessage:failure];
        return nil;
    }
    return snapshot;
}

- (OmniIosCall *)lookup:(NSString *)callId {
    auto it = _calls.find(callId.UTF8String);
    return it == _calls.end() ? nullptr : it->second;
}

- (BOOL)answerCall:(NSString *)callId error:(NSError **)error {
    __block NSString *failure = nil;
    [self runSync:^{
        OmniIosCall *call = [self lookup:callId];
        if (!call) {
            failure = @"呼叫已不存在";
            return;
        }
        try {
            CallOpParam prm;
            prm.statusCode = PJSIP_SC_OK;
            call->answer(prm);
        } catch (Error &err) {
            failure = [NSString stringWithUTF8String:err.info().c_str()];
        }
    }];
    if (failure) {
        if (error) *error = [self errorWithMessage:failure];
        return NO;
    }
    return YES;
}

- (BOOL)hangupCall:(NSString *)callId error:(NSError **)error {
    [self runSync:^{
        OmniIosCall *call = [self lookup:callId];
        if (!call) return;
        try {
            CallOpParam prm(true);
            call->hangup(prm);
        } catch (...) {
        }
    }];
    return YES;
}

- (BOOL)holdCall:(NSString *)callId on:(BOOL)on error:(NSError **)error {
    __block NSString *failure = nil;
    [self runSync:^{
        OmniIosCall *call = [self lookup:callId];
        if (!call) {
            failure = @"呼叫已不存在";
            return;
        }
        try {
            CallOpParam prm(true);
            if (on) {
                call->setHold(prm);
            } else {
                prm.opt.flag = PJSUA_CALL_UNHOLD;
                call->reinvite(prm);
            }
        } catch (Error &err) {
            failure = [NSString stringWithUTF8String:err.info().c_str()];
        }
    }];
    if (failure) {
        if (error) *error = [self errorWithMessage:failure];
        return NO;
    }
    return YES;
}

- (BOOL)setMuted:(BOOL)on error:(NSError **)error {
    [self runSync:^{
        self->_muted = on;
        for (auto &pair : self->_calls) {
            pair.second->applyMute(on);
        }
    }];
    return YES;
}

- (BOOL)sendDtmf:(NSString *)digits callId:(nullable NSString *)callId error:(NSError **)error {
    __block NSString *failure = nil;
    [self runSync:^{
        OmniIosCall *call = callId ? [self lookup:callId] : nullptr;
        if (!call && !self->_calls.empty()) call = self->_calls.begin()->second;
        if (!call) {
            failure = @"没有通话中的呼叫";
            return;
        }
        try {
            // RFC2833 带内信号，与 Android 侧保持一致
            call->dialDtmf(digits.UTF8String);
        } catch (Error &err) {
            failure = [NSString stringWithUTF8String:err.info().c_str()];
        }
    }];
    if (failure) {
        if (error) *error = [self errorWithMessage:failure];
        return NO;
    }
    return YES;
}

- (NSArray<NSDictionary *> *)activeCalls {
    NSMutableArray *result = [NSMutableArray array];
    [self runSync:^{
        for (auto &pair : self->_calls) {
            NSDictionary *snap = pair.second->snapshot();
            if (snap.count > 0) [result addObject:snap];
        }
    }];
    return result;
}

- (void)audioSessionActivated:(BOOL)activated {
    [self runSync:^{
        if (!self->_ep) return;
        try {
            // CallKit 激活/释放音频会话后重挂音频设备，否则会双向无声
            AudDevManager &mgr = self->_ep->audDevManager();
            if (activated) {
                mgr.setOutputVolume(100, true);
            }
        } catch (...) {
        }
    }];
}

- (BOOL)reRegisterIfPossible {
    if (!_lastConfig) return NO;
    return [self registerWithConfig:_lastConfig error:nil];
}

- (BOOL)hasCredentials {
    return _lastConfig != nil;
}

// -------------------------------------------------- C++ 回调转 Objective-C

- (void)trackCall:(OmniIosCall *)call {
    _calls[call->key().UTF8String] = call;
    if (_muted) call->applyMute(true);
}

- (void)untrackCall:(OmniIosCall *)call {
    _calls.erase(call->key().UTF8String);
}

- (void)onRegState:(NSString *)state code:(int)code reason:(NSString *)reason registrationId:(NSString *)registrationId {
    if (![_lastConfig[@"registrationId"] isEqualToString:registrationId]) return;
    _registrationState = state;
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.delegate sipRegistrationChanged:state code:code reason:reason registrationId:registrationId];
    });
}

- (void)onIncoming:(OmniIosCall *)call {
    NSDictionary *snap = call->snapshot();
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.delegate sipIncomingCall:snap];
    });
}

- (void)onCallState:(OmniIosCall *)call {
    NSDictionary *snap = call->snapshot();
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.delegate sipCallStateChanged:snap];
    });
}

- (void)onMedia:(OmniIosCall *)call {
    NSDictionary *snap = call->snapshot();
    BOOL hasAudio = call->hasAudio;
    BOOL isMuted = _muted;
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.delegate sipMediaStateChanged:@{
            @"callId": snap[@"callId"] ?: @"",
            @"localAudio": @(hasAudio && !isMuted),
            @"remoteAudio": @(hasAudio),
            @"muted": @(isMuted),
        }];
    });
}

@end

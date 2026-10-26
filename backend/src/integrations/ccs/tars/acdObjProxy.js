// Minimal client proxy for SMC-ICC.ACDServer.ACDObj (generated-style, one method).
/* eslint-disable */
"use strict";

var TarsStream = require("@tars/stream");
var TarsError = require("@tars/rpc").error;
var _ACD_STRUCT = require("./acd_structTars.js");
var _BASE = require("./baseTars.js");
if (_BASE && _BASE.smc_icc && _BASE.smc_icc.stCommRsp_t) {
    _ACD_STRUCT.smc_icc.stCommRsp_t = _BASE.smc_icc.stCommRsp_t;
}
var _makeError = function (data, message, type) {
    var error = new Error(message || "");
    error.request = data.request;
    error.response = { costtime: data.request.costtime };
    if (type === TarsError.CLIENT.DECODE_ERROR) {
        error.name = "DECODE_ERROR";
        error.response.error = { code: type, message: message };
    } else {
        error.name = "RPC_ERROR";
        error.response.error = data.error;
    }
    return error;
};

var smc_icc = smc_icc || {};
module.exports.smc_icc = smc_icc;

smc_icc.acdObjProxy = function () {
    this._name = undefined;
    this._worker = undefined;
};

smc_icc.acdObjProxy.prototype.setTimeout = function (iTimeout) {
    this._worker.timeout = iTimeout;
};
smc_icc.acdObjProxy.prototype.getTimeout = function () {
    return this._worker.timeout;
};
smc_icc.acdObjProxy.prototype.setVersion = function (iVersion) {
    this._worker.version = iVersion;
};
smc_icc.acdObjProxy.prototype.getVersion = function () {
    return this._worker.version;
};

var __DoACDRequestCallQueueList$IF = {
    name: "DoACDRequestCallQueueList",
    return: "int32",
    arguments: [{
        name: "req",
        class: "smc_icc.stACDRequestCallQueueList_t",
        direction: "in"
    }, {
        name: "rsp",
        class: "smc_icc.stACDRequestCallQueueListAck_t",
        direction: "out"
    }]
};

var __DoACDRequestCallQueueList$IE = function (req) {
    var os = new TarsStream.TarsOutputStream();
    os.writeStruct(1, req);
    return os.getBinBuffer();
};

var __DoACDRequestCallQueueList$ID = function (data) {
    try {
        var is = new TarsStream.TarsInputStream(data.response.sBuffer);
        return {
            request: data.request,
            response: {
                costtime: data.request.costtime,
                return: is.readInt32(0, true, 0),
                arguments: {
                    rsp: is.readStruct(2, true, _ACD_STRUCT.smc_icc.stACDRequestCallQueueListAck_t)
                }
            }
        };
    } catch (e) {
        throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
    }
};

var __DoACDRequestCallQueueList$PE = function (req, version) {
    var tup = new TarsStream.UniAttribute();
    tup.tupVersion = version;
    tup.writeStruct("req", req);
    return tup;
};

var __DoACDRequestCallQueueList$PD = function (data) {
    try {
        var tup = data.response.tup;
        return {
            request: data.request,
            response: {
                costtime: data.request.costtime,
                return: tup.readInt32("", 0),
                arguments: {
                    rsp: tup.readStruct("rsp", _ACD_STRUCT.smc_icc.stACDRequestCallQueueListAck_t)
                }
            }
        };
    } catch (e) {
        throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
    }
};

var __DoACDRequestCallQueueList$ER = function (data) {
    throw _makeError(data, "Call acd::DoACDRequestCallQueueList failed");
};

smc_icc.acdObjProxy.prototype.DoACDRequestCallQueueList = function (req) {
    var version = this._worker.version;
    if (version === TarsStream.Tup.TUP_SIMPLE || version === TarsStream.Tup.TUP_COMPLEX) {
        return this._worker.tup_invoke(
            "DoACDRequestCallQueueList",
            __DoACDRequestCallQueueList$PE(req, version),
            arguments[arguments.length - 1],
            __DoACDRequestCallQueueList$IF
        ).then(__DoACDRequestCallQueueList$PD, __DoACDRequestCallQueueList$ER);
    }
    return this._worker.tars_invoke(
        "DoACDRequestCallQueueList",
        __DoACDRequestCallQueueList$IE(req),
        arguments[arguments.length - 1],
        __DoACDRequestCallQueueList$IF
    ).then(__DoACDRequestCallQueueList$ID, __DoACDRequestCallQueueList$ER);
};
smc_icc.acdObjProxy.DoACDRequestCallQueueList = __DoACDRequestCallQueueList$IF;

// ── DoRing (CCS/Omni → ACD 排队) ──
var __DoRing$IF = {
    name: "DoRing",
    return: "int32",
    arguments: [{
        name: "ACDRing",
        class: "smc_icc.stACDRing_t",
        direction: "in"
    }, {
        name: "rsp",
        class: "smc_icc.stCommRsp_t",
        direction: "out"
    }]
};
var __DoRing$IE = function (req) {
    var os = new TarsStream.TarsOutputStream();
    os.writeStruct(1, req);
    return os.getBinBuffer();
};
var __DoRing$ID = function (data) {
    try {
        var is = new TarsStream.TarsInputStream(data.response.sBuffer);
        var out = {
            request: data.request,
            response: {
                costtime: data.request.costtime,
                return: is.readInt32(0, true, 0),
                arguments: {}
            }
        };
        try {
            out.response.arguments.rsp = is.readStruct(2, false, _ACD_STRUCT.smc_icc.stCommRsp_t);
        } catch (_e) {}
        return out;
    } catch (e) {
        throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
    }
};
var __DoRing$PE = function (req, version) {
    var tup = new TarsStream.UniAttribute();
    tup.tupVersion = version;
    tup.writeStruct("ACDRing", req);
    return tup;
};
var __DoRing$PD = function (data) {
    try {
        var tup = data.response.tup;
        var out = {
            request: data.request,
            response: {
                costtime: data.request.costtime,
                return: tup.readInt32("", 0),
                arguments: {}
            }
        };
        try {
            out.response.arguments.rsp = tup.readStruct("rsp", _ACD_STRUCT.smc_icc.stCommRsp_t);
        } catch (_e) {}
        return out;
    } catch (e) {
        throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
    }
};
var __DoRing$ER = function (data) {
    throw _makeError(data, "Call acd::DoRing failed");
};
smc_icc.acdObjProxy.prototype.DoRing = function (req) {
    var version = this._worker.version;
    if (version === TarsStream.Tup.TUP_SIMPLE || version === TarsStream.Tup.TUP_COMPLEX) {
        return this._worker.tup_invoke("DoRing", __DoRing$PE(req, version), arguments[arguments.length - 1], __DoRing$IF)
            .then(__DoRing$PD, __DoRing$ER);
    }
    return this._worker.tars_invoke("DoRing", __DoRing$IE(req), arguments[arguments.length - 1], __DoRing$IF)
        .then(__DoRing$ID, __DoRing$ER);
};
smc_icc.acdObjProxy.DoRing = __DoRing$IF;

// ── DoRequestACDCancel ──
var __DoRequestACDCancel$IF = {
    name: "DoRequestACDCancel",
    return: "int32",
    arguments: [{
        name: "ACDRequestACDCancel",
        class: "smc_icc.stACDRequestACDCancel_t",
        direction: "in"
    }, {
        name: "rsp",
        class: "smc_icc.stCommRsp_t",
        direction: "out"
    }]
};
var __DoRequestACDCancel$IE = function (req) {
    var os = new TarsStream.TarsOutputStream();
    os.writeStruct(1, req);
    return os.getBinBuffer();
};
var __DoRequestACDCancel$ID = function (data) {
    try {
        var is = new TarsStream.TarsInputStream(data.response.sBuffer);
        var out = {
            request: data.request,
            response: {
                costtime: data.request.costtime,
                return: is.readInt32(0, true, 0),
                arguments: {}
            }
        };
        try {
            out.response.arguments.rsp = is.readStruct(2, false, _ACD_STRUCT.smc_icc.stCommRsp_t);
        } catch (_e) {}
        return out;
    } catch (e) {
        throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
    }
};
var __DoRequestACDCancel$PE = function (req, version) {
    var tup = new TarsStream.UniAttribute();
    tup.tupVersion = version;
    tup.writeStruct("ACDRequestACDCancel", req);
    return tup;
};
var __DoRequestACDCancel$PD = function (data) {
    try {
        var tup = data.response.tup;
        var out = {
            request: data.request,
            response: {
                costtime: data.request.costtime,
                return: tup.readInt32("", 0),
                arguments: {}
            }
        };
        try {
            out.response.arguments.rsp = tup.readStruct("rsp", _ACD_STRUCT.smc_icc.stCommRsp_t);
        } catch (_e) {}
        return out;
    } catch (e) {
        throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
    }
};
var __DoRequestACDCancel$ER = function (data) {
    throw _makeError(data, "Call acd::DoRequestACDCancel failed");
};
smc_icc.acdObjProxy.prototype.DoRequestACDCancel = function (req) {
    var version = this._worker.version;
    if (version === TarsStream.Tup.TUP_SIMPLE || version === TarsStream.Tup.TUP_COMPLEX) {
        return this._worker.tup_invoke(
            "DoRequestACDCancel",
            __DoRequestACDCancel$PE(req, version),
            arguments[arguments.length - 1],
            __DoRequestACDCancel$IF
        ).then(__DoRequestACDCancel$PD, __DoRequestACDCancel$ER);
    }
    return this._worker.tars_invoke(
        "DoRequestACDCancel",
        __DoRequestACDCancel$IE(req),
        arguments[arguments.length - 1],
        __DoRequestACDCancel$IF
    ).then(__DoRequestACDCancel$ID, __DoRequestACDCancel$ER);
};
smc_icc.acdObjProxy.DoRequestACDCancel = __DoRequestACDCancel$IF;

function __bindAcdReqRsp(name, reqClassName) {
    var IF = {
        name: name,
        return: "int32",
        arguments: [{
            name: "req",
            class: reqClassName,
            direction: "in"
        }, {
            name: "rsp",
            class: "smc_icc.stCommRsp_t",
            direction: "out"
        }]
    };
    var IE = function (req) {
        var os = new TarsStream.TarsOutputStream();
        os.writeStruct(1, req);
        return os.getBinBuffer();
    };
    var ID = function (data) {
        try {
            var is = new TarsStream.TarsInputStream(data.response.sBuffer);
            var out = {
                request: data.request,
                response: {
                    costtime: data.request.costtime,
                    return: is.readInt32(0, true, 0),
                    arguments: {}
                }
            };
            try {
                out.response.arguments.rsp = is.readStruct(2, false, _ACD_STRUCT.smc_icc.stCommRsp_t);
            } catch (_e) {}
            return out;
        } catch (e) {
            throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
        }
    };
    var PE = function (req, version) {
        var tup = new TarsStream.UniAttribute();
        tup.tupVersion = version;
        tup.writeStruct("req", req);
        return tup;
    };
    var PD = function (data) {
        try {
            var tup = data.response.tup;
            var out = {
                request: data.request,
                response: {
                    costtime: data.request.costtime,
                    return: tup.readInt32("", 0),
                    arguments: {}
                }
            };
            try {
                out.response.arguments.rsp = tup.readStruct("rsp", _ACD_STRUCT.smc_icc.stCommRsp_t);
            } catch (_e) {}
            return out;
        } catch (e) {
            throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR);
        }
    };
    var ER = function (data) {
        throw _makeError(data, "Call acd::" + name + " failed");
    };
    smc_icc.acdObjProxy.prototype[name] = function (req) {
        var version = this._worker.version;
        if (version === TarsStream.Tup.TUP_SIMPLE || version === TarsStream.Tup.TUP_COMPLEX) {
            return this._worker.tup_invoke(name, PE(req, version), arguments[arguments.length - 1], IF)
                .then(PD, ER);
        }
        return this._worker.tars_invoke(name, IE(req), arguments[arguments.length - 1], IF)
            .then(ID, ER);
    };
    smc_icc.acdObjProxy[name] = IF;
}

__bindAcdReqRsp("DoACDAgentUpdateMediaQueuingMode", "smc_icc.stACDAgentUpdateMediaQueuingMode_t");
__bindAcdReqRsp("DoACDAgentUpdateCallerCount", "smc_icc.stACDAgentUpdateCallerCount_t");
__bindAcdReqRsp("DoACDAgentSessionReleased", "smc_icc.stACDAgentSessionReleased_t");
__bindAcdReqRsp("DoAgentSignInGroup", "smc_icc.stACDAgentSignInGroup_t");
__bindAcdReqRsp("DoAgentSignOutGroup", "smc_icc.stACDAgentSignOutGroup_t");
__bindAcdReqRsp("DoAgentSignInSkill", "smc_icc.stACDAgentSignInSkill_t");
__bindAcdReqRsp("DoAgentSignOutSkill", "smc_icc.stACDAgentSignOutSkill_t");
__bindAcdReqRsp("DoAgentStatusChangeEvt", "smc_icc.stACDAgentStatusChangeEvtEx_t");


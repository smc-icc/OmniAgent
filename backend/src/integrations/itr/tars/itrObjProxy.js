/* eslint-disable */
"use strict";

var TarsStream = require("@tars/stream");
var TarsError = require("@tars/rpc").error;
var _ITR_STRUCT = require("./itr_structTars.js");

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

smc_icc.itrObjProxy = function () {
    this._name = undefined;
    this._worker = undefined;
};
smc_icc.itrObjProxy.prototype.setTimeout = function (iTimeout) {
    this._worker.timeout = iTimeout;
};
smc_icc.itrObjProxy.prototype.getTimeout = function () {
    return this._worker.timeout;
};

function decodeCommRsp(data) {
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
        out.response.arguments.rsp = is.readStruct(2, false, _ITR_STRUCT.smc_icc.stITRCommRsp);
    } catch (_e) {}
    return out;
}

function encodeStruct(req) {
    var os = new TarsStream.TarsOutputStream();
    os.writeStruct(1, req);
    return os.getBinBuffer();
}

// ── StartSession ──
var __StartSession$IF = {
    name: "StartSession",
    return: "int32",
    arguments: [
        { name: "req", class: "smc_icc.stITRStartReq", direction: "in" },
        { name: "rsp", class: "smc_icc.stITRCommRsp", direction: "out" }
    ]
};
smc_icc.itrObjProxy.prototype.StartSession = function (req) {
    return this._worker.tars_invoke("StartSession", encodeStruct(req), arguments[arguments.length - 1], __StartSession$IF)
        .then(function (data) {
            try { return decodeCommRsp(data); }
            catch (e) { throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR); }
        }, function (data) { throw _makeError(data, "Call itr::StartSession failed"); });
};
smc_icc.itrObjProxy.StartSession = __StartSession$IF;

// ── OnMessage ──
var __OnMessage$IF = {
    name: "OnMessage",
    return: "int32",
    arguments: [
        { name: "req", class: "smc_icc.stITRMessageReq", direction: "in" },
        { name: "rsp", class: "smc_icc.stITRCommRsp", direction: "out" }
    ]
};
smc_icc.itrObjProxy.prototype.OnMessage = function (req) {
    return this._worker.tars_invoke("OnMessage", encodeStruct(req), arguments[arguments.length - 1], __OnMessage$IF)
        .then(function (data) {
            try { return decodeCommRsp(data); }
            catch (e) { throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR); }
        }, function (data) { throw _makeError(data, "Call itr::OnMessage failed"); });
};
smc_icc.itrObjProxy.OnMessage = __OnMessage$IF;

// ── EndSession ──
var __EndSession$IF = {
    name: "EndSession",
    return: "int32",
    arguments: [
        { name: "conversationId", class: "string", direction: "in" },
        { name: "rsp", class: "smc_icc.stITRCommRsp", direction: "out" }
    ]
};
smc_icc.itrObjProxy.prototype.EndSession = function (conversationId) {
    var os = new TarsStream.TarsOutputStream();
    os.writeString(1, conversationId);
    return this._worker.tars_invoke("EndSession", os.getBinBuffer(), arguments[arguments.length - 1], __EndSession$IF)
        .then(function (data) {
            try { return decodeCommRsp(data); }
            catch (e) { throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR); }
        }, function (data) { throw _makeError(data, "Call itr::EndSession failed"); });
};
smc_icc.itrObjProxy.EndSession = __EndSession$IF;

// ── Ping ──
var __Ping$IF = {
    name: "Ping",
    return: "int32",
    arguments: [
        { name: "rsp", class: "smc_icc.stITRCommRsp", direction: "out" }
    ]
};
smc_icc.itrObjProxy.prototype.Ping = function () {
    var os = new TarsStream.TarsOutputStream();
    return this._worker.tars_invoke("Ping", os.getBinBuffer(), arguments[arguments.length - 1], __Ping$IF)
        .then(function (data) {
            try { return decodeCommRsp(data); }
            catch (e) { throw _makeError(data, e.message, TarsError.CLIENT.DECODE_ERROR); }
        }, function (data) { throw _makeError(data, "Call itr::Ping failed"); });
};
smc_icc.itrObjProxy.Ping = __Ping$IF;

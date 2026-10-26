/* eslint-disable */
"use strict";

var TarsStream = require("@tars/stream");
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var smc_icc = smc_icc || {};
module.exports.smc_icc = smc_icc;

smc_icc.stITRStartReq = function () {
    this.conversationId = "";
    this.contactId = "";
    this.channelType = "";
    this.inboxId = 0;
    this.flowId = 0;
    this.vdnId = 0;
    this.callerId = "";
    this.metaJson = "";
    this._classname = "smc_icc.stITRStartReq";
};
smc_icc.stITRStartReq._classname = "smc_icc.stITRStartReq";
smc_icc.stITRStartReq._write = function (os, tag, value) { os.writeStruct(tag, value); };
smc_icc.stITRStartReq._read = function (is, tag, def) { return is.readStruct(tag, true, def); };
smc_icc.stITRStartReq._readFrom = function (is) {
    var tmp = new smc_icc.stITRStartReq();
    tmp.conversationId = is.readString(0, true, "");
    tmp.contactId = is.readString(1, true, "");
    tmp.channelType = is.readString(2, true, "");
    tmp.inboxId = is.readInt32(3, true, 0);
    tmp.flowId = is.readInt32(4, true, 0);
    tmp.vdnId = is.readInt32(5, true, 0);
    tmp.callerId = is.readString(6, true, "");
    tmp.metaJson = is.readString(7, false, "");
    return tmp;
};
smc_icc.stITRStartReq.prototype._writeTo = function (os) {
    os.writeString(0, this.conversationId);
    os.writeString(1, this.contactId);
    os.writeString(2, this.channelType);
    os.writeInt32(3, this.inboxId);
    os.writeInt32(4, this.flowId);
    os.writeInt32(5, this.vdnId);
    os.writeString(6, this.callerId);
    os.writeString(7, this.metaJson || "");
};
smc_icc.stITRStartReq.prototype.toObject = function () {
    return {
        conversationId: this.conversationId,
        contactId: this.contactId,
        channelType: this.channelType,
        inboxId: this.inboxId,
        flowId: this.flowId,
        vdnId: this.vdnId,
        callerId: this.callerId,
        metaJson: this.metaJson
    };
};
smc_icc.stITRStartReq.prototype.readFromObject = function (json) {
    _hasOwnProperty.call(json, "conversationId") && (this.conversationId = json.conversationId);
    _hasOwnProperty.call(json, "contactId") && (this.contactId = json.contactId);
    _hasOwnProperty.call(json, "channelType") && (this.channelType = json.channelType);
    _hasOwnProperty.call(json, "inboxId") && (this.inboxId = json.inboxId);
    _hasOwnProperty.call(json, "flowId") && (this.flowId = json.flowId);
    _hasOwnProperty.call(json, "vdnId") && (this.vdnId = json.vdnId);
    _hasOwnProperty.call(json, "callerId") && (this.callerId = json.callerId);
    _hasOwnProperty.call(json, "metaJson") && (this.metaJson = json.metaJson);
    return this;
};
smc_icc.stITRStartReq.new = function () { return new smc_icc.stITRStartReq(); };

smc_icc.stITRMessageReq = function () {
    this.conversationId = "";
    this.content = "";
    this.contentType = "text";
    this.metaJson = "";
    this._classname = "smc_icc.stITRMessageReq";
};
smc_icc.stITRMessageReq._classname = "smc_icc.stITRMessageReq";
smc_icc.stITRMessageReq._write = function (os, tag, value) { os.writeStruct(tag, value); };
smc_icc.stITRMessageReq._read = function (is, tag, def) { return is.readStruct(tag, true, def); };
smc_icc.stITRMessageReq._readFrom = function (is) {
    var tmp = new smc_icc.stITRMessageReq();
    tmp.conversationId = is.readString(0, true, "");
    tmp.content = is.readString(1, true, "");
    tmp.contentType = is.readString(2, false, "text");
    tmp.metaJson = is.readString(3, false, "");
    return tmp;
};
smc_icc.stITRMessageReq.prototype._writeTo = function (os) {
    os.writeString(0, this.conversationId);
    os.writeString(1, this.content);
    os.writeString(2, this.contentType || "text");
    os.writeString(3, this.metaJson || "");
};
smc_icc.stITRMessageReq.prototype.toObject = function () {
    return {
        conversationId: this.conversationId,
        content: this.content,
        contentType: this.contentType,
        metaJson: this.metaJson
    };
};
smc_icc.stITRMessageReq.prototype.readFromObject = function (json) {
    _hasOwnProperty.call(json, "conversationId") && (this.conversationId = json.conversationId);
    _hasOwnProperty.call(json, "content") && (this.content = json.content);
    _hasOwnProperty.call(json, "contentType") && (this.contentType = json.contentType);
    _hasOwnProperty.call(json, "metaJson") && (this.metaJson = json.metaJson);
    return this;
};
smc_icc.stITRMessageReq.new = function () { return new smc_icc.stITRMessageReq(); };

smc_icc.stITRCommRsp = function () {
    this.result = 0;
    this.message = "ok";
    this.state = "";
    this.payloadJson = "";
    this._classname = "smc_icc.stITRCommRsp";
};
smc_icc.stITRCommRsp._classname = "smc_icc.stITRCommRsp";
smc_icc.stITRCommRsp._write = function (os, tag, value) { os.writeStruct(tag, value); };
smc_icc.stITRCommRsp._read = function (is, tag, def) { return is.readStruct(tag, true, def); };
smc_icc.stITRCommRsp._readFrom = function (is) {
    var tmp = new smc_icc.stITRCommRsp();
    tmp.result = is.readInt32(0, true, 0);
    tmp.message = is.readString(1, true, "");
    tmp.state = is.readString(2, false, "");
    tmp.payloadJson = is.readString(3, false, "");
    return tmp;
};
smc_icc.stITRCommRsp.prototype._writeTo = function (os) {
    os.writeInt32(0, this.result);
    os.writeString(1, this.message || "");
    os.writeString(2, this.state || "");
    os.writeString(3, this.payloadJson || "");
};
smc_icc.stITRCommRsp.prototype.toObject = function () {
    return {
        result: this.result,
        message: this.message,
        state: this.state,
        payloadJson: this.payloadJson
    };
};
smc_icc.stITRCommRsp.prototype.readFromObject = function (json) {
    _hasOwnProperty.call(json, "result") && (this.result = json.result);
    _hasOwnProperty.call(json, "message") && (this.message = json.message);
    _hasOwnProperty.call(json, "state") && (this.state = json.state);
    _hasOwnProperty.call(json, "payloadJson") && (this.payloadJson = json.payloadJson);
    return this;
};
smc_icc.stITRCommRsp.new = function () { return new smc_icc.stITRCommRsp(); };

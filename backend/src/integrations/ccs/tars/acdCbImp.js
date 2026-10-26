/**
 * Minimal TARS Imp for ccs.tars::interface acd (ACD → Omni callbacks).
 * Only the Ring/Cancel/Finish path is handled; other OnACD* are no-op stubs.
 */
'use strict';

const assert = require('assert');
const TarsStream = require('@tars/stream');
const TarsError = require('@tars/rpc').error;
const base = require('./baseTars');
const acdStruct = require('./acd_structTars');

const smc_icc = {};
module.exports.smc_icc = smc_icc;

const CommRsp = base.smc_icc.stCommRsp_t;
const S = acdStruct.smc_icc;

smc_icc.acdCbImp = function () {
  this._name = undefined;
  this._worker = undefined;
};

smc_icc.acdCbImp.prototype.initialize = function () {};

smc_icc.acdCbImp.prototype.onDispatch = function (current, funcName, binBuffer) {
  if ('__' + funcName in this) {
    return this['__' + funcName](current, binBuffer);
  }
  return TarsError.SERVER.FUNC_NOT_FOUND;
};

function makeRE() {
  return function (_ret, rsp) {
    if (
      this.getRequestVersion() === TarsStream.Tup.TUP_SIMPLE ||
      this.getRequestVersion() === TarsStream.Tup.TUP_COMPLEX
    ) {
      const tup = new TarsStream.UniAttribute();
      tup.tupVersion = this.getRequestVersion();
      tup.writeInt32('', _ret);
      tup.writeStruct('rsp', rsp);
      this.doResponse(tup.encode());
    } else {
      const os = new TarsStream.TarsOutputStream();
      os.writeInt32(0, _ret);
      os.writeStruct(2, rsp);
      this.doResponse(os.getBinBuffer());
    }
  };
}

function bindMethod(name, Struct) {
  smc_icc.acdCbImp.prototype[name] = function () {
    assert.fail(name + ' function not implemented');
  };
  const re = makeRE();
  smc_icc.acdCbImp.prototype['__' + name] = function (current, binBuffer) {
    let req = null;
    let rsp = null;
    if (
      current.getRequestVersion() === TarsStream.Tup.TUP_SIMPLE ||
      current.getRequestVersion() === TarsStream.Tup.TUP_COMPLEX
    ) {
      const tup = new TarsStream.UniAttribute();
      tup.tupVersion = current.getRequestVersion();
      tup.decode(binBuffer);
      req = tup.readStruct('req', Struct);
      rsp = tup.readStruct('rsp', CommRsp, new CommRsp());
    } else {
      const is = new TarsStream.TarsInputStream(binBuffer);
      req = is.readStruct(1, true, Struct);
      rsp = is.readStruct(2, false, CommRsp);
    }
    if (!rsp) rsp = new CommRsp();
    current.sendResponse = re;
    this[name](current, req, rsp);
    return TarsError.SUCCESS;
  };
}

smc_icc.acdCbImp.prototype.__tars_ping = function (current) {
  makeRE().call(current, 0, new CommRsp());
  return TarsError.SUCCESS;
};

bindMethod('OnACDAgentSignInGroupAck', S.stACDAgentSignInGroupAck_t);
bindMethod('OnACDAgentSignOutGroupAck', S.stACDAgentSignOutGroupAck_t);
bindMethod('OnACDAgentSignInSkillAck', S.stACDAgentSignInSkillAck_t);
bindMethod('OnACDAgentSignOutSkillAck', S.stACDAgentSignOutSkillAck_t);
bindMethod('OnACDRingAck', S.stACDRingAck_t);
bindMethod('OnACDRequestACDCancelAck', S.stACDRequestACDCancelAck_t);
bindMethod('OnACDFinishACDQueueEvt', S.stACDFinishACDQueueEvt_t);

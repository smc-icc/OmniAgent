'use strict';

const path = require('path');
const acdCbMod = require(path.join(__dirname, 'tars', 'acdCbImp.js'));

/** @type {(method: string, payload: object) => void | null} */
let onAcdCallback = null;

function setOnAcdCallback(cb) {
  onAcdCallback = cb;
}

function emit(method, ack) {
  if (!onAcdCallback || !ack) return;
  const payload = typeof ack.toObject === 'function' ? ack.toObject() : ack;
  onAcdCallback(method, payload);
}

const proto = acdCbMod.smc_icc.acdCbImp.prototype;
for (const name of Object.getOwnPropertyNames(proto)) {
  if (name === 'constructor' || name === 'initialize' || name.startsWith('__') || name === 'onDispatch') continue;
  if (!name.startsWith('On')) continue;
  proto[name] = function (current, ack, rsp) {
    emit(name, ack);
    if (rsp) {
      if (typeof rsp.err !== 'undefined') rsp.err = 0;
      if (typeof rsp.Err !== 'undefined') rsp.Err = 0;
    }
    if (current && typeof current.sendResponse === 'function') {
      current.sendResponse(0, rsp || {});
    }
    return 0;
  };
}

class OmniAcdCbImp extends acdCbMod.smc_icc.acdCbImp {}

module.exports = { OmniAcdCbImp, setOnAcdCallback };

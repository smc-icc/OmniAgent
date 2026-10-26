'use strict';

const path = require('path');
const agentModule = require(path.join(__dirname, 'tars', 'agent.js'));
require(path.join(__dirname, 'tars', 'agentImp.js'));

/** @type {(method: string, payload: object) => void | null} */
let onAgentCallback = null;

function setOnAgentCallback(cb) {
  onAgentCallback = cb;
}

function emit(method, ack, current) {
  if (!onAgentCallback || !ack) return;
  const payload = typeof ack.toObject === 'function' ? ack.toObject() : ack;
  const request = current && typeof current.getRequest === 'function' ? current.getRequest() : null;
  onAgentCallback(method, payload, request ? String(request.sServantName || '') : '');
}

const proto = agentModule.smc_icc.agentImp.prototype;
for (const name of Object.getOwnPropertyNames(proto)) {
  if (name === 'constructor' || name === 'initialize' || name.startsWith('__') || name === 'onDispatch') continue;
  if (!name.startsWith('On')) continue;
  proto[name] = function (current, ack, rsp) {
    emit(name, ack, current);
    if (rsp) rsp.err = 0;
    if (current && typeof current.sendResponse === 'function') {
      current.sendResponse(0, rsp || {});
    }
    return 0;
  };
}

class OmniAgentImp extends agentModule.smc_icc.agentImp {}

module.exports = { OmniAgentImp, setOnAgentCallback };

'use strict';

const path = require('path');

const tarsDir = path.join(__dirname, 'tars');

module.exports = {
  ccsTars: require(path.join(tarsDir, 'ccsProxy.js')),
  agentStructTars: require(path.join(tarsDir, 'agent_structTars.js')),
  agentTars: require(path.join(tarsDir, 'agent.js')),
  baseTars: require(path.join(tarsDir, 'baseTars.js')),
};

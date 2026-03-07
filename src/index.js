// holons — Organic Programming SDK for JavaScript
//
// Transport, serve, and identity utilities for building holons in JS/TS.

const transport = require('./transport');
const serve = require('./serve');
const identity = require('./identity');
const discover = require('./discover');
const grpcclient = require('./grpcclient');
const holonrpcServer = require('./holonrpc_server');
const holonrpcClient = require('./holonrpc_client');

const holonrpc = {
    ...holonrpcServer,
    ...holonrpcClient,
};

module.exports = { transport, serve, identity, discover, grpcclient, holonrpc };

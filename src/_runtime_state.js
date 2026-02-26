'use strict';

const memEndpointMap = new Map(); // listenURI -> tcp target (host:port)

function normalizeMemURI(uri) {
    if (!uri || uri === 'mem' || uri === 'mem://') {
        return 'mem://';
    }
    if (uri.startsWith('mem://')) {
        return uri;
    }
    throw new Error(`invalid mem URI: ${uri}`);
}

function registerMemEndpoint(uri, target) {
    const key = normalizeMemURI(uri);
    memEndpointMap.set(key, target);
    return key;
}

function resolveMemEndpoint(uri) {
    const key = normalizeMemURI(uri);
    return memEndpointMap.get(key) || null;
}

function unregisterMemEndpoint(uri) {
    const key = normalizeMemURI(uri);
    memEndpointMap.delete(key);
}

module.exports = {
    normalizeMemURI,
    registerMemEndpoint,
    resolveMemEndpoint,
    unregisterMemEndpoint,
};

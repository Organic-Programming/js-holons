// URI-based listener factory for Node.js holons.
//
// Supported transports:
//   tcp://<host>:<port>   — TCP socket (default: tcp://:9090)
//   unix://<path>         — Unix domain socket
//   stdio://              — stdin/stdout pipe (single-connection)
//   mem://                — in-process duplex pair listener
//   ws://<host>:<port>    — WebSocket listener
//   wss://<host>:<port>   — WebSocket over TLS

'use strict';

const net = require('node:net');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Duplex } = require('node:stream');
const { WebSocketServer, createWebSocketStream } = require('ws');

const DEFAULT_URI = 'tcp://:9090';

function listen(uri, options = {}) {
    const transportURI = uri || DEFAULT_URI;
    const parsed = parseURI(transportURI);

    switch (parsed.scheme) {
        case 'tcp':
            return listenTCP(parsed, options.tcp || {});
        case 'unix':
            return listenUnix(parsed, options.unix || {});
        case 'stdio':
            return new StdioListener();
        case 'mem':
            return new MemListener();
        case 'ws':
        case 'wss': {
            const listener = new WSListener(transportURI, options.ws || {});
            listener.start();
            return listener;
        }
        default:
            throw new Error(
                `unsupported transport URI: "${transportURI}" ` +
                '(expected tcp://, unix://, stdio://, mem://, ws://, or wss://)'
            );
    }
}

function scheme(uri) {
    if (!uri) return '';
    const idx = uri.indexOf('://');
    return idx >= 0 ? uri.slice(0, idx).toLowerCase() : uri.toLowerCase();
}

function parseURI(uri) {
    if (!uri) {
        return parseURI(DEFAULT_URI);
    }

    const s = scheme(uri);

    if (s === 'tcp') {
        const rest = uri.slice('tcp://'.length);
        const { host, port } = splitHostPort(rest, '9090');
        return {
            scheme: 'tcp',
            uri,
            host,
            port,
        };
    }

    if (s === 'unix') {
        const socketPath = uri.slice('unix://'.length);
        if (!socketPath) {
            throw new Error('unix:// URI requires a socket path');
        }
        return {
            scheme: 'unix',
            uri,
            path: socketPath,
        };
    }

    if (s === 'stdio') {
        return {
            scheme: 'stdio',
            uri: 'stdio://',
        };
    }

    if (s === 'mem') {
        return {
            scheme: 'mem',
            uri: uri.startsWith('mem://') ? uri : 'mem://',
        };
    }

    if (s === 'ws' || s === 'wss') {
        const secure = s === 'wss';
        const rest = uri.slice((secure ? 'wss://' : 'ws://').length);
        const slashIdx = rest.indexOf('/');
        const addr = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
        const path = slashIdx >= 0 ? rest.slice(slashIdx) : '/grpc';
        const { host, port } = splitHostPort(addr, secure ? '443' : '80');

        return {
            scheme: secure ? 'wss' : 'ws',
            uri,
            secure,
            host,
            port,
            path,
        };
    }

    throw new Error(`unsupported transport URI: "${uri}"`);
}

// --- TCP ---

function listenTCP(parsed, options = {}) {
    const server = trackNetServerConnections(net.createServer(options.connectionListener));
    server.listen({
        host: parsed.host || '0.0.0.0',
        port: Number(parsed.port),
    });
    return server;
}

// --- Unix ---

function listenUnix(parsed, options = {}) {
    try {
        fs.unlinkSync(parsed.path);
    } catch {
        // ignore stale/missing socket file cleanup errors
    }

    const server = trackNetServerConnections(net.createServer(options.connectionListener));
    server.listen(parsed.path);
    return server;
}

// --- Stdio ---

class StdioConn {
    constructor() {
        this.readable = process.stdin;
        this.writable = process.stdout;
    }

    close() {
        // Process stdio is owned by Node runtime. No-op.
    }
}

class StdioListener extends EventEmitter {
    constructor() {
        super();
        this._consumed = false;
        this._closed = false;
        this._conn = new StdioConn();
    }

    accept() {
        if (this._closed) {
            throw new Error('stdio listener is closed');
        }
        if (this._consumed) {
            throw new Error('stdio listener is single-use');
        }
        this._consumed = true;
        return this._conn;
    }

    close() {
        this._closed = true;
    }

    get address() {
        return 'stdio://';
    }
}

// --- Mem ---

class InMemoryConn extends Duplex {
    constructor() {
        super();
        this._peer = null;
    }

    setPeer(peer) {
        this._peer = peer;
    }

    _read() {
        // Reads are push-driven by peer writes.
    }

    _write(chunk, _encoding, callback) {
        if (this._peer && !this._peer.destroyed) {
            this._peer.push(Buffer.from(chunk));
        }
        callback();
    }

    _final(callback) {
        if (this._peer && !this._peer.destroyed) {
            this._peer.push(null);
        }
        callback();
    }

    _destroy(err, callback) {
        if (this._peer && !this._peer.destroyed) {
            this._peer.destroy();
        }
        callback(err);
    }
}

function createMemPair() {
    const a = new InMemoryConn();
    const b = new InMemoryConn();
    a.setPeer(b);
    b.setPeer(a);
    return { client: a, server: b };
}

class MemListener extends EventEmitter {
    constructor() {
        super();
        this._queue = [];
        this._waiters = [];
        this._closed = false;
    }

    async dial() {
        if (this._closed) {
            throw new Error('mem listener is closed');
        }

        const pair = createMemPair();

        if (this._waiters.length > 0) {
            const waiter = this._waiters.shift();
            waiter.resolve(pair.server);
        } else {
            this._queue.push(pair.server);
        }

        this.emit('connection', pair.server);
        return pair;
    }

    async accept() {
        if (this._closed) {
            throw new Error('mem listener is closed');
        }

        if (this._queue.length > 0) {
            return this._queue.shift();
        }

        return new Promise((resolve, reject) => {
            this._waiters.push({ resolve, reject });
        });
    }

    close() {
        if (this._closed) return;
        this._closed = true;

        for (const conn of this._queue) {
            conn.destroy();
        }
        this._queue = [];

        const err = new Error('mem listener closed');
        for (const waiter of this._waiters) {
            waiter.reject(err);
        }
        this._waiters = [];
    }

    get address() {
        return 'mem://';
    }
}

// --- WS / WSS ---

class WSListener extends EventEmitter {
    constructor(uri, options = {}) {
        super();

        const parsed = parseURI(uri);
        if (parsed.scheme !== 'ws' && parsed.scheme !== 'wss') {
            throw new Error(`WSListener requires ws:// or wss:// URI, got: ${uri}`);
        }

        this.uri = uri;
        this.scheme = parsed.scheme;
        this.host = parsed.host || '0.0.0.0';
        this.port = Number(parsed.port);
        this.path = parsed.path || '/grpc';
        this.secure = parsed.secure;

        this.options = options;

        this._server = null;
        this._wss = null;
        this._closed = false;
        this._started = false;
        this._readyPromise = null;

        this._queue = [];
        this._waiters = [];
        this._httpSockets = new Set();
        this._wsClients = new Set();
        this._streams = new Set();
    }

    start() {
        if (this._readyPromise) {
            return this._readyPromise;
        }

        this._readyPromise = new Promise((resolve, reject) => {
            try {
                this._server = this.secure
                    ? createHTTPSServer(this.options)
                    : http.createServer();
            } catch (err) {
                reject(err);
                return;
            }

            this._wss = new WebSocketServer({
                server: this._server,
                path: this.path,
                handleProtocols: (protocols) => {
                    const hasGrpc = typeof protocols.has === 'function'
                        ? protocols.has('grpc')
                        : Array.isArray(protocols) && protocols.includes('grpc');
                    if (hasGrpc) return 'grpc';
                    return false;
                },
            });

            this._server.on('connection', (socket) => {
                this._httpSockets.add(socket);
                const cleanup = () => {
                    this._httpSockets.delete(socket);
                };
                socket.on('close', cleanup);
                socket.on('error', cleanup);
            });

            this._wss.on('connection', (ws, req) => {
                this._wsClients.add(ws);
                const cleanupWS = () => {
                    this._wsClients.delete(ws);
                };
                ws.on('close', cleanupWS);
                ws.on('error', cleanupWS);

                const stream = createWebSocketStream(ws);
                this._streams.add(stream);
                const cleanupStream = () => {
                    this._streams.delete(stream);
                };
                stream.on('close', cleanupStream);
                stream.on('error', cleanupStream);

                if (this._waiters.length > 0) {
                    const waiter = this._waiters.shift();
                    waiter.resolve(stream);
                } else {
                    this._queue.push(stream);
                }

                this.emit('connection', stream, req);
            });

            this._wss.on('error', (err) => {
                this.emit('error', err);
            });

            this._server.on('error', (err) => {
                reject(err);
            });

            this._server.listen({ host: this.host || '0.0.0.0', port: this.port }, () => {
                const addr = this._server.address();
                if (addr && typeof addr === 'object') {
                    this.host = addr.address;
                    this.port = addr.port;
                }
                this._started = true;
                this.emit('listening');
                resolve();
            });
        });

        return this._readyPromise;
    }

    async ready() {
        await this.start();
    }

    async accept() {
        await this.start();

        if (this._closed) {
            throw new Error('ws listener is closed');
        }

        if (this._queue.length > 0) {
            return this._queue.shift();
        }

        return new Promise((resolve, reject) => {
            this._waiters.push({ resolve, reject });
        });
    }

    close() {
        if (this._closed) return;
        this._closed = true;

        const err = new Error('ws listener closed');
        for (const waiter of this._waiters) {
            waiter.reject(err);
        }
        this._waiters = [];

        for (const stream of this._queue) {
            stream.destroy();
        }
        this._queue = [];

        for (const stream of this._streams) {
            stream.destroy();
        }
        this._streams.clear();

        for (const ws of this._wsClients) {
            ws.terminate();
        }
        this._wsClients.clear();

        for (const socket of this._httpSockets) {
            socket.destroy();
        }
        this._httpSockets.clear();

        if (this._wss) {
            this._wss.close();
        }

        if (this._server) {
            this._server.close();
        }
    }

    get address() {
        return `${this.scheme}://${normalizeAddrHost(this.host)}:${this.port}${this.path}`;
    }
}

// --- Helpers ---

function splitHostPort(addr, defaultPort) {
    if (!addr) {
        return { host: '0.0.0.0', port: defaultPort };
    }

    // IPv6: [::1]:9090
    if (addr.startsWith('[')) {
        const end = addr.indexOf(']');
        if (end < 0) {
            throw new Error(`invalid host:port: ${addr}`);
        }
        const host = addr.slice(1, end);
        const rest = addr.slice(end + 1);
        const port = rest.startsWith(':') && rest.length > 1 ? rest.slice(1) : defaultPort;
        return {
            host,
            port,
        };
    }

    const idx = addr.lastIndexOf(':');
    if (idx < 0) {
        return {
            host: addr,
            port: defaultPort,
        };
    }

    const host = idx === 0 ? '0.0.0.0' : addr.slice(0, idx);
    const port = addr.slice(idx + 1) || defaultPort;

    return {
        host,
        port,
    };
}

function createHTTPSServer(options) {
    const tls = options.tls || {};

    const key = tls.key || readOptionalFile(tls.keyFile || process.env.HOLONS_TLS_KEY_FILE);
    const cert = tls.cert || readOptionalFile(tls.certFile || process.env.HOLONS_TLS_CERT_FILE);

    if (!key || !cert) {
        throw new Error(
            'wss:// requires TLS key/cert. Provide options.ws.tls.{key,cert} or HOLONS_TLS_KEY_FILE/HOLONS_TLS_CERT_FILE.'
        );
    }

    return https.createServer({ key, cert });
}

function readOptionalFile(filePath) {
    if (!filePath) return null;
    return fs.readFileSync(filePath);
}

function normalizeAddrHost(host) {
    if (!host) return '0.0.0.0';
    if (host.includes(':') && !host.startsWith('[')) {
        return `[${host}]`;
    }
    return host;
}

function trackNetServerConnections(server) {
    const sockets = new Set();

    server.on('connection', (socket) => {
        sockets.add(socket);
        const cleanup = () => {
            sockets.delete(socket);
        };
        socket.on('close', cleanup);
        socket.on('error', cleanup);
    });

    const close = server.close.bind(server);
    server.close = (callback) => {
        for (const socket of sockets) {
            socket.destroy();
        }
        sockets.clear();
        return close(callback);
    };

    return server;
}

module.exports = {
    DEFAULT_URI,
    listen,
    scheme,
    parseURI,
    StdioListener,
    MemListener,
    WSListener,
};

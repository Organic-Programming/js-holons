'use strict';

const { EventEmitter } = require('node:events');
const { WebSocket } = require('ws');

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_INVOKE_TIMEOUT_MS = 5000;
const DEFAULT_MAX_PAYLOAD_BYTES = 1 << 20;
const DEFAULT_RECONNECT_MIN_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30 * 1000;
const DEFAULT_RECONNECT_FACTOR = 2;
const DEFAULT_RECONNECT_JITTER = 0.1;

class HolonRPCError extends Error {
    constructor(code, message, data) {
        super(String(message || 'rpc error'));
        this.name = 'HolonRPCError';
        this.code = Number.isFinite(Number(code)) ? Number(code) : 13;
        if (data !== undefined) {
            this.data = data;
        }
    }
}

class HolonRPCClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options || {};

        this._handlers = new Map();
        this._pending = new Map();
        this._nextClientID = 1;

        this._ws = null;
        this._connectedURL = '';
        this._closingExplicitly = false;
        this._reconnectState = null;
    }

    register(method, handler) {
        if (typeof method !== 'string' || method.trim() === '') {
            throw new Error('method must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new Error('handler must be a function');
        }
        this._handlers.set(method, handler);
    }

    unregister(method) {
        this._handlers.delete(method);
    }

    connected() {
        return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
    }

    async connect(url, options = {}) {
        this._assertConnectable();
        const settings = resolveConnectSettings(this.options, url, options);
        await this._connectSocket(settings.target, settings.wsOptions);
    }

    async connectWithReconnect(url, options = {}) {
        this._assertConnectable();
        const settings = resolveConnectSettings(this.options, url, options);

        const reconnectState = {
            target: settings.target,
            wsOptions: settings.wsOptions,
            attempt: 0,
            timer: null,
            inFlight: false,
        };
        this._reconnectState = reconnectState;

        try {
            await this._connectSocket(settings.target, settings.wsOptions, reconnectState);
        } catch (err) {
            this._disableReconnect();
            throw err;
        }
    }

    async close() {
        this._closingExplicitly = true;
        this._disableReconnect();

        const ws = this._ws;
        this._ws = null;
        this._connectedURL = '';

        this._failAllPending(new HolonRPCError(14, 'connection closed'));

        if (!ws) {
            this._closingExplicitly = false;
            return;
        }

        try {
            await closeSocket(ws, 1000, 'client close');
        } finally {
            this._closingExplicitly = false;
        }
    }

    async invoke(method, params = {}, options = {}) {
        if (typeof method !== 'string' || method.trim() === '') {
            throw new Error('holon-rpc: method is required');
        }

        const ws = this._ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new HolonRPCError(14, 'connection closed');
        }

        const timeout = positiveInt(
            options.timeout ?? this.options.invokeTimeout ?? DEFAULT_INVOKE_TIMEOUT_MS,
            'invoke timeout'
        );

        const id = `c${this._nextClientID++}`;
        const payload = {
            jsonrpc: '2.0',
            id,
            method,
            params: ensureObject(params),
        };

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const pending = this._pending.get(id);
                if (!pending) return;
                this._pending.delete(id);
                pending.reject(new HolonRPCError(4, `timeout after ${timeout}ms`));
            }, timeout);

            timer.unref?.();
            this._pending.set(id, { resolve, reject, timer });

            ws.send(JSON.stringify(payload), (err) => {
                if (!err) return;

                const pending = this._pending.get(id);
                if (!pending) return;

                clearTimeout(pending.timer);
                this._pending.delete(id);
                pending.reject(new HolonRPCError(14, err.message || 'connection closed'));
            });
        });
    }

    async _handleMessage(data, isBinary) {
        if (isBinary) {
            return;
        }

        let msg;
        try {
            msg = JSON.parse(decodeMessage(data));
        } catch {
            return;
        }

        if (!msg || Array.isArray(msg) || typeof msg !== 'object') {
            return;
        }

        if (Object.prototype.hasOwnProperty.call(msg, 'method')) {
            await this._handleRequest(msg);
            return;
        }

        if (Object.prototype.hasOwnProperty.call(msg, 'result') || Object.prototype.hasOwnProperty.call(msg, 'error')) {
            this._handleResponse(msg);
        }
    }

    async _handleRequest(msg) {
        const id = msg.id;
        const hasID = id !== undefined && id !== null;

        if (msg.jsonrpc !== '2.0') {
            if (hasID) {
                await this._sendError(id, -32600, 'invalid request');
            }
            return;
        }

        const method = msg.method;
        if (typeof method !== 'string' || method.trim() === '') {
            if (hasID) {
                await this._sendError(id, -32600, 'invalid request');
            }
            return;
        }

        if (hasID && (typeof id !== 'string' || !id.startsWith('s'))) {
            await this._sendError(id, -32600, 'invalid request id');
            return;
        }

        if (method === 'rpc.heartbeat') {
            if (hasID) {
                await this._sendResult(id, {});
            }
            return;
        }

        const handler = this._handlers.get(method);
        if (!handler) {
            if (hasID) {
                await this._sendError(id, -32601, `method "${method}" not found`);
            }
            return;
        }

        let params;
        try {
            params = decodeParams(msg.params);
        } catch (err) {
            if (hasID) {
                await this._sendError(id, -32602, err.message || 'invalid params');
            }
            return;
        }

        try {
            const result = await Promise.resolve(handler(params));
            if (hasID) {
                await this._sendResult(id, ensureObject(result));
            }
        } catch (err) {
            if (hasID) {
                await this._sendError(id, 13, err?.message || String(err));
            }
        }
    }

    _handleResponse(msg) {
        const id = msg.id;
        if (id === undefined || id === null) {
            return;
        }

        const key = String(id);
        const pending = this._pending.get(key);
        if (!pending) {
            return;
        }

        clearTimeout(pending.timer);
        this._pending.delete(key);

        if (msg.jsonrpc !== '2.0') {
            pending.reject(new Error('invalid response')); // protocol violation
            return;
        }

        if (msg.error) {
            pending.reject(new HolonRPCError(msg.error.code, msg.error.message || 'rpc error', msg.error.data));
            return;
        }

        pending.resolve(normalizeResult(msg.result));
    }

    async _sendResult(id, result) {
        await this._sendJSON({
            jsonrpc: '2.0',
            id,
            result: ensureObject(result),
        });
    }

    async _sendError(id, code, message, data) {
        const payload = {
            jsonrpc: '2.0',
            id,
            error: {
                code: Number(code),
                message: String(message || 'rpc error'),
            },
        };

        if (data !== undefined) {
            payload.error.data = data;
        }

        await this._sendJSON(payload);
    }

    async _sendJSON(payload) {
        const ws = this._ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new HolonRPCError(14, 'connection closed');
        }

        await new Promise((resolve, reject) => {
            ws.send(JSON.stringify(payload), (err) => {
                if (err) {
                    reject(new HolonRPCError(14, err.message || 'connection closed'));
                    return;
                }
                resolve();
            });
        });
    }

    _failAllPending(err) {
        for (const pending of this._pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this._pending.clear();
    }

    _assertConnectable() {
        if (this.connected()) {
            throw new Error('holon-rpc: client already connected');
        }
        if (this._ws && this._ws.readyState === WebSocket.CONNECTING) {
            throw new Error('holon-rpc: client is already connecting');
        }
        if (this._reconnectState) {
            throw new Error('holon-rpc: reconnect loop already active');
        }
    }

    async _connectSocket(target, wsOptions, reconnectState = null) {
        const ws = new WebSocket(target, 'holon-rpc', wsOptions);
        await waitForSocketOpen(ws);

        if (ws.protocol !== 'holon-rpc') {
            try {
                ws.close(1002, 'missing holon-rpc subprotocol');
            } catch {
                // no-op
            }
            throw new Error('holon-rpc: server did not negotiate holon-rpc');
        }

        if ((reconnectState && this._reconnectState !== reconnectState) || this._closingExplicitly) {
            await closeSocket(ws, 1000, 'connection canceled');
            throw new Error('holon-rpc: connection attempt canceled');
        }

        this._ws = ws;
        this._connectedURL = target;
        this._attachSocket(ws, target);
        this.emit('connect', { url: target });
    }

    _attachSocket(ws, target) {
        ws.on('message', (data, isBinary) => {
            void this._handleMessage(data, isBinary);
        });

        ws.on('close', () => {
            if (this._ws !== ws) return;

            this._ws = null;
            this._connectedURL = '';
            this._failAllPending(new HolonRPCError(14, 'connection closed'));
            this.emit('disconnect');

            if (this._closingExplicitly || !this._reconnectState) {
                return;
            }

            this._scheduleReconnect(target);
        });

        // Prevent unhandled "error" events from taking down the process.
        ws.on('error', () => {});
    }

    _scheduleReconnect(target) {
        const state = this._reconnectState;
        if (!state || state.timer || state.inFlight || this._closingExplicitly) {
            return;
        }

        const delay = reconnectDelayMs(state.attempt);
        state.attempt += 1;

        state.timer = setTimeout(async () => {
            if (!this._reconnectState || this._reconnectState !== state) {
                return;
            }

            state.timer = null;
            state.inFlight = true;
            try {
                await this._connectSocket(target, state.wsOptions, state);
                state.attempt = 0;
            } catch {
                // Keep retrying while reconnect mode is active.
            } finally {
                state.inFlight = false;
            }

            if (this._reconnectState && this._reconnectState === state && !this.connected()) {
                this._scheduleReconnect(target);
            }
        }, delay);

        state.timer.unref?.();
    }

    _disableReconnect() {
        const state = this._reconnectState;
        this._reconnectState = null;
        if (!state || !state.timer) return;
        clearTimeout(state.timer);
        state.timer = null;
    }
}

function decodeMessage(data) {
    if (typeof data === 'string') {
        return data;
    }
    if (Buffer.isBuffer(data)) {
        return data.toString('utf8');
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString('utf8');
    }
    if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    }
    throw new Error('unsupported message type');
}

function decodeParams(params) {
    if (params === undefined || params === null) {
        return {};
    }
    if (Array.isArray(params) || typeof params !== 'object') {
        throw new Error('params must be an object');
    }
    return params;
}

function ensureObject(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
        return {};
    }
    return value;
}

function normalizeResult(result) {
    if (result === undefined) {
        return {};
    }
    return result;
}

function positiveInt(value, fieldName) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${fieldName} must be a positive number`);
    }
    return Math.trunc(parsed);
}

function normalizeHolonRPCURL(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`invalid holon-rpc URL: ${url}`);
    }

    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        throw new Error(`holon-rpc client expects ws:// or wss:// URL, got ${url}`);
    }

    if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/rpc';
    }

    return parsed.toString();
}

function resolveConnectSettings(defaultOptions, url, options) {
    if (typeof url !== 'string' || url.trim() === '') {
        throw new Error('holon-rpc: url is required');
    }

    const target = normalizeHolonRPCURL(url);
    const timeout = positiveInt(
        options.timeout ?? defaultOptions.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS,
        'connect timeout'
    );

    const wsOptions = {
        ...(defaultOptions.ws || {}),
        ...(options.ws || {}),
    };

    if (wsOptions.handshakeTimeout === undefined) {
        wsOptions.handshakeTimeout = timeout;
    }
    if (wsOptions.maxPayload === undefined) {
        wsOptions.maxPayload = DEFAULT_MAX_PAYLOAD_BYTES;
    }

    return {
        target,
        wsOptions,
    };
}

function reconnectDelayMs(attempt) {
    const base = Math.min(
        DEFAULT_RECONNECT_MIN_DELAY_MS * (DEFAULT_RECONNECT_FACTOR ** attempt),
        DEFAULT_RECONNECT_MAX_DELAY_MS
    );
    const jitter = 1 + (Math.random() * DEFAULT_RECONNECT_JITTER);
    return Math.max(DEFAULT_RECONNECT_MIN_DELAY_MS, Math.floor(base * jitter));
}

function waitForSocketOpen(ws) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
            ws.off('open', onOpen);
            ws.off('error', onError);
            ws.off('close', onClose);
        };

        const onOpen = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };

        const onError = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err || new Error('holon-rpc connection failed'));
        };

        const onClose = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('holon-rpc connection closed before open'));
        };

        ws.once('open', onOpen);
        ws.once('error', onError);
        ws.once('close', onClose);
    });
}

function closeSocket(ws, code = 1000, reason = 'client close') {
    return new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
        }

        const done = () => {
            ws.off('close', done);
            resolve();
        };

        ws.once('close', done);

        try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close(code, reason);
            }
        } catch {
            resolve();
        }
    });
}

module.exports = {
    HolonRPCClient,
    HolonRPCError,
    DEFAULT_CONNECT_TIMEOUT_MS,
    DEFAULT_INVOKE_TIMEOUT_MS,
};

// TypeScript declarations for @organic-programming/holons

import * as net from 'net';
import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import { Duplex } from 'stream';
import { ChildProcess } from 'child_process';

// --- Transport ---

export namespace transport {
    const DEFAULT_URI: string;

    function listen(uri: string, options?: ListenOptions): net.Server | MemListener | StdioListener | WSListener;
    function scheme(uri: string): string;
    function parseURI(uri: string): ParsedURI;

    interface ParsedTCPURI {
        scheme: 'tcp';
        uri: string;
        host: string;
        port: string;
    }

    interface ParsedUnixURI {
        scheme: 'unix';
        uri: string;
        path: string;
    }

    interface ParsedStdioURI {
        scheme: 'stdio';
        uri: 'stdio://';
    }

    interface ParsedMemURI {
        scheme: 'mem';
        uri: string;
    }

    interface ParsedWSURI {
        scheme: 'ws' | 'wss';
        uri: string;
        secure: boolean;
        host: string;
        port: string;
        path: string;
    }

    type ParsedURI = ParsedTCPURI | ParsedUnixURI | ParsedStdioURI | ParsedMemURI | ParsedWSURI;

    interface ListenOptions {
        tcp?: {
            connectionListener?: (socket: net.Socket) => void;
        };
        unix?: {
            connectionListener?: (socket: net.Socket) => void;
        };
        ws?: {
            tls?: {
                key?: string | Buffer;
                cert?: string | Buffer;
                keyFile?: string;
                certFile?: string;
            };
        };
    }

    class StdioListener extends EventEmitter {
        accept(): { readable: NodeJS.ReadStream; writable: NodeJS.WriteStream; close(): void };
        close(): void;
        readonly address: string;
    }

    class MemListener extends EventEmitter {
        dial(): Promise<{ client: Duplex; server: Duplex }>;
        accept(): Promise<Duplex>;
        close(): void;
        readonly address: string;
    }

    class WSListener extends EventEmitter {
        constructor(uri: string, options?: ListenOptions['ws']);
        start(): Promise<void>;
        ready(): Promise<void>;
        accept(): Promise<Duplex>;
        close(): void;
        readonly address: string;
        host: string;
        port: number;
        path: string;
        scheme: 'ws' | 'wss';
    }
}

// --- Serve ---

export namespace serve {
    type RegisterFunc = (server: grpc.Server) => void;

    interface RunOptions {
        reflect?: boolean;
        reflectionPackageDefinition?: grpc.GrpcObject;
        ws?: {
            tls?: {
                key?: string | Buffer;
                cert?: string | Buffer;
                keyFile?: string;
                certFile?: string;
            };
        };
        logger?: {
            error: (...args: any[]) => void;
            warn?: (...args: any[]) => void;
        };
    }

    interface HolonServer extends grpc.Server {
        stopHolon?: () => Promise<void>;
    }

    function parseFlags(args: string[]): string;
    function run(listenUri: string, registerFn: RegisterFunc): Promise<HolonServer>;
    function runWithOptions(
        listenUri: string,
        registerFn: RegisterFunc,
        reflectOrOptions?: boolean | RunOptions,
    ): Promise<HolonServer>;
    const DEFAULT_URI: string;
}

// --- Identity ---

export namespace identity {
    interface HolonIdentity {
        uuid: string;
        given_name: string;
        family_name: string;
        motto: string;
        composer: string;
        clade: string;
        status: string;
        born: string;
        lang: string;
        parents: string[];
        reproduction: string;
        generated_by: string;
        proto_status: string;
        aliases: string[];
    }

    function parseHolon(filePath: string): HolonIdentity;
}

// --- gRPC Client ---

export namespace grpcclient {
    type ClientCtor<TClient> = new (
        address: string,
        credentials: grpc.ChannelCredentials,
        options?: grpc.ChannelOptions,
    ) => TClient;

    interface DialOptions {
        credentials?: grpc.ChannelCredentials;
        channelOptions?: grpc.ChannelOptions;
    }

    interface DialURIOptions extends DialOptions {
        command?: string;
        args?: string[];
        env?: NodeJS.ProcessEnv;
        ws?: Record<string, unknown>;
    }

    function dial<TClient>(addressOrURI: string, ClientCtor: ClientCtor<TClient>, options?: DialOptions): TClient;
    function dialMem<TClient>(memURI: string, ClientCtor: ClientCtor<TClient>, options?: DialOptions): TClient;

    function dialWebSocket<TClient>(
        uri: string,
        ClientCtor: ClientCtor<TClient>,
        options?: DialURIOptions,
    ): Promise<{ client: TClient; close: () => Promise<void> }>;

    function dialStdio<TClient>(
        binaryPath: string,
        ClientCtor: ClientCtor<TClient>,
        options?: DialURIOptions,
    ): Promise<{ client: TClient; process: ChildProcess; close: () => Promise<void> }>;

    function dialURI<TClient>(
        uri: string,
        ClientCtor: ClientCtor<TClient>,
        options?: DialURIOptions,
    ): Promise<{ client: TClient; close: () => Promise<void> }>;
}

// --- Holon-RPC Client + Server ---

export namespace holonrpc {
    class HolonRPCError extends Error {
        constructor(code: number, message: string, data?: unknown);
        code: number;
        data?: unknown;
    }

    interface HolonRPCConnection {
        id: string;
        protocol: 'holon-rpc';
    }

    interface HolonRPCServerOptions {
        tls?: {
            key?: string | Buffer;
            cert?: string | Buffer;
            keyFile?: string;
            certFile?: string;
        };
    }

    interface HolonRPCClientOptions {
        connectTimeout?: number;
        invokeTimeout?: number;
        ws?: Record<string, unknown>;
    }

    interface HolonRPCConnectOptions {
        timeout?: number;
        ws?: Record<string, unknown>;
    }

    interface HolonRPCInvokeOptions {
        timeout?: number;
    }

    class HolonRPCClient extends EventEmitter {
        constructor(options?: HolonRPCClientOptions);
        register(method: string, handler: (params: Record<string, unknown>) => unknown): void;
        unregister(method: string): void;
        connected(): boolean;
        connect(url: string, options?: HolonRPCConnectOptions): Promise<void>;
        connectWithReconnect(url: string, options?: HolonRPCConnectOptions): Promise<void>;
        close(): Promise<void>;
        invoke(
            method: string,
            params?: Record<string, unknown>,
            options?: HolonRPCInvokeOptions,
        ): Promise<Record<string, unknown>>;
    }

    class HolonRPCServer extends EventEmitter {
        constructor(uri?: string, options?: HolonRPCServerOptions);
        uri: string;
        address: string;
        register(method: string, handler: (params: Record<string, unknown>, client: HolonRPCConnection) => unknown): void;
        unregister(method: string): void;
        listClients(): HolonRPCConnection[];
        start(): Promise<void>;
        close(): Promise<void>;
        invoke(
            client: HolonRPCConnection | string,
            method: string,
            params?: Record<string, unknown>,
            options?: { timeout?: number },
        ): Promise<Record<string, unknown>>;
    }

    const DEFAULT_URI: string;
}

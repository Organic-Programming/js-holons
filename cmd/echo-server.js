#!/usr/bin/env node
'use strict';

const serve = require('../src/serve');

const DEFAULT_SDK = 'js-holons';
const DEFAULT_VERSION = '0.1.0';
const DEFAULT_LISTEN = 'tcp://127.0.0.1:0';

const ECHO_SERVICE_DEF = {
    Ping: {
        path: '/echo.v1.Echo/Ping',
        requestStream: false,
        responseStream: false,
        requestSerialize: serialize,
        requestDeserialize: deserialize,
        responseSerialize: serialize,
        responseDeserialize: deserialize,
        originalName: 'ping',
    },
};

function parseArgs(argv) {
    const out = {
        listen: DEFAULT_LISTEN,
        sdk: DEFAULT_SDK,
        version: DEFAULT_VERSION,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--listen' && i + 1 < argv.length) {
            out.listen = argv[i + 1];
            i += 1;
            continue;
        }
        if (token === '--port' && i + 1 < argv.length) {
            out.listen = `tcp://127.0.0.1:${argv[i + 1]}`;
            i += 1;
            continue;
        }
        if (token === '--sdk' && i + 1 < argv.length) {
            out.sdk = argv[i + 1];
            i += 1;
            continue;
        }
        if (token === '--version' && i + 1 < argv.length) {
            out.version = argv[i + 1];
            i += 1;
        }
    }

    return out;
}

async function run(argv = process.argv, deps = {}) {
    const args = parseArgs(argv);
    const serveModule = deps.serveModule || serve;

    const server = await serveModule.runWithOptions(
        args.listen,
        (grpcServer) => {
            grpcServer.addService(ECHO_SERVICE_DEF, {
                Ping(call, callback) {
                    const request = call.request || {};
                    callback(null, {
                        message: String(request.message || ''),
                        sdk: args.sdk,
                        version: args.version,
                    });
                },
            });
        },
        {
            reflect: false,
            logger: console,
        },
    );

    const runtime = server.__holonsRuntime || {};
    return {
        listen: args.listen,
        publicURI: runtime.publicURI || args.listen,
        server,
    };
}

async function main() {
    try {
        const started = await run(process.argv);
        if (started.listen !== 'stdio://' && started.listen !== 'stdio') {
            process.stdout.write(`${started.publicURI}\n`);
        }
    } catch (err) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
    }
}

function serialize(value) {
    return Buffer.from(JSON.stringify(value || {}));
}

function deserialize(buffer) {
    try {
        return JSON.parse(Buffer.from(buffer).toString('utf8'));
    } catch {
        return {};
    }
}

module.exports = {
    ECHO_SERVICE_DEF,
    parseArgs,
    run,
};

if (require.main === module) {
    main();
}

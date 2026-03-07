# js-holons

**Node.js SDK for Organic Programming** — transport, serve, identity,
discovery, connect helpers, gRPC client helpers, and Holon-RPC
client/server utilities for building holons in JavaScript/TypeScript.

This SDK now mirrors the Go reference capability set at the URI level:

- `tcp://`
- `unix://`
- `stdio://`
- `mem://`
- `ws://`
- `wss://`

## Install

```bash
npm install @organic-programming/holons
```

## Modules

| Module | Purpose |
|--------|---------|
| `transport` | URI parser + listener factory |
| `serve` | Standard `serve --listen <URI>` runner |
| `identity` | `holon.yaml` parser |
| `discover` | Filesystem discovery for local, `$OPBIN`, and cache roots |
| `connect` | Slug/direct-target resolution to ready gRPC clients |
| `grpcclient` | Transport-aware client dial helpers |
| `holonrpc` | Holon-RPC (JSON-RPC 2.0 over WebSocket) client + server |

## Transport URIs

| Scheme | Server-side support | Client-side support |
|--------|---------------------|---------------------|
| `tcp://host:port` | Native gRPC bind | Native dial |
| `unix:///path.sock` | Native gRPC bind | Native dial |
| `stdio://` | Adapter bridge to internal gRPC TCP | `dialStdio` / `dialURI` |
| `mem://` | In-process endpoint registry + internal gRPC TCP | `dialMem` / `dialURI` |
| `ws://host:port/path` | WebSocket bridge to internal gRPC TCP | `dialWebSocket` / `dialURI` |
| `wss://host:port/path` | TLS WebSocket bridge to internal gRPC TCP | `dialWebSocket` / `dialURI` |

## Quick Start (Server)

```js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('node:path');
const { serve } = require('@organic-programming/holons');

const pkgDef = protoLoader.loadSync(path.join(__dirname, 'api/hello.proto'));
const pkg = grpc.loadPackageDefinition(pkgDef).hello.v1;

function greet(call, callback) {
  const name = call.request.name || 'World';
  callback(null, { message: `Hello, ${name}!` });
}

const listenURI = serve.parseFlags(process.argv.slice(2));
serve.runWithOptions(listenURI, (server) => {
  server.addService(pkg.HelloService.service, { Greet: greet });
}, {
  reflect: true,
  reflectionPackageDefinition: pkg,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## gRPC Client Helpers

`grpcclient` is constructor-based (Node gRPC style):

```js
const { grpcclient } = require('@organic-programming/holons');

// For tcp:// or unix://
const client = grpcclient.dial('tcp://127.0.0.1:9090', HelloServiceClient);

// For mem://
const memClient = grpcclient.dialMem('mem://', HelloServiceClient);

// For ws:// and wss://
const { client: wsClient, close: closeWS } = await grpcclient.dialWebSocket(
  'ws://127.0.0.1:8080/grpc',
  HelloServiceClient,
);

// For stdio://
const { client: stdioClient, process: child, close } = await grpcclient.dialStdio(
  '/path/to/holon-binary',
  HelloServiceClient,
);
```

Unified entrypoint:

```js
const { client, close } = await grpcclient.dialURI('ws://127.0.0.1:8080/grpc', HelloServiceClient);
```

## Identity Parser

```js
const { identity } = require('@organic-programming/holons');

const id = identity.parseHolon('holon.yaml');
console.log(id.uuid, id.given_name, id.lang);
```

## Discovery and Connect

```js
const { discover, connect } = require('@organic-programming/holons');

const entry = await discover.findBySlug('atlas-daemon');
const client = await connect.connect('atlas-daemon');
try {
  console.log(entry?.dir);
} finally {
  await connect.disconnect(client);
}
```

`connect.connect()` resolves either a slug or a direct address. It can
reuse an advertised daemon, start one on ephemeral TCP, or launch an
ephemeral `stdio://` session depending on the options you pass.

## WSS TLS Configuration

For `wss://` listeners, provide TLS key/cert either:

- in code via `serve.runWithOptions(..., { ws: { tls: { key, cert }}})`
- via env vars:
  - `HOLONS_TLS_KEY_FILE`
  - `HOLONS_TLS_CERT_FILE`

## API Summary

### `transport`

- `DEFAULT_URI`
- `listen(uri, options?)`
- `scheme(uri)`
- `parseURI(uri)`
- `StdioListener`, `MemListener`, `WSListener`

### `serve`

- `parseFlags(args)`
- `run(listenUri, registerFn)`
- `runWithOptions(listenUri, registerFn, reflectOrOptions?)`

### `grpcclient`

- `dial(addressOrURI, ClientCtor, options?)`
- `dialMem(memURI, ClientCtor, options?)`
- `dialWebSocket(uri, ClientCtor, options?)`
- `dialStdio(binaryPath, ClientCtor, options?)`
- `dialURI(uri, ClientCtor, options?)`

### `identity`

- `parseHolon(filePath)`

### `discover`

- `discover(root)`
- `discoverLocal()`
- `discoverAll()`
- `findBySlug(slug)`
- `findByUUID(prefix)`

### `connect`

- `connect(target, opts?)`
- `disconnect(client)`

### `holonrpc`

- `HolonRPCClient(options?)`
- `client.connect(url, options?)`
- `client.invoke(method, params?, options?)`
- `client.register(method, handler)`
- `client.close()`
- `HolonRPCServer(uri?, options?)`
- `register(method, handler)`
- `invoke(client, method, params?, options?)`
- `start()`, `close()`

The Holon-RPC server negotiates only the `holon-rpc` subprotocol and
speaks JSON-RPC 2.0 envelopes.

## Test

```bash
npm test
```

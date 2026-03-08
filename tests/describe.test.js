// HolonMeta Describe tests for js-holons.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const grpc = require('@grpc/grpc-js');

const sdk = require('../src/index');

const ECHO_PROTO = `syntax = "proto3";
package echo.v1;

// Echo echoes request payloads for documentation tests.
service Echo {
  // Ping echoes the inbound message.
  // @example {"message":"hello","sdk":"go-holons"}
  rpc Ping(PingRequest) returns (PingResponse);
}

message PingRequest {
  // Message to echo back.
  // @required
  // @example "hello"
  string message = 1;

  // SDK marker included in the response.
  // @example "go-holons"
  string sdk = 2;
}

message PingResponse {
  // Echoed message.
  string message = 1;

  // SDK marker from the server.
  string sdk = 2;
}
`;

const HOLON_YAML = `given_name: Echo
family_name: Server
motto: Reply precisely.
`;

function canListenOnLoopback() {
    return new Promise((resolve) => {
        const probe = require('node:net').createServer();
        probe.once('error', (err) => {
            const code = err && err.code;
            resolve(code !== 'EPERM' && code !== 'EACCES');
        });
        probe.listen(0, '127.0.0.1', () => {
            probe.close(() => resolve(true));
        });
    });
}

function makeHolonDir(includeProto = true) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'js-holons-describe-'));
    fs.writeFileSync(path.join(root, 'holon.yaml'), HOLON_YAML);
    if (includeProto) {
        const protoDir = path.join(root, 'protos', 'echo', 'v1');
        fs.mkdirSync(protoDir, { recursive: true });
        fs.writeFileSync(path.join(protoDir, 'echo.proto'), ECHO_PROTO);
    }
    return root;
}

function removeDir(root) {
    fs.rmSync(root, { recursive: true, force: true });
}

function findField(fields, name) {
    return fields.find((field) => field.name === name);
}

describe('describe', () => {
    it('buildResponse() extracts docs from echo proto', () => {
        const root = makeHolonDir(true);
        try {
            const response = sdk.describe.buildResponse(path.join(root, 'protos'), path.join(root, 'holon.yaml'));

            assert.equal(response.slug, 'echo-server');
            assert.equal(response.motto, 'Reply precisely.');
            assert.equal(response.services.length, 1);
            assert.equal(response.services[0].name, 'echo.v1.Echo');
            assert.equal(response.services[0].description, 'Echo echoes request payloads for documentation tests.');
            assert.equal(response.services[0].methods.length, 1);
            assert.equal(response.services[0].methods[0].name, 'Ping');
            assert.equal(response.services[0].methods[0].description, 'Ping echoes the inbound message.');
            assert.equal(response.services[0].methods[0].example_input, '{"message":"hello","sdk":"go-holons"}');

            const messageField = findField(response.services[0].methods[0].input_fields, 'message');
            assert.ok(messageField);
            assert.equal(messageField.type, 'string');
            assert.equal(messageField.number, 1);
            assert.equal(messageField.description, 'Message to echo back.');
            assert.equal(messageField.label, sdk.describe.holonmeta.FieldLabel.FIELD_LABEL_OPTIONAL);
            assert.equal(messageField.required, true);
            assert.equal(messageField.example, '"hello"');
        } finally {
            removeDir(root);
        }
    });

    it('serve.runWithOptions() auto-registers HolonMeta Describe', async (t) => {
        if (!await canListenOnLoopback()) {
            t.skip('socket bind not permitted in this environment');
            return;
        }

        const root = makeHolonDir(true);
        const previousCwd = process.cwd();
        process.chdir(root);

        const HolonMetaClient = grpc.makeGenericClientConstructor(
            sdk.describe.holonmeta.HOLON_META_SERVICE_DEF,
            'HolonMeta',
            {},
        );

        let server = null;
        let client = null;

        try {
            server = await sdk.serve.runWithOptions(
                'tcp://127.0.0.1:0',
                () => {},
                { reflect: false, logger: { error() {}, warn() {} } },
            );

            const parsed = sdk.transport.parseURI(server.__holonsRuntime.publicURI);
            client = new HolonMetaClient(`${parsed.host}:${parsed.port}`, grpc.credentials.createInsecure());
            const response = await new Promise((resolve, reject) => {
                client.Describe({}, (err, out) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(out);
                });
            });

            assert.equal(response.slug, 'echo-server');
            assert.equal(response.motto, 'Reply precisely.');
            assert.deepEqual(response.services.map((service) => service.name), ['echo.v1.Echo']);
        } finally {
            process.chdir(previousCwd);
            client?.close();
            await server?.stopHolon();
            removeDir(root);
        }
    });

    it('Describe degrades gracefully when protos are missing', async (t) => {
        if (!await canListenOnLoopback()) {
            t.skip('socket bind not permitted in this environment');
            return;
        }

        const root = makeHolonDir(false);
        const previousCwd = process.cwd();
        process.chdir(root);

        const HolonMetaClient = grpc.makeGenericClientConstructor(
            sdk.describe.holonmeta.HOLON_META_SERVICE_DEF,
            'HolonMeta',
            {},
        );

        let server = null;
        let client = null;

        try {
            server = await sdk.serve.runWithOptions(
                'tcp://127.0.0.1:0',
                () => {},
                { reflect: false, logger: { error() {}, warn() {} } },
            );

            const parsed = sdk.transport.parseURI(server.__holonsRuntime.publicURI);
            client = new HolonMetaClient(`${parsed.host}:${parsed.port}`, grpc.credentials.createInsecure());
            const response = await new Promise((resolve, reject) => {
                client.Describe({}, (err, out) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(out);
                });
            });

            assert.equal(response.slug, 'echo-server');
            assert.equal(response.motto, 'Reply precisely.');
            assert.deepEqual(response.services, []);
        } finally {
            process.chdir(previousCwd);
            client?.close();
            await server?.stopHolon();
            removeDir(root);
        }
    });
});

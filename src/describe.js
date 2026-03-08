// HolonMeta Describe support for Node.js holons.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

const { parseHolon } = require('./identity');
const holonmeta = require('./gen/holonmeta/v1/holonmeta');

const HOLON_META_SERVICE_NAME = 'holonmeta.v1.HolonMeta';

const FIELD_LABEL_OPTIONAL = holonmeta.FieldLabel.FIELD_LABEL_OPTIONAL;
const FIELD_LABEL_REPEATED = holonmeta.FieldLabel.FIELD_LABEL_REPEATED;
const FIELD_LABEL_MAP = holonmeta.FieldLabel.FIELD_LABEL_MAP;

function buildResponse(protoDir, holonYamlPath) {
    const identity = parseHolon(holonYamlPath);
    const services = parseServices(protoDir);

    return {
        slug: slugFor(identity),
        motto: identity.motto || '',
        services,
    };
}

function register(server, protoDir, holonYamlPath) {
    if (!server) {
        throw new Error('gRPC server is required');
    }

    const response = buildResponse(protoDir, holonYamlPath);
    server.addService(holonmeta.HOLON_META_SERVICE_DEF, {
        Describe(_call, callback) {
            callback(null, response);
        },
    });
}

function parseServices(protoDir) {
    const absDir = path.resolve(String(protoDir));
    if (!fs.existsSync(absDir)) {
        return [];
    }
    if (!fs.statSync(absDir).isDirectory()) {
        throw new Error(`${absDir} is not a directory`);
    }

    const relFiles = collectProtoFiles(absDir);
    if (relFiles.length === 0) {
        return [];
    }

    const absFiles = relFiles.map((rel) => path.resolve(absDir, rel));
    const inputFiles = new Set(absFiles.map(normalizePath));
    const root = loadRoot(absDir, absFiles);
    return collectServices(root)
        .filter((service) => inputFiles.has(normalizePath(service.filename)))
        .filter((service) => trimFullName(service.fullName) !== HOLON_META_SERVICE_NAME)
        .map((service) => buildService(service, inputFiles));
}

function collectProtoFiles(rootDir) {
    /** @type {string[]} */
    const files = [];

    walk(rootDir);
    files.sort();
    return files;

    function walk(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            const currentPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name.startsWith('.')) {
                    continue;
                }
                walk(currentPath);
                continue;
            }
            if (path.extname(entry.name) !== '.proto') {
                continue;
            }
            files.push(path.relative(rootDir, currentPath));
        }
    }
}

function loadRoot(protoDir, absFiles) {
    const root = new protobuf.Root();
    const defaultResolvePath = protobuf.Root.prototype.resolvePath;

    root.resolvePath = function resolvePath(origin, target) {
        const base = origin ? path.dirname(origin) : protoDir;
        const candidate = path.resolve(base, target);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        return defaultResolvePath.call(this, origin, target);
    };

    root.loadSync(absFiles, {
        keepCase: true,
        alternateCommentMode: true,
    });
    root.resolveAll();
    return root;
}

function collectServices(root) {
    /** @type {protobuf.Service[]} */
    const services = [];
    visit(root);
    return services;

    function visit(namespace) {
        if (!namespace || !Array.isArray(namespace.nestedArray)) {
            return;
        }
        for (const nested of namespace.nestedArray) {
            if (nested instanceof protobuf.Service) {
                services.push(nested);
            }
            if (Array.isArray(nested.nestedArray)) {
                visit(nested);
            }
        }
    }
}

function buildService(service, inputFiles) {
    const meta = parseCommentBlock(service.comment || '');
    return {
        name: trimFullName(service.fullName),
        description: meta.description,
        methods: service.methodsArray.map((method) => buildMethod(method, inputFiles)),
    };
}

function buildMethod(method, inputFiles) {
    const meta = parseCommentBlock(method.comment || '');
    return {
        name: method.name,
        description: meta.description,
        input_type: trimFullName(method.resolvedRequestType.fullName),
        output_type: trimFullName(method.resolvedResponseType.fullName),
        input_fields: buildFields(method.resolvedRequestType, inputFiles, new Set()),
        output_fields: buildFields(method.resolvedResponseType, inputFiles, new Set()),
        client_streaming: Boolean(method.requestStream),
        server_streaming: Boolean(method.responseStream),
        example_input: meta.example,
    };
}

function buildFields(type, inputFiles, seen) {
    if (!type) {
        return [];
    }

    const fullName = trimFullName(type.fullName);
    if (seen.has(fullName)) {
        return [];
    }

    const nextSeen = new Set(seen);
    nextSeen.add(fullName);

    return type.fieldsArray.map((field) => buildField(field, inputFiles, nextSeen));
}

function buildField(field, inputFiles, seen) {
    const meta = parseCommentBlock(field.comment || '');
    const doc = {
        name: field.name,
        type: fieldTypeName(field),
        number: field.id,
        description: meta.description,
        label: fieldLabel(field),
        map_key_type: '',
        map_value_type: '',
        nested_fields: [],
        enum_values: [],
        required: meta.required,
        example: meta.example,
    };

    if (field.map) {
        doc.map_key_type = scalarTypeName(field.keyType);
        doc.map_value_type = field.resolvedType
            ? trimFullName(field.resolvedType.fullName)
            : scalarTypeName(field.type);

        if (field.resolvedType instanceof protobuf.Enum && shouldExpand(field.resolvedType, inputFiles)) {
            doc.enum_values = buildEnumValues(field.resolvedType);
        }
        if (field.resolvedType instanceof protobuf.Type && shouldExpand(field.resolvedType, inputFiles)) {
            doc.nested_fields = buildFields(field.resolvedType, inputFiles, seen);
        }
        return doc;
    }

    if (field.resolvedType instanceof protobuf.Enum && shouldExpand(field.resolvedType, inputFiles)) {
        doc.enum_values = buildEnumValues(field.resolvedType);
    }
    if (field.resolvedType instanceof protobuf.Type && shouldExpand(field.resolvedType, inputFiles)) {
        doc.nested_fields = buildFields(field.resolvedType, inputFiles, seen);
    }

    return doc;
}

function buildEnumValues(enumType) {
    return Object.keys(enumType.values).map((name) => ({
        name,
        number: enumType.values[name],
        description: parseCommentBlock((enumType.comments && enumType.comments[name]) || '').description,
    }));
}

function shouldExpand(reflectionObject, inputFiles) {
    return Boolean(reflectionObject && inputFiles.has(normalizePath(reflectionObject.filename)));
}

function fieldLabel(field) {
    if (field.map) {
        return FIELD_LABEL_MAP;
    }
    if (field.repeated) {
        return FIELD_LABEL_REPEATED;
    }
    return FIELD_LABEL_OPTIONAL;
}

function fieldTypeName(field) {
    if (field.map) {
        const keyType = scalarTypeName(field.keyType);
        const valueType = field.resolvedType
            ? trimFullName(field.resolvedType.fullName)
            : scalarTypeName(field.type);
        return `map<${keyType}, ${valueType}>`;
    }
    if (field.resolvedType) {
        return trimFullName(field.resolvedType.fullName);
    }
    return scalarTypeName(field.type);
}

function scalarTypeName(typeName) {
    return String(typeName || '');
}

function parseCommentBlock(raw) {
    const lines = String(raw || '')
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim());

    const description = [];
    const examples = [];
    let required = false;

    for (const line of lines) {
        if (!line) {
            continue;
        }
        if (line === '@required') {
            required = true;
            continue;
        }
        if (line.startsWith('@example')) {
            const example = line.slice('@example'.length).trim();
            if (example) {
                examples.push(example);
            }
            continue;
        }
        description.push(line);
    }

    return {
        description: description.join(' '),
        required,
        example: examples.join('\n'),
    };
}

function trimFullName(fullName) {
    return String(fullName || '').replace(/^\./, '');
}

function normalizePath(filePath) {
    if (!filePath) {
        return '';
    }
    return path.resolve(String(filePath));
}

function slugFor(identity) {
    const given = String(identity.given_name || '').trim();
    const family = String(identity.family_name || '').trim().replace(/\?$/, '');
    if (!given && !family) {
        return '';
    }
    return `${given}-${family}`.trim().toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
}

module.exports = {
    HOLON_META_SERVICE_NAME,
    buildResponse,
    register,
    holonmeta,
};

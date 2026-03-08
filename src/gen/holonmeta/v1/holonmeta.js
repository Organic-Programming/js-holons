'use strict';

const protobuf = require('protobufjs');

const descriptor = {
    "nested": {
        "holonmeta": {
            "nested": {
                "v1": {
                    "nested": {
                        "HolonMeta": {
                            "methods": {
                                "Describe": {
                                    "requestType": "DescribeRequest",
                                    "responseType": "DescribeResponse"
                                }
                            }
                        },
                        "DescribeRequest": {
                            "fields": {}
                        },
                        "DescribeResponse": {
                            "fields": {
                                "slug": {
                                    "type": "string",
                                    "id": 1
                                },
                                "motto": {
                                    "type": "string",
                                    "id": 2
                                },
                                "services": {
                                    "rule": "repeated",
                                    "type": "ServiceDoc",
                                    "id": 3
                                }
                            }
                        },
                        "ServiceDoc": {
                            "fields": {
                                "name": {
                                    "type": "string",
                                    "id": 1
                                },
                                "description": {
                                    "type": "string",
                                    "id": 2
                                },
                                "methods": {
                                    "rule": "repeated",
                                    "type": "MethodDoc",
                                    "id": 3
                                }
                            }
                        },
                        "MethodDoc": {
                            "fields": {
                                "name": {
                                    "type": "string",
                                    "id": 1
                                },
                                "description": {
                                    "type": "string",
                                    "id": 2
                                },
                                "input_type": {
                                    "type": "string",
                                    "id": 3
                                },
                                "output_type": {
                                    "type": "string",
                                    "id": 4
                                },
                                "input_fields": {
                                    "rule": "repeated",
                                    "type": "FieldDoc",
                                    "id": 5
                                },
                                "output_fields": {
                                    "rule": "repeated",
                                    "type": "FieldDoc",
                                    "id": 6
                                },
                                "client_streaming": {
                                    "type": "bool",
                                    "id": 7
                                },
                                "server_streaming": {
                                    "type": "bool",
                                    "id": 8
                                },
                                "example_input": {
                                    "type": "string",
                                    "id": 9
                                }
                            }
                        },
                        "FieldDoc": {
                            "fields": {
                                "name": {
                                    "type": "string",
                                    "id": 1
                                },
                                "type": {
                                    "type": "string",
                                    "id": 2
                                },
                                "number": {
                                    "type": "int32",
                                    "id": 3
                                },
                                "description": {
                                    "type": "string",
                                    "id": 4
                                },
                                "label": {
                                    "type": "FieldLabel",
                                    "id": 5
                                },
                                "map_key_type": {
                                    "type": "string",
                                    "id": 6
                                },
                                "map_value_type": {
                                    "type": "string",
                                    "id": 7
                                },
                                "nested_fields": {
                                    "rule": "repeated",
                                    "type": "FieldDoc",
                                    "id": 8
                                },
                                "enum_values": {
                                    "rule": "repeated",
                                    "type": "EnumValueDoc",
                                    "id": 9
                                },
                                "required": {
                                    "type": "bool",
                                    "id": 10
                                },
                                "example": {
                                    "type": "string",
                                    "id": 11
                                }
                            }
                        },
                        "FieldLabel": {
                            "values": {
                                "FIELD_LABEL_UNSPECIFIED": 0,
                                "FIELD_LABEL_OPTIONAL": 1,
                                "FIELD_LABEL_REPEATED": 2,
                                "FIELD_LABEL_MAP": 3,
                                "FIELD_LABEL_REQUIRED": 4
                            }
                        },
                        "EnumValueDoc": {
                            "fields": {
                                "name": {
                                    "type": "string",
                                    "id": 1
                                },
                                "number": {
                                    "type": "int32",
                                    "id": 2
                                },
                                "description": {
                                    "type": "string",
                                    "id": 3
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};
const root = protobuf.Root.fromJSON(descriptor);

const DescribeRequest = root.lookupType('holonmeta.v1.DescribeRequest');
const DescribeResponse = root.lookupType('holonmeta.v1.DescribeResponse');
const FieldLabel = root.lookupEnum('holonmeta.v1.FieldLabel').values;

function makeSerializer(type) {
    return (value) => Buffer.from(type.encode(type.fromObject(value || {})).finish());
}

function makeDeserializer(type) {
    return (buffer) => type.toObject(type.decode(buffer), {
        longs: String,
        enums: String,
        defaults: true,
        arrays: true,
        objects: true,
        oneofs: true,
    });
}

const HOLON_META_SERVICE_DEF = {
    Describe: {
        path: '/holonmeta.v1.HolonMeta/Describe',
        requestStream: false,
        responseStream: false,
        requestSerialize: makeSerializer(DescribeRequest),
        requestDeserialize: makeDeserializer(DescribeRequest),
        responseSerialize: makeSerializer(DescribeResponse),
        responseDeserialize: makeDeserializer(DescribeResponse),
        originalName: 'describe',
    },
};

module.exports = {
    root,
    DescribeRequest,
    DescribeResponse,
    FieldLabel,
    HOLON_META_SERVICE_DEF,
};

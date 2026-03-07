// Parse holon.yaml identity files.

'use strict';

const fs = require('fs');
const YAML = require('yaml');

/**
 * @typedef {Object} HolonIdentity
 * @property {string} uuid
 * @property {string} given_name
 * @property {string} family_name
 * @property {string} motto
 * @property {string} composer
 * @property {string} clade
 * @property {string} status
 * @property {string} born
 * @property {string} lang
 * @property {string[]} parents
 * @property {string} reproduction
 * @property {string} generated_by
 * @property {string} proto_status
 * @property {string[]} aliases
 */

/**
 * Parse a holon.yaml file.
 * @param {string} filePath
 * @returns {HolonIdentity}
 */
function parseHolon(filePath) {
    const text = fs.readFileSync(filePath, 'utf-8');
    const data = YAML.parse(text);
    if (data === null || Array.isArray(data) || typeof data !== 'object') {
        throw new Error(`${filePath}: holon.yaml must be a YAML mapping`);
    }

    return {
        uuid: data.uuid || '',
        given_name: data.given_name || '',
        family_name: data.family_name || '',
        motto: data.motto || '',
        composer: data.composer || '',
        clade: data.clade || '',
        status: data.status || '',
        born: data.born || '',
        lang: data.lang || '',
        parents: data.parents || [],
        reproduction: data.reproduction || '',
        generated_by: data.generated_by || '',
        proto_status: data.proto_status || '',
        aliases: data.aliases || [],
    };
}

module.exports = { parseHolon };

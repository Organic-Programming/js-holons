// Parse HOLON.md identity files.

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
 * Parse a HOLON.md file.
 * @param {string} filePath
 * @returns {HolonIdentity}
 */
function parseHolon(filePath) {
    const text = fs.readFileSync(filePath, 'utf-8');

    if (!text.startsWith('---')) {
        throw new Error(`${filePath}: missing YAML frontmatter`);
    }

    const endIdx = text.indexOf('---', 3);
    if (endIdx < 0) {
        throw new Error(`${filePath}: unterminated YAML frontmatter`);
    }

    const frontmatter = text.slice(3, endIdx).trim();
    const data = YAML.parse(frontmatter) || {};

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

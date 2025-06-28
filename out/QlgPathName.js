"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildQualName = buildQualName;
exports.buildAPI2PartName = buildAPI2PartName;
exports.buildQlgPathNameHex = buildQlgPathNameHex;
function toUTF16BE(str, length) {
    // Encode as UTF-16LE, then swap bytes for BE
    const le = Buffer.from(str, 'utf16le');
    const be = Buffer.alloc(length);
    for (let i = 0; i < Math.min(le.length, length); i += 2) {
        be[i] = le[i + 1];
        be[i + 1] = le[i];
    }
    // Pad with zeros if needed
    if (be.length > le.length) {
        be.fill(0, le.length);
    }
    return be;
}
function serializeQlgPathNameBE(obj) {
    const buf = Buffer.alloc(4 + 2 + 3 + 3 + 4 + 4 + 2 + 10 + 4096);
    let offset = 0;
    buf.writeInt32BE(obj.CCSID, offset);
    offset += 4;
    buf.write(obj.Country_ID.padEnd(2, '\0'), offset, 2, 'ascii');
    offset += 2;
    buf.write(obj.Language_ID.padEnd(3, '\0'), offset, 3, 'ascii');
    offset += 3;
    buf.write(obj.Reserved.padEnd(3, '\0'), offset, 3, 'ascii');
    offset += 3;
    buf.writeUInt32BE(obj.Path_Type, offset);
    offset += 4;
    buf.writeInt32BE(obj.Path_Length, offset);
    offset += 4;
    // Path_Name_Delimiter as UTF-16BE (2 bytes)
    toUTF16BE(obj.Path_Name_Delimiter, 2).copy(buf, offset);
    offset += 2;
    buf.write(obj.Reserved2.padEnd(10, '\0'), offset, 10, 'ascii');
    offset += 10;
    // Path_Name as UTF-16BE (up to 4096 bytes)
    toUTF16BE(obj.Path_Name, 4096).copy(buf, offset);
    offset += 4096;
    return buf;
}
// Helper function to insure that a qualified object name
// is in true CL command qualified name format.
// It accepts either a fully qualified object name,
// such as qgpl/customter
// or an API-structure of: OBJECT....LIBRARY...
// and returns library/object to the caller.
// If only somethig like "OBJECT" is passed in (i.e., no library)
// then it is returned as "OBJECT" without a qualified library name.
function buildQualName(input) {
    // If the input name is already a fully-qualified object name,
    // then simply round-trip it.
    if (input.includes('/')) {
        return input;
    }
    // Extract first 10 and second 10 bytes
    const part1 = input.substring(0, 10).trimEnd();
    const part2 = input.substring(10, 20).trimEnd();
    if (part2) { // return newly qualified name
        return `${part2}/${part1}`;
    }
    else { // return just the object name
        return part1;
    }
}
function buildAPI2PartName(cmdString) {
    // Parse a CL command string into tokens
    // and return the command/object and library name
    // as a 20-byte API-friendly Qualified Object Name.
    let cmdName = '';
    let libName = '';
    // Trim and split into tokens
    let tokens = cmdString.trim().split(/\s+/);
    // Check for a label (first token ends with a colon)
    if (tokens.length > 1 && tokens[0].endsWith(':')) {
        tokens.shift(); // Remove the label
    }
    // The first token is now the command (possibly qualified)
    if (tokens.length > 0) {
        cmdName = tokens[0];
    }
    if (cmdName.includes('/')) {
        let [lib, name] = cmdName.split('/');
        name = name?.startsWith('"') && name.endsWith('"') ? name : name.toUpperCase();
        lib = lib?.startsWith('"') && lib.endsWith('"') ? lib : lib.toUpperCase();
        cmdName = (name || '').padEnd(10, ' ');
        libName = (lib || '').padEnd(10, ' ');
    }
    else {
        let name = cmdName;
        name = name.startsWith('"') && name.endsWith('"') ? name : name.toUpperCase();
        cmdName = name.padEnd(10, ' ');
        libName = '*LIBL'.padEnd(10, ' ');
    }
    return Buffer.from(cmdName + libName, 'ascii');
}
// Accepts ASCII/UTF-8 path name and populates an IBM i-compatible Qlg_Path_Name structure
// that may be passed to host (i.e., IBM i) API calls.
function buildQlgPathNameHex(pathAndCmd) {
    // Prepare fields
    const CCSID = 1200;
    const Country_ID = '\0\0';
    const Language_ID = '\0\0\0';
    const Reserved = '\0\0\0';
    const Path_Type = 2; // QLG_CHAR_DOUBLE
    const Path_Name_Delimiter = '/';
    const Reserved2 = '\0'.repeat(10);
    console.log(`Outfile: "${pathAndCmd}"`);
    // Path_Name as UTF-16BE, up to 4096 bytes
    const Path_Length = Buffer.from(pathAndCmd, 'utf16le').length;
    const pathNameBufferBE = toUTF16BE(pathAndCmd, Path_Length);
    // Build structure with just enough space for the path name
    const buf = Buffer.alloc(4 + 2 + 3 + 3 + 4 + 4 + 2 + 10 + Path_Length);
    let offset = 0;
    buf.writeInt32BE(CCSID, offset);
    offset += 4;
    buf.write(Country_ID, offset, 2, 'ascii');
    offset += 2;
    buf.write(Language_ID, offset, 3, 'ascii');
    offset += 3;
    buf.write(Reserved, offset, 3, 'ascii');
    offset += 3;
    buf.writeUInt32BE(Path_Type, offset);
    offset += 4;
    buf.writeInt32BE(Path_Length, offset);
    offset += 4;
    // Path_Name_Delimiter as UTF-16BE (2 bytes)
    toUTF16BE(Path_Name_Delimiter, 2).copy(buf, offset);
    offset += 2;
    buf.write(Reserved2, offset, 10, 'ascii');
    offset += 10;
    // Path_Name as UTF-16BE (only Path_Length bytes)
    pathNameBufferBE.copy(buf, offset, 0, Path_Length);
    offset += Path_Length;
    return buf.toString('hex').toUpperCase();
}
//# sourceMappingURL=QlgPathName.js.map
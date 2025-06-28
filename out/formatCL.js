"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCLCommand = buildCLCommand;
exports.buildCLCommand_xx = buildCLCommand_xx;
exports.quoteIfNeeded = quoteIfNeeded;
exports.isValidName = isValidName;
exports.extractAllowedValsAndTypes = extractAllowedValsAndTypes;
exports.formatCLSource = formatCLSource;
exports.extractFullCLCmd = extractFullCLCmd;
const xmldom_1 = require("@xmldom/xmldom");
function buildCLCommand(cmdName, values, defaults, allowedValsMap, parmTypeMap, parmMetas, presentParms, qualGroupsMap) {
    let cmd = cmdName;
    // Remove *LIBL/ from the command name if present
    const LIBL = '*LIBL/';
    if (cmd.toUpperCase().startsWith(LIBL)) {
        cmd = cmd.substring(LIBL.length);
    }
    // Track which parameters have already been handled (by qualGroupsMap)
    const handledParms = new Set();
    // Handle QUAL/ELEM grouping if qualGroupsMap is provided (optional, for advanced use)
    if (qualGroupsMap) {
        for (const [kwd, qualInstances] of Object.entries(qualGroupsMap)) {
            if (!qualInstances.length)
                continue;
            const allowedVals = allowedValsMap[kwd] || [];
            const parmType = parmTypeMap[kwd] || "";
            // Each instance is an array of QUAL/ELEM parts
            const qualStrings = qualInstances.map(instanceArr => instanceArr
                .map((v, idx) => quoteIfNeeded(v, allowedVals, parmType))
                .join('/'));
            cmd += ` ${kwd}(${qualStrings.join(' ')})`;
            handledParms.add(kwd);
        }
    }
    // Output parameters in the order defined by parmMetas
    for (const meta of parmMetas) {
        const key = meta.Kwd;
        if (handledParms.has(key))
            continue; // Already handled by qualGroupsMap
        const value = values[key];
        if (value === undefined ||
            value === null ||
            value === '' ||
            (!presentParms?.has(key) && defaults && deepEqual(normalizeValue(value), normalizeValue(defaults[key])))) {
            continue;
        }
        const allowedVals = allowedValsMap[key] || [];
        const parmType = parmTypeMap[key] || "";
        // QUAL parameter (array of parts)
        if (meta.Quals && meta.Quals.length > 0 && Array.isArray(value)) {
            // Multi-instance QUAL: array of arrays
            if (Array.isArray(value[0])) {
                cmd += ` ${key}(${value.map((vArr) => vArr.map((v) => quoteIfNeeded(v, allowedVals, parmType)).join('/')).join(' ')})`;
            }
            else {
                // Single instance QUAL: array of strings
                cmd += ` ${key}(${value.map((v) => quoteIfNeeded(v, allowedVals, parmType)).join('/')})`;
            }
        }
        // ELEM parameter (array of parts, joined by space)
        else if (meta.Elems && meta.Elems.length > 0 && Array.isArray(value)) {
            cmd += ` ${key}(${value.map((vArr) => Array.isArray(vArr)
                ? vArr.map((v) => quoteIfNeeded(v, allowedVals, parmType)).join(' ')
                : quoteIfNeeded(vArr, allowedVals, parmType)).join(' ')})`;
        }
        // Multi-instance simple
        else if (Array.isArray(value)) {
            cmd += ` ${key}(${value.map(v => quoteIfNeeded(v, allowedVals, parmType)).join(' ')})`;
        }
        // Simple parameter
        else {
            cmd += ` ${key}(${quoteIfNeeded(value, allowedVals, parmType)})`;
        }
    }
    return cmd;
}
function buildCLCommand_xx(cmdName, values, defaults, allowedValsMap, parmTypeMap, parmMetas, presentParms, qualGroupsMap // Optional: for QUAL/ELEM grouping if you have it
) {
    let cmd = cmdName;
    // Remove *LIBL/ from the command name if present
    const LIBL = '*LIBL/';
    if (cmd.toUpperCase().startsWith(LIBL)) {
        cmd = cmd.substring(LIBL.length);
    }
    // Track which parameters have already been handled (by qualGroupsMap)
    const handledParms = new Set();
    // Handle QUAL/ELEM grouping if qualGroupsMap is provided (optional, for advanced use)
    if (qualGroupsMap) {
        for (const [kwd, qualInstances] of Object.entries(qualGroupsMap)) {
            if (!qualInstances.length)
                continue;
            const allowedVals = allowedValsMap[kwd] || [];
            const parmType = parmTypeMap[kwd] || "";
            const qualStrings = qualInstances.map(instanceArr => instanceArr
                .slice() // copy to avoid mutating original
                .reverse()
                .map((v, idx) => quoteIfNeeded(v, allowedVals, parmType))
                .join('/'));
            cmd += ` ${kwd}(${qualStrings.join(' ')})`;
            handledParms.add(kwd);
        }
    }
    // Output parameters in the order defined by parmMetas
    for (const meta of parmMetas) {
        const key = meta.Kwd;
        if (handledParms.has(key))
            continue; // Already handled by qualGroupsMap
        const value = values[key];
        console.log('key:', key, 'value:', value, 'default:', defaults[key], 'present:', presentParms?.has(key));
        if (value === undefined ||
            value === null ||
            value === '' ||
            (!presentParms?.has(key) && defaults && deepEqual(normalizeValue(value), normalizeValue(defaults[key])))) {
            continue;
        }
        const allowedVals = allowedValsMap[key] || [];
        const parmType = parmTypeMap[key] || "";
        // Multi-instance (array)
        if (Array.isArray(value)) {
            cmd += ` ${key}(${value.map(v => quoteIfNeeded(v, allowedVals, parmType)).join(' ')})`;
        }
        else {
            cmd += ` ${key}(${quoteIfNeeded(value, allowedVals, parmType)})`;
        }
    }
    return cmd;
}
function normalizeValue(val) {
    if (typeof val === 'string' && val.includes('/')) {
        return val.split('/');
    }
    return val;
}
function deepEqual(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i]))
                return false;
        }
        return true;
    }
    return a === b;
}
function isCLExpression(val) {
    // Detect common CL operators
    const ops = ['*CAT', '*TCAT', '*BCAT', '*EQ', '*NE', '*LT', '*LE', '*GT', '*GE'];
    const trimmed = val.trim().toUpperCase();
    if (trimmed.startsWith('(') && trimmed.endsWith(')'))
        return true;
    if (ops.some(op => trimmed.includes(op)))
        return true;
    // Detect any %functionName( pattern (future-proof for new CL built-ins)
    if (/%[A-Z][A-Z0-9]*\s*\(/i.test(trimmed))
        return true;
    // Also treat any value with an ampersand variable and operator as an expression
    if (/&[A-Z][A-Z0-9]*\s*[*%]/i.test(trimmed))
        return true;
    return false;
}
function quoteIfNeeded(val, allowedVals = [], parmType = "") {
    const trimmed = val.trim();
    const type = parmType.toUpperCase().replace(/^\*/, "");
    // Never quote valid IBM i names or special values
    if (["NAME", "PNAME", "CNAME"].includes(type) ||
        allowedVals.includes(trimmed.toUpperCase()) ||
        isValidName(trimmed) ||
        trimmed.startsWith("*")) {
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed;
        }
        return trimmed.toUpperCase();
    }
    // --- NEW: Don't quote CL expressions ---
    if (isCLExpression(trimmed)) {
        return val;
    }
    if (trimmed === "''" || trimmed === "") {
        return "";
    }
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        return trimmed;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return trimmed;
    }
    return `'${trimmed.replace(/'/g, "''")}'`;
}
function isValidName(val) {
    const trimmed = val.trim();
    if (trimmed.startsWith("&")) {
        return /^[&][A-Z$#@][A-Z0-9$#@_.]{0,10}$/i.test(trimmed);
    }
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        return true;
    }
    return /^[A-Z$#@][A-Z0-9$#@_.]{0,10}$/i.test(trimmed);
}
function extractAllowedValsAndTypes(xml) {
    const allowedValsMap = {};
    const parmTypeMap = {};
    const parser = new xmldom_1.DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const parms = doc.getElementsByTagName("Parm");
    for (let i = 0; i < parms.length; i++) {
        const parm = parms[i];
        const kwd = parm.getAttribute("Kwd");
        if (!kwd)
            continue;
        parmTypeMap[kwd] = parm.getAttribute("Type") || "";
        const vals = [];
        // SpcVal
        const spcVals = parm.getElementsByTagName("SpcVal");
        for (let s = 0; s < spcVals.length; s++) {
            const values = spcVals[s].getElementsByTagName("Value");
            for (let v = 0; v < values.length; v++) {
                vals.push(values[v].getAttribute("Val") || "");
            }
        }
        // SngVal
        const sngVals = parm.getElementsByTagName("SngVal");
        for (let s = 0; s < sngVals.length; s++) {
            const values = sngVals[s].getElementsByTagName("Value");
            for (let v = 0; v < values.length; v++) {
                vals.push(values[v].getAttribute("Val") || "");
            }
        }
        // Value
        const values = parm.getElementsByTagName("Value");
        for (let v = 0; v < values.length; v++) {
            vals.push(values[v].getAttribute("Val") || "");
        }
        allowedValsMap[kwd] = vals.map(v => v.toUpperCase());
    }
    return { allowedValsMap, parmTypeMap };
}
function formatCLSource(allLines, options, startIndex = 0) {
    let level = 1;
    let fromCase = '';
    let toCase = '';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = lowercase.toUpperCase();
    // Set up case conversion
    switch (options.cvtcase) {
        case '*UPPER':
            fromCase = lowercase;
            toCase = uppercase;
            break;
        case '*LOWER':
            fromCase = uppercase;
            toCase = lowercase;
            break;
        default:
            break;
    }
    const outputLines = [];
    let idx = startIndex;
    while (idx < allLines.length) {
        const source_record = allLines[idx++];
        if (!source_record) {
            break;
        }
        const sequence = source_record.substring(0, 6);
        const date = source_record.substring(6, 12);
        let source_data = source_record.substring(12, 92);
        // Handle CL tags (ending with :)
        const [tag, ...rest] = source_data.trim().split(/\s+/);
        const statement = rest.join(' ');
        if (tag.endsWith(':')) {
            let tagOut = tag;
            if (options.cvtcase !== '*NONE') {
                tagOut = translateCase(tag, fromCase, toCase);
            }
            outputLines.push(sequence + date + tagOut + ' +');
            if (statement.startsWith('+')) {
                continue;
            }
            source_data = statement;
        }
        // Write comments as-is if indrmks = '*NO'
        if (source_data.trim().startsWith('/*') && options.indrmks === '*NO') {
            outputLines.push(sequence + date + source_data);
            continue;
        }
        // Build command string (handle continuations)
        const input = buildCommandString(source_data, allLines, idx);
        idx += input.linesConsumed;
        // Convert case if requested and not a comment
        if (options.cvtcase !== '*NONE' && !input.value.trim().startsWith('/*')) {
            input.value = convertCaseWithQuotes(input.value, fromCase, toCase);
        }
        // Format DCLs to align parameters vertically
        if (input.value.trim().toUpperCase().startsWith('DCL')) {
            input.value = formatDCL(input.value);
        }
        // Write formatted command string
        outputLines.push(...writeFormatted(input.value, sequence, date, level, options));
        const upperInput = input.value.toUpperCase();
        if (upperInput.includes('DO')) {
            level++;
        }
        if (upperInput.includes('ENDDO')) {
            level = Math.max(1, level - 1);
        }
    }
    return outputLines;
}
// --- Helper Functions ---
function translateCase(str, fromCase, toCase) {
    let result = '';
    for (const ch of str) {
        const idx = fromCase.indexOf(ch);
        result += idx >= 0 ? toCase[idx] : ch;
    }
    return result;
}
function buildCommandString(source_data, allLines, idx) {
    let input = source_data.trim();
    let linesConsumed = 0;
    while (input.endsWith('+') || input.endsWith('-')) {
        const save_continuation = input.slice(-1);
        input = input.slice(0, -1);
        const nextLine = allLines[idx + linesConsumed];
        if (!nextLine) {
            break; // Prevents undefined errors
        }
        const nextData = nextLine.substring(12, 92);
        if (save_continuation === '+') {
            input += nextData.trimStart();
        }
        else {
            input += nextData.trimEnd();
        }
        linesConsumed++;
    }
    return { value: input, linesConsumed };
}
function convertCaseWithQuotes(input, fromCase, toCase) {
    let result = '';
    let inQuote = false;
    for (const ch of input) {
        if (ch === "'") {
            inQuote = !inQuote;
            result += ch;
        }
        else if (!inQuote) {
            const idx = fromCase.indexOf(ch);
            result += idx >= 0 ? toCase[idx] : ch;
        }
        else {
            result += ch;
        }
    }
    return result;
}
function formatDCL(input) {
    // Align DCL parameters (simple version)
    const parts = input.trim().split(/\s+/);
    const dcl = parts[0];
    const variable = (parts[1] || '').padEnd(17, ' ');
    const type = (parts[2] || '').padEnd(12, ' ');
    let varlen = '';
    let other = '';
    if (parts[3] && parts[3].toUpperCase().startsWith('LEN(')) {
        varlen = parts[3].padEnd(11, ' ');
        other = parts.slice(4).join(' ');
    }
    else {
        other = parts.slice(3).join(' ');
    }
    return `${dcl} ${variable}${type}${varlen}${other}`;
}
function writeFormatted(input, sequence, date, level, options) {
    // Indent only the first 10 levels
    let indent = '';
    if (level <= 10) {
        indent = ' '.repeat(options.indcol * (level - 1) + options.bgncol);
    }
    else {
        indent = ' '.repeat(options.indcol * 9 + options.bgncol);
    }
    const maxlength = 70 - indent.length;
    const lines = [];
    // Simple line breaking logic (does not handle all REXX edge cases)
    let inputLeft = input;
    let continued = false;
    while (inputLeft.length > 0) {
        let chunk = '';
        if ((!continued && inputLeft.length <= maxlength) ||
            (continued && inputLeft.length <= maxlength - options.indcont)) {
            chunk = inputLeft;
            inputLeft = '';
        }
        else {
            // Break at last space before maxlength
            let breakPos = inputLeft.lastIndexOf(' ', maxlength - 1);
            if (breakPos <= 0) {
                breakPos = maxlength - 1;
            }
            chunk = inputLeft.slice(0, breakPos) + ' +';
            inputLeft = inputLeft.slice(breakPos).trimStart();
        }
        if (continued) {
            lines.push(sequence + date + indent + ' '.repeat(options.indcont) + chunk);
        }
        else {
            lines.push(sequence + date + indent + chunk);
        }
        continued = true;
    }
    return lines;
}
/**
 * Extracts the full CL command from the editor, handling + and - continuations.
 * @param allLines All lines in the document (as array of strings)
 * @param currentLine The line number where the cursor is
 * @returns The full CL command as a single string
 */
function extractFullCLCmd(allLines, currentLine) {
    // Step 1: Find the start of the command (walk backwards)
    let startLine = currentLine;
    while (startLine > 0) {
        const prevLine = allLines[startLine - 1].trimRight();
        if (!prevLine.endsWith('+') && !prevLine.endsWith('-'))
            break;
        startLine--;
    }
    // Step 2: Collect and join lines, handling continuations
    let cmd = '';
    let lineIdx = startLine;
    let pendingPlus = false;
    let pendingMinus = false;
    while (lineIdx < allLines.length) {
        let line = allLines[lineIdx].replace(/\r?\n$/, '');
        let trimmed = line.trimRight();
        if (pendingPlus) {
            line = line.replace(/^\s*/, '');
            pendingPlus = false;
        }
        if (pendingMinus) {
            line = line.trimLeft();
            pendingMinus = false;
        }
        if (trimmed.endsWith('+')) {
            cmd += trimmed.slice(0, -1);
            pendingPlus = true;
        }
        else if (trimmed.endsWith('-')) {
            cmd += trimmed.slice(0, -1);
            pendingMinus = true;
        }
        else {
            cmd += line;
            break;
        }
        lineIdx++;
    }
    return cmd.trim();
}
//# sourceMappingURL=formatCL.js.map
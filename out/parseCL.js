"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractParmMetas = extractParmMetas;
exports.parseCLParms = parseCLParms;
exports.splitCLMultiInstance = splitCLMultiInstance;
exports.splitQualifiedCLValue = splitQualifiedCLValue;
const xmldom_1 = require("@xmldom/xmldom");
function isElementWithName(n, name) {
    return !!n && typeof n === 'object'
        && 'nodeType' in n && n.nodeType === 1
        && 'nodeName' in n && typeof n.nodeName === 'string'
        && n.nodeName.toUpperCase() === name.toUpperCase()
        && typeof n.getAttribute === 'function';
}
function extractParmMetas(xml) {
    const doc = new xmldom_1.DOMParser().parseFromString(xml, 'application/xml');
    const parms = Array.from(doc.getElementsByTagName('Parm'));
    return parms.map(parm => {
        const Kwd = parm.getAttribute('Kwd') || '';
        const Type = parm.getAttribute('Type') || undefined;
        const Max = parm.getAttribute('Max') ? Number(parm.getAttribute('Max')) : undefined;
        // --- Direct child QUALs of Parm ---
        const qualNodes = Array.from(parm.childNodes).filter(n => isElementWithName(n, 'QUAL'));
        const Quals = qualNodes.length
            ? qualNodes.map(q => ({
                Prompt: q.getAttribute('Prompt') || '',
                Type: q.getAttribute('Type') || undefined
            }))
            : undefined;
        // --- Direct child ELEMs of Parm ---
        const elemNodes = Array.from(parm.childNodes).filter(n => isElementWithName(n, 'ELEM'));
        const Elems = elemNodes.length
            ? elemNodes.map(e => {
                // QUALs under ELEM (direct children)
                const elemQualNodes = Array.from(e.childNodes).filter(n => isElementWithName(n, 'QUAL'));
                const ElemQuals = elemQualNodes.length
                    ? elemQualNodes.map(q => ({
                        Prompt: q.getAttribute('Prompt') || '',
                        Type: q.getAttribute('Type') || undefined
                    }))
                    : undefined;
                return {
                    Prompt: e.getAttribute('Prompt') || '',
                    Type: e.getAttribute('Type') || undefined,
                    Quals: ElemQuals
                };
            })
            : undefined;
        return { Kwd, Type, Max, Quals, Elems };
    });
}
function parseCLParms(rawCmd, parmMetas) {
    // Remove command name and label if present
    let cmd = rawCmd.trim();
    let labelMatch = cmd.match(/^([A-Z0-9_]+:)\s*/i);
    if (labelMatch)
        cmd = cmd.slice(labelMatch[0].length);
    let cmdNameMatch = cmd.match(/^([A-Z0-9_\/]+)\s*/i);
    if (cmdNameMatch)
        cmd = cmd.slice(cmdNameMatch[0].length);
    // Parse parameters: KEYWORD(value) KEYWORD(value) ...
    const paramMap = {};
    const paramRegex = /([A-Z0-9_]+)\s*\(([^)]*)\)/gi;
    let match;
    let i = 0;
    while (i < cmd.length) {
        // Find the next keyword
        const kwdMatch = cmd.slice(i).match(/^([A-Z0-9_]+)\s*\(/i);
        if (!kwdMatch)
            break;
        const kwd = kwdMatch[1];
        i += kwdMatch[0].length;
        // Extract the value, handling nested parentheses
        let depth = 1;
        let val = '';
        while (i < cmd.length && depth > 0) {
            const c = cmd[i];
            if (c === '(')
                depth++;
            else if (c === ')')
                depth--;
            if (depth > 0)
                val += c;
            i++;
        }
        while (i < cmd.length && /\s/.test(cmd[i]))
            i++;
        const meta = parmMetas.find(p => p.Kwd === kwd);
        // --- Handle ELEM (multi-part, like FILE or LOG) FIRST ---
        if (meta && meta.Elems && meta.Elems.length > 0) {
            const vals = splitCLMultiInstance(val);
            paramMap[kwd] = vals.map((v, idx) => {
                const elemMeta = meta.Elems && meta.Elems[idx];
                if (elemMeta && elemMeta.Quals && elemMeta.Quals.length > 0) {
                    return splitQualifiedCLValue(v, elemMeta.Quals.length);
                }
                else {
                    return v.trim();
                }
            });
            continue;
        }
        // --- Handle multi-instance (MAX > 1) ---
        if (meta && meta.Max && meta.Max > 1) {
            const vals = splitCLMultiInstance(val);
            paramMap[kwd] = vals.map(v => v.trim());
            continue;
        }
        // --- Handle QUAL ---
        if (meta && meta.Quals && meta.Quals.length > 0) {
            const parts = splitQualifiedCLValue(val, meta.Quals.length);
            paramMap[kwd] = parts;
            continue;
        }
        // --- Otherwise, treat as a single value ---
        paramMap[kwd] = val;
    }
    return paramMap;
}
// --- Helper: Split multi-instance values, respecting quotes/parentheses ---
function splitCLMultiInstance(val) {
    const result = [];
    let current = '';
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < val.length; i++) {
        const c = val[i];
        if (c === "'" && !inDoubleQuote)
            inSingleQuote = !inSingleQuote;
        else if (c === '"' && !inSingleQuote)
            inDoubleQuote = !inDoubleQuote;
        else if (!inSingleQuote && !inDoubleQuote) {
            if (c === '(')
                depth++;
            else if (c === ')')
                depth--;
            else if (c === ' ' && depth === 0) {
                if (current.trim())
                    result.push(current.trim());
                current = '';
                continue;
            }
        }
        current += c;
    }
    if (current.trim())
        result.push(current.trim());
    return result;
}
// --- Helper: Split QUAL values, respecting quotes/parentheses ---
function splitQualifiedCLValue(val, numQuals) {
    console.log('splitQualifiedCLValue input:', val);
    const parts = [];
    let current = '';
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < val.length; i++) {
        const c = val[i];
        // Handle quotes
        if (c === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += c;
            continue;
        }
        if (c === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += c;
            continue;
        }
        // Only split on / if not in quotes or parens
        if (!inSingleQuote && !inDoubleQuote && c === '/' && depth === 0 && parts.length < numQuals - 1) {
            console.log('SPLIT at /, current:', current, 'next:', val.slice(i));
            parts.push(current.trim());
            current = '';
            continue; // Don't add the slash
        }
        // Now handle parens
        if (!inSingleQuote && !inDoubleQuote) {
            if (c === '(')
                depth++;
            else if (c === ')')
                depth--;
        }
        // Always add the character unless it was a split /
        current += c;
    }
    parts.push(current.trim());
    return parts;
}
//# sourceMappingURL=parseCL.js.map
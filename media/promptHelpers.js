
// ✅ Valid IBM i CL parameter data types
export const CL_DATA_TYPES = [
    'DEC',
    'LGL',
    'CHAR',
    'INT2',
    'INT4',
    'UINT2',
    'UINT4',
    'NAME',
    'GENERIC',
    'VARNAME',
    'DATE',
    'TIME',
    'CMD',
    'X',
    'ZEROELEM',
    'NULL',
    'CMDSTR',
    'PNAME',
    'SNAME',
    'CNAME'
];

// ✅ Container/structure Types (not actual data types)
export const CL_CONTAINER_TYPES = [
    'ELEM',
    'QUAL'
];


// ✅ Check if a type is a valid data type
export function isValidDataType(type) {
    return CL_DATA_TYPES.includes((type || '').toUpperCase());
}

// ✅ Check if a type is a container type
export function isContainerType(type) {
    return CL_CONTAINER_TYPES.includes((type || '').toUpperCase());
}

// ✅ Check if a type needs special handling
export function getTypeCategory(type) {
    const upperType = (type || '').toUpperCase();
    if (CL_DATA_TYPES.includes(upperType)) {
        return 'DATA_TYPE';
    } else if (CL_CONTAINER_TYPES.includes(upperType)) {
        return 'CONTAINER';
    } else {
        return 'UNKNOWN';
    }
}


export function splitUnquotedSlash(str) {
    const result = [];
    let current = '';
    let inSingle = false, inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === '/' && !inSingle && !inDouble) {
            result.push(current);
            current = '';
            continue;
        }
        current += c;
    }
    result.push(current);
    return result;
}

export function splitCLQual(val) {
    let parts = [];
    let current = '';
    let inSingle = false, inDouble = false, parenDepth = 0;
    for (let i = 0; i < val.length; i++) {
        const c = val[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === '/' && !inSingle && !inDouble && parenDepth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        if (c === '(' && !inSingle && !inDouble) parenDepth++;
        else if (c === ')' && !inSingle && !inDouble && parenDepth > 0) parenDepth--;
        current += c;
    }
    parts.push(current);
    return parts;
}

// ✅ Get CSS width class based on effective length
export function getLengthClass(effectiveLen) {
    if (effectiveLen <= 6) return 'input-xs';      // 80px - small numbers, short codes
    if (effectiveLen <= 12) return 'input-sm';     // 120px - medium numbers, names
    if (effectiveLen <= 25) return 'input-md';     // 200px - longer names, paths
    if (effectiveLen <= 50) return 'input-lg';     // 300px - descriptions, titles
    if (effectiveLen <= 80) return 'input-xl';     // 400px - long text
    return 'input-full';                           // 100% - very long text (textarea)
}

// Flaten parameter value (for QUAL nodes)
export function flattenParmValue(val) {
    if (typeof val === "string") {
        return [val];
    }
    if (Array.isArray(val)) {
        if (val.length > 0 && Array.isArray(val[0])) {
            return val.map(sub =>
                Array.isArray(sub) ? sub.join("/") : sub
            );
        }
        return val;
    }
    return [];
}


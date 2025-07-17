
// Split a string into top-level parenthesized groups, preserving all content inside each group
// Example: INCREL((*IF IMDEL *EQ 'A') (*OR IMDEL *EQ ' ')) => ["(*IF IMDEL *EQ 'A')", "(*OR IMDEL *EQ ' ')"]
export function splitTopLevelParenGroups(str: string): string[] {
    const groups: string[] = [];
    let current = '';
    let depth = 0;
    let inSingle = false, inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        if (!inSingle && !inDouble) {
            if (c === '(') {
                if (depth === 0 && current.trim().length > 0) {
                    groups.push(current.trim());
                    current = '';
                }
                depth++;
            } else if (c === ')') {
                depth--;
            }
        }
        current += c;
        if (depth === 0 && (c === ')' || (i === str.length - 1 && current.trim().length > 0))) {
            groups.push(current.trim());
            current = '';
        }
    }
    return groups.filter(g => g.length > 0);
}

// ✅ Valid IBM i CL parameter data types
export const CL_DATA_TYPES: string[] = [
    'DEC', 'LGL', 'CHAR', 'INT2', 'INT4', 'UINT2', 'UINT4', 'NAME', 'GENERIC', 'VARNAME',
    'DATE', 'TIME', 'CMD', 'X', 'ZEROELEM', 'NULL', 'CMDSTR', 'PNAME', 'SNAME', 'CNAME'
];

// ✅ Container/structure Types (not actual data types)
export const CL_CONTAINER_TYPES: string[] = [
    'ELEM', 'QUAL'
];

// ✅ Check if a type is a valid data type
export function isValidDataType(type: string | null | undefined): boolean {
    return CL_DATA_TYPES.includes((type || '').toUpperCase());
}

// ✅ Check if a type is a container type
export function isContainerType(type: string | null | undefined): boolean {
    return CL_CONTAINER_TYPES.includes((type || '').toUpperCase());
}

// ✅ Check if a type needs special handling
export function getTypeCategory(type: string | null | undefined): 'DATA_TYPE' | 'CONTAINER' | 'UNKNOWN' {
    const upperType = (type || '').toUpperCase();
    if (CL_DATA_TYPES.includes(upperType)) {
        return 'DATA_TYPE';
    } else if (CL_CONTAINER_TYPES.includes(upperType)) {
        return 'CONTAINER';
    } else {
        return 'UNKNOWN';
    }
}

export function splitUnquotedSlash(str: string): string[] {
    const result: string[] = [];
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

export function splitCLQual(val: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inSingle = false, inDouble = false, parenDepth = 0;
    for (let i = 0; i < val.length; i++) {
        const c = val[i];
        if (c === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (c === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (!inSingle && !inDouble) {
            if (c === '(') {
                parenDepth++;
            } else if (c === ')') {
                if (parenDepth > 0) parenDepth--;
            }
        }
        if (c === '/' && !inSingle && !inDouble && parenDepth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    if (current.length > 0) {
        parts.push(current.trim());
    }
    return parts;
}

// Default field lengths for IBM i CL data types (when no Len= attribute is present)
export const CL_TYPE_DEFAULT_LENGTHS: Record<string, number> = {
    'DEC': 15,
    'LGL': 1,
    'CHAR': 32,
    'NAME': 10,
    'SNAME': 10,
    'CNAME': 10,
    'PNAME': 32,
    'GENERIC': 10,
    'HEX': 1,
    'X': 15,
    'VARNAME': 11,
    'CMD': 256,
    'CMDSTR': 256
};

// Get the default field length for a CL type (if no Len= attribute)
export function getDefaultLengthForType(type: string | null | undefined): number {
    if (!type) return 10;
    const upper = type.replace('*', '').toUpperCase();
    return CL_TYPE_DEFAULT_LENGTHS[upper] || 10;
}

// ✅ Get CSS width class based on effective length
export function getLengthClass(effectiveLen: number): string {
    if (effectiveLen <= 6) return 'input-xs';
    if (effectiveLen <= 12) return 'input-sm';
    if (effectiveLen <= 25) return 'input-md';
    if (effectiveLen <= 50) return 'input-lg';
    if (effectiveLen <= 80) return 'input-xl';
    return 'input-full';
}

// --- CL Prompter formatting settings ---
// These should be settable in the extension's config UI and used in formatCL.ts
export function getCLPrompterFormatSettings(): {
    cmdLabelIndent: number;
    cmdIndent: number;
    cmdContIndent: number;
    cmdRightMargin: number;
} {
    let settings = {
        cmdLabelIndent: 2,
        cmdIndent: 14,
        cmdContIndent: 27,
        cmdRightMargin: 72
    };
    if (typeof window !== 'undefined' && (window as any).vscodeApi && typeof (window as any).vscodeApi.getState === 'function') {
        const state = (window as any).vscodeApi.getState();
        if (state && state.clPrompterFormatSettings) {
            settings = { ...settings, ...state.clPrompterFormatSettings };
        }
    }
    return settings;
}

// Flatten parameter value (for QUAL nodes)
export function flattenParmValue(val: any): string[] {
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

// Parse a space-separated string, respecting quoted substrings
export function parseSpaceSeparatedValues(str: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (!inQuotes && (char === "'" || char === '"')) {
            inQuotes = true;
            quoteChar = char;
            current += char;
        } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            current += char;
        } else if (!inQuotes && /\s/.test(char)) {
            if (current.trim()) {
                values.push(current.trim());
                current = '';
            }
        } else {
            current += char;
        }
    }
    if (current.trim()) {
        values.push(current.trim());
    }
    return values;
}
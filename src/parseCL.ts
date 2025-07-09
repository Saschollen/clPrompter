
import { DOMParser } from '@xmldom/xmldom';

interface ParsedParms {
  [kwd: string]: string | string[] | (string | string[])[];
}

export interface ParmMeta {
  Kwd: string;
  Type?: string;
  Max?: number;
  Quals?: { Prompt: string; Type?: string }[];
  Elems?: ElemMeta[];
}

export interface ElemMeta {
  Prompt: string;
  Type?: string;
  Quals?: { Prompt: string; Type?: string }[];
}


function isElementWithName(n: unknown, name: string): n is { nodeType: number; nodeName: string; getAttribute: (attr: string) => string | null } {
  return !!n && typeof n === 'object'
    && 'nodeType' in n && (n as any).nodeType === 1
    && 'nodeName' in n && typeof (n as any).nodeName === 'string'
    && (n as any).nodeName.toUpperCase() === name.toUpperCase()
    && typeof (n as any).getAttribute === 'function';
}

export function extractParmMetas(xml: string): ParmMeta[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
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


export function parseCLParms(
  rawCmd: string,
  parmMetas: ParmMeta[]
): ParsedParms {
  // Remove command name and label if present
  let cmd = rawCmd.trim();
  let labelMatch = cmd.match(/^([A-Z0-9_]+:)\s*/i);
  if (labelMatch) cmd = cmd.slice(labelMatch[0].length);
  let cmdNameMatch = cmd.match(/^([A-Z0-9_\/]+)\s*/i);
  if (cmdNameMatch) cmd = cmd.slice(cmdNameMatch[0].length);

  // Parse parameters: KEYWORD(value) KEYWORD(value) ...
  const paramMap: ParsedParms = {};
  let i = 0;
  while (i < cmd.length) {
    // Find the next keyword
    const kwdMatch = cmd.slice(i).match(/^([A-Z0-9_]+)\s*\(/i);
    if (!kwdMatch) break;
    const kwd = kwdMatch[1];
    i += kwdMatch[0].length;

    // Extract the value, handling nested parentheses
    let depth = 1;
    let val = '';
    while (i < cmd.length && depth > 0) {
      const c = cmd[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (depth > 0) val += c;
      i++;
    }
    while (i < cmd.length && /\s/.test(cmd[i])) i++;

    const meta = parmMetas.find(p => p.Kwd === kwd);

    // --- Handle ELEM (multi-part, like FILE or LOG) FIRST ---
    if (meta && meta.Elems && meta.Elems.length > 0) {
      const vals = splitCLMultiInstance(val);
      // If this is a multi-instance ELEM (Max > 1), preserve all groups
      paramMap[kwd] = vals.map((v, idx) => {
        const elemMeta = meta.Elems && meta.Elems[idx];
        if (elemMeta && elemMeta.Quals && elemMeta.Quals.length > 0) {
          // QUAL inside ELEM: split and reverse for right-to-left mapping
          const parts = splitQualifiedCLValue(v, elemMeta.Quals.length);
          return parts.reverse();
        } else {
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
      // Split and reverse for right-to-left mapping (QUAL0 is rightmost)
      const parts = splitQualifiedCLValue(val, meta.Quals.length);
      paramMap[kwd] = parts.reverse();
      continue;
    }

    // --- Otherwise, treat as a single value ---
    paramMap[kwd] = val;
  }
  return paramMap;
}

// --- Helper: Split multi-instance values, respecting quotes/parentheses ---
export function splitCLMultiInstance(val: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < val.length; i++) {
    const c = val[i];
    if (c === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (c === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (!inSingleQuote && !inDoubleQuote) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ' ' && depth === 0) {
        if (current.trim()) result.push(current.trim());
        current = '';
        continue;
      }
    }
    current += c;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

// --- Helper: Split QUAL values, respecting quotes/parentheses ---
export function splitQualifiedCLValue(val: string, numQuals: number): string[] {
  console.log('splitQualifiedCLValue input:', val);
  const parts: string[] = [];
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
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }

    // Always add the character unless it was a split /
    current += c;
  }
  parts.push(current.trim());
  // Remove trailing empty/undefined parts (but preserve left-to-right order for now)
  while (parts.length > 0 && (!parts[parts.length - 1] || parts[parts.length - 1].trim() === '')) {
    parts.pop();
  }
  return parts;
}
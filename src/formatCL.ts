type CaseOption = '*UPPER' | '*LOWER' | '*NONE';
type IndentRemarks = '*NO' | '*YES';


import { DOMParser } from '@xmldom/xmldom';
import { ParmMeta } from './parseCL';
// Import CL Prompter formatting settings from promptHelpers.js
// import { getCLPrompterFormatSettings } from '../media/promptHelpers';
// VS Code config import
import * as vscode from 'vscode';

// Type aliases must be declared before use
type AllowedValsMap = Record<string, string[]>; // e.g. { OBJTYPE: ["*ALL", "*FILE", ...], ... }
type ParmTypeMap = Record<string, string>;      // e.g. { OBJTYPE: "NAME", ... }

interface FormatOptions {
  cvtcase: CaseOption;
  indrmks: IndentRemarks;
  bgncol: number;
  indcol: number;
  indcont: number;
}

// ✅ Update groupNestedElems to handle numeric pattern
// ✅ Fix groupNestedElems to preserve ALL non-ELEM parameters
function groupNestedElems(values: Record<string, any>, parmTypeMap: ParmTypeMap): { grouped: Record<string, any>, updatedTypeMap: ParmTypeMap } {
  const grouped: Record<string, any> = {}; // ✅ Start empty
  const updatedTypeMap: ParmTypeMap = { ...parmTypeMap };
  const processed = new Set<string>();

  // ✅ FIRST: Copy all regular parameters (non-ELEM pattern keys)
  for (const [key, value] of Object.entries(values)) {
    // ✅ Support both simple and nested ELEM patterns
    const isSimpleElem = key.match(/^(.+)_ELEM\d+$/);        // LOG_ELEM0, LOG_ELEM1
    const isNestedElem = key.match(/^(.+)_ELEM(\d+)_(\d+)(?:_(\d+))?$/); // TOPGMQ_ELEM1_0

    if (!isSimpleElem && !isNestedElem) {
      // ✅ This is a regular parameter - preserve it
      grouped[key] = value;
      console.log(`[groupNestedElems] Preserved regular parameter: ${key}`, value);
    }
  }

  // Find all ELEM parameters with both simple and nested patterns
  const elemParams = new Set<string>();
  for (const key of Object.keys(values)) {
    // ✅ Support both simple and nested ELEM patterns
    const simpleElemMatch = key.match(/^(.+)_ELEM\d+$/);           // LOG_ELEM0 -> LOG
    const nestedElemMatch = key.match(/^(.+)_ELEM(\d+)_(\d+)(?:_(\d+))?$/); // TOPGMQ_ELEM1_0 -> TOPGMQ

    if (simpleElemMatch) {
      elemParams.add(simpleElemMatch[1]); // Base parameter name (LOG)
    } else if (nestedElemMatch) {
      elemParams.add(nestedElemMatch[1]); // Base parameter name (TOPGMQ)
    }
  }

  // ✅ SECOND: Process ELEM parameters and create grouped structures
  for (const baseParam of elemParams) {
    const elemValues: (string | string[])[] = [];
    let elemIndex = 0;

    // Collect all ELEM values for this parameter
    // Collect all ELEM values for this parameter
    while (true) {
      // ✅ FIRST: Check for simple ELEM pattern: LOG_ELEM0, LOG_ELEM1, LOG_ELEM2
      const simpleElemKey = `${baseParam}_ELEM${elemIndex}`;
      const nestedSimpleKey = `${baseParam}_ELEM${elemIndex}_0`;

      if (values[simpleElemKey] !== undefined) {
        // Simple ELEM value: LOG_ELEM0, LOG_ELEM1, LOG_ELEM2
        elemValues.push(values[simpleElemKey]);
        processed.add(simpleElemKey);

      } else if (values[nestedSimpleKey] !== undefined) {
        // This ELEM has nested values - collect them as a sub-group
        const subValues: string[] = [];
        let subIndex = 0;

        while (true) {
          const subKey = `${baseParam}_ELEM${elemIndex}_${subIndex}`;
          if (values[subKey] !== undefined) {
            subValues.push(values[subKey]);
            processed.add(subKey);
            subIndex++;
          } else {
            break;
          }
        }

        if (subValues.length > 0) {
          // Multiple values - treat as sub-group
          elemValues.push(subValues);
        }

      } else if (values[nestedSimpleKey] !== undefined) {
        // This ELEM is a simple value in nested format
        elemValues.push(values[nestedSimpleKey]);
        processed.add(nestedSimpleKey);

      } else {
        // No more ELEM values
        break;
      }

      elemIndex++;
    }

    // Set the grouped structure for ELEM parameters
    if (elemValues.length > 0) {
      grouped[baseParam] = elemValues;
      updatedTypeMap[baseParam] = 'ELEM';
      console.log(`[groupNestedElems] Grouped ELEM ${baseParam}:`, elemValues);
    }
  }

  console.log('[groupNestedElems] Original values:', Object.keys(values));
  console.log('[groupNestedElems] Final grouped values:', Object.keys(grouped));

  return { grouped, updatedTypeMap };
}

// ✅ Function build command string after prompter.
export function buildCLCommand(
  cmdName: string,
  values: Record<string, any>,
  defaults: Record<string, any>,
  allowedValsMap: AllowedValsMap,
  parmTypeMap: ParmTypeMap,
  parmMetas: ParmMeta[],
  presentParms?: Set<string>,
  qualGroupsMap?: Record<string, string[][]>
): string {
  // If a label is present in values, prepend it to the command string
  let cmd = '';
  if (values && typeof values === 'object') {
    // Look for a label property (case-insensitive, e.g. 'LABEL', 'Lbl', etc.)
    const labelKey = Object.keys(values).find(k => k.toLowerCase() === 'label');
    if (labelKey !== undefined) {
      const labelVal = values[labelKey];
      if (typeof labelVal === 'string' && labelVal.trim() !== '') {
        // Always prepend label (with colon) if present and non-empty
        cmd = labelVal.trim().toUpperCase() + ': ';
      }
    }
  }
  cmd += cmdName;

  // Remove *LIBL/ from the command name if present
  const LIBL = '*LIBL/';
  if (cmd.toUpperCase().startsWith(LIBL)) {
    cmd = cmd.substring(LIBL.length);
  }

  // ✅ Check if this command actually has ELEM pattern keys
  // ✅ Support both simple and nested ELEM patterns
  const hasElemPatterns = Object.keys(values).some(key =>
    key.match(/^(.+)_ELEM\d+$/) ||                           // LOG_ELEM0, LOG_ELEM1 (simple)
    key.match(/^(.+)_ELEM(\d+)_(\d+)(?:_(\d+))?$/)          // TOPGMQ_ELEM1_0 (nested)
  );

  // ✅ Only process ELEM grouping if there are ELEM patterns
  let groupedValues: Record<string, any>;
  let updatedTypeMap: ParmTypeMap;

  if (hasElemPatterns) {
    console.log('[buildCLCommand] ELEM patterns detected, calling groupNestedElems...');
    const result = groupNestedElems(values, parmTypeMap);
    groupedValues = result.grouped;
    updatedTypeMap = result.updatedTypeMap;
  } else {
    console.log('[buildCLCommand] No ELEM patterns, using values directly');
    groupedValues = values; // ✅ Use original values directly
    updatedTypeMap = parmTypeMap;
  }

  // Track which parameters have already been handled
  const handledParms = new Set<string>();

  // Handle QUAL/ELEM grouping if qualGroupsMap is provided
  // Handle QUAL/ELEM grouping if qualGroupsMap is provided
  if (qualGroupsMap) {
    for (const [kwd, qualInstances] of Object.entries(qualGroupsMap)) {
      if (!qualInstances.length) continue;

      // PATCH: Only include if user changed or value differs from default
      const defaultVal = defaults && defaults[kwd];
      const userChanged = presentParms?.has(kwd);

      // Check if all instances are empty or default
      const allEmptyOrDefault = qualInstances.every(instanceArr =>
        instanceArr.every((v, idx) =>
        (v === undefined || v === null || v === '' ||
          (!userChanged &&
            defaultVal &&
            (
              Array.isArray(defaultVal)
                ? v.toString().trim().toUpperCase() === (defaultVal[idx] || '').toString().trim().toUpperCase()
                : v.toString().trim().toUpperCase() === defaultVal.toString().trim().toUpperCase()
            )
          )
        )
        )
      );
      if (allEmptyOrDefault) continue;

      const allowedVals = allowedValsMap[kwd] || [];
      const parmType = updatedTypeMap[kwd] || "";
      const qualStrings = qualInstances.map(instanceArr =>
        instanceArr
          .map((v, idx) => quoteIfNeeded(v, allowedVals, parmType))
          .join('/')
      );
      cmd += ` ${kwd}(${qualStrings.join(' ')})`;
      handledParms.add(kwd);
    }
  }

  // Output parameters in the order defined by parmMetas
  for (const meta of parmMetas) {
    const key = meta.Kwd;
    if (handledParms.has(key)) continue;

    // ✅ Use grouped values instead of raw values
    let value = groupedValues[key];

    if (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.every(v => v === undefined || v === null || v === '')) ||
      (!presentParms?.has(key) && defaults && deepEqual(normalizeValue(value), normalizeValue(defaults[key])))
    ) {
      continue;
    }

    const hasElemChildren = meta.Elems && meta.Elems.length > 0;
    const hasQualChildren = meta.Quals && meta.Quals.length > 0;
    const isMultiInstance = meta.Max ? (+meta.Max > 1) : false;

    // Always flatten single-element arrays for simple, single-instance parameters
    if (!hasElemChildren && !hasQualChildren && !isMultiInstance && Array.isArray(value) && value.length === 1) {
      value = value[0];
    }

    // --- NEW: Skip logic for simple and multi-instance parameters ---
    if (!hasElemChildren && !hasQualChildren && isMultiInstance) {
      // Multi-instance, non-ELEM/QUAL parameter (e.g. PRINT, FMTOPT, SRCOPT)
      const defaultVal = defaults && defaults[key];
      // If value is undefined/null/empty array, skip
      if (
        value === undefined ||
        value === null ||
        (Array.isArray(value) && value.length === 0)
      ) {
        continue;
      }
      // If value is array of length 1, and that value matches the default, and not presentParms, skip
      if (
        Array.isArray(value) &&
        value.length === 1 &&
        defaultVal !== undefined &&
        !presentParms?.has(key) &&
        value[0].toString().trim().toUpperCase() === (Array.isArray(defaultVal) ? defaultVal[0] : defaultVal || '').toString().trim().toUpperCase()
      ) {
        console.log(`[buildCLCommand] Skipping multi-instance parameter ${key} (single default: "${value[0]}")`);
        continue;
      }
    } else if (!hasElemChildren && !hasQualChildren && !isMultiInstance) {
      // Simple, single-instance parameter
      const defaultVal = defaults && defaults[key];
      const valNorm = (Array.isArray(value) ? value[0] : value) || '';
      const defNorm = (Array.isArray(defaultVal) ? defaultVal[0] : defaultVal) || '';
      if (
        valNorm === undefined ||
        valNorm === null ||
        valNorm === '' ||
        (!presentParms?.has(key) &&
          defNorm !== undefined &&
          valNorm.toString().trim().toUpperCase() === defNorm.toString().trim().toUpperCase())
      ) {
        console.log(`[buildCLCommand] Skipping simple parameter ${key} (unchanged default: "${valNorm}")`);
        continue;
      }
    } else {
      // For non-simple parameters, use the old skip logic
      if (
        value === undefined ||
        value === null ||
        value === '' ||
        (!presentParms?.has(key) && defaults && deepEqual(normalizeValue(value), normalizeValue(defaults[key])))
      ) {
        continue;
      }
    }

    const allowedVals = allowedValsMap[key] || [];
    const parmType = updatedTypeMap[key] || "";

    console.log(`[buildCLCommand] Processing ${key}: value=${JSON.stringify(value)}, type=${parmType}`);

    if (hasElemChildren && Array.isArray(value)) {
      // ✅ ELEM parameter with complex structure
      if (parmType === 'ELEM') {
        // Mixed ELEM parameters (simple values and sub-groups)
        const elemParts: string[] = [];
        for (const elemValue of value) {
          if (Array.isArray(elemValue)) {
            // Sub-group: wrap in parentheses after quoting individual values
            const quotedSubValues = elemValue.map(v => quoteIfNeeded(v, allowedVals, parmType));
            elemParts.push(`(${quotedSubValues.join(' ')})`);
          } else {
            // Simple value: quote if needed
            elemParts.push(quoteIfNeeded(elemValue, allowedVals, parmType));
          }
        }

        // Always wrap each instance in parentheses for ELEM with Max > 1
        if (isMultiInstance) {
          const wrappedParts = elemParts.map(part => part.startsWith('(') ? part : `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
          console.log(`[buildCLCommand] Added ELEM (always parens per instance): ${key}(${wrappedParts.join(' ')})`);
        } else {
          cmd += ` ${key}(${elemParts.join(' ')})`;
          console.log(`[buildCLCommand] Added single-instance ELEM: ${key}(${elemParts.join(' ')})`);
        }
      } else {
        // ✅ Regular ELEM parameter (array of parts)
        const elemParts = value.map((vArr: any) =>
          Array.isArray(vArr)
            ? vArr.map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join(' ')
            : quoteIfNeeded(vArr, allowedVals, parmType)
        );

        // Always wrap each instance in parentheses for ELEM with Max > 1
        if (isMultiInstance) {
          const wrappedParts = elemParts.map(part => `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
        } else {
          cmd += ` ${key}(${elemParts.join(' ')})`;
        }
      }
    } else if (hasQualChildren && Array.isArray(value)) {
      // PATCH: Skip if all parts are empty or default and not changed by user
      const defaultVal = defaults && defaults[key];
      const userChanged = presentParms?.has(key);

      // For multi-instance QUAL, value is array of arrays; for single, array of parts
      const allEmptyOrDefault = Array.isArray(value[0])
        ? value.every((vArr: any, idx: number) =>
          Array.isArray(vArr)
            ? vArr.every((v: any, j: number) =>
            (v === undefined || v === null || v === '' ||
              (!userChanged &&
                defaultVal &&
                Array.isArray(defaultVal[idx])
                ? v.toString().trim().toUpperCase() === (defaultVal[idx][j] || '').toString().trim().toUpperCase()
                : v.toString().trim().toUpperCase() === (defaultVal[j] || '').toString().trim().toUpperCase()
              )
            )
            )
            : (vArr === undefined || vArr === null || vArr === '' ||
              (!userChanged &&
                defaultVal &&
                vArr.toString().trim().toUpperCase() === (Array.isArray(defaultVal) ? (defaultVal[idx] || '') : defaultVal).toString().trim().toUpperCase()
              )
            )
        )
        : value.every((v: any, idx: number) =>
        (v === undefined || v === null || v === '' ||
          (!userChanged &&
            defaultVal &&
            v.toString().trim().toUpperCase() === (Array.isArray(defaultVal) ? (defaultVal[idx] || '') : defaultVal).toString().trim().toUpperCase()
          )
        )
        );

      if (allEmptyOrDefault) {
        continue;
      }

      // ✅ QUAL parameter (array of parts)
      if (Array.isArray(value[0])) {
        // Each vArr is an array of QUAL parts (e.g., ['OBJ', 'LIB'])
        const qualParts = value.map((vArr: any) =>
          Array.isArray(vArr)
            ? vArr.slice().filter((x: any) => x !== undefined && x !== null && x !== '').map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join('/')
            : quoteIfNeeded(vArr, allowedVals, parmType) // treat as atomic string
        );

        // Always wrap each instance in parentheses for QUAL with Max > 1
        if (isMultiInstance) {
          const wrappedParts = qualParts.map(part => `(${part})`);
          cmd += ` ${key}(${wrappedParts.join(' ')})`;
          console.log(`[buildCLCommand] Added QUAL (always parens per instance): ${key}(${wrappedParts.join(' ')})`);
        } else {
          cmd += ` ${key}(${qualParts.join(' ')})`;
        }
      } else {
        // Reverse QUAL parts for single instance as well
        const qualPart = value.slice().filter((x: any) => x !== undefined && x !== null && x !== '').map((v: string) => quoteIfNeeded(v, allowedVals, parmType)).join('/');
        cmd += ` ${key}(${qualPart})`;
      }
    } else if (Array.isArray(value)) {
      // ✅ Multi-instance parameter (Max > 1) - regardless of type
      if (isMultiInstance) {
        // Always wrap each value in parens if the parameter has ELEM or QUAL children
        if (hasElemChildren || hasQualChildren) {
          // For multi-instance ELEM/QUAL, wrap each part in parentheses
          const wrappedValues = value.map(v => `(${quoteIfNeeded(v, allowedVals, parmType)})`);
          cmd += ` ${key}(${wrappedValues.join(' ')})`;
          console.log(`[buildCLCommand] Added parameter (ELEM/QUAL, always parens per instance): ${key}(${wrappedValues.join(' ')})`);
        } else {
          // For regular multi-instance parameters, do NOT wrap each value in parens
          // Remove trailing blanks from each quoted string part to avoid extra blanks in continued quoted strings
          // For continued quoted strings, do not trim or alter the quoted parts; just join as-is
          const quotedParts = value.map(v => quoteIfNeeded(v, allowedVals, parmType));
          cmd += ` ${key}(${quotedParts.join(' ')})`;
          console.log(`[buildCLCommand] Added multi-instance parameter (simple type, no trim): ${key}(${quotedParts.join(' ')})`);
        }
      } else {
        // Single instance or single value - no extra parentheses needed
        const quotedParts = value.map(v => quoteIfNeeded(v, allowedVals, parmType));
        cmd += ` ${key}(${quotedParts.join(' ')})`;
      }
    } else {
      // ✅ Simple parameter
      let q = quoteIfNeeded(value, allowedVals, parmType);
      cmd += ` ${key}(${q})`;
    }
  }

  return cmd;
}


function normalizeValue(val: any): any {
  if (typeof val === 'string' && val.includes('/')) {
    return val.split('/');
  }
  return val;
}

function deepEqual(a: any, b: any): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return a === b;
}

function isCLExpression(val: string): boolean {
  // Detect common CL operators
  const ops = ['*CAT', '*TCAT', '*BCAT', '*EQ', '*NE', '*LT', '*LE', '*GT', '*GE'];
  const trimmed = val.trim().toUpperCase();

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return true;
  if (ops.some(op => trimmed.includes(op))) return true;
  // Detect any %functionName( pattern (future-proof for new CL built-ins)
  if (/%[A-Z][A-Z0-9]*\s*\(/i.test(trimmed)) return true;
  // Also treat any value with an ampersand variable and operator as an expression
  if (/&[A-Z][A-Z0-9]*\s*[*%]/i.test(trimmed)) return true;
  return false;
}

export function quoteIfNeeded(val: string, allowedVals: string[] = [], parmType: string = ""): string {
    const trimmed = val.trim();
    const type = parmType.toUpperCase().replace(/^[*]/, "");

    function isCLQuotedString(s: string): boolean {
        if (s.length < 2 || !s.startsWith("'") || !s.endsWith("'")) return false;
        const inner = s.slice(1, -1);
        let i = 0;
        while (i < inner.length) {
            if (inner[i] === "'") {
                if (inner[i + 1] === "'") {
                    i += 2; // Escaped ''
                } else {
                    return false; // Unescaped single quote
                }
            } else {
                i++;
            }
        }
        return true;
    }

    // 1. Do not quote CL variables like &MYVAR
    if (/^&[A-Z][A-Z0-9]{0,9}$/i.test(trimmed)) {
        return trimmed;
    }

    // 2. Do not quote allowed keywords or values (e.g. *YES, *FILE)
    if (allowedVals.some(v => v.toUpperCase() === trimmed.toUpperCase()) || trimmed.startsWith("*")) {
        return trimmed;
    }

    // 3. Already a properly quoted CL string
    if (isCLQuotedString(trimmed)) {
        return trimmed;
    }

    // 4. Double-quoted string from user input
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed;
    }

    // 5. Library-qualified name like QGPL/CUST
    if (/^[A-Z0-9$#@_]+\/[A-Z0-9$#@_]+$/i.test(trimmed)) {
        return trimmed;
    }

    // 6. Unqualified valid CL name
    if (/^[A-Z$#@][A-Z0-9$#@_]{0,10}$/i.test(trimmed)) {
        return trimmed;
    }

    // 7. If type hints at NAME-like field and it's valid
    if (["NAME", "PNAME", "CNAME"].includes(type) && isValidName(trimmed)) {
        return trimmed;
    }

    // 8. CL expression (e.g., *IF &X = &Y)
    if (isCLExpression(trimmed)) {
        return val;
    }

    // 9. Special case: empty quoted or blank
    if (trimmed === "''" || trimmed === "") {
        return "";
    }

    // 10. Numeric literal
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return trimmed;
    }

    // 11. Recover unescaped single-quoted string
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        const inner = trimmed.slice(1, -1).replace(/'/g, "''");
        return `'${inner}'`;
    }

    // 12. Default: Quote and escape embedded single quotes
    return `'${trimmed.replace(/'/g, "''")}'`;
}


export function isValidName(val: string): boolean {
  const trimmed = val.trim();
  if (trimmed.startsWith("&")) {
    return /^[&][A-Z$#@][A-Z0-9$#@_.]{0,10}$/i.test(trimmed);
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return true;
  }
  return /^[A-Z$#@][A-Z0-9$#@_.]{0,10}$/i.test(trimmed);
}


export function extractAllowedValsAndTypes(xml: string): { allowedValsMap: AllowedValsMap, parmTypeMap: ParmTypeMap } {
  const allowedValsMap: AllowedValsMap = {};
  const parmTypeMap: ParmTypeMap = {};
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parms = doc.getElementsByTagName("Parm");
  for (let i = 0; i < parms.length; i++) {
    const parm = parms[i];
    const kwd = parm.getAttribute("Kwd");
    if (!kwd) continue;
    parmTypeMap[kwd] = parm.getAttribute("Type") || "";
    const vals: string[] = [];
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

export function formatCLSource(
  allLines: string[],
  options: FormatOptions,
  startIndex = 0
): string[] {
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

  const outputLines: string[] = [];
  let idx = startIndex;

  while (idx < allLines.length) {
    const source_record = allLines[idx++];
    if (!source_record) { break; }

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

function translateCase(str: string, fromCase: string, toCase: string): string {
  let result = '';
  for (const ch of str) {
    const idx = fromCase.indexOf(ch);
    result += idx >= 0 ? toCase[idx] : ch;
  }
  return result;
}

function buildCommandString(
  source_data: string,
  allLines: string[],
  idx: number
): { value: string; linesConsumed: number } {
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
    // Special handling for quoted string continuations
    if (save_continuation === '+') {
      // If input ends with a single quote and nextData starts with a single quote, do not add a space
      if (input.endsWith("'") && nextData.trimStart().startsWith("'")) {
        input += nextData.trimStart();
      } else {
        input += nextData.trimStart();
      }
    } else {
      if (input.endsWith("'") && nextData.trimEnd().startsWith("'")) {
        input += nextData.trimEnd();
      } else {
        input += nextData.trimEnd();
      }
    }
    linesConsumed++;
  }
  return { value: input, linesConsumed };
}

function convertCaseWithQuotes(input: string, fromCase: string, toCase: string): string {
  let result = '';
  let inQuote = false;
  for (const ch of input) {
    if (ch === "'") {
      inQuote = !inQuote;
      result += ch;
    } else if (!inQuote) {
      const idx = fromCase.indexOf(ch);
      result += idx >= 0 ? toCase[idx] : ch;
    } else {
      result += ch;
    }
  }
  return result;
}

function formatDCL(input: string): string {
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
  } else {
    other = parts.slice(3).join(' ');
  }
  return `${dcl} ${variable}${type}${varlen}${other}`;
}

function writeFormatted(
  input: string,
  sequence: string,
  date: string,
  level: number,
  options: FormatOptions
): string[] {
  // Indent only the first 10 levels
  let indent = '';
  if (level <= 10) {
    indent = ' '.repeat(options.indcol * (level - 1) + options.bgncol);
  } else {
    indent = ' '.repeat(options.indcol * 9 + options.bgncol);
  }
  const maxlength = 70 - indent.length;
  const lines: string[] = [];

  // Simple line breaking logic (does not handle all REXX edge cases)
  let inputLeft = input;
  let continued = false;
  while (inputLeft.length > 0) {
    let chunk = '';
    if (
      (!continued && inputLeft.length <= maxlength) ||
      (continued && inputLeft.length <= maxlength - options.indcont)
    ) {
      chunk = inputLeft;
      inputLeft = '';
    } else {
      // Break at last space before maxlength
      let breakPos = inputLeft.lastIndexOf(' ', maxlength - 1);
      if (breakPos <= 0) { breakPos = maxlength - 1; }
      chunk = inputLeft.slice(0, breakPos) + ' +';
      inputLeft = inputLeft.slice(breakPos).trimStart();
    }
    if (continued) {
      lines.push(sequence + date + indent + ' '.repeat(options.indcont) + chunk);
    } else {
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

export function extractFullCLCmd(lines: string[], currentLine: number): { command: string; startLine: number; endLine: number } {
  let startLine = currentLine;
  let endLine = currentLine;
  // Find the start of the command (look backward for continuation)
  while (startLine > 0) {
    // Remove trailing comments for continuation detection
    let prevLine = lines[startLine - 1];
    let codePart = prevLine.replace(/\/\*.*\*\//g, '').trimEnd();
    if (codePart.endsWith('+') || codePart.endsWith('-')) {
      startLine--;
    } else {
      break;
    }
  }

  let command = '';
  let lineIndex = startLine;

  while (lineIndex < lines.length) {
    let line = lines[lineIndex];
    // Split line into code and trailing comment (if any)
    let codePart = line;
    const commentIdx = line.indexOf('/*');
    if (commentIdx !== -1) {
      codePart = line.substring(0, commentIdx);
    }
    // Remove trailing whitespace
    codePart = codePart.replace(/[ \t]+$/, '');

    // Check for trailing + or - (CL continuation), regardless of quotes
    let contChar = '';
    let lineContent = codePart;
    if (codePart.length > 0 && (codePart[codePart.length - 1] === '+' || codePart[codePart.length - 1] === '-')) {
      contChar = codePart[codePart.length - 1];
      lineContent = codePart.slice(0, -1);
    }

    if (contChar) {
      command += lineContent;
      endLine = lineIndex;
      // Prepare to concatenate the next line
      let nextLine = lines[lineIndex + 1] || '';
      // Remove trailing comment from the next line as well
      let nextContent = nextLine;
      const nextCommentIdx = nextLine.indexOf('/*');
      if (nextCommentIdx !== -1) {
        nextContent = nextLine.substring(0, nextCommentIdx);
      }
      // Remove trailing whitespace
      nextContent = nextContent.replace(/[ \t]+$/, '');
      // Remove trailing + or - from the next line if present (but preserve space before it)
      if (
        nextContent.length > 0 &&
        (nextContent[nextContent.length - 1] === '+' || nextContent[nextContent.length - 1] === '-')
      ) {
        nextContent = nextContent.slice(0, -1);
      }
      if (contChar === '+') {
        let firstNonBlank = nextContent.search(/\S/);
        if (firstNonBlank === -1) firstNonBlank = nextContent.length;
        nextContent = nextContent.slice(firstNonBlank);
      } // for '-' use the whole next line
      command += nextContent;
      // Skip the next line since we've already concatenated it
      lineIndex += 2;
      endLine = lineIndex - 1;
      continue;
    } else {
      command += lineContent;
      endLine = lineIndex;
      break;
    }
  }
  // Remove any double spaces that may have been introduced
  command = command.replace(/\s{2,}/g, ' ').trim();

  return {
    command,
    startLine,
    endLine
  };
}

// Format a CL command string in classic IBM i SEU style
// labelCol: 2, cmdCol: 14, rightMargin: 72 (for 80-byte lines)
/**
 * Format a CL command string in classic IBM i SEU style.
 * - Label at col 2 (if present, uppercased, with colon)
 * - Command at col 14
 * - First parameter at col 25
 * - Right margin at 72
 * - Continuation lines at col 27
 * - Only break at token boundaries (never in the middle of a token)
 * - Tokens: words, quoted strings, parenthesis groups, CL operators
 * - Appends + for true continuations
 */
export function XXX_OLD_CODE_formatCLCmd(
  label: string | undefined,
  cmdName: string,
  paramStr: string,
  rightMargin?: number,
  lineLength?: number
): string {
  // Pull in user or default settings for indentation and margin from VS Code config
  const config = vscode.workspace.getConfiguration('clPrompter');
  const cmdLabelIndent = Number(config.get('cmdLabelIndent', 2));
  const cmdIndent = Number(config.get('cmdIndent', 14));
  const cmdIndentParm = Number(config.get('cmdIndentParm', 25));
  const cmdContIndent = Number(config.get('cmdContIndent', 27));

  rightMargin = rightMargin ?? Number(config.get('cmdRightMargin', 72));
  // Helper: pad to a column (1-based, SEU-style)
  function padToCol(str: string, col: number): string {
    // If str.length >= col - 1, just return str (already at or past desired col)
    if (str.length >= col - 1) return str;
    // Pad so that the string ENDS at col-1, so the NEXT character is at col (1-based)
    return str + ' '.repeat(col - 1 - str.length);
  }

  // Tokenize paramStr into tokens: quoted strings (never split inside), parenthesis groups, CL operators, CL variables, built-in functions (split at argument boundaries), or words
  function tokenizeParams(str: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < str.length) {
      // Skip whitespace
      while (i < str.length && str[i] === ' ') i++;
      if (i >= str.length) break;
      const ch = str[i];
      // Quoted string (never split inside, always keep closing quote)
      if (ch === '\'' || ch === '"') {
        let quote = ch;
        let j = i + 1;
        let val = ch;
        while (j < str.length) {
          val += str[j];
          if (str[j] === quote) {
            // Check for doubled quote (escaped)
            if (j + 1 < str.length && str[j + 1] === quote) {
              val += quote;
              j += 2;
              continue;
            } else {
              j++;
              break;
            }
          }
          j++;
        }
        tokens.push(val);
        i = j;
        continue;
      }
      // Built-in function: %FUNC(...), split at spaces inside parens
      if (ch === '%' && /%[A-Z][A-Z0-9]*/i.test(str.slice(i))) {
        let funcMatch = str.slice(i).match(/^%[A-Z][A-Z0-9]*/i);
        if (funcMatch) {
          let funcName = funcMatch[0];
          let j = i + funcName.length;
          if (str[j] === '(') {
            let depth = 1;
            let val = funcName + '(';
            j++;
            let arg = '';
            let argTokens: string[] = [];
            while (j < str.length && depth > 0) {
              if (str[j] === '(') {
                depth++;
                arg += str[j++];
              } else if (str[j] === ')') {
                depth--;
                if (depth === 0) {
                  if (arg.trim().length > 0) {
                    // Recursively tokenize the argument string
                    argTokens.push(...tokenizeParams(arg.trim()));
                  }
                  arg = '';
                  j++;
                  break;
                } else {
                  arg += str[j++];
                }
              } else if (str[j] === '\'' || str[j] === '"') {
                // Quoted string inside built-in function
                let quote = str[j];
                let qj = j + 1;
                let qval = quote;
                while (qj < str.length) {
                  qval += str[qj];
                  if (str[qj] === quote) {
                    if (qj + 1 < str.length && str[qj + 1] === quote) {
                      qval += quote;
                      qj += 2;
                      continue;
                    } else {
                      qj++;
                      break;
                    }
                  }
                  qj++;
                }
                arg += qval;
                j = qj;
              } else if (str[j] === ' ') {
                // Argument boundary
                if (arg.length > 0) {
                  argTokens.push(arg);
                  arg = '';
                }
                j++;
              } else {
                arg += str[j++];
              }
            }
            // Push the function name and open paren
            tokens.push(funcName + '(');
            // Push argument tokens (already tokenized)
            tokens.push(...argTokens);
            // Push close paren
            tokens.push(')');
            i = j;
            continue;
          }
        }
      }
      // Parenthesis group (may be nested, atomic)
      if (ch === '(') {
        let depth = 1;
        let j = i + 1;
        let val = '(';
        while (j < str.length && depth > 0) {
          if (str[j] === '\'' || str[j] === '"') {
            // Quoted string inside parens
            const quote = str[j];
            val += quote;
            j++;
            while (j < str.length) {
              val += str[j];
              if (str[j] === quote) {
                if (j + 1 < str.length && str[j + 1] === quote) {
                  val += quote;
                  j += 2;
                  continue;
                } else {
                  j++;
                  break;
                }
              }
              j++;
            }
          } else if (str[j] === '(') {
            depth++;
            val += str[j++];
          } else if (str[j] === ')') {
            depth--;
            val += str[j++];
            if (depth === 0) break;
          } else {
            val += str[j++];
          }
        }
        tokens.push(val);
        i = j;
        continue;
      }
      // CL variable: & followed by valid chars (atomic)
      if (ch === '&') {
        let j = i + 1;
        while (j < str.length && /[A-Z0-9$#@_.]/i.test(str[j])) j++;
        tokens.push(str.slice(i, j));
        i = j;
        continue;
      }
      // CL operator: * followed by up to 32 valid chars, then blank or end (atomic)
      if (ch === '*') {
        let j = i + 1;
        let opLen = 1;
        while (j < str.length && str[j] !== ' ' && opLen < 32) {
          j++;
          opLen++;
        }
        tokens.push(str.slice(i, j));
        i = j;
        continue;
      }
      // Word (up to next space, paren, quote, &, *, or %)
      let j = i;
      while (j < str.length && ![' ', '\'', '"', '(', '*', '&', '%'].includes(str[j])) j++;
      if (j > i) {
        tokens.push(str.slice(i, j));
      }
      i = j;
    }
    return tokens;
  }

  // Build the first line: label (if any) at user-configured col (default 2), command at user-configured col (default 14), parameters at user-configured col (default 27 or single space)
  let firstLine = '';
  let cmdAndLabel = '';
  if (label && label.trim()) {
    let trimmed = label.trim().replace(/:+$/, '').toUpperCase() + ':';
    let labelCol = ' '.repeat(Math.max(0, cmdLabelIndent - 1)) + trimmed;
    cmdAndLabel = padToCol(labelCol, cmdIndent) + cmdName;
  } else {
    cmdAndLabel = padToCol('', cmdIndent) + cmdName;
  }
  // Unified logic for parameter alignment
  if (cmdIndentParm === 0) {
    firstLine = cmdAndLabel + ' ';
  } else if (cmdAndLabel.length < cmdIndentParm - 1) {
    firstLine = cmdAndLabel + ' '.repeat(cmdIndentParm - 1 - cmdAndLabel.length);
  } else {
    firstLine = cmdAndLabel;
  }

  // Tokenize paramStr, but treat KWD( as a single token (no space between keyword and paren)
  function tokenizeKwdParen(str: string): string[] {
    const result: string[] = [];
    let i = 0;
    while (i < str.length) {
      // Skip whitespace
      while (i < str.length && str[i] === ' ') i++;
      if (i >= str.length) break;
      // Look for KWD(
      let kwdParen = str.slice(i).match(/^([A-Z0-9$#@_]+)\(/i);
      if (kwdParen) {
        result.push(kwdParen[1] + '(');
        i += kwdParen[1].length + 1;
        continue;
      }
      // Otherwise, fallback to normal tokenizer
      let j = i;
      while (j < str.length && str[j] !== ' ') j++;
      result.push(str.slice(i, j));
      i = j;
    }
    return result;
  }

  // Use the improved tokenizer for the first split, then pass to the main tokenizer for further splitting
  let tokens: string[] = [];
  tokenizeKwdParen(paramStr.trim()).forEach(tok => {
    if (/^[A-Z0-9$#@_]+\($/i.test(tok)) {
      tokens.push(tok); // KWD(
    } else {
      tokens.push(...tokenizeParams(tok));
    }
  });

  // --- Improved SEU-style wrapping: join tokens with SEU rules, break only at valid boundaries ---
  // --- PATCHED joinTokensSEU: Reassemble CL built-in functions as atomic tokens ---
  function joinTokensSEU(tokens: string[]): string {
    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // Handle CL built-in functions: join %FUNC( ... ) as a single token
      if (/^%[A-Z][A-Z0-9]*\($/i.test(t)) {
        let func = t;
        let depth = 1;
        let args: string[] = [];
        i++;
        while (i < tokens.length && depth > 0) {
          if (tokens[i] === '(') depth++;
          if (tokens[i] === ')') depth--;
          if (depth > 0) {
            args.push(tokens[i]);
          }
          if (depth === 0) break;
          i++;
        }
        func += args.join(' ') + ')';
        out += (out && !out.endsWith('(') ? ' ' : '') + func;
        continue;
      }
      if (i === 0) {
        out += t;
      } else {
        const prev = tokens[i - 1];
        // Never add a space after '('
        if (prev.endsWith('(')) {
          out += '';
        } else if (t === ')') {
          out += '';
        } else {
          out += ' ';
        }
        out += t;
      }
    }
    return out;
  }

  let lines: string[] = [];
  // Use custom indents for first and continuation lines
  let firstRoom = rightMargin - firstLine.length;
  // Join tokens with SEU rules (no space after (, no space before ), otherwise one space)
  let paramSEU = joinTokensSEU(tokens);
  // Now, break paramSEU into lines, only at valid SEU boundaries (spaces between tokens, not inside tokens)
  let cur = 0;
  let isFirst = true;
  while (cur < paramSEU.length) {
    let maxLen = isFirst ? firstRoom : rightMargin - (cmdContIndent - 1); // continuation indent
    let chunk = '';
    if (paramSEU.length - cur <= maxLen) {
      chunk = paramSEU.slice(cur);
      cur = paramSEU.length;
    } else {
      // Find last space within maxLen
      let searchEnd = cur + maxLen;
      if (searchEnd > paramSEU.length) searchEnd = paramSEU.length;
      let lastSpace = paramSEU.lastIndexOf(' ', searchEnd);
      if (lastSpace > cur) {
        chunk = paramSEU.slice(cur, lastSpace);
        cur = lastSpace + 1; // skip the space
      } else {
        // No space found, must break in the middle of a token (rare)
        chunk = paramSEU.slice(cur, cur + maxLen);
        cur += maxLen;
      }
    }
    if (isFirst) {
      let out = firstLine + chunk;
      if (cur < paramSEU.length) {
        out += ' +';
      }
      lines.push(out);
      isFirst = false;
    } else {
      let out = ' '.repeat(cmdContIndent - 1) + chunk;
      if (cur < paramSEU.length) {
        out += ' +';
      }
      lines.push(out);
    }
  }
  // Remove trailing spaces
  lines = lines.map(l => l.replace(/\s+$/, ''));
  return lines.join('\n');
}


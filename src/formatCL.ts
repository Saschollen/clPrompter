type CaseOption = '*UPPER' | '*LOWER' | '*NONE';
type IndentRemarks = '*NO' | '*YES';


import { DOMParser } from '@xmldom/xmldom';
import { ParmMeta } from './parseCL';

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


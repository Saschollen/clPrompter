
import { CLParm, CLElem, CLQual, ParmValues, QualPartsMap } from './cltypes';
import * as promptHelpers from './promptHelpers.js';

export function isContainerType(type: string | null | undefined): boolean {
    if (!type) return false;
    const t = type.toUpperCase();
    return t === 'ELEM' || t === 'QUAL' || t === 'CONTAINER';
}

export function populateQualInputs(
    parm: Element | null,
    kwd: string,
    vals: string | string[] | null | undefined,
    container: Document = document
): void {
    const quals = parm ? parm.getElementsByTagName("Qual") : [];
    let parts: string[] = [];

    // Parse input values into parts array
    if (Array.isArray(vals)) {
        parts = vals as string[];
    } else if (typeof vals === "string") {
        // Use your promptHelpers.splitCLQual if available, otherwise fallback to .split("/")
        parts = (promptHelpers && typeof promptHelpers.splitCLQual === "function")
            ? promptHelpers.splitCLQual(vals)
            : vals.split("/");
    }

    // Log parts for debugging
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        console.log(`${kwd} Parts Dump: Parts[${i}] = ${part}`);
    }

    // Left-pad so rightmost value goes to QUAL0
    while (parts.length < quals.length) {
        parts.unshift("");
    }

    // Assign values to QUAL inputs (QUAL0 = file/object, QUAL1 = library, etc.)
    for (let q = 0; q < quals.length; q++) {
        // IBM i convention: QUAL0 gets rightmost value
        const value = parts[q];
        const partIdx = parts.length - 1 - q;

        let input = container.querySelector(`[name="${kwd}_QUAL${q}"]`) as HTMLInputElement | HTMLSelectElement | null;
        if (!input) {
            if (!input) {
                input = container.querySelector(`vscode-single-select[name="${kwd}_QUAL${q}"]`);
            }
            if (!input) {
                input = container.querySelector(`select[name="${kwd}_QUAL${q}"]`);
            }
            if (!input) {
                input = container.querySelector(`#${kwd}_QUAL${q}_custom`);
            }
        }

        // Debug output
        console.log(`[clPrompter] QUAL Value Applied: kwd=${kwd}, q=${q}, partIdx=${partIdx}, parts[q]=value="${value}"`);

        if (input) {
            const tag = input.tagName ? input.tagName.toLowerCase() : "";
            if (tag === 'vscode-single-select') {
                (input as any).value = value;
            } else if (tag === 'select') {
                let foundIdx = -1;
                const selectElem = input as HTMLSelectElement;
                for (let i = 0; i < selectElem.options.length; i++) {
                    if (selectElem.options[i].value.trim().toUpperCase() === value.trim().toUpperCase()) {
                        foundIdx = i;
                        break;
                    }
                }
                if (foundIdx !== -1) {
                    selectElem.selectedIndex = foundIdx;
                    const customInput = container.querySelector(`#${kwd}_QUAL${q}_custom`) as HTMLInputElement | null;
                    if (customInput) customInput.value = "";
                } else {
                    selectElem.selectedIndex = -1;
                    const customInput = container.querySelector(`#${kwd}_QUAL${q}_custom`) as HTMLInputElement | null;
                    if (customInput) customInput.value = value;
                }
            } else {
                (input as HTMLInputElement).value = value;
            }
        }
    }
}

// Populate ELEM inputs for a parameter, including nested ELEM/QUAL and SngVal support
export function populateElemInputs(
    parm: CLParm,
    kwd: string,
    vals: string | string[],
    instanceIdx: number,
    container: Document = document
): void {
    const elems = parm.Elems || [];
    let splitVals: string[] = Array.isArray(vals)
        ? vals
        : (typeof vals === "string" ? vals.split(" ") : []);

    // SngVal support: If SngVal is present and selected, set only that value
    const sngValInput = container.querySelector(`[name="${kwd}_SNGVAL"]`) as HTMLSelectElement | null;
    if (sngValInput && sngValInput.value) {
        const selectedOption = sngValInput.selectedOptions[0];
        if (selectedOption && selectedOption.getAttribute("data-sngval") === "true") {
            // SngVal selected, assign and return
            const input = container.querySelector(`[name="${kwd}_SNGVAL"]`) as HTMLInputElement | null;
            if (input) input.value = sngValInput.value;
            return;
        }
    }

    // Multi-instance support: If MAX > 1, handle repeated groups
    const max = parm.Max ?? 1;
    const numInstances = Math.max(1, max);

    // For each ELEM child, assign value (recursively for nested ELEM/QUAL)
    for (let e = 0; e < elems.length; e++) {
        const elem = elems[e];
        // Compose the input name for this ELEM instance
        const elemName = `${kwd}_ELEM${e}_${instanceIdx}`;
        const value = splitVals[e] ?? elem.Dft ?? "";

        // QUAL child: delegate to populateQualInputs
        if (elem.Type === "QUAL" && elem.Quals) {
            // If you have XML Element for this ELEM, pass it; otherwise, pass null
            populateQualInputs(
                null,
                elemName,
                value,
                container
            );
        }
        // Nested ELEM child: recurse
        else if (elem.Type === "ELEM" && elem.Elems) {
            populateElemInputs(
                elem as CLParm,
                elemName,
                value,
                0,
                container
            );
        }
        // Basic input: assign value directly
        else {
            const input = container.querySelector(`[name="${elemName}"]`) as HTMLInputElement | HTMLSelectElement | null;
            if (input) input.value = value;
        }
    }

    // Remove trailing unchanged defaults (for command assembly, not population)
    // If you want to skip this for population, you can omit this block
    // Otherwise, you can add logic here to clear trailing default values if needed
}

/**
 * Assembles qualified parameter values in LIFO order.
 * For each entry in qualPartsMap, filters out empty/missing parts,
 * reverses the order, and joins with '/'.
 * Example: [Q1, Q2, Q3] => "Q3/Q2/Q1" (if all present)
 */
export function assembleQualParams(
    values: Record<string, any>,
    qualPartsMap: Record<string, (string | undefined | null)[]>
): void {
    for (const [parmName, parts] of Object.entries(qualPartsMap)) {
        if (!Array.isArray(parts) || parts.length === 0) {
            continue; // Skip if parts is not an array or is empty
        }
        // Filter out missing/empty parts
        const filtered = parts
            .filter(p => typeof p === "string" && p.trim() !== "")
            .map(p => (p as string).trim());

        // Reverse for LIFO order (rightmost first)
        const lifo = filtered.reverse();

        if (lifo.length > 0) {
            values[parmName] = lifo.join("/");
        }
    }
}

export function assembleElemParams(
    values: ParmValues,
    parms: Element[],
    originalParamMap?: ParmValues,
    getElemOrQualValue?: (elem: Element, elemName: string, container: Document) => string
): void {
    if (!Array.isArray(parms) || parms.length === 0) {
        // Optionally log or handle the case where parms is missing
        return;
    }
    for (let i = 0; i < parms.length; i++) {
        const parm = parms[i];
        const kwd = parm.getAttribute("Kwd") || "";
        const type = (parm.getAttribute("Type") || "").toUpperCase();
        const isMultiGroup = !!document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`);

        if (type === "ELEM" && !isMultiGroup) {
            // SngVal check
            const sngValInput = document.querySelector(`[name="${kwd}_SNGVAL"]`) as HTMLSelectElement | null;
            if (sngValInput && sngValInput.value) {
                const selectedOption = sngValInput.selectedOptions[0];
                if (selectedOption && selectedOption.getAttribute("data-sngval") === "true") {
                    if (!isUnchangedDefault(sngValInput, sngValInput.value)) {
                        values[kwd] = [sngValInput.value];
                    }
                    continue;
                }
            }

            // No SngVal selected - process ELEM values normally
            const elems = parm.getElementsByTagName("Elem");
            let elemVals: string[] = [];
            for (let e = 0; e < elems.length; e++) {
                const elemName = `${kwd}_ELEM${e}`;
                const elem = elems[e];
                let val = "";
                if (getElemOrQualValue) {
                    val = getElemOrQualValue(elem, elemName, document);
                }
                if (val && val.trim() !== "") elemVals.push(val);
            }
            // Remove trailing unchanged defaults
            while (elemVals.length > 0) {
                const lastIdx = elemVals.length - 1;
                const elemName = `${kwd}_ELEM${lastIdx}`;
                const input = document.querySelector(`[name="${elemName}"]`) as HTMLInputElement | null;
                if (!input) break;
                const val = elemVals[lastIdx];
                if (isUnchangedDefault(input, val)) {
                    elemVals.pop();
                } else {
                    break;
                }
            }
            if (elemVals.length > 0) {
                values[kwd] = elemVals;
            } else if (originalParamMap && Object.prototype.hasOwnProperty.call(originalParamMap, kwd)) {
                let orig = originalParamMap[kwd];
                if (Array.isArray(orig)) {
                    values[kwd] = orig;
                } else if (typeof orig === "string") {
                    values[kwd] = orig.trim().split(/\s+/);
                } else {
                    values[kwd] = [String(orig)];
                }
            }
        }
    }
}

export function isUnchangedDefault(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | Element,
    value: string,
    originalParamMap?: Record<string, any>
): boolean {
    // 1. Always include if user modified
    if (input.getAttribute('data-modified') === 'true') return false;

    // 2. Always include if present in original command (by full name for ELEM, by base for simple)
    const name = input.getAttribute('name') || input.id;
    const baseName = name.split('_')[0];
    if (originalParamMap && (originalParamMap.hasOwnProperty(name) || originalParamMap.hasOwnProperty(baseName))) return false;

    // 3. Compare to default (case-insensitive, trimmed, treat undefined/empty as equal)
    const defaultValue = input.getAttribute('data-default');
    const val = (value || '').trim().toUpperCase();
    const def = (defaultValue || '').trim().toUpperCase();
    if (val === def) return true;

    // 4. If both are empty, treat as unchanged
    if (!val && !def) return true;

    // 5. For QUAL, never skip due to default (handled elsewhere)
    if (name.includes('_QUAL')) return false;

    return false;
}

export function validateRangeInput(
    input: HTMLInputElement | HTMLTextAreaElement | Element,
    allowedValsMap: Record<string, string[]> = {},
    tooltips?: any // If you have a tooltip helper, pass it in
): boolean {
    const fromValue = input.getAttribute('data-range-from');
    const toValue = input.getAttribute('data-range-to');

    if (!fromValue || !toValue) return true; // No range to validate

    const value = (input as HTMLInputElement).value?.trim() || "";

    // Allow empty values (they're optional)
    if (!value) return true;

    // Check if value matches any allowed special value
    const inputName = input.getAttribute('name') || input.id;
    const allowedVals = allowedValsMap[inputName] || [];
    if (allowedVals.includes(value)) return true;

    // Allow any value that starts with * (special values)
    if (value.startsWith('*')) return true;

    // Allow any value that starts with & (CL variables)
    if (value.startsWith('&')) return true;

    // Validate numeric range
    const numValue = parseInt(value, 10);
    const fromNum = parseInt(fromValue, 10);
    const toNum = parseInt(toValue, 10);

    if (isNaN(numValue) || isNaN(fromNum) || isNaN(toNum)) return true; // Can't validate non-numeric, assume valid

    const isValid = numValue >= fromNum && numValue <= toNum;

    if (!isValid) {
        (input as HTMLElement).classList.add('invalid');
        if (tooltips && typeof tooltips.showRangeTooltip === 'function') {
            tooltips.showRangeTooltip(input, `❌ Value ${value} is outside valid range ${fromValue}-${toValue}`, 'error');
        }
        return false;
    } else {
        (input as HTMLElement).classList.remove('invalid');
        return true;
    }
}
export function getDefaultValue(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | Element
): string {
    // Check data-default attribute first
    const dataDefault = input.getAttribute('data-default');
    if (dataDefault) return dataDefault;

    // Check if it's a select with a default option
    const tag = input.tagName.toUpperCase();
    if (tag === 'SELECT' || tag === 'VSCODE-DROPDOWN') {
        const defaultOption =
            (input as HTMLSelectElement).querySelector('option[selected]') ||
            (input as Element).querySelector('vscode-option[selected]');
        if (defaultOption && (defaultOption as HTMLOptionElement).value) {
            return (defaultOption as HTMLOptionElement).value;
        }
    }

    // For other inputs, check the default value property
    if ('defaultValue' in input) {
        return (input as HTMLInputElement | HTMLTextAreaElement).defaultValue || '';
    }

    return '';
}

export function getInputValue(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | Element
): string {
    if (!input) return '';
    const tag = input.tagName.toLowerCase();

    if (tag === 'vscode-textarea' || tag === 'textarea') {
        return (input as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' ');
    }

    if (tag === 'vscode-single-select') {
        return (input as any).value || '';
    }

    if (tag === 'vscode-textfield') {
        return (input as any).value || '';
    }

    // Handle old dropdown with custom input
    if (tag === 'select' && (input as HTMLSelectElement).dataset.customInputId) {
        const customInputId = (input as HTMLSelectElement).dataset.customInputId;
        const customInput = customInputId ? document.getElementById(customInputId) : null;
        if (customInput && (customInput as HTMLInputElement).value.trim() !== "") {
            return (customInput as HTMLInputElement).value.trim();
        } else {
            return (input as HTMLSelectElement).value;
        }
    }

    // Regular input
    return (input as HTMLInputElement).value || '';
}
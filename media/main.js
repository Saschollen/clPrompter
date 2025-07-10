// Utility: Returns true if the type is a container type (ELEM, QUAL, etc)
function isContainerType(type) {
  if (!type) return false;
  const t = type.toUpperCase();
  return t === 'ELEM' || t === 'QUAL' || t === 'CONTAINER';
}
// main.js: Entry point for VS Code webview
// Import all helpers and initialize the UI

import './vscode-elements.js';
import * as promptHelpers from './promptHelpers.js';
import * as tooltips from './tooltips.js';
import * as txtarea from './textarea.js';

let xmlDoc;
let caseMode = "MONO";
let parms = [];
let allowedValsMap = {};
let cmdName = "{{cmdName}}";
let originalParamMap = {};
let vscode;
let isTestMode = false;

try {
  vscode = acquireVsCodeApi();
} catch (e) {
  console.log('[clPrompter] Running in browser test mode (not VS Code)');
  isTestMode = true;

  // Mock VS Code API for testing
  vscode = {
    postMessage: (msg) => console.log('[MOCK] VS Code message:', msg),
    setState: (state) => console.log("[MOCK] Set state:", state),
    getState: () => ({ "[MOCK]": "No state in browser" })
  };

  // ✅ Mock VS Code Elements for Firefox testing
  if (typeof customElements === 'undefined') {
    window.customElements = {
      get: () => null,
      define: () => { },
      keys: function () { return []; }
    };
  }
}

console.log("[clPrompter] webview JS loaded");
// ✅ Update your existing message handler around line 370
window.addEventListener("message", event => {
  const message = event.data;
  console.log("[clPrompter] Received message:", message.type);

  // ✅ Handle reset message FIRST
  if (message.type === "reset") {
    console.log("[clPrompter] Processing reset message");
    resetPrompterState();
    return;
  }

  // Handle configuration updates
  if (message.type === "configuration") {
    console.log("[clPrompter] Received configuration:", message.config);
    const userColor = message.config.keywordColor;
    const autoAdjust = typeof message.config.kwdColorAutoAdjust === 'boolean' ? message.config.kwdColorAutoAdjust : true;
    if (userColor) {
      setKeywordColorVariants(userColor, autoAdjust);
    }
  }

  // ✅ Handle new formData message with pre-processed allowedValsMap
  // In the formData message handler, after loadForm() call (around line 470):

  if (message.type === "formData") {
    console.log("[clPrompter] Processing formData message");
    const parser = new DOMParser();
    xmlDoc = parser.parseFromString(message.xml, "text/xml");

    // ✅ Use pre-processed allowedValsMap from TypeScript
    allowedValsMap = message.allowedValsMap || {};
    cmdName = message.cmdName || cmdName;

    // ✅ CRITICAL: Set originalParamMap from TypeScript
    if (message.paramMap) {
      originalParamMap = message.paramMap;
      console.log("[clPrompter] Received originalParamMap:", originalParamMap);
    }

    if (message.config && message.config.keywordColor) {
      setKeywordColorVariants(message.config.keywordColor);
    }

    // --- Advanced: Generate theme variants for keyword color ---
    function setKeywordColorVariants(baseColor, autoAdjust = true) {
      // Helper: Clamp value
      function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
      }

      // Helper: Convert hex to RGB
      function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) {
          hex = hex.split('').map(x => x + x).join('');
        }
        const num = parseInt(hex, 16);
        return {
          r: (num >> 16) & 255,
          g: (num >> 8) & 255,
          b: num & 255
        };
      }

      // Helper: Convert named color to hex (uses a hidden element)
      function namedColorToHex(colorName) {
        // Fast path for hex
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorName)) {
          return colorName;
        }
        // Create a dummy element to resolve the color
        const temp = document.createElement('div');
        temp.style.color = colorName;
        document.body.appendChild(temp);
        // Get computed color
        const computed = getComputedStyle(temp).color;
        document.body.removeChild(temp);
        // Parse rgb(a) string
        const match = computed.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (match) {
          const r = parseInt(match[1], 10);
          const g = parseInt(match[2], 10);
          const b = parseInt(match[3], 10);
          return rgbToHex({ r, g, b });
        }
        // Fallback: return original
        return colorName;
      }

      // Helper: Adjust brightness (factor > 1 = lighter, < 1 = darker)
      function adjustBrightness({ r, g, b }, factor) {
        return {
          r: clamp(Math.round(r * factor), 0, 255),
          g: clamp(Math.round(g * factor), 0, 255),
          b: clamp(Math.round(b * factor), 0, 255)
        };
      }

      // Helper: Convert RGB to hex
      function rgbToHex({ r, g, b }) {
        return (
          '#' +
          r.toString(16).padStart(2, '0') +
          g.toString(16).padStart(2, '0') +
          b.toString(16).padStart(2, '0')
        );
      }

      // Accept both hex and named colors
      let hexColor = baseColor;
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(baseColor)) {
        hexColor = namedColorToHex(baseColor);
      }

      let light, dark, highContrast;
      if (autoAdjust) {
        let rgb = hexToRgb(hexColor);
        light = rgbToHex(adjustBrightness(rgb, 0.85));
        dark = rgbToHex(adjustBrightness(rgb, 1.35));
        highContrast = rgbToHex(adjustBrightness(rgb, 1.7));
      } else {
        light = dark = highContrast = hexColor;
      }

      // Set CSS variables for each theme
      document.documentElement.style.setProperty('--keyword-color', hexColor);
      document.documentElement.style.setProperty('--keyword-color-light', light);
      document.documentElement.style.setProperty('--keyword-color-dark', dark);
      document.documentElement.style.setProperty('--keyword-color-high-contrast', highContrast);

      console.log(`[clPrompter] Set keyword color variants: base=${hexColor}, light=${light}, dark=${dark}, high-contrast=${highContrast}, autoAdjust=${autoAdjust}`);
    }

    console.log(`[clPrompter] Updated cmdName to: ${cmdName}`);
    console.log(`[clPrompter] Pre-processed allowedValsMap keys:`, Object.keys(allowedValsMap));

    // Sort parameters
    const allParms = Array.from(xmlDoc.getElementsByTagName("Parm"));
    parms = allParms.sort((a, b) => {
      const aPosNbr = a.getAttribute("PosNbr");
      const bPosNbr = b.getAttribute("PosNbr");
      const aPos = aPosNbr ? parseInt(aPosNbr, 10) : 0;
      const bPos = bPosNbr ? parseInt(bPosNbr, 10) : 0;

      if (aPos === bPos) {
        const aIndex = allParms.indexOf(a);
        const bIndex = allParms.indexOf(b);
        return aIndex - bIndex;
      }
      return aPos - bPos;
    });

    console.log("[clPrompter] Found", parms.length, "parameters");

    setMainTitle();
    loadForm();
    console.log("[clPrompter] loadForm completed");

    if (originalParamMap && Object.keys(originalParamMap).length > 0) {
      console.log("[clPrompter] Populating form with original parameter values:", originalParamMap);
      // ✅ Wait for next animation frame (ensures DOM is rendered)
      requestAnimationFrame(() => {
        populateFormFromValues(originalParamMap);
      });
      // setTimeout(() => {
      //  populateFormFromValues(originalParamMap);
      // }, 10); // ✅ Minimal 10ms delay - just enough for DOM rendering
    }
  }

  // ✅ Existing handlers...
  if (message.type === "setLabel") {
    console.log("[clPrompter] Setting label:", message.label);
    setLabel(message.label);
  }

  // ✅ LEGACY: Handle old formXml for backward compatibility (remove this later)
  if (message.type === "formXml") {
    console.warn("[clPrompter] Received legacy formXml message - this should be migrated to formData handler");
    const parser = new DOMParser();
    xmlDoc = parser.parseFromString(message.xml, "text/xml");

    // ... existing formXml logic as fallback ...
    buildAllowedValsMap(); // ✅ Keep for now as fallback
    setMainTitle();
    loadForm();
    // Add this right after the form loads in prompter.html
    setTimeout(() => {
      console.log("[clPrompter] DEBUG: All TOPGMQ inputs created:");
      const topgmqInputs = document.querySelectorAll('[name*="TOPGMQ"]');
      topgmqInputs.forEach(input => {
        console.log(`  ${input.tagName}[name="${input.name}"][id="${input.id}"]`);
      });
    }, 1000);
  }
});


function detectVSCodeTheme() {
  // ✅ Detect VS Code theme for better color defaults
  const body = document.body;
  const computedStyle = getComputedStyle(body);
  const bgColor = computedStyle.getPropertyValue('--vscode-editor-background') || computedStyle.backgroundColor;

  // Simple heuristic: if background is dark, use lighter keyword color
  const isLightTheme = bgColor.includes('rgb(') &&
    bgColor.split(',').slice(0, 3).every(val => parseInt(val.replace(/\D/g, '')) > 128);

  body.setAttribute('data-vscode-theme-kind', isLightTheme ? 'vscode-light' : 'vscode-dark');

  console.log(`[clPrompter] Detected theme: ${isLightTheme ? 'light' : 'dark'}`);
}


// ✅ Add this function around line 350 (after global variables)
function resetPrompterState() {
  console.log("[clPrompter] Resetting prompter state for new command");

  // Clear global state
  xmlDoc = null;
  parms = [];
  allowedValsMap = {};
  originalParamMap = {};

  // Clear the form
  const form = document.getElementById("clForm");
  if (form) {
    form.innerHTML = "";
  }

  // Clear the main title
  const mainTitle = document.getElementById("mainTitle");
  if (mainTitle) {
    mainTitle.textContent = "";
  }

  // Clear the label input
  const labelInput = document.getElementById("clLabel");
  if (labelInput) {
    labelInput.value = "";
  }

  // Hide any tooltips
  if (typeof hideRangeTooltip === 'function') {
    tooltips.hideRangeTooltip();
  }

  console.log("[clPrompter] Prompter state reset completed");
}
function applyCase(val) {
  if (caseMode === "MONO") {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      return trimmed;
    }
    return trimmed.toUpperCase();
  }
  return val;
}

function setLabel(val) {
  const labelInput = document.getElementById("clLabel");
  if (labelInput) labelInput.value = val || "";
}
function setMainTitle() {
  if (!xmlDoc) return;
  const cmdElem = xmlDoc.querySelector("Cmd");
  if (!cmdElem) return;
  const prompt = cmdElem.getAttribute("Prompt") || cmdElem.getAttribute("CmdName") || "CL Command";
  const cmdName = cmdElem.getAttribute("CmdName") || "";
  const title = `${prompt}${cmdName ? " (" + cmdName + ")" : ""} Prompt`;
  const mainTitle = document.getElementById("mainTitle");
  if (mainTitle) mainTitle.textContent = title;
}

function getDefaultForInput(input, parms) {
  let name = input.name;
  let kwd = name;
  let qualIdx = null;
  let qualPrompt = null;
  const qualMatch = name.match(/^(.+?)_(.+)$/);
  if (qualMatch) {
    kwd = qualMatch[1];
    qualPrompt = qualMatch[2];
  }
  const parm = Array.from(parms).find(p => p.getAttribute("Kwd") === kwd);
  if (!parm) return "";
  if (qualPrompt) {
    const quals = parm.getElementsByTagName("Qual");
    for (let q = 0; q < quals.length; q++) {
      const qual = quals[q];
      if ((qual.getAttribute("Prompt") || q.toString()) === qualPrompt || qualPrompt == q.toString()) {
        if (qual.getAttribute("Dft")) return qual.getAttribute("Dft");
        if (qual.getAttribute("Min") === "0") return "";
        return null;
      }
    }
  }
  if (name.includes("_ELEM")) {
    const elemMatch = name.match(/^(.+?)_ELEM(\d+)/);
    if (elemMatch) {
      const elemIdx = parseInt(elemMatch[2], 10);
      const elems = parm.getElementsByTagName("Elem");
      if (elems[elemIdx]) {
        if (elems[elemIdx].getAttribute("Dft")) return elems[elemIdx].getAttribute("Dft");
        if (elems[elemIdx].getAttribute("Min") === "0") return "";
        return null;
      }
    }
  }
  if (parm.getAttribute("Dft")) return parm.getAttribute("Dft");
  if (parm.getAttribute("Min") === "0") return "";
  return null;
}





// ✅ Helper function to set element values consistently
// Only keep one definition of setElementValue (the more general one below)
// NOTE: All calls to setElementValue should use the local function defined below (container, elemName, value)

function createParameterInput(name, allowedVals, noCustomInput = false, defaultValue = "") {
  if (allowedVals && allowedVals.length > 0) {
    // ✅ Check for range metadata
    const rangeMetadata = allowedVals.find(v => v.startsWith('_RANGE_'));
    const hasRange = !!rangeMetadata;

    const parm = Array.from(parms).find(p => p.getAttribute("Kwd") === name);
    const effectiveLen = parm ? calculateFieldWidth(parm, allowedVals) : 25;
    const widthClass = promptHelpers.getLengthClass(effectiveLen);

    // ✅ HYBRID APPROACH: Use dropdown for restricted, textfield with custom dropdown for flexible
    if (noCustomInput && customElements.get('vscode-single-select')) {
      // ✅ Restricted parameters - Pure dropdown (no combobox attribute)
      const select = document.createElement('vscode-single-select');
      select.name = name;
      select.id = name;
      select.className = widthClass;

      if (defaultValue) {
        select.setAttribute('data-default', defaultValue);
        select.value = defaultValue;
      }

      // Track user modification
      select.setAttribute('data-modified', 'false');
      select.addEventListener('change', function () {
        select.setAttribute('data-modified', 'true');
      });

      // Add empty option first
      const emptyOption = document.createElement('vscode-option');
      emptyOption.value = "";
      emptyOption.textContent = "";
      select.appendChild(emptyOption);

      // Add options (filter out range metadata)
      allowedVals.forEach(val => {
        if (val && val !== '_noCustomInput' && !val.startsWith('_RANGE_')) {
          const option = document.createElement('vscode-option');
          option.value = val;
          option.textContent = val;
          if (val === defaultValue) {
            option.selected = true;
          }
          select.appendChild(option);
        }
      });

      console.log(`[clPrompter] Created restricted vscode-single-select dropdown for ${name}`);
      return select;

    } else if (customElements.get('vscode-textfield')) {
      // ✅ Flexible parameters - Custom textfield with dropdown list
      const container = document.createElement('div');
      container.style.position = 'relative';
      container.style.display = 'inline-block';
      // container.style.width = '100%';

      const textfield = document.createElement('vscode-textfield');
      textfield.name = name;
      textfield.id = name;
      textfield.className = widthClass;
      // textfield.style.width = 'auto';


      if (defaultValue) {
        textfield.setAttribute('data-default', defaultValue);
        textfield.value = defaultValue;
      }

      // Track user modification
      textfield.setAttribute('data-modified', 'false');
      textfield.addEventListener('input', function () {
        textfield.setAttribute('data-modified', 'true');
      });
      textfield.addEventListener('change', function () {
        textfield.setAttribute('data-modified', 'true');
      });

      // ✅ Add range validation attributes if range exists
      if (hasRange) {
        const rangeParts = rangeMetadata.split('_');
        if (rangeParts.length >= 4) {
          const fromValue = rangeParts[2];
          const toValue = rangeParts[3];

          // ✅ Set data attributes for your custom validation
          textfield.setAttribute('data-range-from', fromValue);
          textfield.setAttribute('data-range-to', toValue);

          // ✅ Also set HTML5 min/max to match (for native validation)
          textfield.setAttribute('min', fromValue);
          textfield.setAttribute('max', toValue);

          console.log(`[clPrompter] Set both custom and HTML5 range: ${fromValue}-${toValue}`);
        }
      }

      // ✅ Create custom dropdown list
      const suggestionsList = document.createElement('ul');
      suggestionsList.className = 'dropdown-list';
      suggestionsList.id = `${name}_suggestions`;
      suggestionsList.style.cssText = `
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 3px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        max-height: 200px;
        overflow-y: auto;
        z-index: 1000;
        margin: 0;
        padding: 0;
        list-style: none;
        display: none;
      `;

      // Add suggestion items
      const suggestionOptions = allowedVals.filter(v => v && v !== '_noCustomInput' && !v.startsWith('_RANGE_'));
      suggestionOptions.forEach(val => {
        const listItem = document.createElement('li');
        listItem.textContent = val;
        listItem.style.cssText = `
          padding: 6px 12px;
          cursor: pointer;
          border-bottom: 1px solid var(--vscode-dropdown-border);
          color: var(--vscode-dropdown-foreground);
        `;

        // Hover effects
        listItem.addEventListener('mouseenter', () => {
          listItem.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
        });
        listItem.addEventListener('mouseleave', () => {
          listItem.style.backgroundColor = '';
        });

        // Click to select
        listItem.addEventListener('click', () => {
          textfield.value = val;
          suggestionsList.style.display = 'none';
          textfield.dispatchEvent(new Event('input'));
          textfield.dispatchEvent(new Event('change'));
          textfield.focus();
        });

        suggestionsList.appendChild(listItem);
      });



      // ✅ Filter suggestions as user types + range validation
      textfield.addEventListener('input', (e) => {
        const inputValue = e.target.value.toLowerCase();
        const listItems = suggestionsList.querySelectorAll('li');

        let hasVisibleItems = false;
        listItems.forEach(item => {
          const text = item.textContent.toLowerCase();
          if (text.includes(inputValue) || inputValue === '') {
            item.style.display = 'block';
            hasVisibleItems = true;
          } else {
            item.style.display = 'none';
          }
        });

        // Show/hide dropdown based on matching items
        suggestionsList.style.display = hasVisibleItems ? 'block' : 'none';

        // ✅ Range validation with tooltip - MOVED HERE FROM WRONG LOCATION
        if (hasRange) {
          validateRangeInput(e.target);
        }
      });

      // ✅ Enhanced change event for range validation
      textfield.addEventListener('change', function (e) {
        if (hasRange) {
          validateRangeInput(e.target);
        }
      });

      // ✅ Enhanced event listeners - REMOVED SUCCESS TOOLTIPS
      textfield.addEventListener('focus', () => {
        if (suggestionOptions.length > 0) {
          suggestionsList.style.display = 'block';
        }

        // ✅ Clear any existing tooltip first, then show focus tooltip
        tooltips.hideRangeTooltip();
        if (hasRange) {
          const fromValue = textfield.getAttribute('data-range-from');
          const toValue = textfield.getAttribute('data-range-to');
          // ✅ Use configurable duration
          tooltips.showRangeTooltip(textfield, `💡 Enter a number between ${fromValue} and ${toValue}`, 'info');
        }
      });

      textfield.addEventListener('blur', (e) => {
        // Delay hiding to allow clicking on suggestions
        setTimeout(() => {
          suggestionsList.style.display = 'none';

          // ✅ Just hide tooltip on blur - no success tooltip
          if (!textfield.matches(':hover')) {
            tooltips.hideRangeTooltip();
          }
        }, 150);
      });


      // ✅ Keyboard navigation
      textfield.addEventListener('keydown', (e) => {
        const visibleItems = Array.from(suggestionsList.querySelectorAll('li')).filter(li => li.style.display !== 'none');
        const currentSelected = suggestionsList.querySelector('li.selected');
        let selectedIndex = currentSelected ? visibleItems.indexOf(currentSelected) : -1;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          suggestionsList.style.display = 'block';
          selectedIndex = Math.min(selectedIndex + 1, visibleItems.length - 1);
          updateSelection(visibleItems, selectedIndex);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIndex = Math.max(selectedIndex - 1, 0);
          updateSelection(visibleItems, selectedIndex);
        } else if (e.key === 'Enter') {
          if (currentSelected) {
            e.preventDefault();
            currentSelected.click();
          }
        } else if (e.key === 'Escape') {
          suggestionsList.style.display = 'none';
          tooltips.hideRangeTooltip();
        }
      });

      function updateSelection(items, index) {
        items.forEach((item, i) => {
          if (i === index) {
            item.classList.add('selected');
            item.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground)';
            item.style.color = 'var(--vscode-list-activeSelectionForeground)';
          } else {
            item.classList.remove('selected');
            item.style.backgroundColor = '';
            item.style.color = 'var(--vscode-dropdown-foreground)';
          }
        });
      }

      // ✅ Add enhanced placeholder hint
      if (!hasRange) {
        const optionsPreview = suggestionOptions.slice(0, 3).join(', ');
        textfield.placeholder = `e.g., ${optionsPreview}${suggestionOptions.length > 3 ? '...' : ''}`;
      }

      // ✅ Add hover support for range inputs - MOVED TO CORRECT LOCATION
      if (hasRange) {
        addRangeHoverSupport(textfield);
      }

      container.appendChild(textfield);
      container.appendChild(suggestionsList);

      console.log(`[clPrompter] Created vscode-textfield with custom dropdown (${suggestionOptions.length} options) for ${name}`);
      return container;
    }
  }

  // ✅ For parameters without predefined values, use plain vscode-textfield
  if (customElements.get('vscode-textfield')) {
    const textfield = document.createElement('vscode-textfield');
    textfield.name = name;
    textfield.id = name;

    if (defaultValue) {
      textfield.setAttribute('data-default', defaultValue);
      textfield.value = defaultValue;
    }

    console.log(`[clPrompter] Created plain vscode-textfield for ${name}`);
    return textfield;
  }

  // Final fallback to regular HTML input
  const input = document.createElement('input');
  input.type = 'text';
  input.name = name;
  input.id = name;

  if (defaultValue) {
    input.setAttribute('data-default', defaultValue);
    input.value = defaultValue;
  }

  return input;
}



// ✅ Enhanced hover support function - REMOVED SUCCESS TOOLTIPS
function addRangeHoverSupport(input) {
  const fromValue = input.getAttribute('data-range-from');
  const toValue = input.getAttribute('data-range-to');

  if (!fromValue || !toValue) return;

  // ✅ Remove native title attribute to prevent dual tooltips
  input.removeAttribute('title');

  // ✅ Show hint on hover (when not focused and no tooltip exists)
  input.addEventListener('mouseenter', () => {
    // ✅ Only show hover tooltip if field is NOT focused
    if (document.activeElement !== input && !tooltips.currentTooltip) {
      const value = input.value.trim();
      let message, type;

      if (!value) {
        message = `💡 Range: ${fromValue} to ${toValue}. Click to enter a value.`;
        type = 'hint';
      } else if (value.startsWith('*')) {
        message = `💡 Special value: "${value}". Range: ${fromValue}-${toValue}`;
        type = 'hint';
      } else {
        const numValue = parseInt(value, 10);
        const fromNum = parseInt(fromValue, 10);
        const toNum = parseInt(toValue, 10);

        if (!isNaN(numValue) && !isNaN(fromNum) && !isNaN(toNum)) {
          if (numValue >= fromNum && numValue <= toNum) {
            message = `✅ "${value}" is valid (range: ${fromValue}-${toValue})`;
            type = 'hint'; // ✅ Changed from 'success' to 'hint'
          } else {
            message = `❌ "${value}" is invalid (range: ${fromValue}-${toValue})`;
            type = 'error';
          }
        } else {
          message = `❓ "${value}" - Expected number in range ${fromValue}-${toValue}`;
          type = 'hint';
        }
      }

      // ✅ Use configurable hover duration
      tooltips.showRangeTooltip(input, message, type, tooltips.getTooltipSettings().hoverDuration);
    }
  });

  // ✅ Hide on mouse leave (unless focused)
  input.addEventListener('mouseleave', () => {
    if (document.activeElement !== input) {
      setTimeout(() => {
        if (document.activeElement !== input && tooltips.currentTooltip) {
          tooltips.hideRangeTooltip();
        }
      }, 100);
    }
  });

  // ✅ Clear tooltip immediately when user starts typing
  input.addEventListener('input', () => {
    tooltips.hideRangeTooltip();
  });

  // ✅ Clear tooltip when focus leaves the input
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== input && !input.matches(':hover')) {
        tooltips.hideRangeTooltip();
      }
    }, 150);
  });
}



function createDropdownWithCustomInput(name, dropdownVals, placeholder = "Or enter custom value", sngvalList = [], noCustomInput = false) {
  const container = document.createElement("span");
  const select = document.createElement("select");
  select.name = name;
  const sngvalSet = new Set(sngvalList);
  const sngvalOpts = dropdownVals.filter(val => sngvalSet.has(val));
  const otherOpts = dropdownVals.filter(val => !sngvalSet.has(val));
  const sngvalGroup = document.createElement("optgroup");
  sngvalGroup.label = "Single Values";
  sngvalOpts.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    opt.dataset.sngval = "true";
    sngvalGroup.appendChild(opt);
  });
  select.appendChild(sngvalGroup);
  const otherGroup = document.createElement("optgroup");
  otherGroup.label = "Other Values";
  otherOpts.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    otherGroup.appendChild(opt);
  });
  select.appendChild(otherGroup);
  if (sngvalOpts.length > 0) select.dataset.hasSngval = "true";
  if (!noCustomInput) {
    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.placeholder = placeholder;
    customInput.className = "clvar-input";
    customInput.id = name + "_custom";
    customInput.addEventListener("input", function () {
      if (customInput.value.trim() !== "") {
        select.selectedIndex = -1;
      }
    });
    select.addEventListener("change", function () {
      customInput.value = "";
    });
    select.dataset.customInputId = customInput.id;
    container.appendChild(select);
    container.appendChild(customInput);
  } else {
    container.appendChild(select);
  }
  return container;
}



// Replace populateElemInputs function around line 1280:

function populateElemInputs(parm, kwd, vals, instanceIdx = 0, container = document) {
  console.log(`[clPrompter] ===== populateElemInputs START =====`);
  console.log(`[clPrompter] populateElemInputs: ${kwd}, vals:`, vals, `instanceIdx: ${instanceIdx}`);

  const elems = parm ? parm.getElementsByTagName("Elem") : [];
  console.log(`[clPrompter] ${kwd} - Found ${elems.length} elements`);

  // ✅ Check for PARM-level default (SngVal)
  let parmDefault = null;
  if (parm) {
    parmDefault = parm.getAttribute("Dft");
    if (!parmDefault) {
      const sngVal = parm.querySelector('SngVal');
      if (sngVal) {
        const defaultSngVal = sngVal.querySelector('Value');
        if (defaultSngVal) {
          parmDefault = defaultSngVal.getAttribute('Val');
          console.log(`[clPrompter] ${kwd} - Found SngVal default: "${parmDefault}"`);
        }
      }
    }
  }

  const isMultiInstance = container !== document && container.closest('.parm-multi-group');
  console.log(`[clPrompter] ${kwd} - isMultiInstance: ${isMultiInstance}, parmDefault: "${parmDefault}"`);


  let splitVals = [];

  // Robust ELEM multi-instance parsing
  if (!vals || vals === "" || vals === null || vals === undefined) {
    if (parmDefault) {
      console.log(`[clPrompter] ${kwd} - No user values, using PARM default: "${parmDefault}"`);
      // Check if this is a SngVal
      const sngValInput = container.querySelector(`[name="${kwd}_SNGVAL"]`) ||
        container.querySelector(`[name="${kwd}_SNGVAL_${instanceIdx}"]`) ||
        document.querySelector(`[name="${kwd}_SNGVAL"]`);
      if (sngValInput) {
        console.log(`[clPrompter] ${kwd} - Setting SngVal input to default: "${parmDefault}"`);
        sngValInput.value = parmDefault;
        const options = sngValInput.querySelectorAll('vscode-option, option');
        const matchingOption = Array.from(options).find(opt =>
          opt.value === parmDefault && opt.getAttribute('data-sngval') === 'true'
        );
        if (matchingOption) {
          console.log(`[clPrompter] ${kwd} - Default "${parmDefault}" is a SngVal, skipping ELEM population`);
          return;
        }
      }
      splitVals = [parmDefault];
    } else {
      splitVals = [];
    }
  } else if (Array.isArray(vals)) {
    splitVals = vals;
  } else if (typeof vals === 'string') {
    let cleanValue = vals.trim();
    // Remove outer parentheses if present
    if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
      cleanValue = cleanValue.slice(1, -1);
      console.log(`[clPrompter] ${kwd} - Stripped parentheses: "${vals}" -> "${cleanValue}"`);
    }
    // Always split the value into ELEM parts for each instance
    if (cleanValue) {
      splitVals = promptHelpers.parseSpaceSeparatedValues(cleanValue);
    } else {
      splitVals = [];
    }
  } else {
    splitVals = [];
  }

  console.log(`[clPrompter] ${kwd} - Final split values:`, splitVals);

  // ✅ FIXED: Populate each ELEM with the corresponding value
  for (let e = 0; e < elems.length; e++) {
    const elem = elems[e];
    const elemType = elem.getAttribute("Type") || "CHAR";
    const elemName = isMultiInstance ? `${kwd}_ELEM${e}_${instanceIdx}` : `${kwd}_ELEM${e}`;

    // ✅ Use splitVals[e] or individual ELEM default
    let value = splitVals[e] !== undefined ? splitVals[e] : "";
    if (!value) {
      value = elem.getAttribute("Dft") || "";
    }

    console.log(`[clPrompter] ${kwd} - Processing element ${e}: ${elemName} = "${value}"`);

    // ✅ FIXED: Find and set the actual input element
    let input = container.querySelector(`[name="${elemName}"]`);

    if (!input) {
      input = container.querySelector(`vscode-single-select[id="${elemName}"]`) ||
        container.querySelector(`vscode-textfield[id="${elemName}"]`) ||
        container.querySelector(`vscode-textarea[id="${elemName}"]`) ||
        container.querySelector(`textarea[id="${elemName}"]`) ||
        container.querySelector(`vscode-single-select[name="${elemName}"]`) ||
        container.querySelector(`vscode-textfield[name="${elemName}"]`) ||
        container.querySelector(`vscode-textarea[name="${elemName}"]`) ||
        container.querySelector(`textarea[name="${elemName}"]`);
    }

    console.log(`SETTING: tagName=${input.tagName.toLowerCase()} input.value = ${value}`)
    if (input) {
      if (input.tagName.toLowerCase() === 'vscode-single-select') {
        input.value = value;
      } else if (input.tagName.toLowerCase() === 'vscode-textfield') {
        input.value = value;
      } else {
        input.value = value;
      }
      console.log(`[clPrompter] Set ${elemName} to: "${value}"`);
    } else {
      console.log(`[clPrompter] NO INPUT FOUND for ${elemName}`);
    }
  }

  console.log(`[clPrompter] ===== populateElemInputs END =====`);
}

// parseSpaceSeparatedValues is now imported from promptHelpers.js


// ✅ NEW: Helper function to populate individual ELEM input
function populateElemInput(elem, elemName, elemType, value, container) {
  // ✅ Handle nested ELEM (ELEM within ELEM) - like TOPGMQ's "Call stack entry identifier"
  if (elemType === "ELEM") {
    console.log(`[clPrompter] Found nested ELEM: ${elemName}`);

    // ✅ Parse the nested value - strip parentheses and split on spaces
    let subValues = [];
    if (typeof value === 'string' && value.trim() !== '') {
      let cleanValue = value.trim();

      // ✅ Remove surrounding parentheses if present
      if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
        cleanValue = cleanValue.slice(1, -1); // Remove first and last character
        console.log(`[clPrompter] Stripped parentheses: "${value}" -> "${cleanValue}"`);
      }

      subValues = cleanValue.split(' ').filter(v => v.trim() !== '');
    } else if (Array.isArray(value)) {
      subValues = value;
    }

    console.log(`[clPrompter] Nested ELEM sub-values:`, subValues);

    // Get the sub-elements
    const subElems = elem.querySelectorAll(":scope > Elem");
    console.log(`[clPrompter] Found ${subElems.length} sub-elements`);

    // Populate each sub-element
    for (let se = 0; se < subElems.length; se++) {
      const subElemName = `${elemName}_${se}`;
      const subValue = subValues[se] !== undefined ? subValues[se] : "";

      console.log(`[clPrompter] Processing sub-element ${se}: ${subElemName} = "${subValue}"`);
      setElementValue(container, subElemName, subValue);
    }
  } else {
    // ✅ Regular element processing
    setElementValue(container, elemName, value);
  }
}

// ✅ NEW: Helper function to set element value in correct container
function setElementValue(container, elemName, value) {
  let input = container.querySelector(`[name="${elemName}"]`);

  if (!input) {
    // Try VS Code Elements
    const vsCodeSelect = container.querySelector(`vscode-single-select[name="${elemName}"]`);
    const vsCodeTextfield = container.querySelector(`vscode-textfield[name="${elemName}"]`);
    const vsCodeTextarea = container.querySelector(`vscode-textarea[name="${elemName}"]`);
    const htmlTextarea = container.querySelector(`textarea[name="${elemName}"]`);
    input = vsCodeSelect || vsCodeTextfield || vsCodeTextarea || htmlTextarea;
  }

  if (!input) {
    // Try select+custom pattern
    const select = container.querySelector(`select[name="${elemName}"]`);
    const customInput = container.querySelector(`#${elemName}_custom`);

    if (select && customInput) {
      // Handle select+custom logic
      let foundIdx = -1;
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value.trim().toUpperCase() === value.trim().toUpperCase()) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx !== -1 && value) {
        select.selectedIndex = foundIdx;
        customInput.value = "";
        console.log(`[clPrompter] Set select option for ${elemName}: "${value}"`);
      } else if (value) {
        select.selectedIndex = -1;
        customInput.value = value;
        console.log(`[clPrompter] Set custom input for ${elemName}: "${value}"`);
      }
      return;
    }
  }

  if (input) {
    if (input.tagName.toLowerCase() === 'vscode-single-select') {
      // Handle VS Code select
      input.value = value;
      console.log(`[clPrompter] Set VS Code select for ${elemName}: "${value}"`);
    } else {
      // Handle regular input
      input.value = value;
      console.log(`[clPrompter] Set regular input for ${elemName}: "${value}"`);
    }
  } else {
    console.log(`[clPrompter] NO INPUT FOUND for ${elemName}`);

    // ✅ Debug: List all available inputs in container
    const allInputs = container.querySelectorAll('input, select, vscode-single-select, vscode-textfield');
    console.log(`[clPrompter] Available inputs in container:`,
      Array.from(allInputs).map(inp => `${inp.tagName}[name="${inp.name}"][id="${inp.id}"]`)
    );
  }
}

function populateQualInputs(parm, kwd, vals, container = document) {
  const quals = parm ? parm.getElementsByTagName("Qual") : [];
  let parts;
  if (Array.isArray(vals)) {
    parts = vals;
  } else if (typeof vals === "string") {
    parts = promptHelpers.splitCLQual(vals);
  } else {
    parts = [];
  }

  // Remove empty/undefined parts from the right (trailing empty qualifiers)
  while (parts.length > 0 && (!parts[parts.length - 1] || parts[parts.length - 1].trim() === "")) {
    parts.pop();
  }

  // Right-align parts: QUAL0 gets last part, QUAL1 gets next-to-last, etc.
  for (let q = quals.length - 1; q >= 0; q--) {
    // Map: QUALq (right-to-left) gets parts[quals.length - 1 - q]
    const partIdx = quals.length - 1 - q;
    const value = (partIdx < parts.length && parts[partIdx] && parts[partIdx].trim() !== "") ? parts[partIdx] : "";

    let input = container.querySelector(`[name="${kwd}_QUAL${q}"]`);
    if (!input) {
      input = container.querySelector(`vscode-single-select[name="${kwd}_QUAL${q}"]`) ||
        container.querySelector(`select[name="${kwd}_QUAL${q}"]`) ||
        container.querySelector(`#${kwd}_QUAL${q}_custom`);
    }

    // Debug output
    console.log(`[clPrompter] QUAL PATCH: kwd=${kwd}, q=${q}, partIdx=${partIdx}, value="${value}"`);
    if (input) {
      if (input.tagName && input.tagName.toLowerCase() === 'vscode-single-select') {
        input.value = value;
      } else if (input.tagName && input.tagName.toLowerCase() === 'select') {
        let foundIdx = -1;
        for (let i = 0; i < input.options.length; i++) {
          if (input.options[i].value.trim().toUpperCase() === value.trim().toUpperCase()) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx !== -1) {
          input.selectedIndex = foundIdx;
          const customInput = container.querySelector(`#${kwd}_QUAL${q}_custom`);
          if (customInput) customInput.value = "";
        } else {
          input.selectedIndex = -1;
          const customInput = container.querySelector(`#${kwd}_QUAL${q}_custom`);
          if (customInput) customInput.value = value;
        }
      } else {
        input.value = value;
      }
    }
  }
}

function calculateFieldWidth(parm, allowedVals) {
  const type = (parm.getAttribute('Type') || 'CHAR').toUpperCase();
  let lenAttr = parm.getAttribute('Len') || '';
  const kwd = parm.getAttribute('Kwd') || 'UNKNOWN';
  const isRestricted = parm.getAttribute('Rstd') === 'YES';

  if (isContainerType(type)) {
    console.log(`[calculateFieldWidth] ${kwd}: Container type ${type}, using default length`);
    return 40;
  }

  // Use default length for type if no Len attribute
  let effectiveLen;
  if (!lenAttr) {
    // Use promptHelpers.getDefaultLengthForType if available
    if (typeof promptHelpers !== 'undefined' && promptHelpers.getDefaultLengthForType) {
      effectiveLen = promptHelpers.getDefaultLengthForType(type);
    } else {
      // fallback
      switch (type) {
        case 'DEC': effectiveLen = 15; break;
        case 'LGL': effectiveLen = 1; break;
        case 'CHAR': effectiveLen = 32; break;
        case 'NAME': case 'SNAME': case 'CNAME': effectiveLen = 10; break;
        case 'PNAME': effectiveLen = 32; break;
        case 'GENERIC': effectiveLen = 10; break;
        case 'HEX': effectiveLen = 1; break;
        case 'X': effectiveLen = 15; break;
        case 'VARNAME': effectiveLen = 11; break;
        case 'CMD': case 'CMDSTR': effectiveLen = 256; break;
        default: effectiveLen = 10;
      }
    }
  } else {
    effectiveLen = 10;
  }

  // Handle type-specific base lengths if Len is present
  if (lenAttr) {
    switch (type) {
      case 'INT2':
        effectiveLen = 6;
        break;
      case 'INT4':
        effectiveLen = 11;
        break;
      case 'UINT2':
        effectiveLen = 5;
        break;
      case 'UINT4':
        effectiveLen = 10;
        break;
      case 'VARNAME':
        effectiveLen = parseInt(lenAttr, 10) || 11;
        break;
      case 'NAME':
      case 'PNAME':
      case 'SNAME':
      case 'CNAME':
        effectiveLen = parseInt(lenAttr, 10) || 10;
        break;
      case 'DATE':
        effectiveLen = 10;
        break;
      case 'TIME':
        effectiveLen = 8;
        break;
      case 'LGL':
        effectiveLen = 1;
        break;
      case 'DEC':
        if (lenAttr.includes('.')) {
          const [totalDigits] = lenAttr.split('.').map(s => parseInt(s, 10));
          effectiveLen = totalDigits + 1;
        } else {
          effectiveLen = parseInt(lenAttr, 10) || 10;
        }
        break;
      case 'X':
        if (lenAttr.includes('.')) {
          const parts = lenAttr.split('.');
          if (parts.length >= 3) {
            const charLen = parseInt(parts[0], 10) || 10;
            const numDigits = parseInt(parts[1], 10) || 10;
            const numDecimals = parseInt(parts[2], 10) || 0;
            const numDisplayLen = numDigits + 1;
            effectiveLen = Math.max(charLen, numDisplayLen);
            console.log(`[calculateFieldWidth] ${kwd}: Type X - CharLen=${charLen}, NumFormat=${numDigits}.${numDecimals}, DisplayLen=${numDisplayLen}, Using=${effectiveLen}`);
          } else if (parts.length === 2) {
            const charLen = parseInt(parts[0], 10) || 10;
            const numLen = parseInt(parts[1], 10) || 10;
            effectiveLen = Math.max(charLen, numLen);
            console.log(`[calculateFieldWidth] ${kwd}: Type X - CharLen=${charLen}, NumLen=${numLen}, Using=${effectiveLen}`);
          } else {
            effectiveLen = parseInt(parts[0], 10) || 10;
          }
        } else {
          effectiveLen = parseInt(lenAttr, 10) || 10;
        }
        break;
      case 'GENERIC':
        effectiveLen = parseInt(lenAttr, 10) || 10;
        break;
      case 'NULL':
      case 'ZEROELEM':
        effectiveLen = 0;
        break;
      case 'CMD':
      case 'CMDSTR':
        effectiveLen = parseInt(lenAttr, 10) || 2000;
        break;
      case 'CHAR':
      default:
        effectiveLen = parseInt(lenAttr, 10) || 25;
        break;
    }
  }

  // ✅ NEW: Find the longest SPCVAL/SNGVAL value
  let maxSpcValLen = 0;
  if (Array.isArray(allowedVals)) {
    allowedVals.forEach(val => {
      if (val && val !== '_noCustomInput' && !val.startsWith('_RANGE_')) {
        maxSpcValLen = Math.max(maxSpcValLen, val.length);
      }
    });
  }

  // ✅ NEW: For restricted fields, also check SpcVal/SngVal directly from XML
  const spcVals = parm.querySelectorAll('SpcVal Value, SngVal Value');
  spcVals.forEach(valElem => {
    const val = valElem.getAttribute('Val');
    if (val && val !== '*NULL') {
      maxSpcValLen = Math.max(maxSpcValLen, val.length);
    }
  });

  // ✅ NEW: If this is a restricted field, prioritize SpcVal lengths over declared length
  let finalLen;
  if (isRestricted && maxSpcValLen > 0) {
    finalLen = Math.max(effectiveLen, maxSpcValLen);
    console.log(`[calculateFieldWidth] ${kwd}: Restricted field - DeclaredLen=${effectiveLen}, MaxspcValLen=${maxSpcValLen}, Using=${finalLen}`);
  } else {
    finalLen = Math.max(effectiveLen, maxSpcValLen);
  }

  console.log(`[calculateFieldWidth] ${kwd}: Type=${type}, Len=${lenAttr}, Rstd=${isRestricted}, Calculated=${effectiveLen}, MaxSpcVal=${maxSpcValLen}, Final=${finalLen}`);

  return finalLen;
}



async function populateFormFromValues(paramMap) {
  console.log("[clPrompter] populateFormFromValues called with:", paramMap);
  // Normalize all parameter keys to uppercase for DOM and XML matching
  const upperParamMap = {};
  for (const [k, v] of Object.entries(paramMap)) {
    upperParamMap[k.toUpperCase()] = v;
  }
  console.log("[clPrompter] Keys to process:", Object.keys(upperParamMap));

  for (const [kwd, vals] of Object.entries(upperParamMap)) {
    const parm = Array.from(parms).find(p => p.getAttribute("Kwd") === kwd);
    if (!parm) {
      console.warn(`[clPrompter] [populateFormFromValues] No Parm XML found for ${kwd}`);
      continue;
    }
    const isElem = parm.getElementsByTagName("Elem").length > 0;
    const isQual = parm.getElementsByTagName("Qual").length > 0;
    const max = parseInt(parm.getAttribute("Max") || "1", 10);
    const group = document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`);

    // --- Multi-instance (MAX > 1) ---
    if (max > 1 && group) {
      let splitValsArr = [];
      if (isElem) {
        // ELEM multi-instance: robust group splitting
        if (typeof vals === 'string' && vals.trim().startsWith('(')) {
          splitValsArr = promptHelpers.splitTopLevelParenGroups(vals).map(v => {
            let s = v.trim();
            if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
            return s;
          });
        } else if (Array.isArray(vals)) {
          splitValsArr = vals;
        } else if (typeof vals === 'string') {
          splitValsArr = [vals];
        }
        splitValsArr = splitValsArr.filter(v => v !== undefined && v !== null && v.toString().trim() !== "");
      } else if (isQual) {
        // QUAL multi-instance: always treat as array, filter empty
        if (Array.isArray(vals)) {
          splitValsArr = vals.filter(v => v && v.trim() !== "");
        } else if (typeof vals === 'string') {
          splitValsArr = promptHelpers.flattenParmValue(vals).filter(v => v && v.trim() !== "");
        }
      } else {
        // Simple multi-instance: always treat as array, never drop single value
        if (Array.isArray(vals)) {
          splitValsArr = vals;
        } else if (typeof vals === 'string') {
          splitValsArr = promptHelpers.flattenParmValue(vals);
        } else if (vals !== undefined && vals !== null && vals !== "") {
          splitValsArr = [vals];
        }
        splitValsArr = splitValsArr.filter(v => v !== undefined && v !== null && v.toString().trim() !== "");
      }
      // Remove all but the first instance
      let instances = group.querySelectorAll('.parm-instance');
      for (let i = 1; i < instances.length; i++) instances[i].remove();
      for (let i = 0; i < splitValsArr.length; i++) {
        if (i > 0) {
          const addBtn = group.querySelector('.add-parm-btn');
          if (addBtn) {
            addBtn.click();
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        const currentInstances = group.querySelectorAll('.parm-instance');
        const inst = currentInstances[i];
        if (!inst) continue;
        if (isElem) {
          populateElemInputs(parm, kwd, splitValsArr[i], i, inst);
        } else if (isQual) {
          populateQualInputs(parm, kwd, splitValsArr[i], inst);
        } else {
          // Simple parameter
          const paramValue = (splitValsArr[i] !== undefined && splitValsArr[i] !== null && splitValsArr[i] !== "")
            ? splitValsArr[i].toString().trim()
            : getDefaultForInput(null, parms);
          let input =
            inst.querySelector(`vscode-textarea[name="${kwd}"]`) ||
            inst.querySelector(`textarea[name="${kwd}"]`) ||
            inst.querySelector(`[name="${kwd}"]`);
          if (input) {
            input.value = paramValue;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const select = inst.querySelector(`select[name="${kwd}"]`);
            const customInput = inst.querySelector(`#${kwd}_custom`);
            if (select && customInput) {
              let foundIdx = -1;
              for (let j = 0; j < select.options.length; j++) {
                if (select.options[j].value.trim().toUpperCase() === (paramValue || "").trim().toUpperCase()) {
                  foundIdx = j;
                  break;
                }
              }
              if (foundIdx !== -1 && paramValue) {
                select.selectedIndex = foundIdx;
                customInput.value = "";
              } else if (paramValue) {
                select.selectedIndex = -1;
                customInput.value = paramValue;
              } else {
                select.selectedIndex = -1;
                customInput.value = "";
              }
            }
          }
        }
      }
      handleSngvalLocking(group);
      continue;
    }

    // --- Single-instance ---
    if (isElem) {
      if (vals !== undefined && vals !== null && vals.toString().trim() !== "") {
        populateElemInputs(parm, kwd, vals, 0, document);
      }
      continue;
    }
    if (isQual) {
      if (vals !== undefined && vals !== null && vals.toString().trim() !== "") {
        populateQualInputs(parm, kwd, vals, document);
      }
      continue;
    }
    // Simple single-instance
    const paramValue = Array.isArray(vals) ? vals[0] : vals;
    if (paramValue !== undefined && paramValue !== null && paramValue.toString().trim() !== "") {
      let input =
        document.querySelector(`vscode-textarea[name="${kwd}"]`) ||
        document.querySelector(`textarea[name="${kwd}"]`) ||
        document.querySelector(`[name="${kwd}"]`);
      if (input) {
        input.value = paramValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const select = document.querySelector(`select[name="${kwd}"]`);
        const customInput = document.querySelector(`#${kwd}_custom`);
        if (select && customInput) {
          let foundIdx = -1;
          for (let j = 0; j < select.options.length; j++) {
            if (select.options[j].value.trim().toUpperCase() === (paramValue || "").trim().toUpperCase()) {
              foundIdx = j;
              break;
            }
          }
          if (foundIdx !== -1 && paramValue) {
            select.selectedIndex = foundIdx;
            customInput.value = "";
          } else if (paramValue) {
            select.selectedIndex = -1;
            customInput.value = paramValue;
          } else {
            select.selectedIndex = -1;
            customInput.value = "";
          }
        }
      }
    }
  }

  document.querySelectorAll('.elem-group').forEach(group => handleSngvalLocking(group));
}

function setupSngValLockingForFirstElem(container, firstElemSelectId, kwd) {
  const firstElemSelect = container.querySelector(`#${firstElemSelectId}`);
  if (!firstElemSelect) return;

  function updateElemLocking() {
    const selectedOption = firstElemSelect.selectedOptions[0];
    const isSngVal = selectedOption && selectedOption.getAttribute("data-sngval") === "true";

    // Find all OTHER ELEM inputs in this container (not the first one)
    const otherElemInputs = container.querySelectorAll(`[name^="${kwd}_ELEM"]:not([name="${firstElemSelectId}"])`);

    if (isSngVal) {
      // SngVal selected - disable and clear all OTHER ELEM inputs
      otherElemInputs.forEach(input => {
        input.disabled = true;
        input.value = "";

        const parent = input.closest('.form-div');
        if (parent) {
          parent.style.opacity = '0.5';
          parent.title = 'Disabled because single value is selected above';
        }
      });
    } else {
      // No SngVal selected - enable all OTHER ELEM inputs
      otherElemInputs.forEach(input => {
        input.disabled = false;

        const parent = input.closest('.form-div');
        if (parent) {
          parent.style.opacity = '1';
          parent.title = '';
        }
      });
    }
  }

  // Listen for changes
  firstElemSelect.addEventListener('change', updateElemLocking);

  // Initial setup
  updateElemLocking();
}



function handleSngvalLocking(container) {
  const sngvalSelects = container.querySelectorAll('select[data-has-sngval="true"]');
  sngvalSelects.forEach(select => {
    function updateLocking() {
      const isSngval =
        select.value &&
        select.selectedIndex !== -1 &&
        select.options[select.selectedIndex].dataset.sngval === "true";

      const allInputs = Array.from(container.querySelectorAll('input, select')).filter(i => {
        if (i === select) return false;
        if (i.id && select.dataset.customInputId && i.id === select.dataset.customInputId) return false;
        return true;
      });

      if (isSngval) {
        allInputs.forEach(i => {
          i.disabled = true;
          if (i.tagName === "SELECT") i.selectedIndex = -1;
          else i.value = "";
        });
      } else {
        allInputs.forEach(i => i.disabled = false);
      }

      const multiGroup = container.closest('.parm-multi-group');
      if (multiGroup) {
        const addBtn = multiGroup.querySelector('.add-parm-btn');
        if (addBtn) addBtn.disabled = isSngval;
        if (isSngval) {
          multiGroup.querySelectorAll('.parm-instance').forEach(inst => {
            if (inst !== container) inst.style.display = "none";
          });
        } else {
          multiGroup.querySelectorAll('.parm-instance').forEach(inst => {
            inst.style.display = "";
          });
        }
      }
    }

    select.addEventListener('change', function () {
      if (select.dataset.customInputId) {
        const customInput = document.getElementById(select.dataset.customInputId);
        if (customInput) customInput.value = "";
      }
      updateLocking();
    });

    updateLocking();
  });
}

function createInputForType(type, name, value, len, allowedVals = []) {

  console.log(`[createInputForType] type=${type}, name=${name}, value=${value}, len=${len}`);

  try {
    const upperType = (type || 'CHAR').toUpperCase().replace('*', '');
    const typeCategory = promptHelpers.getTypeCategory(upperType);

    if (typeCategory === 'CONTAINER') {
      console.error(`[clPrompter] Container type ${upperType} should not reach createInputForType`);
      return null;
    }

    if (typeCategory === 'UNKNOWN') {
      console.warn(`[clPrompter] Unknown type ${upperType}, treating as CHAR`);
    }

    // ✅ Replace lines 2033-2034 with this simpler fix:
    let parm = Array.from(parms).find(p => p.getAttribute("Kwd") === name);

    // ✅ For ELEM inputs, find the parent parameter
    if (!parm && name.includes('_ELEM')) {
      const parentKwd = name.split('_ELEM')[0];
      parm = Array.from(parms).find(p => p.getAttribute("Kwd") === parentKwd);
    }

    const effectiveLen = parm ? calculateFieldWidth(parm, []) : (parseInt(len, 10) || 25);

    const widthClass = promptHelpers.getLengthClass(effectiveLen);

    let input;
    const useVSCodeElements = customElements.get('vscode-textfield') &&
      customElements.get('vscode-textarea');

    console.log(`[clPrompter] Starting switch(${upperType}) for ${name},  EffectiveLen: ${effectiveLen}, WidthClass: ${widthClass}`);
    // ✅ First, handle all type-specific logic (no textarea creation here)
    switch (upperType) {
      case 'DEC':
      case 'INT2':
      case 'INT4':
      case 'UINT2':
      case 'UINT4':
        console.log(`[clPrompter] Processing number type: ${upperType}`);

        if (useVSCodeElements) {
          input = document.createElement('vscode-textfield');
          input.className = widthClass;
          input.setAttribute('type', 'number');

          const hasXMLRange = parm && (
            parm.getAttribute('RangeMinVal') ||
            parm.getAttribute('RangeMaxVal')
          );

          if (hasXMLRange) {
            const minVal = parm.getAttribute('RangeMinVal');
            const maxVal = parm.getAttribute('RangeMaxVal');

            if (minVal) input.setAttribute('min', minVal);
            if (maxVal) input.setAttribute('max', maxVal);

            console.log(`[clPrompter] ${name} - Using XML range: ${minVal} to ${maxVal}`);
          } else {
            if (upperType === 'INT2') {
              input.setAttribute('min', '-32768');
              input.setAttribute('max', '32767');
            } else if (upperType === 'INT4') {
              input.setAttribute('min', '-2147483648');
              input.setAttribute('max', '2147483647');
            } else if (upperType === 'UINT2') {
              input.setAttribute('min', '0');
              input.setAttribute('max', '65535');
            } else if (upperType === 'UINT4') {
              input.setAttribute('min', '0');
              input.setAttribute('max', '4294967295');
            }

            console.log(`[clPrompter] ${name} - Using type constraints for ${upperType}`);
          }

          if (upperType === 'DEC' && len && len.includes('.')) {
            const [, decimalPlaces] = len.split('.');
            const step = parseFloat(`0.${'0'.repeat(parseInt(decimalPlaces) - 1)}1`);
            input.setAttribute('step', step.toString());
          }
        } else {
          input = document.createElement("input");
          input.type = "number";
          input.className = widthClass;
        }
        break;

      case 'VARNAME':
        console.log(`[clPrompter] Processing VARNAME type: ${upperType}`);
        if (useVSCodeElements) {
          input = document.createElement('vscode-textfield');
          input.className = widthClass;
          input.setAttribute('pattern', '&[A-Z][A-Z0-9]*');
          input.placeholder = '&VARIABLENAME';
          input.title = 'CL variable name (must start with &)';
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.className = widthClass;
          input.pattern = "&[A-Z][A-Z0-9]*";
          input.placeholder = "&VARIABLENAME";
        }
        break;

      case 'NAME':
      case 'PNAME':
      case 'SNAME':
      case 'CNAME':
      case 'GENERIC':
        console.log(`[clPrompter] Processing name type: ${upperType}`);
        if (useVSCodeElements) {
          input = document.createElement('vscode-textfield');
          input.className = widthClass;
          input.placeholder = 'Name';
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.className = widthClass;
        }
        break;

      case 'DATE':
        console.log(`[clPrompter] Processing date type: ${upperType}`);
        if (useVSCodeElements) {
          input = document.createElement('vscode-textfield');
          input.setAttribute('type', 'date');
          input.className = 'input-md';
        } else {
          input = document.createElement("input");
          input.type = "date";
          input.className = 'input-md';
        }
        break;

      case 'TIME':
        console.log(`[clPrompter] Processing time type: ${upperType}`);
        if (useVSCodeElements) {
          input = document.createElement('vscode-textfield');
          input.setAttribute('type', 'time');
          input.className = 'input-sm';
        } else {
          input = document.createElement("input");
          input.type = "time";
          input.className = 'input-sm';
        }
        break;

      case 'LGL':
        console.log(`[clPrompter] Processing logical type: ${upperType}`);
        if (useVSCodeElements) {
          input = document.createElement('vscode-single-select');
          input.className = 'input-xs';

          const opt0 = document.createElement('vscode-option');
          opt0.value = '0';
          opt0.textContent = '0 (False)';

          const opt1 = document.createElement('vscode-option');
          opt1.value = '1';
          opt1.textContent = '1 (True)';

          input.appendChild(opt0);
          input.appendChild(opt1);
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.className = 'input-xs';
          input.placeholder = "0 or 1";
        }
        break;

      case 'X':
        console.log(`[clPrompter] Processing any-type (X) parameter: ${upperType}`);

        let charLen = 25, numDigits = 10, numDecimals = 0;
        if (len && len.includes('.')) {
          const parts = len.split('.');
          if (parts.length >= 3) {
            charLen = parseInt(parts[0], 10) || 25;
            numDigits = parseInt(parts[1], 10) || 10;
            numDecimals = parseInt(parts[2], 10) || 0;
          } else if (parts.length === 2) {
            charLen = parseInt(parts[0], 10) || 25;
            numDigits = parseInt(parts[1], 10) || 10;
          }
        } else if (len) {
          charLen = parseInt(len, 10) || 25;
        }

        if (useVSCodeElements) {
          input = document.createElement('vscode-textfield');
          input.className = widthClass;
          input.placeholder = `Text (max ${charLen}) or Number (${numDigits}.${numDecimals})`;
          input.title = `Accepts character data (max ${charLen} chars) or numeric data (${numDigits} digits, ${numDecimals} decimals)`;
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.className = widthClass;
          input.placeholder = `Text or Number`;
        }

        input.setAttribute('maxlength', charLen.toString());
        break;

      case 'NULL':
      case 'ZEROELEM':
        console.log(`[clPrompter] Processing hidden type: ${upperType}`);
        input = document.createElement("input");
        input.type = "hidden";
        break;

      default:
        console.log(`[clPrompter] Processing default/CHAR type: ${upperType}`);
        if (
          upperType === 'CHAR' &&
          useVSCodeElements &&
          customElements.get('vscode-textarea')
        ) {
          let actualLen = effectiveLen;
          let declaredLen = parseInt(len, 10);
          if (!isNaN(declaredLen) && declaredLen > 0) {
            actualLen = Math.max(actualLen, declaredLen);
          }
          if (actualLen > 80) {
            console.log(`[clPrompter] Creating vscode-textarea for ${name}, Len="${len}", Value="${value}", AllowedVals=${allowedVals}`);
            input = document.createElement('vscode-textarea');
            input.className = widthClass;
            input.name = name;
            input.id = name;
            input.value = value || '';
            input.setAttribute('maxlength', actualLen);
            input.rows = Math.min(Math.ceil(actualLen / 80), 5);
            input.style.minHeight = '60px';
            input.setAttribute('data-default', value || '');
            input.setAttribute('data-modified', 'false');
            input.addEventListener('input', function () {
              input.setAttribute('data-modified', 'true');
            });
            input.addEventListener('change', function () {
              input.setAttribute('data-modified', 'true');
            });
            break;
          }
        }
        // Fallback to textfield if not textarea
        if (useVSCodeElements) {
          input = document.createElement('vscode-textfield');
          input.className = widthClass;
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.className = widthClass;
        }
        break;
    }

    // ✅ AFTER type processing: Convert to textarea if length exceeds threshold
    let actualLen = effectiveLen; // Start with calculated width

    // Override with declared length if it's larger and makes sense
    let declaredLen = parseInt(len, 10);
    if (!isNaN(declaredLen) && declaredLen > 0) {
      actualLen = Math.max(actualLen, declaredLen);
    }
    console.log(`${actualLen} =CreatTextareaWithComboBox ${name}, Len="${len}", Value="${value}", AlwoedVals=${allowedVals}`);

    if (actualLen > 80 && allowedVals && allowedVals.length > 1) {
      console.log(`Calling CreatTextareaWithComboBox ${name}, Len="${len}", Value="${value}", AlwoedVals=${allowedVals}`);
      return createTextareaWithCombobox(name, value, actualLen, allowedVals);
    }

    // ✅ Set common attributes (redundant for textarea, but safe for all)
    // PATCH: Always set name to the parameter keyword for single-instance (_INST0)
    if (input) {
      input.name = input.name || (name.includes('_INST0') ? name.replace('_INST0', '') : name);
      input.id = name;
    }

    if (value) {
      input.value = value;
      input.setAttribute('data-default', value);
      console.log(`[clPrompter] Set value for ${name}: ${value}`);
    }

    if (declaredLen && input.tagName !== 'SELECT') {
      if (input.tagName.toLowerCase() === 'vscode-textfield' ||
        input.tagName.toLowerCase() === 'vscode-textarea' ||
        input.tagName === 'INPUT' ||
        input.tagName === 'TEXTAREA') {
        input.setAttribute("maxlength", declaredLen);
        console.log(`[clPrompter] Set maxlength for ${name}: ${declaredLen}`);
      }
    }

    // ✅ Add VARNAME validation
    if (input.getAttribute('pattern') === '&[A-Z][A-Z0-9]*') {
      input.addEventListener('input', function (e) {
        const value = e.target.value.toUpperCase();
        if (value && !value.startsWith('&')) {
          e.target.value = '&' + value;
        }
        e.target.value = e.target.value.toUpperCase();
      });

      input.addEventListener('blur', function (e) {
        const value = e.target.value;
        if (value && !value.match(/^&[A-Z][A-Z0-9]*$/)) {
          e.target.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
          e.target.title = 'Invalid CL variable name. Must be &VARIABLENAME format.';
        } else {
          e.target.style.borderColor = '';
          e.target.title = 'CL variable name (must start with &)';
        }
      });
    }

    // --- MODIFIED TRACKING ---
    input.setAttribute('data-modified', 'false');
    input.addEventListener('input', function () {
      input.setAttribute('data-modified', 'true');
    });
    input.addEventListener('change', function () {
      input.setAttribute('data-modified', 'true');
    });

    console.log(`[clPrompter] Successfully created ${input.tagName.toLowerCase()} for ${name}, class=${input.className}`);
    return input;

  } catch (error) {
    console.error(`[clPrompter] Error in createInputForType for ${name}:`, error);

    const fallbackInput = document.createElement("input");
    fallbackInput.type = "text";
    fallbackInput.name = name;
    fallbackInput.id = name;
    fallbackInput.className = 'input-md';

    if (value) {
      fallbackInput.value = value;
      fallbackInput.setAttribute('data-default', value);
    }

    return fallbackInput;
  }
}

function isValidName(val) {
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

function setupSngValLocking(container, sngValSelectId, kwd) {
  const sngValSelect = container.querySelector(`#${sngValSelectId}`);
  if (!sngValSelect) return;

  function updateSngValLocking() {
    const selectedOption = sngValSelect.selectedOptions[0];
    const isSngVal = selectedOption && selectedOption.getAttribute("data-sngval") === "true";

    // Find all ELEM inputs in this container
    const elemInputs = container.querySelectorAll(`[name^="${kwd}_ELEM"]`);

    if (isSngVal) {
      // SngVal selected - disable and clear all ELEM inputs
      elemInputs.forEach(input => {
        input.disabled = true;
        if (input.tagName === "SELECT") {
          input.selectedIndex = -1;
        } else {
          input.value = "";
        }
      });
    } else {
      // No SngVal selected - enable all ELEM inputs
      elemInputs.forEach(input => {
        input.disabled = false;
      });
    }
  }

  // Listen for changes
  sngValSelect.addEventListener('change', updateSngValLocking);

  // Initial setup
  updateSngValLocking();
}

function getDropdownOrCustomValue(selectElem) {
  if (selectElem && selectElem.dataset.customInputId) {
    const customInput = document.getElementById(selectElem.dataset.customInputId);
    if (customInput && customInput.value.trim() !== "") {
      return customInput.value.trim();
    } else {
      return selectElem.value;
    }
  }
  return selectElem.value;
}

function renderParmInstance(parm, kwd, idx, max, multiGroupDiv) {
  const type = (parm.getAttribute("Type") || "").toUpperCase();
  const prompt = parm.getAttribute("Prompt") || kwd;
  const dft = parm.getAttribute("Dft") || "";
  const len = parm.getAttribute("Len") || "";
  const required = parm.getAttribute("Min") === "1";
  const instanceId = `${kwd}_INST${idx}`;

  const div = document.createElement("div");
  div.className = "parm-instance";
  div.dataset.kwd = kwd;

  // Determine parameter type and render accordingly
  const isElem = (type === "ELEM" || parm.getElementsByTagName("Elem").length > 0);
  const isQual = parm.getElementsByTagName("Qual").length > 0;

  // Add label for simple parameters only
  if (!isElem && !isQual) {
    addParameterLabel(div, prompt, kwd, idx, max, instanceId);
  }

  // Render based on parameter type
  if (isElem) {
    renderElemParameter(parm, kwd, idx, div, prompt, dft, max); // ✅ Pass max
  } else if (isQual) {
    renderQualParm(parm, kwd, div, prompt, idx, max); // ✅ Pass idx and max
  } else {
    renderSimpleParameter(parm, kwd, div, dft, required, instanceId);
  }

  // Add multi-instance controls
  if (max > 1 && multiGroupDiv) {
    addMultiInstanceControls(div, parm, kwd, idx, max, multiGroupDiv);
  }

  return div;
}


function formatPromptWithKeyword(prompt, kwd, idx = null, max = 1) {
  let labelText = prompt;

  if (idx === 0 && kwd && !prompt.includes(`(${kwd})`)) {
    // ✅ Add keyword with highlighting
    labelText += ` (<span class="keyword-highlight">${kwd}</span>)`;
  }

  if (max > 1 && idx !== null) {
    labelText += ` [${idx + 1}]`;
  }

  return labelText;
}

function addParameterLabel(container, prompt, kwd, idx, max, instanceId) {
  const label = document.createElement("label");
  label.className = "form-label";

  // ✅ Use innerHTML instead of textContent to allow HTML formatting
  label.innerHTML = formatPromptWithKeyword(prompt, kwd, idx, max);
  label.htmlFor = instanceId;
  container.appendChild(label);
}

// Update renderElemParameter function around line 2670:

function renderElemParameter(parm, kwd, idx, container, prompt, dft, max = 1) {
  console.log(`[clPrompter] Processing ELEM parameter: ${kwd}, instance: ${idx}, max: ${max}`);

  const fieldset = document.createElement("fieldset");
  fieldset.className = "elem-group";

  // Add legend with highlighted keyword
  const legend = document.createElement("legend");
  // ✅ Use innerHTML instead of textContent
  legend.innerHTML = formatPromptWithKeyword(prompt, kwd, idx, max);
  fieldset.appendChild(legend);

  const isMultiInstance = max > 1;
  addElemChildren(fieldset, parm, kwd, idx, isMultiInstance);

  container.appendChild(fieldset);
  console.log(`[clPrompter] Completed ELEM parameter: ${kwd}`);
}

function addSngValControl(container, parm, kwd, prompt, dft, sngVal, instanceIdx = 0, isMultiInstance = false) {
  console.log(`[clPrompter] Adding SngVal for ${kwd}, instance: ${instanceIdx}, dft: "${dft}"`);

  // ✅ Use PARM-level default if no explicit dft provided
  let effectiveDefault = dft;
  if (!effectiveDefault) {
    effectiveDefault = parm.getAttribute("Dft");
  }

  const sngValDiv = document.createElement("div");
  sngValDiv.className = "form-div";

  const sngValLabel = document.createElement("label");
  sngValLabel.className = "form-label";
  sngValLabel.textContent = prompt;

  const sngValId = isMultiInstance ? `${kwd}_SNGVAL_${instanceIdx}` : `${kwd}_SNGVAL`;
  sngValLabel.htmlFor = sngValId;
  sngValDiv.appendChild(sngValLabel);

  const sngValSelect = document.createElement("vscode-single-select");
  sngValSelect.id = sngValId;
  sngValSelect.name = sngValId;
  sngValSelect.setAttribute("combobox", "");

  // ✅ Set default using effective default
  if (effectiveDefault) {
    sngValSelect.setAttribute('data-default', effectiveDefault);
  }

  // Add empty option first
  const emptyOption = document.createElement("vscode-option");
  emptyOption.value = "";
  emptyOption.textContent = "(specify individual elements)";
  sngValSelect.appendChild(emptyOption);

  // Add SngVal options
  const sngValues = sngVal.querySelectorAll("Value");
  if (sngValues.length > 0) {
    sngValues.forEach(val => {
      const option = document.createElement("vscode-option");
      option.value = val.getAttribute("Val");
      option.textContent = val.getAttribute("Val");
      option.setAttribute("data-sngval", "true");

      // ✅ Select effective default option
      if (val.getAttribute("Val") === effectiveDefault) {
        option.selected = true;
        sngValSelect.value = effectiveDefault;
        console.log(`[clPrompter] ${kwd} - Set SngVal default to: "${effectiveDefault}"`);
      }

      sngValSelect.appendChild(option);
    });
  }


  // ✅ Add Values options (if any)
  const values = parm.querySelector("Values");
  if (values) {
    const valuesGroup = document.createElement("optgroup");
    valuesGroup.label = "Values";

    const valueElements = values.querySelectorAll("Value");
    valueElements.forEach(val => {
      const valText = val.getAttribute("Val");

      // Don't duplicate SngVal entries
      const isDuplicate = Array.from(sngValues).some(sngVal =>
        sngVal.getAttribute("Val") === valText
      );

      if (!isDuplicate) {
        const option = document.createElement("vscode-option");
        option.value = valText;
        option.textContent = valText;

        if (valText === dft) {
          option.selected = true;
          sngValSelect.value = dft;
        }

        valuesGroup.appendChild(option);
      }
    });

    if (valuesGroup.children.length > 0) {
      sngValSelect.appendChild(valuesGroup);
    }
  }

  // ✅ Add SpcVal options last
  const spcVal = parm.querySelector("SpcVal");
  if (spcVal) {
    const spcGroup = document.createElement("optgroup");
    spcGroup.label = "Special Values";

    const spcValues = spcVal.querySelectorAll("Value");
    spcValues.forEach(val => {
      const valText = val.getAttribute("Val");

      // Don't duplicate SngVal or Values entries
      const isDuplicate =
        Array.from(sngValues).some(sngVal => sngVal.getAttribute("Val") === valText) ||
        (values && Array.from(values.querySelectorAll("Value")).some(value => value.getAttribute("Val") === valText));

      if (!isDuplicate) {
        const option = document.createElement("vscode-option");
        option.value = valText;
        option.textContent = valText;

        if (valText === dft) {
          option.selected = true;
          sngValSelect.value = dft;
        }

        spcGroup.appendChild(option);
      }
    });

    if (spcGroup.children.length > 0) {
      sngValSelect.appendChild(spcGroup);
    }
  }

  sngValDiv.appendChild(sngValSelect);
  container.appendChild(sngValDiv);
}

function setupSngValLockingForNestedElements(container, sngValSelectId, nestedContainer) {
  const sngValSelect = container.querySelector(`#${sngValSelectId}`);
  if (!sngValSelect) return;

  function updateNestedElementsVisibility() {
    const selectedOption = sngValSelect.selectedOptions[0];
    const isSngVal = selectedOption && selectedOption.getAttribute("data-sngval") === "true";
    const hasValue = sngValSelect.value && sngValSelect.value.trim() !== "";

    console.log(`[clPrompter] SngVal changed: value="${sngValSelect.value}", isSngVal=${isSngVal}`);

    if (isSngVal || hasValue) {
      // SngVal selected or any value entered - hide nested elements
      nestedContainer.style.display = "none";
      console.log(`[clPrompter] Hiding nested elements (SngVal selected)`);
    } else {
      // No value or empty selection - show nested elements
      nestedContainer.style.display = "block";
      console.log(`[clPrompter] Showing nested elements (no SngVal)`);
    }
  }

  // Listen for changes
  sngValSelect.addEventListener('change', updateNestedElementsVisibility);
  sngValSelect.addEventListener('input', updateNestedElementsVisibility);

  // Initial setup
  updateNestedElementsVisibility();
}

function addElemChildren(container, parm, kwd, instanceIdx = 0, isMultiInstance = false) {
  // ✅ Use ":scope > Elem" to get only DIRECT child Elem elements
  const elems = parm.querySelectorAll(":scope > Elem");
  console.log(`[clPrompter] Processing ${elems.length} DIRECT Elem children for ${kwd}, isMultiInstance: ${isMultiInstance}`);

  for (let e = 0; e < elems.length; e++) {
    const elem = elems[e];
    const elemPrompt = elem.getAttribute("Prompt") || elem.getAttribute("Name") || `Element ${e + 1}`;
    const elemType = elem.getAttribute("Type") || "CHAR";
    const elemLen = elem.getAttribute("Len") || "";
    const elemDft = elem.getAttribute("Dft") || "";

    // ✅ Use instance suffix only for multi-instance parameters
    const elemName = isMultiInstance ? `${kwd}_ELEM${e}_${instanceIdx}` : `${kwd}_ELEM${e}`;

    console.log(`[clPrompter] Creating elem ${e}: ${elemName}, type: ${elemType}, default: ${elemDft}`);

    // ✅ Handle nested ELEM (ELEM within ELEM) - like TOPGMQ's "Call stack entry identifier"
    // ✅ Update the nested ELEM creation in addElemChildren
    // ✅ Handle nested ELEM (ELEM within ELEM) - use numeric pattern
    if (elemType === "ELEM") {
      console.log(`[clPrompter] Found nested ELEM: ${elemName}`);

      // Create a sub-fieldset for the nested ELEM
      const subFieldset = document.createElement("fieldset");
      subFieldset.className = "elem-group nested-elem-group";

      const subLegend = document.createElement("legend");
      subLegend.textContent = elemPrompt;
      subFieldset.appendChild(subLegend);

      // ✅ Process the sub-elements with numeric pattern
      const subElems = elem.querySelectorAll(":scope > Elem");
      for (let se = 0; se < subElems.length; se++) {
        const subElem = subElems[se];
        const subElemPrompt = subElem.getAttribute("Prompt") || `Sub-element ${se + 1}`;
        const subElemType = subElem.getAttribute("Type") || "CHAR";
        const subElemLen = subElem.getAttribute("Len") || "";
        const subElemDft = subElem.getAttribute("Dft") || "";

        // ✅ NEW: Use numeric pattern - ELEM#_index
        const subElemName = `${elemName}_${se}`;

        console.log(`[clPrompter] Creating sub-elem ${se}: ${subElemName}, type: ${subElemType}`);

        const subElemDiv = document.createElement("div");
        subElemDiv.className = "form-div";

        const subElemLabel = document.createElement("label");
        subElemLabel.className = "form-label";
        subElemLabel.textContent = subElemPrompt;
        subElemLabel.htmlFor = subElemName;
        subElemDiv.appendChild(subElemLabel);

        // Create input for sub-element
        const subElemInput = createElemInput(subElem, subElemName, subElemType, subElemLen, subElemDft, kwd);
        subElemDiv.appendChild(subElemInput);
        subFieldset.appendChild(subElemDiv);
      }

      container.appendChild(subFieldset);

    } else {
      // ✅ Regular element - DON'T add level indicator for simple ELEMs
      const elemDiv = document.createElement("div");
      elemDiv.className = "form-div";

      const elemLabel = document.createElement("label");
      elemLabel.className = "form-label";
      elemLabel.textContent = elemPrompt;

      // ✅ Use simple naming for regular elements: LOG_ELEM0, not LOG_ELEM0_0
      elemLabel.htmlFor = elemName; // Use elemName directly
      elemDiv.appendChild(elemLabel);

      // Create appropriate input based on allowed values
      const elemInput = createElemInput(elem, elemName, elemType, elemLen, elemDft, kwd); // Use elemName
      elemDiv.appendChild(elemInput);
      container.appendChild(elemDiv);
    }
  }
}

// ✅ Update createElemInput function around line 2890:
function createElemInput(elem, elemName, elemType, elemLen, elemDft, kwd) {
  console.log(`[createElemInput] kwd=${kwd} name=${elemName}, type=${elemType}, len=${elemLen}`);

  let allowedVals = allowedValsMap[elemName] || [];
  const noCustomInput = allowedVals._noCustomInput === true;

  // ✅ CRITICAL FIX: If allowedValsMap is empty, extract SpcVals directly from ELEM XML
  if (allowedVals.length === 0) {
    console.log(`[createElemInput] ${elemName}: allowedValsMap empty, checking XML for SpcVal/SngVal`);

    const xmlSpcVals = [];

    // Check SpcVal
    const spcVal = elem.querySelector('SpcVal');
    if (spcVal) {
      const spcValues = spcVal.querySelectorAll('Value');
      spcValues.forEach(val => {
        const valText = val.getAttribute('Val');
        if (valText) {
          xmlSpcVals.push(valText);
        }
      });
    }

    // Check SngVal
    const sngVal = elem.querySelector('SngVal');
    if (sngVal) {
      const sngValues = sngVal.querySelectorAll('Value');
      sngValues.forEach(val => {
        const valText = val.getAttribute('Val');
        if (valText) {
          xmlSpcVals.push(valText);
        }
      });
    }

    // Check Values
    const values = elem.querySelector('Values');
    if (values) {
      const valueElements = values.querySelectorAll('Value');
      valueElements.forEach(val => {
        const valText = val.getAttribute('Val');
        if (valText) {
          xmlSpcVals.push(valText);
        }
      });
    }

    if (xmlSpcVals.length > 0) {
      allowedVals = xmlSpcVals;
      console.log(`[createElemInput] ${elemName}: Found ${xmlSpcVals.length} values in XML:`, xmlSpcVals);
    }
  }

  let elemInput;
  const isOnlyNull = allowedVals.length === 1 && allowedVals[0] === '*NULL';
  if (allowedVals.length === 0 || isOnlyNull) {
    // Use createInputForType to get textarea if needed
    return createInputForType('CHAR', elemName, elemDft, elemLen, allowedVals);
  }

  // ✅ Calculate width using the correct allowedVals (from map OR XML)
  const effectiveLen = calculateFieldWidth(elem, allowedVals);
  const widthClass = promptHelpers.getLengthClass(effectiveLen);

  console.log(`[createElemInput] ${elemName}: effectiveLen=${effectiveLen}, widthClass=${widthClass}, allowedVals=${allowedVals.length}`);

  if (allowedVals.length > 0) {
    // Create parameter input with calculated width
    elemInput = createParameterInput(elemName, allowedVals, noCustomInput, elemDft);

    // Apply the calculated width class
    if (elemInput.className) {
      elemInput.className = widthClass;
    }
  } else {
    // ✅ For elements without allowedVals, force CHAR type to prevent number inputs
    const safeElemType = 'CHAR';

    // Create regular input with calculated width
    elemInput = createInputForType(safeElemType, elemName, elemDft, elemLen, allowedVals);

    // Apply the calculated width class
    if (elemInput.className) {
      elemInput.className = widthClass;
    }

    if (elemDft) {
      elemInput.setAttribute('data-default', elemDft);
    }
  }

  // Set common attributes
  elemInput.name = elemName;
  elemInput.id = elemName;

  // --- MODIFIED TRACKING ---
  elemInput.setAttribute('data-modified', 'false');
  elemInput.addEventListener('input', function () {
    elemInput.setAttribute('data-modified', 'true');
  });
  elemInput.addEventListener('change', function () {
    elemInput.setAttribute('data-modified', 'true');
  });

  return elemInput;
}

function createVSCodeSelect(name, spcValElement, defaultValue = "") {
  const select = document.createElement("vscode-single-select");
  select.setAttribute("combobox", "");

  // Add empty option if no default
  if (!defaultValue) {
    const emptyOption = document.createElement("vscode-option");
    emptyOption.value = "";
    emptyOption.textContent = "";
    select.appendChild(emptyOption);
  }

  // Add options from SpcVal
  const values = spcValElement.querySelectorAll("Value");
  values.forEach(val => {
    const option = document.createElement("vscode-option");
    option.value = val.getAttribute("Val");
    option.textContent = val.getAttribute("Val");

    if (val.getAttribute("Val") === defaultValue) {
      option.selected = true;
      select.value = defaultValue;
    }

    select.appendChild(option);
  });

  if (defaultValue) {
    select.setAttribute('data-default', defaultValue);
  }

  return select;
}

function renderQualParm(parm, kwd, container, prompt, instanceIdx = 0, max = 1) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "qual-group";

  const legend = document.createElement("legend");
  legend.innerHTML = formatPromptWithKeyword(prompt, kwd, instanceIdx, max);
  fieldset.appendChild(legend);

  // Find all Qual parts in the XML
  const qualParts = parm.querySelectorAll(":scope > Qual");
  let numParts = qualParts.length;
  if (numParts === 0) numParts = 2; // fallback: assume 2 parts if not defined

  // Render QUAL fields right-to-left: QUALn ... QUAL1, QUAL0 (rightmost)
  for (let i = numParts - 1; i >= 0; i--) {
    const qualDiv = document.createElement("div");
    qualDiv.className = "form-div";

    const qualLabel = document.createElement("label");
    qualLabel.className = "form-label";

    // Map visual position to QUAL index (rightmost is QUAL0)
    const q = numParts - 1 - i;

    let labelText;
    if (q === 0) {
      labelText = prompt; // Main parameter prompt for QUAL0 (rightmost)
    } else if (qualParts[q]) {
      labelText = qualParts[q].getAttribute("Prompt") || `Qualifier ${q}`;
    } else {
      labelText = `Qualifier ${q}`;
    }
    qualLabel.textContent = labelText;
    qualLabel.htmlFor = `${kwd}_QUAL${i}`;
    qualDiv.appendChild(qualLabel);

    const qualInput = document.createElement("vscode-textfield");
    qualInput.name = `${kwd}_QUAL${i}`;
    qualInput.id = `${kwd}_QUAL${i}`;
    qualInput.className = "input-lg";
    qualInput.setAttribute('autocomplete', 'off');
    qualInput.setAttribute('data-modified', 'false');
    qualInput.addEventListener('input', function () {
      qualInput.setAttribute('data-modified', 'true');
    });
    qualInput.addEventListener('change', function () {
      qualInput.setAttribute('data-modified', 'true');
    });
    qualDiv.appendChild(qualInput);
    fieldset.appendChild(qualDiv);
  }
  container.appendChild(fieldset);
}

function createQualInput(qual, qualName, qualType, qualLen, qualDft) {
  const allowedVals = allowedValsMap[qualName] || [];
  const noCustomInput = allowedVals._noCustomInput === true;

  let qualInput;
  if (allowedVals.length > 0) {
    // Use allowed values from allowedValsMap
    qualInput = createParameterInput(qualName, allowedVals, noCustomInput, qualDft);
  } else {
    // Check for SpcVal in the qualifier itself
    const qualSpcVal = qual.querySelector("SpcVal");
    if (qualSpcVal) {
      qualInput = createVSCodeSelect(qualName, qualSpcVal, qualDft);
    } else {
      // Create regular input
      qualInput = createInputForType(qualType, qualName, qualDft, qualLen, allowedVals);
      if (qualDft) {
        qualInput.setAttribute('data-default', qualDft);
      }
    }
  }

  // Set common attributes
  qualInput.name = qualName;
  qualInput.id = qualName;

  // --- MODIFIED TRACKING ---
  qualInput.setAttribute('data-modified', 'false');
  qualInput.addEventListener('input', function () {
    qualInput.setAttribute('data-modified', 'true');
  });
  qualInput.addEventListener('change', function () {
    qualInput.setAttribute('data-modified', 'true');
  });

  return qualInput;
}

function createSimpleParameterCombobox(parm, kwd, dft, spcVal, sngVal) {

  const select = document.createElement("vscode-single-select");
  select.setAttribute("combobox", "");

  // Set default value as data attribute
  if (dft) {
    select.setAttribute('data-default', dft);
    select.value = dft;
  }

  // --- MODIFIED TRACKING ---
  select.setAttribute('data-modified', 'false');
  select.addEventListener('input', function () {
    select.setAttribute('data-modified', 'true');
  });
  select.addEventListener('change', function () {
    select.setAttribute('data-modified', 'true');
  });

  // ✅ Add SngVal options first (if present)
  if (sngVal) {
    const sngValues = sngVal.querySelectorAll("Value");
    sngValues.forEach(val => {
      const option = document.createElement("vscode-option");
      option.value = val.getAttribute("Val");
      option.textContent = val.getAttribute("Val");
      option.setAttribute("data-sngval", "true"); // Mark as single value

      // Select default option
      if (val.getAttribute("Val") === dft) {
        option.selected = true;
        select.value = dft;
      }

      select.appendChild(option);
    });
  }

  // ✅ Add SpcVal options (if present)
  if (spcVal) {
    const spcValues = spcVal.querySelectorAll("Value");
    spcValues.forEach(val => {
      const valText = val.getAttribute("Val");

      // Don't duplicate SngVal entries
      const existingOption = select.querySelector(`vscode-option[value="${valText}"]`);
      if (!existingOption) {
        const option = document.createElement("vscode-option");
        option.value = valText;
        option.textContent = valText;

        // Select default option
        if (valText === dft) {
          option.selected = true;
          select.value = dft;
        }

        select.appendChild(option);
      }
    });
  }

  // ✅ If no default was set and no options exist, add empty option
  if (!select.value && select.children.length === 0) {
    const emptyOption = document.createElement("vscode-option");
    emptyOption.value = "";
    emptyOption.textContent = "";
    select.appendChild(emptyOption);
  }

  return select;
}

function renderSimpleParameter(parm, kwd, container, dft, required, instanceId) {
  console.log(`[clPrompter] renderSimpleParameter: ${kwd}, default: ${dft}`);

  try {
    const allowedVals = allowedValsMap[kwd] || [];
    const spcVal = parm.querySelector("SpcVal");
    const sngVal = parm.querySelector("SngVal");
    const isRestricted = parm.getAttribute("Rstd") === "YES";

    console.log(`[clPrompter] ${kwd} - allowedVals: ${allowedVals.length}, spcVal: ${!!spcVal}, sngVal: ${!!sngVal}`);

    let input;

    if (allowedVals.length > 0) {
      console.log(`[clPrompter] ${kwd} - Using allowedValsMap`);
      input = createParameterInput(kwd, allowedVals, false, dft);
    } else if (spcVal || sngVal || isRestricted) {
      console.log(`[clPrompter] ${kwd} - Creating combobox from XML`);
      input = createSimpleParameterCombobox(parm, kwd, dft, spcVal, sngVal);
    } else {
      console.log(`[clPrompter] ${kwd} - Creating regular text input`);
      const parmType = parm.getAttribute("Type") || "CHAR";
      const parmLen = parm.getAttribute("Len") || "";
      console.log(`[clPrompter] ${kwd} - About to call createInputForType with type: ${parmType}`);
      input = createInputForType(parmType, kwd, dft, parmLen, allowedVals);
    }

    // --- PATCH: Enforce id/name pattern for all parameter input fields ---
    // All instances get unique id (instanceId), and the same name (kwd)
    input.id = instanceId;
    input.name = kwd;
    // For custom elements (e.g., vscode-textarea), setAttribute('name', ...) to ensure attribute is present
    if (input.tagName && input.tagName.toLowerCase().startsWith('vscode-')) {
      input.setAttribute('name', kwd);
    }

    if (required) {
      input.required = true;
    }

    console.log(`[clPrompter] [renderSimpleParameter] Set id='${instanceId}' and name='${kwd}' for input of type <${input.tagName.toLowerCase()}>`);
    container.appendChild(input);
    console.log(`[clPrompter] Successfully appended input for ${kwd}`);

  } catch (error) {
    console.error(`[clPrompter] Error in renderSimpleParameter for ${kwd}:`, error);
    // Create a fallback input
    const fallbackInput = document.createElement("input");
    fallbackInput.type = "text";
    fallbackInput.name = kwd;
    fallbackInput.id = instanceId;
    container.appendChild(fallbackInput);
  }
}

function addMultiInstanceControls(container, parm, kwd, idx, max, multiGroupDiv) {
  if (idx === 0) {
    // Add button for first instance
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-parm-btn";
    addBtn.textContent = "+";
    addBtn.title = "Add another instance";
    addBtn.onclick = function () {
      const instances = multiGroupDiv.querySelectorAll(".parm-instance");
      if (instances.length < max) {
        const newIdx = instances.length;
        const newDiv = renderParmInstance(parm, kwd, newIdx, max, multiGroupDiv);
        multiGroupDiv.appendChild(newDiv);
      }
    };
    container.appendChild(addBtn);
  } else {
    // Remove button for subsequent instances
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-parm-btn";
    removeBtn.textContent = "-";
    removeBtn.title = "Remove this instance";
    removeBtn.onclick = function () {
      container.remove();
    };
    container.appendChild(removeBtn);
  }
}



// --- Main form rendering ---
function loadForm() {
  console.log("loadForm called, xmlDoc:", xmlDoc);
  if (!xmlDoc) return;
  const form = document.getElementById("clForm");
  form.innerHTML = "";

  parms.forEach(parm => {
    const kwd = parm.getAttribute("Kwd");
    const type = parm.getAttribute("Type");
    const constant = parm.getAttribute("Constant"); // Check for Constant attribute
    const max = parseInt(parm.getAttribute("Max") || "1", 10);

    // ✅ Skip parameters with Constant attribute (not Type="CONSTANT")
    if (constant) {
      console.log(`[clPrompter] Skipping CONSTANT parameter: ${kwd} (Constant=${constant})`);
      return; // Skip this parameter
    }

    // ✅ Skip NULL parameters (Type="Null" from TYPE(*NULL))
    if (type.toLowerCase() === "null") {
      console.log(`[clPrompter] Skipping NULL parameter: ${kwd} (Type=${type})`);
      return; // Skip this parameter
    }

    // Multi-instance group
    if (max > 1) {
      const multiGroupDiv = document.createElement("div");
      multiGroupDiv.className = "parm-multi-group";
      multiGroupDiv.dataset.kwd = kwd;
      multiGroupDiv.dataset.max = max;
      // Render first instance
      multiGroupDiv.appendChild(renderParmInstance(parm, kwd, 0, max, multiGroupDiv));
      form.appendChild(multiGroupDiv);
    } else {
      // Single instance
      form.appendChild(renderParmInstance(parm, kwd, 0, 1, null));
    }
  });
}

function validateRestrictedInput(input) {
  if (input.getAttribute('data-restricted') === 'true') {
    const options = Array.from(input.querySelectorAll('vscode-option'));
    const allowedValues = options.map(opt => opt.value);

    if (input.value && !allowedValues.includes(input.value)) {
      // Show validation error or auto-correct
      console.warn(`Invalid value: ${input.value}. Allowed: ${allowedValues.join(', ')}`);
      return false;
    }
  }
  return true;
}

function getInputValue(input) {
  console.log(`[clPrompter] getInputValue - tagName: ${input.tagName}, name: ${input.name}`);

  if (!input) return '';
  if (input.tagName.toLowerCase() === 'vscode-textarea' || input.tagName.toLowerCase() === 'textarea') {
    // Remove all linefeeds and carriage returns
    return (input.value || '').replace(/[\r\n]+/g, ' ');
  }

  // Handle VS Code Elements combobox
  if (input.tagName.toLowerCase() === 'vscode-single-select') {
    const value = input.value || '';
    console.log(`[clPrompter] getInputValue - VS Code select value: "${value}"`);
    return value;
  }

  // Handle VS Code textfield
  if (input.tagName.toLowerCase() === 'vscode-textfield') {
    const value = input.value || '';
    console.log(`[clPrompter] getInputValue - VS Code textfield value: "${value}"`);
    return value;
  }

  // Handle old dropdown with custom input
  if (input.tagName === 'SELECT' && input.dataset.customInputId) {
    const value = getDropdownOrCustomValue(input);
    console.log(`[clPrompter] getInputValue - HTML select+custom value: "${value}"`);
    return value;
  }

  // Handle regular inputs
  const value = input.value || '';
  console.log(`[clPrompter] getInputValue - Regular input value: "${value}"`);
  return value;
}

function isUnchangedDefault(input, value) {
  // Robustly check if a value should be omitted as unchanged default
  // 1. Always include if user modified
  if (input.getAttribute('data-modified') === 'true') return false;

  // 2. Always include if present in original command (by full name for ELEM, by base for simple)
  const name = input.name;
  const baseName = name.split('_')[0];
  if (originalParamMap.hasOwnProperty(name) || originalParamMap.hasOwnProperty(baseName)) return false;

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

// ✅ Add this function before the submit handler (around line 800-900)
function validateRangeInput(input) {
  const fromValue = input.getAttribute('data-range-from');
  const toValue = input.getAttribute('data-range-to');

  if (!fromValue || !toValue) return true; // No range to validate

  const value = input.value.trim();

  // Allow empty values (they're optional)
  if (!value) return true;

  // ✅ Check if value matches any SpcVal or SngVal entries first
  const inputName = input.name || input.id;
  const allowedVals = allowedValsMap[inputName] || [];

  // If value matches any allowed special value, it's valid regardless of range
  if (allowedVals.includes(value)) {
    console.log(`[clPrompter] Range validation: "${value}" matches allowed special value`);
    return true;
  }

  // ✅ Allow any value that starts with * (special values)
  if (value.startsWith('*')) {
    console.log(`[clPrompter] Range validation: "${value}" is special value (starts with *)`);
    return true;
  }

  // ✅ Allow any value that starts with & (CL variables)
  if (value.startsWith('&')) {
    console.log(`[clPrompter] Range validation: "${value}" is CL variable (starts with &)`);
    return true;
  }

  // Validate numeric range
  const numValue = parseInt(value, 10);
  const fromNum = parseInt(fromValue, 10);
  const toNum = parseInt(toValue, 10);

  if (isNaN(numValue) || isNaN(fromNum) || isNaN(toNum)) {
    console.log(`[clPrompter] Range validation: non-numeric values - value: "${value}", range: ${fromValue}-${toValue}`);
    return true; // Can't validate non-numeric, assume valid
  }

  const isValid = numValue >= fromNum && numValue <= toNum;

  if (!isValid) {
    console.log(`[clPrompter] Range validation failed: ${value} not in range ${fromValue}-${toValue}`);

    // Add visual indication
    input.classList.add('invalid');

    // Show error tooltip
    tooltips.showRangeTooltip(input, `❌ Value ${value} is outside valid range ${fromValue}-${toValue}`, 'error');

    return false;
  } else {
    // Remove visual indication
    input.classList.remove('invalid');
    console.log(`[clPrompter] Range validation passed: ${value} is within range ${fromValue}-${toValue}`);
    return true;
  }
}
function getDefaultValue(input) {
  // Check data-default attribute first
  const dataDefault = input.getAttribute('data-default');
  if (dataDefault) return dataDefault;

  // Check if it's a select with a default option
  if (input.tagName === 'SELECT' || input.tagName === 'VSCODE-DROPDOWN') {
    const defaultOption = input.querySelector('option[selected]') ||
      input.querySelector('vscode-option[selected]');
    if (defaultOption) return defaultOption.value;
  }

  // For other inputs, check the default value
  return input.defaultValue || '';
}

// --- SUBMIT HANDLER ---
document.getElementById("submitBtn").addEventListener("click", e => {
  try {
    e.preventDefault();
    if (!xmlDoc) return;
    const values = {};
    // --- LABEL HANDLING ---
    const labelInputSubmit = document.getElementById("clLabel");
    if (labelInputSubmit && labelInputSubmit.value.trim()) {
      values["LABEL"] = labelInputSubmit.value.trim();
    }
    const qualGroups = {};

    // --- 1. MULTI-INSTANCE (MAX > 1) PARAMETERS ---
    document.querySelectorAll(".parm-multi-group").forEach(group => {
      const kwd = group.dataset.kwd;
      const parm = Array.from(parms).find(p => p.getAttribute("Kwd") === kwd);
      if (!parm) return;
      let max = parseInt(group.dataset.max, 10);
      const instances = group.querySelectorAll(".parm-instance");
      let instanceVals = [];
      instances.forEach((inst, idx) => {
        if ((parm.getAttribute("Type") || "").toUpperCase() === "ELEM") {
          const elems = parm.getElementsByTagName("Elem");
          let elemVals = [];
          for (let e = 0; e < elems.length; e++) {
            const elemName = `${kwd}_ELEM${e}_${idx}`;

            let input = inst.querySelector(`vscode-single-select[id="${elemName}"]`) ||
              inst.querySelector(`vscode-textfield[id="${elemName}"]`) ||
              inst.querySelector(`vscode-textarea[id="${elemName}"]`) ||
              inst.querySelector(`textarea[id="${elemName}"]`) ||
              inst.querySelector(`vscode-single-select[name="${elemName}"]`) ||
              inst.querySelector(`vscode-textfield[name="${elemName}"]`) ||
              inst.querySelector(`vscode-textarea[name="${elemName}"]`) ||
              inst.querySelector(`textarea[name="${elemName}"]`);

            if (!input) {
              console.warn(`[clPrompter] SUBMIT: No input found for ${elemName}`);
              continue;
            }

            let val = getInputValue(input);

            const wasModified = input.getAttribute('data-modified') === 'true';
            const defaultValue = input.getAttribute('data-default');
            const wasInOriginal = originalParamMap.hasOwnProperty(elemName);
            if (
              val !== "" && val !== undefined && val !== null && val !== "*N" &&
              (wasModified || (defaultValue === undefined ? true : val.trim().toUpperCase() !== (defaultValue || '').trim().toUpperCase()) || wasInOriginal)
            ) {
              elemVals.push(val);
            }
          }
          // Remove trailing unchanged defaults
          while (elemVals.length > 0) {
            const lastIdx = elemVals.length - 1;
            const elemName = `${kwd}_ELEM${lastIdx}_${idx}`;
            const input = inst.querySelector(`[name="${elemName}"]`);
            if (!input) break;
            const val = elemVals[lastIdx];
            const wasModified = input.getAttribute('data-modified') === 'true';
            const defaultValue = input.getAttribute('data-default');
            const wasInOriginal = originalParamMap.hasOwnProperty(elemName);
            if (
              !wasModified &&
              !wasInOriginal &&
              defaultValue !== undefined &&
              val.trim().toUpperCase() === (defaultValue || '').trim().toUpperCase()
            ) {
              elemVals.pop();
            } else {
              break;
            }
          }
          if (elemVals.length > 0) {
            instanceVals.push(elemVals.join(" "));
          }
        } else {
          let input = inst.querySelector(`select[name^="${kwd}_"]`) || inst.querySelector(`select[name="${kwd}_${idx}"]`) || inst.querySelector(`select[name="${kwd}"]`);
          let val = "";
          if (input) {
            val = getInputValue(input);
          } else {
            input = inst.querySelector(`[name^="${kwd}_"]`) || inst.querySelector(`[name="${kwd}_${idx}"]`) || inst.querySelector(`[name="${kwd}"]`);
            val = input ? input.value : "";
          }
          if (val === "" || val === undefined || val === null) return;
          const parmType = parm && parm.getAttribute("Type") ? parm.getAttribute("Type").toUpperCase() : "";
          if (parmType === "NAME" && val) val = val.toUpperCase();
          instanceVals.push(val);
        }
      });
      if (instanceVals.length > 0) {
        values[kwd] = instanceVals;
      } else if (originalParamMap.hasOwnProperty(kwd)) {
        let orig = originalParamMap[kwd];
        if (Array.isArray(orig)) {
          values[kwd] = orig;
        } else if (typeof orig === "string") {
          values[kwd] = orig.trim().split(/\s+/);
        } else {
          values[kwd] = String(orig);
        }
      }
    });

    // --- 2. SINGLE-INSTANCE PARAMETERS (not in multi-groups) ---
    const form = document.getElementById('clForm');
    const inputs = form.querySelectorAll('input, select, textarea, vscode-single-select, vscode-textfield, vscode-textarea');
    // --- QUAL PARTS COLLECTION (single instance) ---
    // Collect all QUAL part inputs as arrays, e.g. QUAL0, QUAL1, ...
    const qualPartsMap = {};
    inputs.forEach(i => {
      if (i.closest('.parm-multi-group')) return;
      if (!i.name) return;

      // Handle QUAL part inputs (collect as array)
      const qualPartMatch = i.name.match(/^(.+?)_QUAL(\d+)$/);
      if (qualPartMatch) {
        const parmName = qualPartMatch[1];
        const partIdx = parseInt(qualPartMatch[2], 10);
        if (!qualPartsMap[parmName]) qualPartsMap[parmName] = [];
        qualPartsMap[parmName][partIdx] = getInputValue(i);
        return;
      }
      // Legacy: single QUAL input (fallback)
      const qualSingleMatch = i.name.match(/^(.+?)_QUAL$/);
      if (qualSingleMatch) {
        const parmName = qualSingleMatch[1];
        if (!qualPartsMap[parmName]) qualPartsMap[parmName] = [];
        qualPartsMap[parmName][0] = getInputValue(i);
        return;
      }

      //  other parameters...
      let val = getInputValue(i);
      let parmKwd = i.name.split('_')[0];
      let wasInOriginal_simple = originalParamMap.hasOwnProperty(parmKwd);

      if (val !== "" && val !== "''" && val !== '""') {
        if (!isUnchangedDefault(i, val)) {
          values[parmKwd] = val;
          console.log(`[clPrompter] Including parameter: ${parmKwd} = "${val}"`);
        } else {
          console.log(`[clPrompter] Skipping unchanged default: ${parmKwd} = "${val}" (default: "${i.getAttribute('data-default')}", tag: ${i.tagName}, sngval: ${!!i.querySelector && i.querySelector('vscode-option[data-sngval]')})`);
        }
      } else if (wasInOriginal_simple) {
        values[parmKwd] = originalParamMap[parmKwd];
        console.log(`[clPrompter] Restoring original parameter: ${parmKwd}`);
      }

      if (i.name.match(/_ELEM\d+$/)) {
        if (val !== "" && val !== "''" && val !== '""' && !isUnchangedDefault(i, val)) {
          values[i.name] = val;
          console.log(`[clPrompter] Including ELEM: ${i.name} = "${val}"`);
        } else {
          console.log(`[clPrompter] Skipping unchanged ELEM default: ${i.name} = "${val}"`);
        }
        return;
      }
    });


    // --- 3. ELEM PARAMETER ASSEMBLY (single instance) ---
    for (let i = 0; i < parms.length; i++) {
      const parm = parms[i];
      const kwd = parm.getAttribute("Kwd");
      if ((parm.getAttribute("Type") || "").toUpperCase() === "ELEM" && !document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`)) {
        // CHECK: First check if SngVal is selected
        const sngValInput = document.querySelector(`[name="${kwd}_SNGVAL"]`);
        if (sngValInput && sngValInput.value) {
          const selectedOption = sngValInput.selectedOptions[0];
          if (selectedOption && selectedOption.getAttribute("data-sngval") === "true") {
            // ✅ Check if SngVal is unchanged default
            if (!isUnchangedDefault(sngValInput, sngValInput.value)) {
              values[kwd] = [sngValInput.value];
            }
            continue;
          }
        }

        // No SngVal selected - process ELEM values normally
        const elems = parm.getElementsByTagName("Elem");
        let elemVals = [];
        for (let e = 0; e < elems.length; e++) {
          const elemName = `${kwd}_ELEM${e}`;
          const elem = elems[e];
          if (elem.getAttribute("Type") === "ELEM") {
            // Nested ELEM (ELEM within ELEM)
            const subElems = elem.getElementsByTagName("Elem");
            for (let se = 0; se < subElems.length; se++) {
              const subElemName = `${elemName}_${se}`;
              const subInput = document.querySelector(`[name="${subElemName}"]`);
              if (!subInput) continue;
              let subVal = getInputValue(subInput);
              const wasModified = subInput.getAttribute('data-modified') === 'true';
              const defaultValue = subInput.getAttribute('data-default');
              const wasInOriginal = originalParamMap.hasOwnProperty(subElemName);
              if (
                subVal && subVal.trim() !== "" &&
                (wasModified || (defaultValue === undefined ? true : subVal.trim().toUpperCase() !== (defaultValue || '').trim().toUpperCase()) || wasInOriginal)
              ) {
                elemVals.push(subVal);
              }
            }
          } else {
            // Regular ELEM
            const input = document.querySelector(`[name="${elemName}"]`);
            if (!input) continue;
            let val = getInputValue(input);
            const wasModified = input.getAttribute('data-modified') === 'true';
            const defaultValue = input.getAttribute('data-default');
            const wasInOriginal = originalParamMap.hasOwnProperty(elemName);
            if (
              val && val.trim() !== "" &&
              (wasModified || (defaultValue === undefined ? true : val.trim().toUpperCase() !== (defaultValue || '').trim().toUpperCase()) || wasInOriginal)
            ) {
              elemVals.push(val);
            }
          }
        }
        // Remove trailing unchanged defaults
        while (elemVals.length > 0) {
          const lastIdx = elemVals.length - 1;
          const elemName = `${kwd}_ELEM${lastIdx}`;
          const input = document.querySelector(`[name="${elemName}"]`);
          if (!input) break;
          const val = elemVals[lastIdx];
          const wasModified = input.getAttribute('data-modified') === 'true';
          const defaultValue = input.getAttribute('data-default');
          const wasInOriginal = originalParamMap.hasOwnProperty(elemName);
          if (
            !wasModified &&
            !wasInOriginal &&
            defaultValue !== undefined &&
            val.trim().toUpperCase() === (defaultValue || '').trim().toUpperCase()
          ) {
            elemVals.pop();
          } else {
            break;
          }
        }
        if (elemVals.length > 0) {
          values[kwd] = elemVals;
        } else if (originalParamMap.hasOwnProperty(kwd)) {
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

    // --- 4. QUAL PARAMETER ASSEMBLY (single instance) ---
    for (const parmName in qualPartsMap) {
      const parts = qualPartsMap[parmName];
      // Preserve all user input verbatim, including blanks and CL expressions, for each QUAL part
      // Only skip parts that are truly undefined/null (not blanks or valid expressions)
      const qualArr = Array.isArray(parts)
        ? parts.map(x => (x === undefined || x === null ? "" : x))
        : [];
      // Remove only leading undefined/null, but preserve blanks and expressions
      let firstNonNull = 0;
      while (firstNonNull < qualArr.length - 1 && (qualArr[firstNonNull] === undefined || qualArr[firstNonNull] === null)) {
        firstNonNull++;
      }
      const finalQualArr = qualArr.slice(firstNonNull);
      if (finalQualArr.length > 0) {
        values[parmName] = finalQualArr;
        console.log(`[clPrompter] Submit - QUAL ${parmName} as array:`, finalQualArr);
      } else if (originalParamMap.hasOwnProperty(parmName)) {
        values[parmName] = originalParamMap[parmName];
      }
    }

    // --- 5. VALIDATE RANGES BEFORE SUBMISSION ---
    let hasValidationErrors = false;
    const rangeInputs = form.querySelectorAll('[data-range-from][data-range-to], [data-range-from][data-range-to] *');

    // ✅ Also check for range inputs inside containers
    const allRangeInputs = [];
    form.querySelectorAll('*').forEach(element => {
      if (element.hasAttribute('data-range-from') && element.hasAttribute('data-range-to')) {
        allRangeInputs.push(element);
      }
    });

    console.log(`[clPrompter] Found ${allRangeInputs.length} range inputs for validation`);

    allRangeInputs.forEach(input => {
      console.log(`[clPrompter] Validating range input: ${input.name}, value: "${input.value}"`);
      if (!validateRangeInput(input)) {
        hasValidationErrors = true;
        console.log(`[clPrompter] Range validation failed for ${input.name}`);

        // Scroll to the first invalid input
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
      }
    });

    if (hasValidationErrors) {
      console.log('[clPrompter] Blocking submission due to range validation errors');
      // With this:
      console.error('[clPrompter] Submission blocked due to range validation errors');
      vscode.postMessage({
        type: "error",
        message: "Please correct the invalid range values before submitting."
      });
      return; // Stop submission
    }

    // --- 6. FINAL COMMAND ASSEMBLY --- (renamed from 5)
    let cmdString = cmdName;
    // Helper: detect QUAL parameter by value type (array) and key in originalParamMap or qualPartsMap
    function isQualParam(key, value) {
      // Heuristic: QUAL param is an array and was collected as QUAL parts (see qualPartsMap)
      return Array.isArray(value) && qualPartsMap && Object.prototype.hasOwnProperty.call(qualPartsMap, key);
    }
    for (const [key, value] of Object.entries(values)) {
      if (isQualParam(key, value)) {
        // IBM i CL QUAL: UI is right-to-left (QUAL0=rightmost),
        // but command syntax is left-to-right: QUALn/QUALn-1/.../QUAL0
        let qualArr = Array.isArray(value) ? value.slice() : [];
        // Remove only leading undefined/null, but preserve blanks and expressions
        let firstNonNull = 0;
        while (firstNonNull < qualArr.length - 1 && (qualArr[firstNonNull] === undefined || qualArr[firstNonNull] === null)) {
          firstNonNull++;
        }
        const qualParts = qualArr.slice(firstNonNull);
        // Join left-to-right (QUAL0 is rightmost, QUALn is leftmost)
        cmdString += ` ${key}(${qualParts.join("/")})`;
      } else {
        cmdString += ` ${key}(${Array.isArray(value) ? value.join(" ") : value})`;
      }
    }
    const labelInput = document.getElementById("clLabel");
    const labelVal = labelInput && labelInput.value.trim();
    if (labelVal) {
      cmdString = `${labelVal.toUpperCase()}: ${cmdString}`;
    }
    console.log('[clPrompter] Submitting Final values (excluding unchanged defaults):', values);
    vscode.postMessage({ type: "submit", cmdName, values });
  } catch (err) {
    console.error("[clPrompter] Error in submit handler:", err);
    alert("An error occurred: " + err.message);
  }
});

function isCLExpression(val) {
  const ops = ['*CAT', '*TCAT', '*BCAT', '*EQ', '*NE', '*LT', '*LE', '*GT', '*GE'];
  const trimmed = val.trim().toUpperCase();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return true;
  if (ops.some(op => trimmed.includes(op))) return true;
  if (/%[A-Z][A-Z0-9]*\s*\(/i.test(trimmed)) return true;
  if (/&[A-Z][A-Z0-9]*\s*[*%]/i.test(trimmed)) return true;
  return false;
}

document.getElementById("clForm").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("submitBtn").click();
  }
});
document.getElementById("clLabel").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("submitBtn").click();
  }
});

document.getElementById("cancelBtn").addEventListener("click", e => {
  e.preventDefault();
  vscode.postMessage({ type: "cancel" });
});

// --- Keyboard shortcut: F3 cancels prompt (same as Cancel button) ---
document.addEventListener('keydown', function (e) {
  // Only trigger on F3, and only if the prompt is visible
  if (e.key === 'F3' && !e.repeat) {
    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn && cancelBtn.offsetParent !== null) {
      cancelBtn.click();
      e.preventDefault();
      e.stopPropagation();
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  console.log("[clPrompter] DOM Content Loaded");
  detectVSCodeTheme();

  // ✅ Check ALL VS Code Elements components
  setTimeout(() => {
    const availableComponents = [
      'vscode-single-select',
      'vscode-textfield',
      'vscode-textarea',
      'vscode-button',
      'vscode-checkbox',
      'vscode-radio-group',
      'vscode-radio',
      'vscode-option',
      'vscode-divider'
    ];
    const labelInput = document.getElementById("clLabel");
    if (labelInput) {
      labelInput.focus();
    }

    console.log("[clPrompter] VS Code Elements availability:");
    availableComponents.forEach(component => {
      const isAvailable = !!customElements.get(component);
      // console.log(`  ${component}: ${isAvailable}`);
    });

  }, 100);

  vscode.postMessage({ type: 'webviewReady' });
  console.log('[clPrompter] Sent webviewReady message');
});
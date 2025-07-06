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

      // ✅ FIXED: Better value parsing
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
        // ✅ FIXED: Handle multi-instance INCREL format correctly
        let cleanValue = vals.trim();

        // Remove outer parentheses if present
        if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
          cleanValue = cleanValue.slice(1, -1);
          console.log(`[clPrompter] ${kwd} - Stripped parentheses: "${vals}" -> "${cleanValue}"`);
        }

        // ✅ Parse space-separated values while preserving quotes
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
          input = container.querySelector(`vscode-single-select[name="${elemName}"]`) ||
            container.querySelector(`vscode-textfield[name="${elemName}"]`);
        }

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

    // ✅ Keep the parseSpaceSeparatedValues helper function:
    function parseSpaceSeparatedValues(str) {
      const values = [];
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
        } else if (!inQuotes && char === ' ') {
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
        input = vsCodeSelect || vsCodeTextfield;
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

      console.log(`[clPrompter] populateQualInputs: ${kwd}, parts:`, parts);
      console.log(`[clPrompter] ===== populateQualInputs DEBUG =====`);
      console.log(`[clPrompter] ${kwd} - Input vals:`, vals);
      console.log(`[clPrompter] ${kwd} - Split parts:`, parts);
      console.log(`[clPrompter] ${kwd} - Parts length:`, parts.length);
      console.log(`[clPrompter] ${kwd} - Quals length:`, quals.length);

      for (let q = 0; q < quals.length; q++) {
        const qName = `${kwd}_QUAL${q}`;
        // ✅ RESTORE reverse indexing - QUAL0 gets parts[length-1-0], QUAL1 gets parts[length-1-1]
        const reverseIndex = parts.length - 1 - q;
        const value = parts[reverseIndex] !== undefined ? parts[reverseIndex] : "";

        console.log(`[clPrompter] ${kwd} - QUAL${q}:`);
        console.log(`[clPrompter]   - qName: ${qName}`);
        console.log(`[clPrompter]   - reverseIndex: ${reverseIndex} (${parts.length}-1-${q})`);
        console.log(`[clPrompter]   - value: "${value}"`);
        console.log(`[clPrompter]   - parts[${reverseIndex}]: "${parts[reverseIndex]}"`);

        const vsCodeSelect = container.querySelector(`vscode-single-select[name="${qName}"]`);
        const select = container.querySelector(`select[name="${qName}"]`);
        const customInput = container.querySelector(`#${qName}_custom`);

        console.log(`[clPrompter]   - Found vsCodeSelect: ${!!vsCodeSelect}`);
        console.log(`[clPrompter]   - Found select: ${!!select}`);
        console.log(`[clPrompter]   - Found customInput: ${!!customInput}`);

        // ✅ Handle VS Code Elements combobox first
        if (vsCodeSelect) {
          console.log(`[clPrompter]   - Processing VS Code select for ${qName}`);
          console.log(`[clPrompter]   - Value to set: "${value}"`);
          console.log(`[clPrompter]   - Current vsCodeSelect.value before: "${vsCodeSelect.value}"`);

          // Check if value exists in options first
          const options = vsCodeSelect.querySelectorAll('vscode-option');
          console.log(`[clPrompter]   - Found ${options.length} options`);

          let foundOption = false;
          for (let option of options) {
            console.log(`[clPrompter]   - Checking option: "${option.value}"`);
            if (option.value === value) {
              vsCodeSelect.value = value;
              foundOption = true;
              console.log(`[clPrompter]   - Set VS Code select option: "${value}"`);
              break;
            }
          }

          // ✅ If not found in options, set custom value REGARDLESS of combobox attribute
          if (!foundOption && value) {
            console.log(`[clPrompter]   - Setting custom value: "${value}"`);

            // ✅ Force set the value first
            vsCodeSelect.value = value;

            // ✅ Create a temporary option if needed (some VS Code Elements require this)
            const tempOption = document.createElement("vscode-option");
            tempOption.value = value;
            tempOption.textContent = value;
            tempOption.selected = true;
            vsCodeSelect.appendChild(tempOption);

            // ✅ Set value again after adding option
            vsCodeSelect.value = value;

            // ✅ Enhanced shadow DOM access
            const trySetShadowDOM = () => {
              if (vsCodeSelect.shadowRoot) {
                const comboboxInput = vsCodeSelect.shadowRoot.querySelector('.combobox-input, input, .input');
                if (comboboxInput) {
                  comboboxInput.value = value;
                  console.log(`[clPrompter]   - Set VS Code shadow DOM input: "${value}"`);
                  return true;
                }
              }
              return false;
            };

            // ✅ Try immediately and with delays
            if (!trySetShadowDOM()) {
              setTimeout(trySetShadowDOM, 10);
              setTimeout(trySetShadowDOM, 50);
              setTimeout(trySetShadowDOM, 100);
            }

            // ✅ Dispatch events to ensure updates
            vsCodeSelect.dispatchEvent(new Event('input', { bubbles: true }));
            vsCodeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            vsCodeSelect.requestUpdate?.();

            console.log(`[clPrompter]   - Set VS Code select custom value: "${value}"`);
          }

          // ✅ Final verification with delay
          setTimeout(() => {
            console.log(`[clPrompter]   - Final verification - ${qName}.value: "${vsCodeSelect.value}"`);

            // ✅ Additional fallback: if value still doesn't match, force it
            if (vsCodeSelect.value !== value && value) {
              console.log(`[clPrompter]   - Value mismatch detected, forcing value`);
              vsCodeSelect.setAttribute('value', value);

              // Try to set internal property directly
              if (vsCodeSelect._value !== undefined) {
                vsCodeSelect._value = value;
              }
            }
          }, 150);
        } else if (select && customInput) {
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
            console.log(`[clPrompter]   - Set HTML select option: "${value}"`);
          } else if (value) {
            select.selectedIndex = -1;
            customInput.value = value;
            console.log(`[clPrompter]   - Set HTML custom input: "${value}"`);
          }
        } else {
          const input = container.querySelector(`[name="${qName}"]`);
          if (input) {
            input.value = value;
            console.log(`[clPrompter]   - Set regular input: "${value}"`);
          } else {
            console.log(`[clPrompter]   - NO INPUT FOUND for ${qName}`);
          }
        }
      }
      console.log(`[clPrompter] ===== END populateQualInputs DEBUG =====`);
    }


    function calculateFieldWidth(parm, allowedVals) {
      const type = (parm.getAttribute('Type') || 'CHAR').toUpperCase();
      const lenAttr = parm.getAttribute('Len') || '';
      const kwd = parm.getAttribute('Kwd') || 'UNKNOWN';
      const isRestricted = parm.getAttribute('Rstd') === 'YES';

      if (isContainerType(type)) {
        console.log(`[calculateFieldWidth] ${kwd}: Container type ${type}, using default length`);
        return 40;
      }

      let effectiveLen = 10;

      // Handle type-specific base lengths
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
      console.log("[clPrompter] Keys to process:", Object.keys(paramMap));

      for (const [kwd, vals] of Object.entries(paramMap)) {
        console.log(`[clPrompter] Processing parameter: ${kwd}, values:`, vals);

        const group = document.querySelector(`.parm-multi-group[data-kwd="${kwd}"]`);
        if (group) {
          console.log(`[clPrompter] ${kwd} - Found multi-group`);

          // Clear existing instances except the first one
          let instances = group.querySelectorAll('.parm-instance');
          for (let i = 1; i < instances.length; i++) instances[i].remove();

          // ✅ FIXED: Flatten the parameter values properly
          let splitValsArr = promptHelpers.flattenParmValue(vals);
          console.log(`[clPrompter] ${kwd} - Flattened values:`, splitValsArr);

          // ✅ FIXED: Create instances and populate each one
          for (let i = 0; i < splitValsArr.length; i++) {
            console.log(`[clPrompter] ${kwd} - Processing instance ${i}: "${splitValsArr[i]}"`);

            // Add new instance if needed (for i > 0)
            if (i > 0) {
              const addBtn = group.querySelector('.add-parm-btn');
              if (addBtn) {
                addBtn.click();
                // ✅ Small delay to let DOM update
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }

            // Get the current instance container
            const currentInstances = group.querySelectorAll('.parm-instance');
            const inst = currentInstances[i];
            if (!inst) {
              console.error(`[clPrompter] ${kwd} - Instance ${i} not found!`);
              continue;
            }

            const parm = Array.from(parms).find(p => p.getAttribute("Kwd") === kwd);
            if (parm && parm.getElementsByTagName("Elem").length > 0) {
              console.log(`[clPrompter] ${kwd} - Processing ELEM parameter for instance ${i}, value: "${splitValsArr[i]}"`);
              populateElemInputs(parm, kwd, splitValsArr[i], i, inst);
              continue;
            }
            if (parm && parm.getElementsByTagName("Qual").length > 0) {
              populateQualInputs(parm, kwd, splitValsArr[i], inst);
              continue;
            }

            // Simple parameter handling
            const select = inst.querySelector(`select[name="${kwd}"]`);
            const customInput = inst.querySelector(`#${kwd}_custom`);
            let value = (splitValsArr[i] !== undefined && splitValsArr[i] !== null && splitValsArr[i] !== "")
              ? splitValsArr[i].toString().trim()
              : getDefaultForInput(select, parms);

            if (select && customInput) {
              let foundIdx = -1;
              for (let j = 0; j < select.options.length; j++) {
                if (select.options[j].value.trim().toUpperCase() === (value || "").trim().toUpperCase()) {
                  foundIdx = j;
                  break;
                }
              }
              if (foundIdx !== -1 && value) {
                select.selectedIndex = foundIdx;
                customInput.value = "";
              } else if (value) {
                select.selectedIndex = -1;
                customInput.value = value;
              } else {
                select.selectedIndex = -1;
                customInput.value = "";
              }
            } else {
              const input = inst.querySelector(`[name="${kwd}"]`);
              if (input) input.value = value;
            }
          }

          handleSngvalLocking(group);
          continue;
        }
        // Single-instance parameters
        const parm = Array.from(parms).find(p => p.getAttribute("Kwd") === kwd);
        if (parm && parm.getElementsByTagName("Elem").length > 0) {
          populateElemInputs(parm, kwd, vals, 0, document);
          continue;
        }
        if (parm && parm.getElementsByTagName("Qual").length > 0) {
          populateQualInputs(parm, kwd, vals, document);
          continue;
        }

        // Simple parameter
        const input = document.querySelector(`[name="${kwd}"], [name^="${kwd}_"]`);
        if (input) {
          input.value = Array.isArray(vals) ? vals[0] : vals;
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

    function createInputForType(type, name, value, len) {
      console.log(`[clPrompter] createInputForType called: type=${type}, name=${name}, value=${value}, len=${len}`);

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

        console.log(`[clPrompter] ${name} - Type: ${upperType}, EffectiveLen: ${effectiveLen}, WidthClass: ${widthClass}`);

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

        if (actualLen > 80 && upperType !== 'NULL' && upperType !== 'ZEROELEM' && upperType !== 'LGL') {
          console.log(`[clPrompter] Converting to textarea due to length: ${actualLen} > 80 for ${name}`);
          if (useVSCodeElements && customElements.get('vscode-textarea')) {
            const textarea = document.createElement('vscode-textarea');
            textarea.className = 'input-full';
            textarea.style.minHeight = '60px';
            textarea.rows = Math.min(Math.ceil(actualLen / 80), 5);

            // Copy over any attributes from the original input
            textarea.name = input.name;
            textarea.id = input.id;
            if (input.placeholder) textarea.placeholder = input.placeholder;
            if (input.title) textarea.title = input.title;

            input = textarea;
          } else {
            const textarea = document.createElement("textarea");
            textarea.className = 'input-full';
            textarea.style.minHeight = '60px';
            textarea.rows = Math.min(Math.ceil(actualLen / 80), 5);

            // Copy over any attributes from the original input
            textarea.name = input.name;
            textarea.id = input.id;
            if (input.placeholder) textarea.placeholder = input.placeholder;
            if (input.title) textarea.title = input.title;

            input = textarea;
          }
        }

        // ✅ Set common attributes
        input.name = name;
        input.id = name;

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
        renderQualParameter(parm, kwd, div, prompt, idx, max); // ✅ Pass idx and max
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
        elemInput = createInputForType(safeElemType, elemName, elemDft, elemLen);

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

    function renderQualParameter(parm, kwd, container, prompt, instanceIdx = 0, max = 1) {
      const quals = parm.getElementsByTagName("Qual");
      const fieldset = document.createElement("fieldset");
      fieldset.className = "qual-group";

      const legend = document.createElement("legend");
      legend.innerHTML = formatPromptWithKeyword(prompt, kwd, instanceIdx, max);
      fieldset.appendChild(legend);

      const isMultiInstance = max > 1;

      for (let q = 0; q < quals.length; q++) {
        const qual = quals[q];

        // ✅ FIXED: Better prompt resolution logic
        let qualPrompt;

        if (q === 0) {
          // First QUAL uses parameter prompt
          qualPrompt = prompt;
        } else {
          // ✅ Try multiple sources for the prompt
          qualPrompt = qual.getAttribute("Prompt") ||
            qual.getAttribute("PromptText") ||
            qual.getAttribute("Text") ||
            qual.getAttribute("Name") ||
            `Qualifier ${q + 1}`;

          console.log(`[clPrompter] QUAL${q} prompt sources - Prompt: "${qual.getAttribute("Prompt")}", PromptText: "${qual.getAttribute("PromptText")}", Text: "${qual.getAttribute("Text")}", Name: "${qual.getAttribute("Name")}", Final: "${qualPrompt}"`);
        }

        const qualType = qual.getAttribute("Type") || "CHAR";
        const qualLen = qual.getAttribute("Len") || "";
        const qualDft = qual.getAttribute("Dft") || "";

        // ✅ Use instance suffix only for multi-instance parameters
        const qualName = isMultiInstance ? `${kwd}_QUAL${q}_${instanceIdx}` : `${kwd}_QUAL${q}`;

        console.log(`[clPrompter] Creating qual ${q}: ${qualName}, type: ${qualType}, prompt: "${qualPrompt}", default: ${qualDft}`);

        const qualDiv = document.createElement("div");
        qualDiv.className = "form-div";

        const qualLabel = document.createElement("label");
        qualLabel.className = "form-label";
        qualLabel.textContent = qualPrompt;
        qualLabel.htmlFor = qualName;
        qualDiv.appendChild(qualLabel);

        // Create appropriate input for qualifier
        const qualInput = createQualInput(qual, qualName, qualType, qualLen, qualDft);
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
          qualInput = createInputForType(qualType, qualName, qualDft, qualLen);
          if (qualDft) {
            qualInput.setAttribute('data-default', qualDft);
          }
        }
      }

      // Set common attributes
      qualInput.name = qualName;
      qualInput.id = qualName;

      return qualInput;
    }

    function createSimpleParameterCombobox(parm, kwd, dft, spcVal, sngVal) {
      const select = document.createElement("vscode-single-select");
      select.setAttribute("combobox", "");

      // Set default value as data attribute
      if (dft) {
        select.setAttribute('data-default', dft);
      }

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
          input = createInputForType(parmType, kwd, dft, parmLen);
        }

        input.id = instanceId;
        input.name = kwd;

        if (required) {
          input.required = true;
        }

        console.log(`[clPrompter] About to append input for ${kwd} to container`);
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
      // ✅ CRITICAL: Check if this parameter was in the original command
      const parmKwd = input.name.split('_')[0]; // Get base parameter name
      const wasInOriginal = originalParamMap.hasOwnProperty(parmKwd);

      // ✅ If it was in the original command, never treat it as "unchanged default"
      if (wasInOriginal) {
        console.log(`[clPrompter] ${parmKwd} was in original command - preserving it`);
        return false;
      }

      const defaultValue = input.getAttribute('data-default');
      if (!defaultValue) return false;

      // Value matches default exactly
      if (value === defaultValue) return true;

      // ✅ Don't treat empty values as unchanged defaults for QUAL parameters
      if (input.name && input.name.includes('_QUAL')) {
        return false; // Never skip QUAL parameters due to defaults
      }

      // Handle empty value when default exists
      if (!value && defaultValue) return true;

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
                const input = inst.querySelector(`[name="${elemName}"]`);
                let val = input ? input.value : "";
                if (val === "" || val === undefined || val === null || val === "*N") continue;
                const elemType = (elems[e].getAttribute("Type") || "").toUpperCase();
                elemVals.push(val);
              }
              const filtered = elemVals.filter(v => v !== "*N" && v !== "" && v !== "''");
              if (filtered.length > 0) {
                instanceVals.push(filtered.join(" "));
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
        inputs.forEach(i => {
          if (i.closest('.parm-multi-group')) return;
          if (!i.name) return;

          // ✅ Add debug logging for TOPGMQ inputs
          if (i.name.includes('TOPGMQ')) {
            console.log(`[clPrompter] Submit - TOPGMQ input: name="${i.name}", value="${i.value}", tagName=${i.tagName}`);
          }


          let parmType = "CHAR";
          let parmElem = null;
          for (let p = 0; p < parms.length; p++) {
            const kwd = parms[p].getAttribute("Kwd");
            if (i.name.startsWith(kwd)) {
              parmElem = parms[p];
              break;
            }
          }
          if (!parmElem) return;

          const parmKwd = parmElem.getAttribute("Kwd");
          if (parmElem.hasAttribute("Type")) parmType = parmElem.getAttribute("Type").toUpperCase();

          let val = getInputValue(i);

          console.log(`[clPrompter] Submit - Processing ${i.name}, value: "${val}", tagName: ${i.tagName}`);

          // ✅ Skip if value is unchanged default
          if (isUnchangedDefault(i, val)) {
            console.log(`[clPrompter] Skipping ${i.name} - unchanged default: ${val}`);
            return;
          }

          const qualMatch = i.name.match(/^(.+?)_QUAL(\d+)$/);
          if (qualMatch) {
            const parmName = qualMatch[1];
            const qualIndex = parseInt(qualMatch[2], 10);
            if (!qualGroups[parmName]) qualGroups[parmName] = [];
            qualGroups[parmName].push({ qual: `QUAL${qualIndex}`, value: val, index: qualIndex });
            console.log(`[clPrompter] Submit - Added QUAL: ${parmName} QUAL${qualIndex} = "${val}" (index: ${qualIndex})`);
            console.log(`[clPrompter] Submit - Current qualGroups[${parmName}]:`, qualGroups[parmName]);
            return;
          }

          if (i.name.match(/_ELEM\d+$/)) {
            // ✅ Don't store ELEM values with unchanged defaults
            if (val !== "" && val !== "''" && val !== '""') {
              values[i.name] = val;
            }
            return;
          }

          // Around line 3220 in prompter.html submit handler:

          const wasInOriginal = originalParamMap.hasOwnProperty(parmKwd);

          // ✅ FIXED: Only include if value is non-empty AND different from default
          if (val !== "" && val !== "''" && val !== '""') {
            // ✅ Check if this value is different from the default
            const defaultValue = getDefaultValue(i); // You'll need this helper function
            const isChangedFromDefault = val !== defaultValue;

            if (isChangedFromDefault || wasInOriginal) {
              values[parmKwd] = val;
              console.log(`[clPrompter] Including parameter: ${parmKwd} = "${val}" (changed=${isChangedFromDefault}, wasInOriginal=${wasInOriginal})`);
            } else {
              console.log(`[clPrompter] Skipping unchanged default: ${parmKwd} = "${val}"`);
            }
          } else if (wasInOriginal) {
            values[parmKwd] = originalParamMap[parmKwd];
            console.log(`[clPrompter] Restoring original parameter: ${parmKwd}`);
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
            let hasNonDefaultValues = false;

            // ✅ Process each ELEM element
            for (let e = 0; e < elems.length; e++) {
              const elemName = `${kwd}_ELEM${e}`;
              const elem = elems[e];

              // ✅ Handle nested ELEM (ELEM within ELEM)
              if (elem.getAttribute("Type") === "ELEM") {
                console.log(`[clPrompter] Processing nested ELEM: ${elemName}`);
                const subElems = elem.getElementsByTagName("Elem");

                for (let se = 0; se < subElems.length; se++) {
                  const subElemName = `${elemName}_${se}`;  // ✅ Use correct naming pattern
                  const subInput = document.querySelector(`[name="${subElemName}"]`);
                  if (subInput) {
                    let subVal = getInputValue(subInput);
                    if (subVal && subVal.trim() !== "" && !isUnchangedDefault(subInput, subVal)) {
                      values[subElemName] = subVal;
                      hasNonDefaultValues = true;
                      console.log(`[clPrompter] Added nested ELEM value: ${subElemName} = "${subVal}"`);
                    }
                  }
                }
              } else {
                // ✅ Regular ELEM processing
                const input = document.querySelector(`[name="${elemName}"]`);
                if (input) {
                  let val = getInputValue(input);
                  // ✅ Special case: Always include ELEM0 even if it's a default
                  const isFirstElement = elemName.endsWith('_ELEM0');

                  if (val && val.trim() !== "" && (!isUnchangedDefault(input, val) || isFirstElement)) {
                    values[elemName] = val;
                    hasNonDefaultValues = true;
                    console.log(`[clPrompter] Added regular ELEM value: ${elemName} = "${val}"`);
                  }
                }
              }
            }

            // ✅ If no non-default values found, use original values
            if (!hasNonDefaultValues && originalParamMap.hasOwnProperty(kwd)) {
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
        for (const parmName in qualGroups) {
          const parm = Array.from(parms).find(p => p.getAttribute("Kwd") === parmName);
          if (!parm || !parm.getElementsByTagName("Qual").length) continue;

          // ✅ Sort by index (QUAL0, QUAL1, QUAL2) - no reverse needed
          const parts = qualGroups[parmName]
            .sort((a, b) => a.index - b.index)  // Sort by numeric index
            .reverse()
            .map(q => q.value)
            .filter(val => val !== "");

          console.log(`[clPrompter] Submit - Assembled QUAL ${parmName}:`, parts);

          if (parts.length > 0) {
            values[parmName] = parts;
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
        for (const [key, value] of Object.entries(values)) {
          cmdString += ` ${key}(${Array.isArray(value) ? value.join(" ") : value})`;
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

    document.getElementById("cancelBtn").addEventListener("click", e => {
      e.preventDefault();
      vscode.postMessage({ type: "cancel" });
    });

    // --- Keyboard shortcut: F3 cancels prompt (same as Cancel button) ---
    document.addEventListener('keydown', function(e) {
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

        console.log("[clPrompter] VS Code Elements availability:");
        availableComponents.forEach(component => {
          const isAvailable = !!customElements.get(component);
          // console.log(`  ${component}: ${isAvailable}`);
        });

      }, 100);

      vscode.postMessage({ type: 'webviewReady' });
      console.log('[clPrompter] Sent webviewReady message');
    });
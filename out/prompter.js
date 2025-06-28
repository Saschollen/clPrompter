"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHtmlForPrompter = getHtmlForPrompter;
exports.parseCLCmd = parseCLCmd;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const QlgPathName_1 = require("./QlgPathName");
function logMessage(...args) {
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg)).join(' ');
    // Use a fallback for development mode detection
    const isDevelopmentMode = vscode.env.appName.includes('Code - OSS') || vscode.env.appName.includes('Insiders');
    if (isDevelopmentMode) {
        console.log(message);
    }
    else {
        vscode.window.showWarningMessage(message);
    }
}
function getHtmlForPrompter(webview, TwoPartCmdName, xml, nonce) {
    const htmlPath = path.join(__dirname, '..', 'media', 'prompter.html');
    return new Promise((resolve, reject) => {
        fs.readFile(htmlPath, { encoding: 'utf8' }, (err, html) => {
            if (err) {
                reject(new Error(`[clPrompter] Failed to read HTML file: ${err.message}`));
                return;
            }
            const qualCmdName = (0, QlgPathName_1.buildQualName)(TwoPartCmdName);
            // Replace placeholders with escaped or safe values
            const replacedHtml = html
                .replace(/{{cspSource}}/g, webview.cspSource)
                .replace(/{{nonce}}/g, nonce)
                .replace(/{{cmdName}}/g, qualCmdName)
                .replace(/{{xml}}/g, xml.replace(/"/g, '&quot;')); // Escape double quotes for safety
            try {
                const now = new Date();
                const yy = String(now.getFullYear()).slice(-2);
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const dateStr = `${yy}${mm}${dd}`;
                const debugPath = path.join(__dirname, `../../clPrompter-${dateStr}.html`);
                fs.writeFileSync(debugPath, replacedHtml, { encoding: 'utf8' });
            }
            catch (err) {
                console.error('Continuing after Failed to write debug HTML file:', err);
            }
            resolve(replacedHtml);
        });
    });
}
function parseCLCmd(cmd) {
    // Remove command name
    const parts = cmd.trim().split(/\s+/);
    parts.shift();
    const result = {};
    let i = 0;
    while (i < parts.length) {
        let part = parts[i];
        const eqIdx = part.indexOf('(');
        if (eqIdx > 0) {
            // Parameter with parenthesis value
            const param = part.substring(0, eqIdx);
            let val = part.substring(eqIdx);
            // If value is split across tokens, join until closing paren
            while (val.split('(').length > val.split(')').length && i + 1 < parts.length) {
                i++;
                val += ' ' + parts[i];
            }
            val = val.replace(/^\(/, '').replace(/\)$/, '');
            // Split by spaces, but keep quoted strings together
            const vals = val.match(/'[^']*'|"[^"]*"|\S+/g) || [];
            result[param] = vals.map(v => v.replace(/^['"]|['"]$/g, ''));
        }
        else if (part.includes('(')) {
            // Handles case where param and value are split
            const param = part.replace(/\(.*/, '');
            let val = part.substring(part.indexOf('('));
            while (val.split('(').length > val.split(')').length && i + 1 < parts.length) {
                i++;
                val += ' ' + parts[i];
            }
            val = val.replace(/^\(/, '').replace(/\)$/, '');
            const vals = val.match(/'[^']*'|"[^"]*"|\S+/g) || [];
            result[param] = vals.map(v => v.replace(/^['"]|['"]$/g, ''));
        }
        else if (part.includes('=')) {
            // Not standard CL, but just in case
            const [param, val] = part.split('=');
            result[param] = [val];
        }
        else {
            // Parameter with single value
            const param = part;
            if (i + 1 < parts.length && !parts[i + 1].includes('(') && !parts[i + 1].includes('=')) {
                i++;
                result[param] = [parts[i].replace(/^['"]|['"]$/g, '')];
            }
        }
        i++;
    }
    return result;
}
//# sourceMappingURL=prompter.js.map
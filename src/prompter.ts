import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildQlgPathNameHex, buildAPI2PartName, buildQualName } from './QlgPathName';

function logMessage(...args: any[]): void {
  const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg)).join(' ');

  // Use a fallback for development mode detection
  const isDevelopmentMode = vscode.env.appName.includes('Code - OSS') || vscode.env.appName.includes('Insiders');

  if (isDevelopmentMode) {
    console.log(message);
  } else {
    vscode.window.showWarningMessage(message);
  }
}

// ✅ Add this helper function to extension.ts (around line 40, before the ClPromptPanel class)
export function findCommandRange(lines: string[], currentLine: number): { startLine: number; endLine: number } {
  let startLine = currentLine;
  let endLine = currentLine;

  // Find the start of the command (look backward for continuation)
  while (startLine > 0) {
    const prevLine = lines[startLine - 1].trimEnd();
    if (prevLine.endsWith('+') || prevLine.endsWith('-')) {
      startLine--;
    } else {
      break;
    }
  }

  // Find the end of the command (look forward for continuation)
  let lineIndex = startLine;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trimEnd();
    endLine = lineIndex;

    if (line.endsWith('+') || line.endsWith('-')) {
      lineIndex++;
    } else {
      break;
    }
  }

  return { startLine, endLine };
}

export function getHtmlForPrompter(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  TwoPartCmdName: string,
  xml: string,
  nonce: string
): Promise<string> {

  const htmlPath = path.join(__dirname, '..', 'media', 'prompter.html');
  const mainJs = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
  );

  console.log(`[clPrompter] htmlPath: ${htmlPath}`);
  console.log(`[clPrompter] main.js: ${mainJs}`);
  console.log(`[clPrompter] styleUri: ${styleUri}`);


  return new Promise((resolve, reject) => {
    fs.readFile(htmlPath, { encoding: 'utf8' }, (err, html) => {
      if (err) {
        reject(new Error(`[clPrompter] Failed to read HTML file: ${err.message}`));
        return;
      }
      const qualCmdName = buildQualName(TwoPartCmdName);
      // No longer logging vsElements; now using main.js only
      // Replace placeholders with escaped or safe values
      const replacedHtml = html
        .replace(/{{nonce}}/g, nonce)
        .replace(/{{cspSource}}/g, webview.cspSource)
        .replace(/{{mainJs}}/g, mainJs.toString())
        .replace(/{{styleUri}}/g, styleUri.toString())
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
      } catch (err) {
        console.error('Continuing after Failed to write debug HTML file:', err);
      }

      resolve(replacedHtml);
    });
  });
}


export function parseCLCmd(cmd: string): Record<string, string[]> {
  // Remove command name
  const parts = cmd.trim().split(/\s+/);
  parts.shift();

  const result: Record<string, string[]> = {};
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
    } else if (part.includes('(')) {
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
    } else if (part.includes('=')) {
      // Not standard CL, but just in case
      const [param, val] = part.split('=');
      result[param] = [val];
    } else {
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
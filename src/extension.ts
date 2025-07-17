import * as vscode from 'vscode';
import { DOMParser } from '@xmldom/xmldom';

import { collectCLCmd, buildAllowedValsMap } from './extractor';
import { generatePopulationInstructions } from './populator';
import { formatCLCmd, tokenizeCL, parseCL, formatCL_SEU } from './tokenizeCL';

import { CodeForIBMi } from "@halcyontech/vscode-ibmi-types";
export let code4i: CodeForIBMi;
import { Extension, extensions } from "vscode";
import {
    extractAllowedValsAndTypes,
    quoteIfNeeded,
    buildCLCommand
} from "./formatCL";
import {
    extractParmMetas,
    parseCLParms,
    ParmMeta
} from './parseCL';

import { getHtmlForPrompter } from './prompter';
import { buildAPI2PartName } from './QlgPathName';
import { getCMDXML } from './getcmdxml';

let baseExtension: Extension<CodeForIBMi> | undefined;

export async function activate(context: vscode.ExtensionContext) {

    baseExtension = extensions.getExtension<CodeForIBMi>("halcyontechltd.code-for-ibmi");
    if (baseExtension) {
        if (!baseExtension.isActive) {
            await baseExtension.activate();
        }
        code4i = baseExtension.exports;
    } else {
        vscode.window.showErrorMessage("Code for IBM i extension is not installed or not found.");
    }
    console.log('[clPrompter] activating...');
    context.subscriptions.push(
        vscode.commands.registerCommand('clPrompter.clPrompter', async () => {
            console.log('CL Prompter activated!');
            const config = vscode.workspace.getConfiguration('clPrompter');
            if (!config.get('enableF4Key')) {
                vscode.window.showInformationMessage('Fn key for CL Prompter is disabled in settings.');
                return;
            }
            await ClPromptPanel.createOrShow(context.extensionUri);
        })
    );
    console.log('CL Prompter activate [end]');
}


export class ClPromptPanel {
    public static currentPanel: ClPromptPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _editor: vscode.TextEditor | undefined;
    private _selection: vscode.Selection | undefined;
    private _documentUri: vscode.Uri | undefined;

    // ✅ Added method to reset webview state
    public resetWebviewState() {
        console.log('[clPrompter] Resetting webview state');

        // ✅ Check if panel exists and use try-catch for webview access
        if (this._panel) {
            try {
                this._panel.webview.postMessage({ type: 'reset' });
            } catch (error) {
                console.warn('[clPrompter] Could not send reset message - webview may be disposed:', error);
            }
        } else {
            console.warn('[clPrompter] Cannot reset webview state - panel is null');
        }
    }

    // ✅ Update createOrShow method around line 85
    public static async createOrShow(extensionUri: vscode.Uri): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        let fullCmd = '';
        let commandRange: { startLine: number; endLine: number } | undefined;

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // ✅ Use extractFullCLCmd for the command string
            const cmdResult = collectCLCmd(editor);
            fullCmd = cmdResult.command;
            commandRange = { startLine: cmdResult.startLine, endLine: cmdResult.endLine };

            // ✅ Optional: Verify both methods agree on the range
            console.log(`[clPrompter] Command range: ${commandRange.startLine}-${commandRange.endLine}`);
            console.log(`[clPrompter] Extract result: ${cmdResult.startLine}-${cmdResult.endLine}`);
        }

        let cmdName = extractCmdName(fullCmd);
        if (!cmdName) {
            cmdName = (await askUserForCMDToPrompt(fullCmd)).toString();
        }
        if (!cmdName || cmdName.trim() == '') {
            return;
        }
        const cmdLabel = extractCmdLabel(fullCmd);

        const xml = await getCMDXML(cmdName);
        console.log("[clPrompter] <XML> ", xml);
        console.log("[clPrompter] </XML>");

        // ✅ Create selection that spans the entire command range
        const selection = editor && commandRange
            ? new vscode.Selection(
                commandRange.startLine, 0,
                commandRange.endLine, editor.document.lineAt(commandRange.endLine).text.length
            )
            : undefined;

        if (ClPromptPanel.currentPanel) {
            ClPromptPanel.currentPanel._panel.reveal(column);
            await ClPromptPanel.currentPanel.setXML(cmdName, xml, editor, selection);
        } else {
            const panel = vscode.window.createWebviewPanel(
                'clPrompter',
                'CL Prompt',
                column,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
                }
            );
            ClPromptPanel.currentPanel = new ClPromptPanel(
                panel, extensionUri, cmdName, cmdLabel, xml, editor, selection, fullCmd);
        }
    }

    private _cmdName: string;
    private _cmdLabel: string;
    private _xml: string;
    private _parmMetas: ParmMeta[] = [];
    private _paramMap: any = [];
    private _presentParms: Set<string> = new Set();

    constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        cmdName: string,
        cmdLabel: string,
        xml: string,
        editor?: vscode.TextEditor,
        selection?: vscode.Selection,
        fullCmd?: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._cmdName = cmdName;
        this._cmdLabel = cmdLabel;
        this._xml = xml;
        this._editor = editor;
        this._selection = selection;

        // In constructor and setXML:
        this._documentUri = editor?.document.uri;
        this._selection = selection;

        if (fullCmd) {
            // 1. Extract parameter metadata from XML
            this._parmMetas = extractParmMetas(xml);
            // 2. Parse the command string into a parameter map
            this._paramMap = parseCLParms(fullCmd, this._parmMetas);
            // 3. Get list of pre-prompt keywords already on the command
            this._presentParms = new Set(Object.keys(this._paramMap));

            console.log('[clPrompter] Parameter Map:', this._paramMap);

            panel.webview.onDidReceiveMessage(message => {
                if (message.type === 'webviewReady') {
                    console.log('[clPrompter] Sending processed data to webview');

                    // ✅ Process XML in TypeScript instead of JavaScript
                    const allowedValsMap = buildAllowedValsMap(xml);

                    // ✅ Read the keyword color configuration
                    const keywordColor = vscode.workspace.getConfiguration('clPrompter').get('kwdColor');

                    // Send processed data instead of raw XML
                    panel.webview.postMessage({
                        type: 'formData',
                        xml, // Still send XML for other processing
                        allowedValsMap,
                        cmdName,
                        paramMap: this._paramMap, // ✅ ADD THIS LINE
                        config: {
                            keywordColor: keywordColor
                        }
                    });

                    // ✅ Send setLabel message first (immediately after formData)
                    panel.webview.postMessage({ type: "setLabel", label: cmdLabel });


                }
            });

        }
        this.getHtmlForPrompter(this._panel.webview, this._cmdName, this._xml)
            .then(html => {
                this._panel.webview.html = html;
            })
            .catch(err => {
                console.error('[clPrompter] Error generating HTML:', err);
            });

        // ✅ Fix around line 245 in constructor
        this._panel.onDidDispose(() => {
            console.log('[clPrompter] Panel disposed');

            // ✅ DON'T call this.dispose() here - it creates recursion
            // ✅ Just clean up the static reference and disposables
            ClPromptPanel.currentPanel = undefined;

            while (this._disposables.length) {
                const disposable = this._disposables.pop();
                if (disposable) {
                    disposable.dispose();
                }
            }
        }, null, this._disposables);

        // ...inside the ClPromptPanel class constructor...
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'submit': {

                        console.log('[submit] this._cmdName:', this._cmdName);
                        console.log('[submit] Received cmdName:', message.cmdName);
                        console.log('[submit] message.values:', message.values);
                        console.log('[submit] Raw message.values:');
                        Object.keys(message.values).forEach(key => {
                            console.log(`  ${key}: "${message.values[key]}"`);
                        });
                        // Check specifically for TOPGMQ patterns
                        const topgmqKeys = Object.keys(message.values).filter(k => k.startsWith('TOPGMQ'));
                        console.log('[submit] TOPGMQ keys found:', topgmqKeys);

                        // ✅ Add debugging for nested ELEM detection
                        const { allowedValsMap, parmTypeMap } = extractAllowedValsAndTypes(this._xml);
                        console.log('[submit] allowedValsMap keys:', Object.keys(allowedValsMap));
                        console.log('[submit] parmTypeMap:', parmTypeMap);

                        // ✅ Check for ELEM parameters specifically
                        Object.keys(message.values).forEach(key => {
                            if (key.includes('_ELEM')) {
                                console.log(`[submit] ELEM parameter ${key}:`, message.values[key]);
                                console.log(`[submit] Type for ${key}:`, parmTypeMap[key]);
                            }
                        });

                        const defaults = extractDefaultsFromXML(this._xml);
                        const cmd = buildCLCommand(
                            this._cmdName,
                            message.values,
                            defaults,
                            allowedValsMap,
                            parmTypeMap,
                            this._parmMetas,
                            this._presentParms,
                            undefined
                        );

                        // Extract label and param string for formatting
                        const label = extractCmdLabel(cmd);
                        const cmdName = extractCmdName(cmd);
                        // Remove label and command name from the start to get the param string
                        let paramStr = cmd;
                        if (label && label.length > 0) {
                            paramStr = paramStr.substring(label.length + 1).trim();
                        }
                        if (cmdName && paramStr.startsWith(cmdName)) {
                            paramStr = paramStr.substring(cmdName.length).trim();
                        }

                        // Import formatCLCmd lazily to avoid circular import issues
                        // (If you already import it at the top, just use it directly)
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        const { formatCLCmd } = require('./tokenizeCL');
                        const formatted = formatCLCmd(label, cmdName, paramStr);

                        // Use the active document's EOL
                        if (this._documentUri && this._selection) {
                            vscode.workspace.openTextDocument(this._documentUri).then(doc => {
                                vscode.window.showTextDocument(doc, { preview: false }).then(editor => {
                                    const eol = doc.eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
                                    const formattedWithEOL = formatted.split(/\r?\n/).join(eol);
                                    editor.edit(editBuilder => {
                                        editBuilder.replace(this._selection!, formattedWithEOL);
                                    }).then(success => {
                                        if (!success) {
                                            vscode.window.showWarningMessage('Failed to insert CL command. Try again.');
                                        }
                                        this._panel.dispose();
                                    });
                                });
                            });
                        } else {
                            vscode.window.showWarningMessage(
                                'Could not insert command: original editor is no longer open.'
                            );
                            vscode.env.clipboard.writeText(formatted);
                            vscode.window.showInformationMessage('CL command copied to clipboard.');
                            this._panel.dispose();
                        }
                        break;
                    }
                    case 'cancel': {
                        this._panel.dispose();
                        break;
                    }
                    case 'loadForm': {
                        this._panel.webview.postMessage({ type: 'formXml', xml: this._xml, cmdName: this._cmdName });
                        this._panel.webview.postMessage({ type: "setLabel", label: this._cmdLabel });
                        break;
                    }
                }
            },
            undefined,
            this._disposables
        );
    }

    // ✅ Update setXML to handle multi-line commands
    public async setXML(cmdName: string, xml: string, editor?: vscode.TextEditor, selection?: vscode.Selection) {
        console.log('[clPrompter] setXML called - resetting state');
        this.resetWebviewState();
        console.log('[clPrompter] setXML finished resetting state');

        this._cmdName = cmdName;
        this._xml = xml;
        this._editor = editor;
        this._selection = selection;

        // ✅ Update document URI to current editor
        this._documentUri = editor?.document.uri;

        const html = await this.getHtmlForPrompter(this._panel.webview, this._cmdName, this._xml);
        this._panel.webview.html = html;
    }


    // ✅ Fix the dispose method around line 290
    public dispose() {
        console.log('[clPrompter] Disposing ClPromptPanel');

        // ✅ Clear the current panel reference BEFORE disposing
        ClPromptPanel.currentPanel = undefined;

        // ✅ Dispose of the panel LAST
        this._panel.dispose();

        // ✅ Clean up disposables after panel is disposed
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private async getHtmlForPrompter(webview: vscode.Webview, cmdString: string, xml: string): Promise<string> {
        const nonce = getNonce();
        const cmdName = buildAPI2PartName(cmdString);

        const prompter = await getHtmlForPrompter(webview, this._extensionUri, cmdName.toString(), xml, nonce);
        // console.log("[clPrompter] HTML generated for Prompter: ", prompter);
        return prompter;
    }
}

// Utility: Extract CL command name from editor or prompt user
async function askUserForCMDToPrompt(cmdString: string): Promise<Buffer> {

    let libName = '';
    let cmdName = '';
    // If input contains spaces, treat as full CL command string
    if (cmdString && cmdString.trim() !== '') {
        return buildAPI2PartName(cmdString);
    }

    // Prompt if not found
    const input = await vscode.window.showInputBox({
        prompt: 'Type Command Name to Prompt:  <library/>cmdName',
        placeHolder: 'e.g. SNDPGMMSG or COZTOOLS/RTVJOBDA',
        validateInput: v => {
            const m = v.match(/^([A-Z0-9_$#@]+)(?:\/([A-Z0-9_$#@]+))?$/i);
            return m ? undefined : 'Enter CMD or LIB/CMD';
        }
    });
    return input ? buildAPI2PartName(input) : Buffer.from('');
}


function extractCmdName(cmdString: string): string {
    // Remove leading/trailing whitespace
    let str = cmdString.trim();
    // Split into tokens
    let tokens = str.split(/\s+/);
    // If first token ends with a colon, it's a label
    if (tokens.length > 1 && tokens[0].endsWith(':')) {
        tokens.shift();
    }
    // The next token is the command (possibly qualified)
    if (tokens.length > 0) {
        // Return the command name (qualified or not)
        return tokens[0];
    }
    return '';
}

function extractCmdLabel(cmdString: string): string {
    let str = cmdString.trim();
    let tokens = str.split(/\s+/);
    if (tokens.length > 1 && tokens[0].endsWith(':')) {
        // Remove the colon and return the label
        return tokens[0].slice(0, -1);
    }
    return '';
}




// Utility: Nonce for CSP
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Helper: Download a streamfile from IBM i as Buffer (raw) or string (text)
export async function downloadStreamfile(
    connection: any, // Use the correct type for your connection if available
    ifsPath: string,
    raw: boolean = false,
    encoding: BufferEncoding = 'utf8'
): Promise<Buffer | string | undefined> {
    try {
        const fileInfo = await connection.stat(ifsPath);  // Get the file attributes (fileInfo.ccsid)
        if (raw) {
            // Raw binary (Buffer)
            if (typeof connection.downloadStreamfileRaw === 'function') {
                return await connection.downloadStreamfileRaw(ifsPath);
            } else {
                throw new Error('downloadStreamfileRaw is not available on this connection.');
            }
        } else {
            // Text (string)
            if (typeof connection.downloadStreamfile === 'function') {
                return await connection.downloadStreamfile(ifsPath, encoding);
            } else {
                // Fallback: download as raw and convert to string
                const buf = await connection.downloadStreamfileRaw(ifsPath);
                return buf.toString(encoding);
            }
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to download streamfile: ${err}`);
        return undefined;
    }
}


function extractDefaultsFromXML(xml: string): Record<string, string> {
    const defaults: Record<string, string> = {};
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const parms = doc.getElementsByTagName("Parm");
    for (let i = 0; i < parms.length; i++) {
        const parm = parms[i];
        const kwd = parm.getAttribute("Kwd");
        const dft = parm.getAttribute("Dft");
        if (kwd && dft) {
            defaults[kwd] = dft;
        }
    }
    return defaults;
}
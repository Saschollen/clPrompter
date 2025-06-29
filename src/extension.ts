import * as vscode from 'vscode';
import { DOMParser } from '@xmldom/xmldom';

import { CodeForIBMi } from "@halcyontech/vscode-ibmi-types";
export let code4i: CodeForIBMi;
import { Extension, extensions } from "vscode";
import {
    extractFullCLCmd,
    extractAllowedValsAndTypes,
    quoteIfNeeded,
    buildCLCommand
} from "./formatCL";
import {
    extractParmMetas,
    parseCLParms,
    ParmMeta
} from './parseCL';

import { getHtmlForPrompter, parseCLCmd } from './prompter';
import { buildAPI2PartName } from './QlgPathName';
import { getCMDXML } from './getcmdxml';

let baseExtension: Extension<CodeForIBMi> | undefined;

export async function activate(context: vscode.ExtensionContext) {
vscode.window.showInformationMessage('CL Prompter activate! [start]');
    baseExtension = extensions.getExtension<CodeForIBMi>("halcyontechltd.code-for-ibmi");
    if (baseExtension) {
        if (!baseExtension.isActive) {
            await baseExtension.activate();
        }
        code4i = baseExtension.exports;
    } else {
        vscode.window.showErrorMessage("Code for IBM i extension is not installed or not found.");
    }
    vscode.window.showInformationMessage('CL Prompter activating...');
    context.subscriptions.push(
        vscode.commands.registerCommand('clPrompter.clPrompter', async () => {
            vscode.window.showInformationMessage('CL Prompter activated!');
            const config = vscode.workspace.getConfiguration('clPrompter');
            if (!config.get('enableF4Key')) {
                vscode.window.showInformationMessage('Fn key for CL Prompter is disabled in settings.');
                return;
            }
            await ClPromptPanel.createOrShow(context.extensionUri);
        })
    );
    vscode.window.showInformationMessage('CL Prompter activate [end]');
}


export class ClPromptPanel {
    public static currentPanel: ClPromptPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _editor: vscode.TextEditor | undefined;
    private _selection: vscode.Selection | undefined;
    private _documentUri: vscode.Uri | undefined;


    public static async createOrShow(extensionUri: vscode.Uri): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        let fullCmd = '';
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const allLines = Array.from({ length: editor.document.lineCount }, (_, i) =>
                editor.document.lineAt(i).text
            );
            const currentLine = editor.selection.active.line;
            fullCmd = extractFullCLCmd(allLines, currentLine);
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

        const selection = editor
            ? new vscode.Selection(
                editor.selection.active.line, 0,
                editor.selection.active.line, editor.document.lineAt(editor.selection.active.line).text.length
            )
            : undefined;

        if (ClPromptPanel.currentPanel) {
            ClPromptPanel.currentPanel._panel.reveal(column);
            await ClPromptPanel.currentPanel.setXML(cmdName, xml, editor, selection); // Use `await` to handle the asynchronous `setXML`
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
    private _presentParms: Set<string> = new Set();

    constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        cmdName: string,
        cmdLabel: string,
        xml: string,
        editor?: vscode.TextEditor,
        selection?: vscode.Selection,
        fullCmd?: string // <-- add this
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
            const paramMap = parseCLParms(fullCmd, this._parmMetas);
            // 3. Get list of pre-prompt keywords already on the command
            this._presentParms = new Set(Object.keys(paramMap));

            console.log('[clPrompter] Parameter Map:', paramMap);

            panel.webview.onDidReceiveMessage(message => {
                if (message.type === 'webviewReady') {
                    console.log('[clPrompter] Sending formXml and populateForm messages to webview');
                    panel.webview.postMessage({ type: 'formXml', xml }); // send XML to render the form
                    panel.webview.postMessage({ type: 'populateForm', paramMap }); // send values to populate
                    panel.webview.postMessage({ type: "setLabel", value: cmdLabel }); // send label
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

        this._panel.onDidDispose(() => {
            ClPromptPanel.currentPanel = undefined;
            this.dispose();
        }, null, this._disposables);

        // ...inside the ClPromptPanel class constructor...
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'submit': {
                        console.log('[submit] this._cmdName:', this._cmdName); // Debug log for cmdName
                        console.log('[submit] Received cmdName:', message.cmdName); // Debug log for cmdName from webview
                        // console.log('[submit] Received cmdString:', message.cmdString); // Debug log for cmdString from webview
                        console.log('[submit] message.values:', message.values); // Debug log for values
                        const defaults = extractDefaultsFromXML(this._xml);
                        const { allowedValsMap, parmTypeMap } = extractAllowedValsAndTypes(this._xml);
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

                        if (this._documentUri && this._selection) {
                            vscode.workspace.openTextDocument(this._documentUri).then(doc => {
                                vscode.window.showTextDocument(doc, { preview: false }).then(editor => {
                                    editor.edit(editBuilder => {
                                        editBuilder.replace(this._selection!, cmd);
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
                            vscode.env.clipboard.writeText(cmd);
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
                        this._panel.webview.postMessage({ type: "setLabel", value: this._cmdLabel });
                        break;
                    }
                }
            },
            undefined,
            this._disposables
        );
    }

    public async setXML(cmdName: string, xml: string, editor?: vscode.TextEditor, selection?: vscode.Selection) {
        this._cmdName = cmdName;
        this._xml = xml;
        this._editor = editor;
        this._selection = selection;
        const html = await this.getHtmlForPrompter(this._panel.webview, this._cmdName, this._xml);
        this._panel.webview.html = html;
    }

    // ...rest of your code...


    public dispose() {
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }

    private async getHtmlForPrompter(webview: vscode.Webview, cmdString: string, xml: string): Promise<string> {
        const nonce = getNonce();
        const cmdName = buildAPI2PartName(cmdString);

        const prompter = await getHtmlForPrompter(webview, cmdName.toString(), xml, nonce);
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
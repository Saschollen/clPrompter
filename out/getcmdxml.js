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
exports.getCMDXML = getCMDXML;
const vscode = __importStar(require("vscode"));
const extension_1 = require("./extension");
const QlgPathName_1 = require("./QlgPathName");
// Utility: Fetch or return XML for a command
async function getCMDXML(cmdString) {
    if (!extension_1.code4i) {
        vscode.window.showErrorMessage("Code for IBM i extension is not available.");
        return '';
    }
    const connection = extension_1.code4i.instance.getConnection();
    const c4iConfig = connection.getConfig();
    console.log(`Using CodeFori: tempDir="${c4iConfig.tempDir}"`);
    // The input cmdString can be full CL Command (with or without parameters)
    // We call buildAPI2PartName that puts out the command and optional library name
    // placing it into the cmdName variable as a 20-byte API-friendly qualified object name
    const cmdName = (0, QlgPathName_1.buildAPI2PartName)(cmdString);
    // Now we need to pull out the command name from the up to first 10 characters.
    // and the library name (LIB) from positions 11 to 20 (if they exist).
    const OBJNAME = cmdName.toString('utf8', 0, 10).trim();
    let LIBNAME = cmdName.length >= 20 ? cmdName.toString('utf8', 10, 20).trim() : '';
    if (!LIBNAME) {
        LIBNAME = '*LIBL';
    }
    // Use up to the first 10 non-blank characters of cmdName for the filename
    // If the command is qualified, use the library name in the xml file name for uniqueness.
    // If the commadn is unqualied, then use just the command name.
    const trimmedCmdName = cmdName.toString().trim().substring(0, 10).replace(/\s+$/, '');
    let cmdXMLName = '';
    if (LIBNAME.length > 0 && LIBNAME !== '*LIBL') {
        cmdXMLName = `${LIBNAME}_`;
    }
    cmdXMLName += OBJNAME;
    const outFile = `${c4iConfig.tempDir.replace(/\/?$/, '/')}${cmdXMLName}.cmd`;
    const fileParm = (0, QlgPathName_1.buildQlgPathNameHex)(outFile); // Create an QlgPathName_T for this outfile
    console.log(`[clPrompter] Getting XML for: ${cmdName}`);
    const QCDRCMDD = `CALL QCDRCMDD PARM('${cmdName}' X'${fileParm}' 'DEST0200' ' ' 'CMDD0200' X'000000000000')`;
    // Use VSCODEforIBMi to get the Command Definition XML file from the IFS
    const result = await connection.runCommand({
        command: QCDRCMDD,
        environment: `ile`
    });
    if (result.code === 0) {
        const cmdxml = await vscode.workspace.openTextDocument(vscode.Uri.from({
            scheme: 'streamfile',
            path: outFile,
            query: 'readonly=true' // Optional: open in read-only mode
        }));
        if (cmdxml) {
            return cmdxml.getText();
        }
    }
    else {
        vscode.window.showWarningMessage(`Command completed with code ${result.code}: ${result.stderr || result.stdout}`);
    }
    // Placeholder for unknown commands
    return `<QcdCLCmd><Cmd CmdName="${cmdName}"></Cmd></QcdCLCmd>`;
}
//# sourceMappingURL=getcmdxml.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHtmlForPrompter = getHtmlForPrompter;
function getHtmlForPrompter(webview, cmdName, xml, nonce) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CL Command Prompter</title>
    <style nonce="${nonce}">
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; padding: 10px; }
    .form-label {
        display: inline-block;
        width: 40ch;
        vertical-align: middle;
        margin-bottom: 0.5em;
    }
    .form-input {
        vertical-align: middle;
        margin-bottom: 0.5em;
    }
    .form-div {
        margin-bottom: 0.5em;
    }
      button { margin-top: 15px; font-size: 1.1em; }
    </style>
    </head>
    <body>
    <form id="clForm"></form>
    <button id="cancelBtn">Cancel</button>
    <button id="submitBtn">Enter</button>

    <script nonce="${nonce}">
    let xmlDoc;

    window.addEventListener("message", event => {
      const message = event.data;
      if (message.type === "formXml") {
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(message.xml, "text/xml");
        loadForm(); // call after XML is loaded
      }
    });
    function loadForm() {
      const cmdInfo = xmlDoc.getElementsByTagName("Cmd");
      const parms = xmlDoc.getElementsByTagName("Parm");
      const form = document.getElementById("clForm");
      form.innerHTML = "";

      if (cmdInfo && cmdInfo.length > 0) {
        var cmdElem = cmdInfo[0];
        var cmdName = cmdElem.getAttribute("CmdName") || "";
        var prompt = cmdElem.getAttribute("Prompt") || "";
        var h3 = document.createElement("h3");
        h3.textContent = cmdName + " (" + prompt + ")";
        form.appendChild(h3);
      }

      for (let i = 0; i < parms.length; i++) {
        const parm = parms[i];
        const kwd = parm.getAttribute("Kwd");
        const prompt = parm.getAttribute("Prompt") || kwd;
        const dft = parm.getAttribute("Dft") || "";

        // Skip parms with Constant="C" or no Kwd
        if (parm.getAttribute("Constant") === "C" || !kwd) continue;

        const row = document.createElement("div");
        row.className = "form-div";

        const label = document.createElement("label");
        label.className = "form-label";
        label.textContent = prompt + " (" + kwd + ")";
        label.htmlFor = "input_" + kwd;

        const input = document.createElement("input");
        input.type = "text";
        input.name = kwd;
        input.value = dft;
        input.id = "input_" + kwd;

        row.appendChild(label);
        row.appendChild(input);
        form.appendChild(row);
      }
    }

    const vscode = acquireVsCodeApi();

    document.getElementById("submitBtn").addEventListener("click", e => {
      e.preventDefault();
      if (!xmlDoc) return;

      const inputs = document.querySelectorAll("input");
      const values = {};
      inputs.forEach(i => {
        values[i.name] = i.value.trim();
      });
      vscode.postMessage({ type: "submit", values });
    });

    document.getElementById("cancelBtn").addEventListener("click", e => {
      e.preventDefault();
      vscode.postMessage({ type: "cancel" });
    });

    // Ask extension to send form XML
    vscode.postMessage({ type: 'loadForm' });
    </script>

    </body>
    </html>`;
}
//# sourceMappingURL=prompter%20copy.js.map
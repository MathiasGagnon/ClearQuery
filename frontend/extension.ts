import * as vscode from "vscode";
import { spawn } from "child_process";

export function activate(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        "dfPreview",
        "DataFrame Preview",
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.html = getHtml([]);

    const py = spawn("python", ["engine.py"]);

    let buffer = "";

    py.stdout.on("data", (data) => {
        buffer += data.toString();

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;

            const msg = JSON.parse(line);
            if (msg.type === "preview") {
                panel.webview.html = getHtml(msg);
            }
        }
    });
}

function getHtml(data: any) {
    const cols = data.columns || [];
    const rows = data.rows || [];

    return `
    <html>
    <body>
        <table border="1">
            <tr>
                ${cols.map((c: string) => `<th>${c}</th>`).join("")}
            </tr>
            ${rows.map((r: any[]) => `
                <tr>
                    ${r.map(v => `<td>${v}</td>`).join("")}
                </tr>
            `).join("")}
        </table>
    </body>
    </html>
    `;
}
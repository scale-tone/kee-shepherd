import * as vscode from 'vscode';

import { KeyShepherd } from './KeyShepherd';

export async function activate(context: vscode.ExtensionContext) {

    const shepherd = await KeyShepherd.create(context);

    context.subscriptions.push(

        vscode.commands.registerCommand('key-shepherd-vscode.superviseSecret', async () => shepherd.superviseSecret()),
        vscode.commands.registerCommand('key-shepherd-vscode.controlSecret', async () => shepherd.controlSecret()),

        vscode.commands.registerCommand('key-shepherd-vscode.insertSecret', async () => {


            vscode.window.showInformationMessage('insertSecret!');

        }),


        vscode.commands.registerCommand('key-shepherd-vscode.disguiseSecrets', async () => shepherd.toggleAllSecretsInThisProject(true)),
        vscode.commands.registerCommand('key-shepherd-vscode.revealSecrets', async () => shepherd.toggleAllSecretsInThisProject(false)),

        vscode.commands.registerCommand('key-shepherd-vscode.hideSecrets', async () => shepherd.hideSecretsInThisFile()),
        vscode.commands.registerCommand('key-shepherd-vscode.showSecrets', async () => shepherd.showSecretsInThisFile()),

        shepherd,
    );
}

// this method is called when your extension is deactivated
export function deactivate() { }

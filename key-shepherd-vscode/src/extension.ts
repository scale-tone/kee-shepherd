import * as vscode from 'vscode';

import { KeyShepherd } from './KeyShepherd';

export async function activate(context: vscode.ExtensionContext) {

    const shepherd = await KeyShepherd.create(context);

    context.subscriptions.push(

        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.superviseSecret', async () => shepherd.superviseSecret()),
        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.controlSecret', async () => shepherd.controlSecret()),

        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.maskSecrets', async () => shepherd.maskSecretsInThisFile()),
        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.unmaskSecrets', async () => shepherd.unmaskSecretsInThisFile()),

        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.insertSupervisedSecret', async () => {


            vscode.window.showInformationMessage('insertSecret!');

        }),

        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.insertControlledSecret', async () => {


            vscode.window.showInformationMessage('insertSecret!');

        }),

        vscode.commands.registerCommand('key-shepherd-vscode.maskSecrets', async () => shepherd.maskSecretsInThisFile()),
        vscode.commands.registerCommand('key-shepherd-vscode.unmaskSecrets', async () => shepherd.unmaskSecretsInThisFile()),

        vscode.commands.registerCommand('key-shepherd-vscode.disguiseSecrets', async () => shepherd.toggleAllSecretsInThisProject(true)),
        vscode.commands.registerCommand('key-shepherd-vscode.revealSecrets', async () => shepherd.toggleAllSecretsInThisProject(false)),


        shepherd,
    );
}

// this method is called when your extension is deactivated
export function deactivate() { }

import * as vscode from 'vscode';

import { ControlTypeEnum } from './KeyMetadataRepo';

import { KeyShepherd } from './KeyShepherd';

export async function activate(context: vscode.ExtensionContext) {

    const shepherd = await KeyShepherd.create(context);

    context.subscriptions.push(

        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.superviseSecret', async () => shepherd.superviseSecret()),
        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.controlSecret', async () => shepherd.controlSecret()),

        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.maskSecrets', async () => shepherd.maskSecretsInThisFile()),
        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.unmaskSecrets', async () => shepherd.unmaskSecretsInThisFile()),

        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.insertSupervisedSecret', async () => shepherd.insertSecret(ControlTypeEnum.Supervised)),
        vscode.commands.registerCommand('key-shepherd-vscode.editor-context.insertControlledSecret', async () => shepherd.insertSecret(ControlTypeEnum.Controlled)),

        vscode.commands.registerCommand('key-shepherd-vscode.maskSecrets', async () => shepherd.maskSecretsInThisFile()),
        vscode.commands.registerCommand('key-shepherd-vscode.unmaskSecrets', async () => shepherd.unmaskSecretsInThisFile()),

        vscode.commands.registerCommand('key-shepherd-vscode.stashSecrets', async () => shepherd.toggleAllSecretsInThisProject(true)),
        vscode.commands.registerCommand('key-shepherd-vscode.unstashSecrets', async () => shepherd.toggleAllSecretsInThisProject(false)),


        shepherd,
    );
}

// this method is called when your extension is deactivated
export function deactivate() { }

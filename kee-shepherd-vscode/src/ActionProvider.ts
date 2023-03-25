
import * as vscode from 'vscode';
import { KeeShepherd } from './KeeShepherd';
import { AnchorPrefix, getAnchorName } from './KeyMetadataHelpers';

// Implements quick code actions like Stashing/Unstashing and Masking/Unmasking
export class ActionProvider implements vscode.CodeActionProvider {
    
    constructor(private _shepherd: KeeShepherd) { }

    async provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): Promise<(vscode.CodeAction | vscode.Command)[]> {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return [];
        }
        
        // Checking for any secrets in current file
        const secrets = await this._shepherd.metadataRepo.getSecrets(document.uri.toString(), true);

        if (!secrets.length) {

            // If there seem to be unresolved secrets
            if (document.getText().includes(AnchorPrefix)) {
            
                return [
                    {
                        command: 'kee-shepherd-vscode.editor-context.resolveSecrets',
                        title: 'Resolve Managed Secrets'
                    }
                ];
            }
    
            return [];
        }

        // Checking if stashed
        const secret = secrets[0];

        const anchorName = getAnchorName(secret.name);

        if (document.getText().includes(anchorName)) {
            
            return [
                {
                    command: 'kee-shepherd-vscode.editor-context.unstashSecrets',
                    title: 'Unstash Secrets'
                }
            ];
        }

        return [
            {
                command: 'kee-shepherd-vscode.editor-context.stashSecrets',
                title: 'Stash Secrets'
            },
            {
                command: 'kee-shepherd-vscode.editor-context.unmaskSecrets',
                title: 'Unmask Secrets'
            },
            {
                command: 'kee-shepherd-vscode.editor-context.maskSecrets',
                title: 'Mask Secrets'
            },
        ];
    }

    resolveCodeAction?(codeAction: vscode.CodeAction, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeAction> {
        return codeAction;
    }
}
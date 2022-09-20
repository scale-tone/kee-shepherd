import * as vscode from 'vscode';

import { ControlTypeEnum, AnchorPrefix, SecretTypeEnum, ControlledSecret } from './KeyMetadataHelpers';
import { KeeShepherd } from './KeeShepherd';
import { Log } from './helpers';

// Completion provider that responds to '@KeeShepherd(' anchor and drops a list of further suggestions for it
export class AnchorCompletionProvider implements vscode.CompletionItemProvider {

    constructor(private _shepherd: KeeShepherd) { }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {

        // Checking if '@KeeShepherd(' is not already typed
        if (position.character > AnchorPrefix.length) {

            const anchorRange = new vscode.Range(position.translate(undefined, -(AnchorPrefix.length + 1)), position);
            if (`${AnchorPrefix}(` === document.getText(anchorRange)) {
                return;
            }
        }

        // Preloading secret cache, in anticipation for next completion (which will use that cache).
        // .refreshCache() should never throw
        this._shepherd.metadataRepo.refreshCache();

        const item = new vscode.CompletionItem('@KeeShepherd()');
        item.insertText = 'KeeShepherd(';
        item.command = { command: 'editor.action.triggerSuggest', title: 'Pick up a secret...' };

        return [ item ];
    }
}

// Completion provider that shows KeeShepherd's context menu items in response to '@KeeShepherd(' anchor text 
export class MenuCommandCompletionProvider implements vscode.CompletionItemProvider {

    static readonly insertSecretCommandId = 'kee-shepherd-vscode.code-completion.insertSecret';

    constructor(private _shepherd: KeeShepherd) { }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {

        if (position.character <= AnchorPrefix.length) {
            return ;
        }

        const anchorRange = new vscode.Range(position.translate(undefined, -(AnchorPrefix.length + 1)), position);
        if (`${AnchorPrefix}(` !== document.getText(anchorRange)) {
            return;
        }

        const insertSupervisedSecretItem = new vscode.CompletionItem('[Supervised Secret...]');
        insertSupervisedSecretItem.sortText = `!${AnchorPrefix}1`;
        insertSupervisedSecretItem.insertText = '';
        insertSupervisedSecretItem.command = {
            title: 'Insert a Supervised Secret Here...',
            command: MenuCommandCompletionProvider.insertSecretCommandId,
            arguments: [ ControlTypeEnum.Supervised, position ]
        };

        const insertManagedSecretItem = new vscode.CompletionItem('[Managed Secret...]');
        insertManagedSecretItem.sortText = `!${AnchorPrefix}2`;
        insertManagedSecretItem.insertText = '';
        insertManagedSecretItem.command = {
            title: 'Insert a Managed Secret Here...',
            command: MenuCommandCompletionProvider.insertSecretCommandId,
            arguments: [ ControlTypeEnum.Managed, position ]
        };

        const insertCodespacesSecretItem = new vscode.CompletionItem('[Codespaces Secret...]');
        insertCodespacesSecretItem.sortText = `!${AnchorPrefix}3`;
        insertCodespacesSecretItem.insertText = '';
        insertCodespacesSecretItem.command = {
            title: 'Insert a Codespaces Secret Here...',
            command: MenuCommandCompletionProvider.insertSecretCommandId,
            arguments: [ ControlTypeEnum.Managed, position, SecretTypeEnum.CodespaceSecret ]
        };

        const insertKeyVaultSecretItem = new vscode.CompletionItem('[Azure Key Vault Secret...]');
        insertKeyVaultSecretItem.sortText = `!${AnchorPrefix}4`;
        insertKeyVaultSecretItem.insertText = '';
        insertKeyVaultSecretItem.command = {
            title: 'Insert an Azure Key Vault Secret Here...',
            command: MenuCommandCompletionProvider.insertSecretCommandId,
            arguments: [ ControlTypeEnum.Managed, position, SecretTypeEnum.AzureKeyVault ]
        };

        return [
            insertSupervisedSecretItem,
            insertManagedSecretItem,
            insertCodespacesSecretItem,
            insertKeyVaultSecretItem
        ];
    }

    // Handles the insert secret command
    handleInsertSecret(controlType: ControlTypeEnum, position: vscode.Position, secretType?: SecretTypeEnum): void {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        if (position.character <= AnchorPrefix.length) {
            return;
        }

        // Selecting the anchor (which was supposed to be typed)

        const nextCharacter = editor.document.getText(new vscode.Range(position, position.translate(undefined, 1)));

        const anchorSelection = new vscode.Selection(
            position.translate(undefined, -(AnchorPrefix.length + 1)), 
            nextCharacter === ')' ? position.translate(undefined, 1) : position
        );

        if (!editor.document.getText(anchorSelection).startsWith(`${AnchorPrefix}(`)) {
            return;
        }

        editor.selection = anchorSelection;
        editor.revealRange(anchorSelection);

        // Now replacing the anchor with the secret
        this._shepherd.insertSecret(controlType, secretType);
    }
}

// Completion provider that allows to re-insert an existing KeeShepherd secret
export class ExistingSecretsCompletionProvider implements vscode.CompletionItemProvider {

    static readonly cloneSecretCommandId = 'kee-shepherd-vscode.code-completion.cloneSecret';

    constructor(private _shepherd: KeeShepherd, private  log: Log) { }

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {

        if (position.character <= AnchorPrefix.length) {
            return;
        }

        const anchorRange = new vscode.Range(position.translate(undefined, -(AnchorPrefix.length + 1)), position);
        if (`${AnchorPrefix}(` !== document.getText(anchorRange)) {
            return;
        }

        let secrets: ControlledSecret[] = [];
        try {

            secrets = await this._shepherd.metadataRepo.getAllCachedSecrets()

        } catch (err) {

            this.log(`Failed to get secrets from cache. ${(err as Error).message ?? err}`, true, true);
            return;
        }

        return secrets.map(secret => {

            const item = new vscode.CompletionItem(secret.name);

            item.detail = `${ControlTypeEnum[secret.controlType]}, ${SecretTypeEnum[secret.type]}`;
            item.insertText = '';
            item.command = {
                title: 'Clone a Secret Here...',
                command: ExistingSecretsCompletionProvider.cloneSecretCommandId,
                arguments: [ position, secret ]
            };

            return item;
        });
    }

    // Handles the insert secret command
    async handleCloneSecret(position: vscode.Position, secret: ControlledSecret): Promise<void> {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        if (position.character <= AnchorPrefix.length) {
            return;
        }

        // Selecting the anchor (which was supposed to be typed)

        const nextCharacter = editor.document.getText(new vscode.Range(position, position.translate(undefined, 1)));

        const anchorSelection = new vscode.Selection(
            position.translate(undefined, -(AnchorPrefix.length + 1)), 
            nextCharacter === ')' ? position.translate(undefined, 1) : position
        );

        if (!editor.document.getText(anchorSelection).startsWith(`${AnchorPrefix}(`)) {
            return;
        }

        editor.selection = anchorSelection;
        editor.revealRange(anchorSelection);

        let secretValue: string;
        try {
            
            secretValue = await this._shepherd.valuesProvider.getSecretValue(secret);

        } catch(err) {

            this.log(`Failed to get secret value. ${(err as Error).message ?? err}`, true, true);
            return;
        }

        this._shepherd.insertSecret(ControlTypeEnum.Managed, undefined, {
            type: secret.type,
            name: secret.name,
            value: secretValue,
            properties: secret.properties,
            alreadyAskedForName: true
        });
    }
}
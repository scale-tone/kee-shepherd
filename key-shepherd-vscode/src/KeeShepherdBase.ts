import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { SecretClient } from '@azure/keyvault-secrets';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

import { SecretTypeEnum, ControlTypeEnum, ControlledSecret, AnchorPrefix } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { SecretMapEntry } from './KeyMapRepo';
import { AzureAccountWrapper, AzureSubscription } from './AzureAccountWrapper';
import { StorageManagementClient } from '@azure/arm-storage';
import axios from 'axios';
import { SecretTreeView } from './SecretTreeView';

export abstract class KeeShepherdBase {

    protected constructor(protected _account: AzureAccountWrapper,
        protected _repo: IKeyMetadataRepo,
        protected readonly _mapRepo: KeyMapRepo,
        public readonly treeView: SecretTreeView
    ) { }

    dispose(): void {
        this._hiddenTextDecoration.dispose();
    }

    protected readonly _hiddenTextDecoration = vscode.window.createTextEditorDecorationType({
        opacity: '0',
        backgroundColor: 'grey'
    });

    protected async internalMaskSecrets(editor: vscode.TextEditor, secretsMap: SecretMapEntry[]): Promise<string[]> {
        
        const decorations: vscode.Range[] = [];
        const missingSecrets: string[] = [];

        // Need to sort the map by positions
        secretsMap.sort((a, b) => a.pos - b.pos);

        // Need to adjust positions, if there're some stashed secrets in there
        var posShift = 0;

        for (var secretPos of secretsMap) {

            const secretText = editor.document.getText(new vscode.Range(
                editor.document.positionAt(secretPos.pos + posShift),
                editor.document.positionAt(secretPos.pos + posShift + secretPos.length)
            ));

            const anchorName = this.getAnchorName(secretPos.name);

            if (anchorName === editor.document.getText(
                new vscode.Range(
                    editor.document.positionAt(secretPos.pos + posShift),
                    editor.document.positionAt(secretPos.pos + posShift + anchorName.length)
                )
            )) {
                // If this secret is stashed, then keeping it as it is and adjusting posShift
                posShift += anchorName.length - secretPos.length;

            } else if (this._repo.getHash(secretText) !== secretPos.hash ) {
                
                missingSecrets.push(secretPos.name);
            
            } else {

                // Masking this secret
                decorations.push(new vscode.Range(
                    editor.document.positionAt(secretPos.pos + posShift),
                    editor.document.positionAt(secretPos.pos + secretPos.length + posShift)
                ));
            }
        }

        editor.setDecorations(this._hiddenTextDecoration, decorations);

        return missingSecrets;
    }

    protected async askUserForSecretName(defaultSecretName: string | undefined = undefined): Promise<string | undefined> {

        const secretName = await vscode.window.showInputBox({
            value: defaultSecretName ?? `${vscode.workspace.name}-secret${new Date().getMilliseconds()}`,
            prompt: 'Give your secret a name'
        });

        if (!!secretName && secretName.startsWith(AnchorPrefix)) {
            throw new Error(`Secret name should not start with ${AnchorPrefix}`);
        }

        return secretName;
    }
    
    protected async addSecret(type: SecretTypeEnum, controlType: ControlTypeEnum, secretName: string, properties: any = undefined): Promise<boolean> {

        const editor = vscode.window.activeTextEditor;
        if (!editor || (!!editor.selection.isEmpty)) {
            return false;
        }

        const currentFile = editor.document.uri.toString();
        if (!currentFile) {
            return false;
        }

        const secretValue = editor.document.getText(editor.selection);

        if (secretValue.startsWith(AnchorPrefix)) {
            throw new Error(`Secret value should not start with ${AnchorPrefix}`);
        }

        const secretHash = this._repo.getHash(secretValue);

        await this._repo.addSecret({
            name: secretName,
            type,
            controlType,
            filePath: currentFile,
            hash: secretHash,
            length: secretValue.length,
            timestamp: new Date(),
            properties
        });

        // Also updating secret map for this file
        const secrets = await this._repo.getSecrets(currentFile, true);
        const secretValues = await this.getSecretValues(secrets);
        await this.updateSecretMapForFile(currentFile, editor.document.getText(), secretValues);

        return true;
    }

    protected resourceManagerResponseToKeys(data: any): { label: string, value: string }[] | undefined {
        
        var keys;

        if (!data) {
        
            return;
        
        } else if (!!data.keys && Array.isArray(data.keys)) {
        
            keys = data.keys.map((k: any) => { return { label: k.keyName, value: k.value }; });

        } else {

            keys = Object.keys(data).filter(n => n !== 'keyName').map(n => { return { label: n, value: data[n] }; });
        }

        return keys;
    }

    protected async getSecretValue(secret: ControlledSecret): Promise<string> {

        switch (secret.type) {
            case SecretTypeEnum.AzureKeyVault: {

                // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
                const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId, 'https://vault.azure.net');
                
                const keyVaultClient = new SecretClient(`https://${secret.properties.keyVaultName}.vault.azure.net`, tokenCredentials as any);
                const keyVaultSecret = await keyVaultClient.getSecret(secret.properties.keyVaultSecretName);
                return keyVaultSecret.value ?? '';
            }   
            case SecretTypeEnum.AzureStorage: {

                const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
                const storageManagementClient = new StorageManagementClient(tokenCredentials, secret.properties.subscriptionId);

                const storageKeys = await storageManagementClient.storageAccounts.listKeys(secret.properties.resourceGroupName, secret.properties.storageAccountName);
                if (!storageKeys.keys) {
                    return '';
                }

                const storageKey = storageKeys.keys!.find(k => k.keyName === secret.properties.storageAccountKeyName);
                return storageKey?.value ?? '';
            }
            case SecretTypeEnum.Custom: {

                const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
                const token = await tokenCredentials.getToken();

                const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });
        
                const keys = this.resourceManagerResponseToKeys(response.data);
                if (!keys) {
                    return '';
                }

                return keys.find(k => k.label === secret.properties.keyName)?.value ?? '';
            }
            default:
                return '';
        }
    }

    protected async getSecretValues(secrets: ControlledSecret[]): Promise<{[name: string]: string}> {

        var result: {[name: string]: string} = {};

/*      TODO: Looks like parallel execution of getSecretValue() leads to https://github.com/microsoft/vscode-azure-account/issues/53
        So by now let's just do it sequentially :((  

        const promises = secrets
            .map(async s => {
                result[s.name] = await this.getSecretValue(s);
            });
  
        await Promise.all(promises);
*/
        
        for (var secret of secrets) {
            result[secret.name] = await this.getSecretValue(secret);
        }        
        
        return result;
    }

    protected getAnchorName(secretName: string): string {
        return `${AnchorPrefix}(${secretName})`;
    }

    protected maskAllText(editor: vscode.TextEditor): void {
        
        editor.setDecorations(this._hiddenTextDecoration, [new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
        )] );
    }

    private async internalStashUnstashSecrets(filePath: string, text: string, secrets: { [name: string]: string }, stash: boolean): Promise<string> {

        var outputText = '';

        const missingSecrets: { [name: string]: string } = {...secrets};

        var pos = 0, prevPos = 0;
        while (pos < text.length) {

            var somethingFound = false;

            // checking if any of the secrets appears at current position
            for (var secretName in secrets) {

                const anchorName = this.getAnchorName(secretName);

                const toFind = stash ? secrets[secretName]: anchorName;
                const toReplace = stash ? anchorName : secrets[secretName];

                if (!!text.startsWith(toFind, pos)) {

                    // Copying a replacement into output
                    outputText += text.substring(prevPos, pos) + toReplace;

                    pos += toFind.length;
                    prevPos = pos;
                    delete missingSecrets[secretName];

                    somethingFound = true;

                } else if (!!text.startsWith(toReplace, pos)) {

                    // This secret is already in its resulting form, so just skipping it
                    outputText += text.substring(prevPos, pos) + toReplace;

                    pos += toReplace.length;
                    prevPos = pos;
                    delete missingSecrets[secretName];

                    somethingFound = true;
                }
            }

            if (!somethingFound) {
                pos++;
            }
        }

        outputText += text.substr(prevPos);

        // Checking if any of these secrets were not found and need to be removed
        const missingSecretNames = Object.keys(missingSecrets);
        if (missingSecretNames.length > 0) {
            
            await this.askUserAboutMissingSecrets(filePath, missingSecretNames);
        }

        // Updating secrets map
        await this.updateSecretMapForFile(filePath, outputText, secrets);

        return outputText;
    }

    protected async stashUnstashAllSecretsInFolders(folders: string[], stash: boolean): Promise<void> {
        
        const secretPromises = folders.map(f => this._repo.getSecrets(f, false));
        const secrets = (await Promise.all(secretPromises)).flat();

        // This must be done sequentially by now
        const secretValues = await this.getSecretValues(secrets);

        // Grouping secrets by filename
        var fileCount = 0, secretCount = 0;
        const secretsPerFile = secrets.reduce((result, currentSecret) => {
        
            if (!result[currentSecret.filePath]) {
                result[currentSecret.filePath] = {};
                fileCount++;
            }

            // Getting managed secrets only
            if (currentSecret.controlType === ControlTypeEnum.Managed) {
                
                result[currentSecret.filePath][currentSecret.name] = secretValues[currentSecret.name];
                secretCount++;
            }

            return result;
        
        }, {} as { [f: string] : {[name: string]: string} });

        // flipping secrets in each file
        const promises = Object.keys(secretsPerFile)
            .map(filePath => this.stashUnstashSecretsInFile(filePath, stash, secretsPerFile[filePath]));
        
        await Promise.all(promises);

        if (secretCount > 0) {
            
            vscode.window.showInformationMessage(`KeeShepherd ${stash ? 'stashed' : 'unstashed'} ${secretCount} secrets in ${fileCount} files`);
        }
    }
    
    protected async stashUnstashSecretsInFile(filePath: string, stash: boolean, managedSecretValues: {[name:string]:string}): Promise<void> {

        try {

            var currentEditor: vscode.TextEditor | undefined;

            // This can fail during unload
            try {
                currentEditor = vscode.window.activeTextEditor;
                if (!!currentEditor && (currentEditor.document.uri.toString() !== filePath)) {
                    currentEditor = undefined;
                }
                    
            } catch (err) {}

            const fileUri = vscode.Uri.parse(filePath);

            // Reading current file contents. Trying with vscode and falling back to fs (because vscode will fail during unload)
            var fileBytes: Uint8Array;
            try {
                fileBytes = await vscode.workspace.fs.readFile(fileUri);
            } catch (err) {
                fileBytes = await fs.promises.readFile(fileUri.fsPath);
            }

            var fileText = Buffer.from(fileBytes).toString();

            // Replacing @KeeShepherd() links with secret values
            const outputFileText = await this.internalStashUnstashSecrets(filePath, fileText, managedSecretValues, stash);

            // Temporarily hiding everything. This seems to be the only way to prevent secret values from flashing.
            // Only doing this if the text has actually changed, because otherwise onDidChangeTextDocument event won't be triggered.
            if (!!currentEditor && (outputFileText !== fileText)) {

                this.maskAllText(currentEditor);
            }

            // Subscribing to document refresh event, if this is the active document. Needs to be done _before_ saving the text.
            if (!!currentEditor) {
                
                const eventToken = vscode.workspace.onDidChangeTextDocument(async (evt) => {

                    if (evt.document.uri.toString() === filePath) {

                        eventToken.dispose();
    
                        var secretMap = await this._mapRepo.getSecretMapForFile(filePath);
                        await this.internalMaskSecrets(currentEditor!, secretMap);
                    }
                });
            }

            // Saving file contents back. Trying with vscode and falling back to fs (because vscode will fail during unload)
            const outputFileBytes = Buffer.from(outputFileText);
            try {
                await vscode.workspace.fs.writeFile(fileUri, outputFileBytes);
            } catch (err) {
                await fs.promises.writeFile(fileUri.fsPath, outputFileBytes);
            }

        } catch (err) {
            vscode.window.showErrorMessage(`KeeShepherd failed to unstash secrets in ${filePath}. ${(err as any).message ?? err}`);
        }
    }

    protected async updateSecretMapForFile(filePath: string, text: string, secretValues: { [name: string]: string }): Promise<string[]> {

        const secrets = await this._repo.getSecrets(filePath, true);
        
        const outputMap: SecretMapEntry[] = []
        const secretsFound: string[] = [];

        // Searching for all secrets in this text
        var pos = 0, posShift = 0;
        while (pos < text.length) {

            var somethingFound = false;

            // checking if any of the secrets appears at current position
            for (var secret of secrets) {

                const anchorName = this.getAnchorName(secret.name);
                const secretValue = secretValues[secret.name];

                if (!!text.startsWith(anchorName, pos)) {

                    // This secret appears in its stashed form. Let's write it down and adjust further positions

                    outputMap.push({ name: secret.name, hash: secret.hash, pos: pos + posShift, length: secret.length });

                    pos += anchorName.length;
                    secretsFound.push(secret.name);
                    somethingFound = true;

                    posShift += secret.length - anchorName.length;

                }
                else if (!!secretValue) {
                    
                    // If we know the secret value, then just checking whether it matches
                    if (!!text.startsWith(secretValue, pos)) {

                        // Found this secret's position. Let's write it down.
                        outputMap.push({ name: secret.name, hash: secret.hash, pos: pos + posShift, length: secretValue.length });

                        pos += secretValue.length;
                        secretsFound.push(secret.name);
                        somethingFound = true;
                    }

                } else {

                    // Otherwise calculating and trying to match the hash. Might take time, but no other options...
                    const currentHash = this._repo.getHash(text.substr(pos, secret.length));
                    
                    if (currentHash === secret.hash) {

                        // Found this secret's position. Let's write it down.
                        outputMap.push({ name: secret.name, hash: secret.hash, pos: pos + posShift, length: secret.length });

                        pos += secret.length;
                        secretsFound.push(secret.name);
                        somethingFound = true;
                    }
                }
            }

            if (!somethingFound) {
                pos++;
            }
        }

        await this._mapRepo.saveSecretMapForFile(filePath, outputMap);

        // returning secrets that were not found
        return secrets.filter(s => !secretsFound.includes(s.name)).map(s => s.name);
    }

    protected pickUpKeyVault(subscription: AzureSubscription): Promise<string> {
        return new Promise<string>((resolve, reject) => {

            // Picking up a KeyVault
            var keyVaultName: string;

            const pick = vscode.window.createQuickPick();
            pick.onDidHide(() => {
                pick.dispose();
                resolve('');
            });

            pick.onDidChangeSelection(items => {
                if (!!items && !!items.length) {
                    keyVaultName = items[0].label;
                }
            });

            // Still allowing to type free text
            pick.onDidChangeValue(value => {
                keyVaultName = value;
            });

            pick.onDidAccept(() => {
                resolve(keyVaultName);
                pick.hide();
            });

            pick.title = 'Select or Enter KeyVault Name';

            // Getting the list of existing KeyVaults
            const resourceGraphClient = new ResourceGraphClient(subscription.session.credentials2);

            resourceGraphClient.resources({

                subscriptions: [subscription.subscription.subscriptionId],
                query: 'resources | where type == "microsoft.keyvault/vaults"'
                    
            }).then(response => {

                if (!!response.data && response.data.length >= 0) {

                    pick.items = response.data.map((keyVault: any) => {
                        return { label: keyVault.name };
                    });

                    pick.placeholder = response.data[0].name;
                }
            });

            pick.show();
        });
    }

    protected async askUserAboutMissingSecrets(filePath: string, missingSecrets: string[]): Promise<void> {

        const userResponse = await vscode.window.showWarningMessage(
            `The following secrets: ${missingSecrets.join(', ')} were not found in ${path.basename(filePath)}. Do you want to forget them?`,
            'Yes', 'No');
        
        if (userResponse === 'Yes') {
            
            await this._repo.removeSecrets(filePath, missingSecrets);

            vscode.window.showInformationMessage(`KeeShepherd: ${missingSecrets.length} secrets have been forgotten`);
            this.treeView.refresh();
        }
    }
}
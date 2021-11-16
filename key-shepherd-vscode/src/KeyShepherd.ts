import * as path from 'path';
import * as vscode from 'vscode';

import { SecretClient } from '@azure/keyvault-secrets';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

import { KeyMetadataRepo, SecretTypeEnum, ControlTypeEnum, ControlledSecret } from './KeyMetadataRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { SecretMapEntry } from './KeyMapRepo';
import { AzureAccountWrapper, AzureSubscription } from './AzureAccountWrapper';

export class KeyShepherd {

    private constructor(private readonly _repo: KeyMetadataRepo, private readonly _mapRepo: KeyMapRepo) {}

    dispose(): void {
        this._hiddenTextDecoration.dispose();
    }

    static async create(context: vscode.ExtensionContext): Promise<KeyShepherd> {

        const storageFolder = context.globalStorageUri.fsPath;

        return new KeyShepherd(
            await KeyMetadataRepo.create(path.join(storageFolder, 'key-metadata')),
            await KeyMapRepo.create(path.join(storageFolder, 'key-maps')));
    }

    async unmaskSecretsInThisFile(): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
    
            editor.setDecorations(this._hiddenTextDecoration, []);

        }, 'KeyShepherd failed to unmask secrets');
    }

    async maskSecretsInThisFile(updateMapIfSomethingNotFound: boolean): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const currentFile = editor.document.uri.toString();
            if (!currentFile) {
                return;
            }

            var secretMap = await this._mapRepo.getSecretMapForFile(currentFile);
            if (secretMap.length <= 0) {
                return;
            }

            var missingSecrets = await this.internalMaskSecrets(editor, secretMap);

            // If some secrets were not found, then trying to update the map and then mask again
            if (!!updateMapIfSomethingNotFound && missingSecrets.length > 0) {
               
                // Using empty values in a hope that updateSecretMapForFile() will be able to match by hashes
                missingSecrets = await this.updateSecretMapForFile(currentFile, editor.document.getText(), {});

                // Trying again
                secretMap = await this._mapRepo.getSecretMapForFile(currentFile);
                await this.internalMaskSecrets(editor, secretMap);

                if (missingSecrets.length > 0) {

                    // Notifying the user that there're still some secrets missing
                    await this.askUserAboutMissingSecrets(currentFile, missingSecrets);
                }
            }

        }, 'KeyShepherd failed to mask secrets');
    }

    async stashUnstashSecretsInThisFile(stash: boolean): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const currentFile = editor.document.uri.toString();
            if (!currentFile) {
                return;
            }
    
            const secrets = await this._repo.getSecretsInFile(currentFile);
            const secretValues = await this.getSecretValues(secrets);

            const secretsValuesMap = secrets.reduce((result, currentSecret) => {

                // Getting controlled secrets only
                if (currentSecret.controlType === ControlTypeEnum.Controlled) {
                    
                    result[currentSecret.name] = secretValues[currentSecret.name];
                }

                return result;
            
            }, {} as { [f: string] : string });

            await (!!stash ?
                this.stashSecretsInFile(currentFile, secretsValuesMap) :
                this.unstashSecretsInFile(currentFile, secretsValuesMap));

        }, 'KeyShepherd failed');
    }

    async stashUnstashAllSecretsInThisProject(stash: boolean): Promise<void> {

        await this.doAndShowError(async () => {

            if (!vscode.workspace.workspaceFolders) {
                return;
            }

            // Making sure there're no dirty files open
            await vscode.workspace.saveAll();

            const secretPromises = vscode.workspace.workspaceFolders.map(f => this._repo.getSecretsInFolder(f.uri.toString()));
            const secrets = (await Promise.all(secretPromises)).flat();

            // This must be done sequentially by now
            const secretValues = await this.getSecretValues(secrets);

            // Grouping secrets by filename
            const secretsPerFile = secrets.reduce((result, currentSecret) => {
            
                if (!result[currentSecret.filePath]) {
                    result[currentSecret.filePath] = {};
                }

                // Getting controlled secrets only
                if (currentSecret.controlType === ControlTypeEnum.Controlled) {
                    
                    result[currentSecret.filePath][currentSecret.name] = secretValues[currentSecret.name];
                }

                return result;
            
            }, {} as { [f: string] : {[name: string]: string} });

            // flipping secrets in each file
            const promises = Object.keys(secretsPerFile)
                .map(filePath => stash ?
                    this.stashSecretsInFile(filePath, secretsPerFile[filePath]) :
                    this.unstashSecretsInFile(filePath, secretsPerFile[filePath])
                );
            
            await Promise.all(promises);

        }, 'KeyShepherd failed');
    }

    async insertSecret(controlType: ControlTypeEnum): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const currentFile = editor.document.uri.toString();
            if (!currentFile) {
                return;
            }

            const keyVault = await this.pickUpSubscriptionAndKeyVault();
            if (!keyVault) {
                return;
            }

            // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
            const tokenCredentials = await this._account.getTokenCredentials(keyVault.subscriptionId, 'https://vault.azure.net');

            const keyVaultClient = new SecretClient(`https://${keyVault.name}.vault.azure.net`, tokenCredentials as any);

            const secretNames = [];
            for await (const secretProps of keyVaultClient.listPropertiesOfSecrets()) {
                secretNames.push(secretProps.name);
            }

            const secretName = await vscode.window.showQuickPick(secretNames, { title: 'Select Secret' });

            if (!secretName) {
                return;
            }

            const secret = await keyVaultClient.getSecret(secretName);
            if (!secret.value) {
                throw new Error(`Secret ${secretName} is empty`);
            }           

            var success = await editor.edit(edit => {
                edit.replace(editor.selection, secret.value ?? '');
            });

            if (!success) {
                return;
            }

            success = await this.addSecret(SecretTypeEnum.AzureKeyVault, controlType, secretName, {
                subscriptionId: keyVault.subscriptionId,
                keyVaultName: keyVault.name,
                keyVaultSecretName: secretName
            });

            if (!!success) {

                await editor.document.save();
            }

        }, 'KeyShepherd failed');
    }

    async superviseSecret(): Promise<void> {
        
        await this.doAndShowError(async () => {

            await this.addSecret(SecretTypeEnum.Unknown, ControlTypeEnum.Supervised);

        }, 'KeyShepherd failed to add a supervised secret');
    }

    async controlSecret(): Promise<void> {

        await this.doAndShowError(async () => {

            await this.addSecret(SecretTypeEnum.Unknown, ControlTypeEnum.Controlled);
            
        }, 'KeyShepherd failed to add a controlled secret');
    }

    private readonly _account = new AzureAccountWrapper();

    private readonly _hiddenTextDecoration = vscode.window.createTextEditorDecorationType({
        opacity: '0',
        backgroundColor: 'grey'
    });

    private _inProgress: boolean = false;

    private async internalMaskSecrets(editor: vscode.TextEditor, secretsMap: SecretMapEntry[]): Promise<string[]> {
        
        const decorations: vscode.Range[] = [];
        const missingSecrets: string[] = [];

        // Need to sort the map by positions
        secretsMap.sort((a, b) => a.pos - b.pos);

        // Need to adjust positions, if there're some stashed secrets in there
        var posShift = 0;

        for (var secretPos of secretsMap) {

            const anchorName = this.getAnchorName(secretPos.name);

            const secretText = editor.document.getText(new vscode.Range(
                editor.document.positionAt(secretPos.pos + posShift),
                editor.document.positionAt(secretPos.pos + posShift + secretPos.length)
            ));

            if (secretText.startsWith(anchorName)) {

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
    
    private async addSecret(type: SecretTypeEnum, controlType: ControlTypeEnum, secretName: string | undefined = undefined, properties: any = undefined): Promise<boolean> {

        const editor = vscode.window.activeTextEditor;
        if (!editor || (!!editor.selection.isEmpty)) {
            return false;
        }

        const currentFile = editor.document.uri.toString();
        if (!currentFile) {
            return false;
        }

        const secretValue = editor.document.getText(editor.selection);

        if (secretValue.length < 3) {
            throw new Error(`Secret should be at least 3 symbols long`);
        }

        const secretHash = this._repo.getHash(secretValue);

        // Asking user for a secret name
        secretName = await vscode.window.showInputBox({
            value: secretName ?? `${vscode.workspace.name}-secret${this._repo.secretCount + 1}`,
            prompt: 'Give your secret a name'
        });

        if (!secretName) {
            return false;
        }

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
        const secrets = await this._repo.getSecretsInFile(currentFile);
        const secretValues = await this.getSecretValues(secrets);
        await this.updateSecretMapForFile(currentFile, editor.document.getText(), secretValues);

        vscode.window.showInformationMessage(`KeyShepherd: ${secretName} was added successfully.`);

        return true;
    }

    private async getSecretValue(secret: ControlledSecret): Promise<string> {

        if (secret.type !== SecretTypeEnum.AzureKeyVault || !secret.properties) {
            return '';
        }

        // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
        const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId, 'https://vault.azure.net');
                
        const keyVaultClient = new SecretClient(`https://${secret.properties.keyVaultName}.vault.azure.net`, tokenCredentials as any);

        const keyVaultSecret = await keyVaultClient.getSecret(secret.properties.keyVaultSecretName);

        return keyVaultSecret.value ?? '';
    }

    private async getSecretValues(secrets: ControlledSecret[]): Promise<{[name: string]: string}> {

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

    private getAnchorName(secretName: string): string {
        return `@KeyShepherd(${secretName})`;
    }

    private maskAllText(editor: vscode.TextEditor): void {
        
        editor.setDecorations(this._hiddenTextDecoration, [new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
        )] );
    }

    private async stashUnstashSecrets(filePath: string, text: string, secrets: { [name: string]: string }, stash: boolean): Promise<string> {

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

    private async stashSecretsInFile(filePath: string, controlledSecretValues: {[name:string]:string}): Promise<void> {

        try {

            const fileUri = vscode.Uri.parse(filePath);

            // Reading current file contents
            const fileBytes = await vscode.workspace.fs.readFile(fileUri);
            var fileText = Buffer.from(fileBytes).toString();

            // Replacing secret values with @KeyShepherd() links
            const outputFileText = await this.stashUnstashSecrets(filePath, fileText, controlledSecretValues, true);

            // Saving file contents back
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(outputFileText));

        } catch (err) {
            vscode.window.showErrorMessage(`KeyShepherd failed to stash secrets in ${filePath}. ${(err as any).message ?? err}`);
        }
    }

    private async unstashSecretsInFile(filePath: string, controlledSecretValues: {[name:string]:string}): Promise<void> {

        try {

            var currentEditor = vscode.window.activeTextEditor;
            if (!!currentEditor && (currentEditor.document.uri.toString() !== filePath)) {
                currentEditor = undefined;
            }

            const fileUri = vscode.Uri.parse(filePath);

            // Reading current file contents
            const fileBytes = await vscode.workspace.fs.readFile(fileUri);
            var fileText = Buffer.from(fileBytes).toString();

            // Replacing @KeyShepherd() links with secret values
            const outputFileText = await this.stashUnstashSecrets(filePath, fileText, controlledSecretValues, false);

            // Temporarily hiding everything. This seems to be the only way to prevent secret values from flashing.
            // Only doing this if the text has actually changed, because otherwise onDidChangeTextDocument event won't be triggered.
            if (!!currentEditor && (outputFileText !== fileText)) {

                this.maskAllText(currentEditor);
            }

            // Subscribing to document refresh event, if this is the active document. Needs to be done _before_ saving the text.
            if (!!currentEditor) {
                
                const eventToken = vscode.workspace.onDidChangeTextDocument(async (evt) => {
                    eventToken.dispose();

                    if (evt.document.uri.toString() === filePath) {
    
                        var secretMap = await this._mapRepo.getSecretMapForFile(filePath);
                        await this.internalMaskSecrets(currentEditor!, secretMap);
                    }
                });
            }

            // Saving file contents back
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(outputFileText));

        } catch (err) {
            vscode.window.showErrorMessage(`KeyShepherd failed to unstash secrets in ${filePath}. ${(err as any).message ?? err}`);
        }
    }

    private async updateSecretMapForFile(filePath: string, text: string, secretValues: { [name: string]: string }): Promise<string[]> {

        const secrets = await this._repo.getSecretsInFile(filePath);
        
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

    private pickUpKeyVault(subscription: AzureSubscription): Promise<string> {
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

    private async pickUpSubscriptionAndKeyVault(): Promise<{ name: string, subscriptionId: string } | undefined> {
        
        // Picking up a subscription

        const subscriptions = await this._account.getSubscriptions();

        if (subscriptions.length <= 0) {
            throw new Error(`Select at least one subscription in the Azure Account extension`);
        }
        
        var subscription: AzureSubscription;

        if (subscriptions.length > 1) {

            const pickResult = await vscode.window.showQuickPick(
                subscriptions.map(s => {
                    return {
                        subscription: s,
                        label: s.subscription.displayName
                    };
                }),
                { title: 'Select Azure Subscription' }
            );

            if (!pickResult) {
                return;
            }
                
            subscription = pickResult.subscription;

        } else {

            subscription = subscriptions[0];
        }

        const keyVaultName = await this.pickUpKeyVault(subscription);

        return !!keyVaultName ? { name: keyVaultName, subscriptionId: subscription.subscription.subscriptionId } : undefined;
    }

    private async doAndShowError(todo: () => Promise<void>, errorMessage: string): Promise<void> {

        if (!!this._inProgress) {
            console.log('Another operation already in progress...');
            return;
        }
        this._inProgress = true;

        try {

            await todo();
    
        } catch (err) {
            vscode.window.showErrorMessage(`${errorMessage}. ${(err as any).message ?? err}`);
        }

        this._inProgress = false;
    }

    private async askUserAboutMissingSecrets(filePath: string, missingSecrets: string[]): Promise<void> {

        const userResponse = await vscode.window.showWarningMessage(
            `The following secrets: ${missingSecrets.join(', ')} were not found in ${path.basename(filePath)}. Do you want to forget them?`,
            'Yes', 'No');
        
        if (userResponse === 'Yes') {
            
            await this._repo.removeSecrets(filePath, missingSecrets);

            vscode.window.showInformationMessage(`KeyShepherd: ${missingSecrets.length} secrets have been forgotten`);
        }
    }
}
import * as path from 'path';
import * as vscode from 'vscode';

import { SecretClient } from '@azure/keyvault-secrets';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

import { KeyMetadataRepo, SecretTypeEnum, ControlTypeEnum, ControlledSecret } from './KeyMetadataRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { SecretMapEntry } from './KeyMapRepo';
import { AzureAccountWrapper, AzureSubscription } from './AzureAccountWrapper';
import { KeyShepherdBase } from './KeyShepherdBase';

export class KeyShepherd extends KeyShepherdBase {

    private constructor(repo: KeyMetadataRepo, mapRepo: KeyMapRepo) {
        super(repo, mapRepo);
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

            // Making sure the file is not dirty
            await editor.document.save();
    
            const secrets = await this._repo.getSecretsInFile(currentFile);
            const secretValues = await this.getSecretValues(secrets);

            const secretsValuesMap = secrets.reduce((result, currentSecret) => {

                // Getting controlled secrets only
                if (currentSecret.controlType === ControlTypeEnum.Controlled) {
                    
                    result[currentSecret.name] = secretValues[currentSecret.name];
                }

                return result;
            
            }, {} as { [f: string] : string });

            await this.stashUnstashSecretsInFile(currentFile, stash, secretsValuesMap);

//            await (!!stash ?
//                this.stashSecretsInFile(currentFile, secretsValuesMap) :
//                this.unstashSecretsInFile(currentFile, secretsValuesMap));

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
                .map(filePath => this.stashUnstashSecretsInFile(filePath, stash, secretsPerFile[filePath]));
            
            await Promise.all(promises);

        }, 'KeyShepherd failed');
    }

    protected async pickUpSecretFromKeyVault(): Promise<{ type: SecretTypeEnum, name: string, value: string, properties: any } | undefined> {

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

        return {
            type: SecretTypeEnum.AzureKeyVault,
            name: secretName,
            value: secret.value,
            properties: {
                subscriptionId: keyVault.subscriptionId,
                keyVaultName: keyVault.name,
                keyVaultSecretName: secretName
            }
        }
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

            const secret = await this.pickUpSecretFromKeyVault();
            if (!secret) {
                return;
            }
            
            var success = await editor.edit(edit => {
                edit.replace(editor.selection, secret.value);
            });

            if (!success) {
                return;
            }

            const localSecretName = await this.askUserForSecretName(secret.name);
            if (!localSecretName) {
                return;
            }

            success = !!await this.addSecret(SecretTypeEnum.AzureKeyVault, controlType, localSecretName, secret.properties);

            if (!!success) {

                await editor.document.save();

                vscode.window.showInformationMessage(`KeyShepherd: ${localSecretName} was added successfully.`);
            }

        }, 'KeyShepherd failed to insert a secret');
    }

    async controlSecret(controlType: ControlTypeEnum): Promise<void> {

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

            const secretName = await this.askUserForSecretName();
            if (!secretName) {
                return;
            }

            // First adding the metadata

            const secretValue = editor.document.getText(editor.selection);
            const secretHash = this._repo.getHash(secretValue);

            await this._repo.addSecret({
                name: secretName,
                type: SecretTypeEnum.AzureKeyVault,
                controlType,
                filePath: currentFile,
                hash: secretHash,
                length: secretValue.length,
                timestamp: new Date(),
                properties: {
                    subscriptionId: keyVault.subscriptionId,
                    keyVaultName: keyVault.name,
                    keyVaultSecretName: secretName
                }
            });

            // Then adding this secret to KeyVault
            try {

                // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
                const tokenCredentials = await this._account.getTokenCredentials(keyVault.subscriptionId, 'https://vault.azure.net');

                const keyVaultClient = new SecretClient(`https://${keyVault.name}.vault.azure.net`, tokenCredentials as any);

                await keyVaultClient.setSecret(secretName, secretValue);
                
            } catch (err) {
                
                // Dropping the just created secret upon failure
                this._repo.removeSecrets(currentFile, [secretName]);

                throw err;
            }

            // Also updating secret map for this file
            const secrets = await this._repo.getSecretsInFile(currentFile);
            const secretValues = await this.getSecretValues(secrets);
            await this.updateSecretMapForFile(currentFile, editor.document.getText(), secretValues);

            vscode.window.showInformationMessage(`KeyShepherd: ${secretName} was added successfully.`);
            
        }, 'KeyShepherd failed to add a secret');
    }

}
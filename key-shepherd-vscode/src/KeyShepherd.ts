import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import axios from 'axios';

import { SecretClient } from '@azure/keyvault-secrets';
import { StorageManagementClient } from '@azure/arm-storage';

import { SecretTypeEnum, ControlTypeEnum, AnchorPrefix } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeyMetadataLocalRepo } from './KeyMetadataLocalRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { KeyShepherdBase } from './KeyShepherdBase';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { KeyMetadataTableRepo } from './KeyMetadataTableRepo';

type SelectedSecretType = { type: SecretTypeEnum, name: string, value: string, properties: any };

enum StorageTypeEnum {
    Local = 1,
    AzureTable
}

const SettingNames = {
    StorageType: 'KeyShepherdStorageType',
    SubscriptionId: 'KeyShepherdTableStorageSubscriptionId',
    ResourceGroupName: 'KeyShepherdTableStorageResourceGroupName',
    StorageAccountName: 'KeyShepherdTableStorageAccountName',
    TableName: 'KeyShepherdTable'
}

export class KeyShepherd extends KeyShepherdBase  implements vscode.TreeDataProvider<vscode.TreeItem> {

    private constructor(account: AzureAccountWrapper, repo: IKeyMetadataRepo, mapRepo: KeyMapRepo) {
        super(account, repo, mapRepo);
    }

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refreshTreeView(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {

        if (!element) {

            const machineNames = await this._repo.getMachineNames();

            return machineNames.map(name => {

                const collapsibleState = name === os.hostname() ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed

                return { label: name, isMachineNode: true, collapsibleState }
            });
        }

        if (!!(element as any).isMachineNode) {

            const workspaceFolders = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) : [];

            const machineName = element.label as string;

            const folderUris = await this._repo.getFolders(machineName);
            
            return folderUris.map(uri => {

                var label = decodeURIComponent(uri);
                if (label.startsWith('file:///')) {
                    label = label.substr(8);
                }

                const collapsibleState = workspaceFolders.includes(uri) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;

                return { label, machineName, isFolderNode: true, uri, collapsibleState }
            });
        }

        if (!!(element as any).isFolderNode) {

            const folderUri = (element as any).uri;

            const secrets = await this._repo.getSecrets(folderUri, (element as any).machineName);

            const filePaths: any = {};
            for (var secret of secrets) {

                const fileName = path.basename(secret.filePath);
                const fileFolderUri = secret.filePath.substr(0, secret.filePath.length - fileName.length - 1);
                if (fileFolderUri.toLowerCase() === folderUri.toLowerCase()) {

                    filePaths[secret.filePath] = fileName;                    
                }
            }
            
            return Object.keys(filePaths).map(filePath => {

                return { label: filePaths[filePath], filePath, isFileNode: true, collapsibleState: vscode.TreeItemCollapsibleState.Expanded  }
            });
        }

        if (!!(element as any).isFileNode) {

            const secrets = await this._repo.getSecrets((element as any).filePath);

            return secrets.map(secret => {

                const description = `${ControlTypeEnum[secret.controlType]}`;

                return { label: secret.name, description, isSecretNode: true, collapsibleState: vscode.TreeItemCollapsibleState.None  }
            });
        }

        return [];
    }

    static async create(context: vscode.ExtensionContext): Promise<KeyShepherd> {

        const storageFolder = context.globalStorageUri.fsPath;
        const account = new AzureAccountWrapper();
        var metadataRepo: IKeyMetadataRepo;

        try {

            metadataRepo = await KeyShepherd.getKeyMetadataRepo(context, storageFolder, account);
            
        } catch (err) {

            const msg = `KeyShepherd failed to initialize its metadata storage. What would you like to do?`;
            const option1 = 'Reset storage settings and try again';
            const option2 = 'Unload KeyShepherd';

            if ((await vscode.window.showWarningMessage(msg, option1, option2)) !== option1) {

                throw err;
            }

            // Zeroing settings
            context.globalState.update(SettingNames.StorageType, undefined);
            context.globalState.update(SettingNames.StorageAccountName, undefined);
            context.globalState.update(SettingNames.TableName, undefined);
            context.globalState.update(SettingNames.SubscriptionId, undefined);
            context.globalState.update(SettingNames.ResourceGroupName, undefined);

            // trying again
            metadataRepo = await KeyShepherd.getKeyMetadataRepo(context, storageFolder, account);
        }

        return new KeyShepherd(account, metadataRepo, await KeyMapRepo.create(path.join(storageFolder, 'key-maps')));
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
            if ( !!updateMapIfSomethingNotFound && missingSecrets.length > 0) {
               
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
    
            const secrets = await this._repo.getSecrets(currentFile);
            const secretValues = await this.getSecretValues(secrets);

            const secretsValuesMap = secrets.reduce((result, currentSecret) => {

                // Getting managed secrets only
                if (currentSecret.controlType === ControlTypeEnum.Managed) {
                    
                    result[currentSecret.name] = secretValues[currentSecret.name];
                }

                return result;
            
            }, {} as { [f: string] : string });

            await this.stashUnstashSecretsInFile(currentFile, stash, secretsValuesMap);

        }, 'KeyShepherd failed');
    }

    async stashUnstashAllSecretsInThisProject(stash: boolean): Promise<void> {

        await this.doAndShowError(async () => {

            if (!vscode.workspace.workspaceFolders) {
                return;
            }

            // Making sure there're no dirty files open
            await vscode.workspace.saveAll();

            const secretPromises = vscode.workspace.workspaceFolders.map(f => this._repo.getSecrets(f.uri.toString()));
            const secrets = (await Promise.all(secretPromises)).flat();

            // This must be done sequentially by now
            const secretValues = await this.getSecretValues(secrets);

            // Grouping secrets by filename
            const secretsPerFile = secrets.reduce((result, currentSecret) => {
            
                if (!result[currentSecret.filePath]) {
                    result[currentSecret.filePath] = {};
                }

                // Getting managed secrets only
                if (currentSecret.controlType === ControlTypeEnum.Managed) {
                    
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

            const secretValue = editor.document.getText(editor.selection);

            if (secretValue.startsWith(AnchorPrefix)) {
                throw new Error(`Secret value should not start with ${AnchorPrefix}`);
            }

            const secretHash = this._repo.getHash(secretValue);

            const secretName = await this.askUserForSecretName();
            if (!secretName) {
                return;
            }

            // Managed secrets always go to KeyVault, supervised go there only by user's request
            var alsoAddToKeyVault = true;
            if (controlType === ControlTypeEnum.Supervised) {
                alsoAddToKeyVault = await vscode.window.showQuickPick(['Yes', 'No'], { title: 'Do you want to also put this secret to Azure Key Vault?' }) === 'Yes';
            }

            if (!alsoAddToKeyVault) {

                // Just adding the secret as unknown

                await this._repo.addSecret({
                    name: secretName,
                    type: SecretTypeEnum.Unknown,
                    controlType,
                    filePath: currentFile,
                    hash: secretHash,
                    length: secretValue.length,
                    timestamp: new Date()
                });
                
            } else {

                const subscription = await this._account.pickUpSubscription();
                if (!subscription) {
                    return;
                }
                
                const subscriptionId = subscription.subscription.subscriptionId;
                const keyVaultName = await this.pickUpKeyVault(subscription);
    
                if (!keyVaultName) {
                    return;
                }
    
                // First adding the metadata
    
                await this._repo.addSecret({
                    name: secretName,
                    type: SecretTypeEnum.AzureKeyVault,
                    controlType,
                    filePath: currentFile,
                    hash: secretHash,
                    length: secretValue.length,
                    timestamp: new Date(),
                    properties: {
                        subscriptionId: subscriptionId,
                        keyVaultName: keyVaultName,
                        keyVaultSecretName: secretName
                    }
                });
    
                // Then adding this secret to KeyVault
                try {
    
                    // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
                    const tokenCredentials = await this._account.getTokenCredentials(subscriptionId, 'https://vault.azure.net');
    
                    const keyVaultClient = new SecretClient(`https://${keyVaultName}.vault.azure.net`, tokenCredentials as any);
    
                    await keyVaultClient.setSecret(secretName, secretValue);
                    
                } catch (err) {
                    
                    // Dropping the just created secret upon failure
                    this._repo.removeSecrets(currentFile, [secretName]);
    
                    throw err;
                }    
            }


            // Also updating secret map for this file
            const secrets = await this._repo.getSecrets(currentFile);
            const secretValues = await this.getSecretValues(secrets);
            await this.updateSecretMapForFile(currentFile, editor.document.getText(), secretValues);

            vscode.window.showInformationMessage(`KeyShepherd: ${secretName} was added successfully.`);
            
        }, 'KeyShepherd failed to add a secret');
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

            const secretType = await vscode.window.showQuickPick(
                [
                    { label: 'Azure Key Vault', type: SecretTypeEnum.AzureKeyVault },
                    { label: 'Azure Storage', type: SecretTypeEnum.AzureStorage },
                    { label: 'Custom (Azure Resource Manager REST API)', type: SecretTypeEnum.Custom },
                ], 
                { title: 'Select where to take the secret from' }
            );

            if (!secretType) {
                return;
            }

            var secret: SelectedSecretType | undefined;
            switch (secretType.type) {
                case SecretTypeEnum.AzureKeyVault:
                    secret = await this.pickUpSecretFromKeyVault();
                    break;
                case SecretTypeEnum.AzureStorage:
                    secret = await this.pickUpSecretFromStorage();
                    break;
                case SecretTypeEnum.Custom:
                    secret = await this.pickUpCustomSecret();
                    break;
            }

            if (!secret) {
                return;
            }
            
            // Pasting secret value at current cursor position
            var success = await editor.edit(edit => {
                edit.replace(editor.selection, secret!.value);
            });

            if (!success) {
                return;
            }

            const localSecretName = await this.askUserForSecretName(secret.name);
            if (!localSecretName) {
                return;
            }

            success = !!await this.addSecret(secret.type, controlType, localSecretName, secret.properties);

            if (!!success) {

                await editor.document.save();

                vscode.window.showInformationMessage(`KeyShepherd: ${localSecretName} was added successfully.`);
            }

        }, 'KeyShepherd failed to insert a secret');
    }

    protected async pickUpCustomSecret(): Promise<SelectedSecretType | undefined> {

        var uri = await vscode.window.showInputBox({
            prompt: 'Enter Azure Resource Manager REST API URL',
            placeHolder: `e.g. '/subscriptions/my-subscription-id/resourceGroups/my-group-name/providers/Microsoft.Storage/storageAccounts/my-account/listKeys?api-version=2021-04-01'`
        });
        
        if (!uri) {
            return;
        }

        if (!uri.toLowerCase().startsWith('https://management.azure.com')) {

            if (!uri.startsWith('/')) {
                uri = '/' + uri;
            }
            
            uri = 'https://management.azure.com' + uri;
        }

        if (!uri.includes('api-version=')) {
            uri += '?api-version=2021-04-01';
        }

        // Extracting subscriptionId
        const match = /\/subscriptions\/([^\/]+)\/resourceGroups/gi.exec(uri);
        if (!match || match.length <= 0) {
            return;
        }
        const subscriptionId = match[1];

        // Obtaining default token
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId);
        const token = await tokenCredentials.getToken();

        const response = await axios.post(uri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });
        
        const keys = this.resourceManagerResponseToKeys(response.data);
        if (!keys) {
            return;
        }
        
        const key = await vscode.window.showQuickPick(keys, { title: 'Select which key to use' });

        if (!key) {
            return;
        }

        return {
            type: SecretTypeEnum.Custom,
            name: key.label,
            value: key.value,
            properties: {
                subscriptionId,
                resourceManagerUri: uri,
                keyName: key.label
            }
        };
    }

    protected async pickUpSecretFromKeyVault(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const keyVaultName = await this.pickUpKeyVault(subscription);

        if (!keyVaultName) {
            return;
        }
        
        // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId, 'https://vault.azure.net');

        const keyVaultClient = new SecretClient(`https://${keyVaultName}.vault.azure.net`, tokenCredentials as any);

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
                subscriptionId: subscriptionId,
                keyVaultName,
                keyVaultSecretName: secretName
            }
        }
    }

    protected async pickUpSecretFromStorage(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const storageManagementClient = new StorageManagementClient(subscription.session.credentials2, subscriptionId);

        const storageAccount = await this._account.picUpStorageAccount(storageManagementClient);

        if (!storageAccount) {
            return;
        }

        // Extracting resource group name
        const match = /\/resourceGroups\/([^\/]+)\/providers/gi.exec(storageAccount.id!);
        if (!match || match.length <= 0) {
            return;
        }
        const resourceGroupName = match[1];

        const storageKeys = await storageManagementClient.storageAccounts.listKeys(resourceGroupName, storageAccount.name!);

        const storageKey = await vscode.window.showQuickPick(storageKeys.keys!.map(key => {
                return {
                    label: key.keyName!,
                    description: `created ${key.creationTime}`,
                    key
                }
            }), 
            { title: 'Select Storage Account Key' }
        );

        if (!storageKey) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureStorage,
            name: `${storageAccount.name}-${storageKey.key.keyName}`,
            value: storageKey.key.value!,
            properties: {
                subscriptionId: subscriptionId,
                resourceGroupName,
                storageAccountName: storageAccount.name,
                storageAccountKeyName: storageKey.key.keyName
            }
        }
    }

    private static async getKeyMetadataRepo(context: vscode.ExtensionContext, storageFolder: string, account: AzureAccountWrapper): Promise<IKeyMetadataRepo> {

        var storageType = context.globalState.get(SettingNames.StorageType);
        var accountName = context.globalState.get(SettingNames.StorageAccountName);
        var tableName = context.globalState.get(SettingNames.TableName);
        var subscriptionId = context.globalState.get(SettingNames.SubscriptionId);
        var resourceGroupName = context.globalState.get(SettingNames.ResourceGroupName);

        var result: IKeyMetadataRepo;

        if (!storageType) {
            
            const storageTypeResponse = await vscode.window.showQuickPick([
                { label: 'Locally', detail: `in ${storageFolder}`, type: StorageTypeEnum.Local },
                { label: 'In a shared Azure Table', type: StorageTypeEnum.AzureTable }
            ], {
                title: 'Select where KeyShepherd should store secret metadata'
            });

            if (!storageTypeResponse) {
                throw new Error('KeyShepherd cannot operate without a storage');
            }

            storageType = storageTypeResponse.type;
        }
        
        if (storageType === StorageTypeEnum.Local) {

            result = await KeyMetadataLocalRepo.create(path.join(storageFolder, 'key-metadata'));

            accountName = undefined;
            tableName = undefined;
            subscriptionId = undefined;
            resourceGroupName = undefined;

        } else {

            if (!accountName || !tableName || !subscriptionId || !resourceGroupName) {
            
                const subscription = await account.pickUpSubscription();
                if (!subscription) {
                    throw new Error('KeyShepherd cannot operate without a storage');
                }
                
                subscriptionId = subscription.subscription.subscriptionId;
                const storageManagementClient = new StorageManagementClient(subscription.session.credentials2, subscriptionId as string);
    
                const storageAccount = await account.picUpStorageAccount(storageManagementClient);
    
                if (!storageAccount) {
                    throw new Error('KeyShepherd cannot operate without a storage');
                }
    
                accountName = storageAccount.name;
    
                // Extracting resource group name
                const match = /\/resourceGroups\/([^\/]+)\/providers/gi.exec(storageAccount.id!);
                if (!match || match.length <= 0) {
                    throw new Error('KeyShepherd cannot operate without a storage');
                }
                resourceGroupName = match[1];
    
                tableName = await vscode.window.showInputBox({ title: 'Enter table name to store secret metadata in', value: 'KeyShepherdMetadata' });
                if (!tableName) {
                    throw new Error('KeyShepherd cannot operate without a storage');
                }    
            }
    
            result = await KeyMetadataTableRepo.create(subscriptionId as any, resourceGroupName as any, accountName as any, tableName as any, account);
        }

        // Updating all settings, but only after the instance was successfully created
        context.globalState.update(SettingNames.StorageType, storageType);
        context.globalState.update(SettingNames.StorageAccountName, accountName);
        context.globalState.update(SettingNames.TableName, tableName);
        context.globalState.update(SettingNames.SubscriptionId, subscriptionId);
        context.globalState.update(SettingNames.ResourceGroupName, resourceGroupName);

        return result;
    }
}
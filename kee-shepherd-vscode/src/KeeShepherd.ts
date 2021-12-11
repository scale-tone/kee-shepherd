import * as path from 'path';
import * as vscode from 'vscode';

import { SecretClient } from '@azure/keyvault-secrets';
import { StorageManagementClient } from '@azure/arm-storage';

import { SecretTypeEnum, ControlTypeEnum, AnchorPrefix, ControlledSecret, StorageTypeEnum } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeyMetadataLocalRepo } from './KeyMetadataLocalRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { KeeShepherdBase } from './KeeShepherdBase';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { KeyMetadataTableRepo } from './KeyMetadataTableRepo';
import { SecretTreeView, KeeShepherdTreeItem, NodeTypeEnum } from './SecretTreeView';
import { SecretValuesProvider } from './SecretValuesProvider';
import { updateGitHooksForFile } from './GitHooksForUnstashedSecrets';

const SettingNames = {
    StorageType: 'KeeShepherdStorageType',
    SubscriptionId: 'KeeShepherdTableStorageSubscriptionId',
    ResourceGroupName: 'KeeShepherdTableStorageResourceGroupName',
    StorageAccountName: 'KeeShepherdTableStorageAccountName',
    TableName: 'KeeShepherdTableName'
}

// Main functionality lies here
export class KeeShepherd extends KeeShepherdBase {

    private constructor(private _account: AzureAccountWrapper, repo: IKeyMetadataRepo, mapRepo: KeyMapRepo, resourcesFolder: string) {
        super(new SecretValuesProvider(_account), repo, mapRepo, new SecretTreeView(() => this._repo, resourcesFolder));
    }

    static async create(context: vscode.ExtensionContext): Promise<KeeShepherd> {

        const account = new AzureAccountWrapper();
        var metadataRepo: IKeyMetadataRepo;

        try {

            metadataRepo = await KeeShepherd.getKeyMetadataRepo(context, account);
            
        } catch (err) {

            const msg = `KeeShepherd failed to initialize its metadata storage. What would you like to do?`;
            const option1 = 'Reset storage settings and try again';
            const option2 = 'Unload KeeShepherd';

            if ((await vscode.window.showWarningMessage(msg, option1, option2)) !== option1) {

                throw err;
            }

            await this.cleanupSettings(context);

            // trying again
            try {
                
                metadataRepo = await KeeShepherd.getKeyMetadataRepo(context, account);

            } catch (err2) {

                vscode.window.showErrorMessage(`KeeShepherd still couldn't initialize its metadata storage`);

                throw err2;
            }
        }

        const resourcesFolderPath = context.asAbsolutePath('resources');

        return new KeeShepherd(
            account, metadataRepo,
            await KeyMapRepo.create(path.join(context.globalStorageUri.fsPath, 'key-maps')),
            resourcesFolderPath
        );
    }

    async changeStorageType(context: vscode.ExtensionContext): Promise<void> {
        
        await this.doAndShowError(async () => {

            await KeeShepherd.cleanupSettings(context);

            this._repo = await KeeShepherd.getKeyMetadataRepo(context, this._account);

            this.treeView.refresh();

        }, 'KeeShepherd failed to switch to another storage type');
    }

    async forgetSecrets(treeItem: KeeShepherdTreeItem): Promise<void>{

        await this.doAndShowError(async () => {

            var secrets: ControlledSecret[] = [];
            var filePath = '';

            if (treeItem.nodeType === NodeTypeEnum.File && !!treeItem.isLocal && !!treeItem.filePath) {
                
                filePath = treeItem.filePath;
                secrets = await this._repo.getSecrets(filePath, true);

            } else if (treeItem.nodeType === NodeTypeEnum.Secret && !!treeItem.isLocal && !!treeItem.command) {
                
                secrets = treeItem.command.arguments;
                filePath = secrets[0].filePath;

            } else {
                return;
            }
            
            const userResponse = await vscode.window.showWarningMessage(
                `Secrets ${secrets.map(s => s.name).join(', ')} will be dropped from secret metadata storage. This will NOT affect the secret itself or the file itself. Do you want to proceed?`,
                'Yes', 'No');
   
            if (userResponse !== 'Yes') {
                return;
            }
            
            await this._repo.removeSecrets(filePath, secrets.map(s => s.name));

            vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets have been forgotten`);
            this.treeView.refresh();

        }, 'KeeShepherd failed to forget secrets');
    }

    async gotoSecret(secret: ControlledSecret): Promise<void>{

        await this.doAndShowError(async () => {

            const editor = await vscode.window.showTextDocument(vscode.Uri.parse(secret.filePath));

            // Searching for this secret in a brute-force way. Deliberately not using secret map here (as it might be outdated).
            const text = editor.document.getText();
            var secretPos = -1, secretLength = 0;

            for (var pos = 0; pos < text.length; pos++) {
    
                // checking if the secret appears at current position
                const anchorName = this.getAnchorName(secret.name);

                if (!!text.startsWith(anchorName, pos)) {

                    // This secret appears in its stashed form. Need to adjust further positions
                    secretPos = pos;
                    secretLength = anchorName.length;
                    break;

                } else {

                    // Calculating and trying to match the hash. Might take time, but no other options...
                    const currentHash = this._repo.getHash(text.substr(pos, secret.length));
                    
                    if (currentHash === secret.hash) {

                        secretPos = pos;
                        secretLength = secret.length;
                        break;
                    }
                }
            }

            // If the secret wasn't found, then updating the entire secret map
            if (secretPos < 0) {
                await this.updateSecretMapForFile(secret.filePath, text, {});
            }

            // Explicitly masking secrets here, because onDidChangeActiveTextEditor will interfere with this handler
            var secretMap = await this._mapRepo.getSecretMapForFile(secret.filePath);
            await this.internalMaskSecrets(editor, secretMap);

            if (secretPos < 0) {
                
                // Also asking the user if they want to forget this missing secret
                await this.askUserAboutMissingSecrets(secret.filePath, [secret.name]);

            } else {

                // Highlighting the secret
                const secretSelection = new vscode.Selection(
                    editor.document.positionAt(secretPos),
                    editor.document.positionAt(secretPos + secretLength)
                );

                editor.selection = secretSelection;
                editor.revealRange(secretSelection);
            }

        }, 'KeeShepherd failed to navigate to this secret');
    }

    async unmaskSecretsInThisFile(): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
    
            editor.setDecorations(this._hiddenTextDecoration, []);

        }, 'KeeShepherd failed to unmask secrets');
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

        }, 'KeeShepherd failed to mask secrets');
    }

    async stashUnstashSecretsInThisFile(stash: boolean): Promise<void> {

        await this.doAndShowError(async () => {

            const document = vscode.window.activeTextEditor?.document;
            if (!document) {
                return;
            }

            const currentFile = document?.uri.toString();
            if (!currentFile) {
                return;
            }

            // Making sure the file is not dirty
            try {

                await document.save();

            } catch (err) { }
    
            const secrets = await this._repo.getSecrets(currentFile, true);
            const secretValues = await this.getSecretValues(secrets);

            const secretsValuesMap = secrets.reduce((result, currentSecret) => {

                // Getting managed secrets only
                if (currentSecret.controlType === ControlTypeEnum.Managed) {
                    
                    result[currentSecret.name] = secretValues[currentSecret.name];
                }

                return result;
            
            }, {} as { [name: string] : string });

            await this.stashUnstashSecretsInFile(currentFile, stash, secretsValuesMap);

            // Updating git hooks for this file
            await updateGitHooksForFile(document.uri, !stash, Object.keys(secretsValuesMap).length);

        }, 'KeeShepherd failed');
    }

    async resolveSecretsInThisFile(): Promise<void> {

        await this.doAndShowError(async () => {

            const document = vscode.window.activeTextEditor?.document;
            if (!document) {
                return;
            }

            const currentFileUri = document?.uri;
            if (!currentFileUri) {
                return;
            }

            const existingSecrets = await this._repo.getSecrets(currentFileUri.toString(), true);

            // Reading current file contents
            var fileText = await this.readFile(currentFileUri);

            const resolvedSecretNames: string[] = [];

            const regex = new RegExp(`${AnchorPrefix}\\((.+)\\)`, 'g');
            var match: RegExpExecArray | null;
            while (match = regex.exec(fileText)) {

                const secretName = match[1];

                // Skipping secrets that are already known
                if (existingSecrets.find(s => s.name === secretName)) {
                    continue;
                }

                const resolvedSecrets = await this._repo.findBySecretName(secretName);

                if (resolvedSecrets.length <= 0) {
                    
                    vscode.window.showErrorMessage(`KeeShepherd couldn't automatically resolve ${secretName}. Insert it manually.`);
                    continue;
                }

                // Using hash as a dictionary key, to detect potential namesakes with different hashes
                const secretsByHash = resolvedSecrets.reduce((result, currentSecret) => {

                    result[currentSecret.hash] = currentSecret;
                    return result;
                
                }, {} as { [hash: string] : ControlledSecret });
    
                if (Object.keys(secretsByHash).length > 1) {
                    
                    vscode.window.showErrorMessage(`KeeShepherd couldn't automatically resolve ${secretName}. There're multiple secrets with this name and different hashes in the storage.`);
                    continue;
                }

                // Prefer managed over supervised
                var resolvedSecret = resolvedSecrets.find(s => s.controlType === ControlTypeEnum.Managed);
                if (!resolvedSecret) {
                    resolvedSecret = resolvedSecrets[0];
                }

                if (!resolvedSecret.properties) {
                    
                    vscode.window.showErrorMessage(`KeeShepherd couldn't automatically resolve ${secretName}. Insert it manually.`);
                    continue;
                }
                
                // Adding the new secret to storage
                await this._repo.addSecret({
                    name: secretName,
                    type: resolvedSecret.type,
                    controlType: ControlTypeEnum.Managed,
                    filePath: currentFileUri.toString(),
                    hash: resolvedSecret.hash,
                    length: resolvedSecret.length,
                    timestamp: new Date(),
                    properties: resolvedSecret.properties
                });

                resolvedSecretNames.push(secretName);
            }

            if (resolvedSecretNames.length > 0) {
                
                this.treeView.refresh();

                vscode.window.showInformationMessage(`KeeShepherd resolved the following secrets: ${resolvedSecretNames.join(', ')}`);
            }

        }, 'KeeShepherd failed to resolve secrets');
    }

    async stashUnstashSecretsInFolder(treeItem: KeeShepherdTreeItem, stash: boolean): Promise<void>{

        await this.doAndShowError(async () => {

            if ((treeItem.nodeType !== NodeTypeEnum.Folder ) || !treeItem.isLocal || !treeItem.folderUri) {
                return;
            }

            const folders = [treeItem.folderUri];
            await this.stashUnstashAllSecretsInFolders(folders, stash);

        }, 'KeeShepherd failed');
    }

    async stashUnstashAllSecretsInThisProject(stash: boolean): Promise<void> {

        await this.doAndShowError(async () => {

            if (!vscode.workspace.workspaceFolders) {
                return;
            }

            try {
                
                // Making sure there're no dirty files open. This can be unreliable during shutdown, so wrapping with try-catch
                await vscode.workspace.saveAll();

            } catch (err) {
            }

            const folders = vscode.workspace.workspaceFolders.map(f => f.uri.toString());

            // Persisting this list, in case the process gets killed in the middle
            if (!!stash) {
                await this._mapRepo.savePendingFolders(folders);
            }

            await this.stashUnstashAllSecretsInFolders(folders, stash);

            // Cleanup upon success
            await this._mapRepo.savePendingFolders([]);

        }, 'KeeShepherd failed');
    }

    async stashPendingFolders(): Promise<void> {

        await this.doAndShowError(async () => {

            const folders = await this._mapRepo.getPendingFolders();
            
            if (!folders || folders.length <= 0) {
                return;
            }

            await this.stashUnstashAllSecretsInFolders(folders, true);

            // Cleanup upon success
            await this._mapRepo.savePendingFolders([]);

        }, 'KeeShepherd failed');
    }

    async controlSecret(controlType: ControlTypeEnum): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document) {
                return;
            }

            if (editor.document.isUntitled) {
                throw new Error('Cannot put secrets to untitled documents');
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
                const keyVaultName = await SecretValuesProvider.pickUpKeyVault(subscription);
    
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
            const secrets = await this._repo.getSecrets(currentFile, true);
            const secretValues = await this.getSecretValues(secrets);
            await this.updateSecretMapForFile(currentFile, editor.document.getText(), secretValues);

            // Also updating git hooks for this file, if it is a Managed secret
            if (controlType === ControlTypeEnum.Managed) {
                
                await updateGitHooksForFile(editor.document.uri, true, Object.keys(secretValues).length);
            }

            vscode.window.showInformationMessage(`KeeShepherd: ${secretName} was added successfully.`);
            this.treeView.refresh();
            
        }, 'KeeShepherd failed to add a secret');
    }

    async insertSecret(controlType: ControlTypeEnum): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document) {
                return;
            }

            if (editor.document.isUntitled) {
                throw new Error('Cannot put secrets to untitled documents');
            }

            const currentFile = editor.document.uri.toString();
            if (!currentFile) {
                return;
            }

            const secret = await this._valuesProvider.pickUpSecret();

            if (!secret) {
                return;
            }

            if (secret.value.startsWith(AnchorPrefix)) {
                throw new Error(`Secret value should not start with ${AnchorPrefix}`);
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

            // Adding metadata to the repo
            const secretHash = this._repo.getHash(secret.value);

            await this._repo.addSecret({
                name: secret.name,
                type: secret.type,
                controlType,
                filePath: currentFile,
                hash: secretHash,
                length: secret.value.length,
                timestamp: new Date(),
                properties: secret.properties
            });
    
            // Also updating secret map for this file
            const secrets = await this._repo.getSecrets(currentFile, true);
            const secretValues = await this.getSecretValues(secrets);
            await this.updateSecretMapForFile(currentFile, editor.document.getText(), secretValues);

            // Immediately masking secrets in this file
            await this.internalMaskSecrets(editor, await this._mapRepo.getSecretMapForFile(currentFile));

            await editor.document.save();
            this.treeView.refresh();

            // Also updating git hooks for this file, if it is a Managed secret
            if (controlType === ControlTypeEnum.Managed) {
                
                await updateGitHooksForFile(editor.document.uri, true, Object.keys(secretValues).length);
            }

            vscode.window.showInformationMessage(`KeeShepherd: ${localSecretName} was added successfully.`);

        }, 'KeeShepherd failed to insert a secret');
    }

    private static async cleanupSettings(context: vscode.ExtensionContext): Promise<void> {
        
        // Zeroing settings
        await context.globalState.update(SettingNames.StorageType, undefined);
        await context.globalState.update(SettingNames.StorageAccountName, undefined);
        await context.globalState.update(SettingNames.TableName, undefined);
        await context.globalState.update(SettingNames.SubscriptionId, undefined);
        await context.globalState.update(SettingNames.ResourceGroupName, undefined);
    }

    private static async getKeyMetadataRepo(context: vscode.ExtensionContext, account: AzureAccountWrapper): Promise<IKeyMetadataRepo> {

        const storageFolder = context.globalStorageUri.fsPath;

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
                title: 'Select where KeeShepherd should store secret metadata'
            });

            if (!storageTypeResponse) {
                throw new Error('Failed to initialize metadata storage');
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
                    throw new Error('Failed to initialize metadata storage');
                }
                
                subscriptionId = subscription.subscription.subscriptionId;
                const storageManagementClient = new StorageManagementClient(subscription.session.credentials2, subscriptionId as string);
    
                const storageAccount = await account.picUpStorageAccount(storageManagementClient);
    
                if (!storageAccount) {
                    throw new Error('Failed to initialize metadata storage');
                }
    
                accountName = storageAccount.name;
    
                // Extracting resource group name
                const match = /\/resourceGroups\/([^\/]+)\/providers/gi.exec(storageAccount.id!);
                if (!match || match.length <= 0) {
                    throw new Error('Failed to initialize metadata storage');
                }
                resourceGroupName = match[1];
    
                tableName = await vscode.window.showInputBox({ title: 'Enter table name to store secret metadata in', value: 'KeeShepherdMetadata' });
                if (!tableName) {
                    throw new Error('Failed to initialize metadata storage');
                }    
            }
    
            result = await KeyMetadataTableRepo.create(subscriptionId as any, resourceGroupName as any, accountName as any, tableName as any, account);
        }

        // Updating all settings, but only after the instance was successfully created
        await context.globalState.update(SettingNames.StorageType, storageType);
        await context.globalState.update(SettingNames.StorageAccountName, accountName);
        await context.globalState.update(SettingNames.TableName, tableName);
        await context.globalState.update(SettingNames.SubscriptionId, subscriptionId);
        await context.globalState.update(SettingNames.ResourceGroupName, resourceGroupName);

        return result;
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

    private _inProgress: boolean = false;
}

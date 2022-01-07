import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';

import { SecretClient } from '@azure/keyvault-secrets';
import { StorageManagementClient } from '@azure/arm-storage';

import { SecretTypeEnum, ControlTypeEnum, AnchorPrefix, ControlledSecret, StorageTypeEnum, getAnchorName, EnvVariableSpecialPath } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeyMetadataLocalRepo } from './KeyMetadataLocalRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { KeeShepherdBase } from './KeeShepherdBase';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { KeyMetadataTableRepo } from './KeyMetadataTableRepo';
import { SecretTreeView, KeeShepherdTreeItem, NodeTypeEnum } from './SecretTreeView';
import { SecretValuesProvider } from './SecretValuesProvider';
import { updateGitHooksForFile } from './GitHooksForUnstashedSecrets';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';

const SettingNames = {
    StorageType: 'KeeShepherdStorageType',
    SubscriptionId: 'KeeShepherdTableStorageSubscriptionId',
    ResourceGroupName: 'KeeShepherdTableStorageResourceGroupName',
    StorageAccountName: 'KeeShepherdTableStorageAccountName',
    TableName: 'KeeShepherdTableName'
}

// Main functionality lies here
export class KeeShepherd extends KeeShepherdBase {

    private constructor(private _context: vscode.ExtensionContext, private _account: AzureAccountWrapper, repo: IKeyMetadataRepo, mapRepo: KeyMapRepo, resourcesFolder: string, protected log: (s: string, withEof: boolean, withTimestamp: boolean) => void) {
        super(new SecretValuesProvider(_account), repo, mapRepo, new SecretTreeView(() => this._repo, resourcesFolder), log);
    }

    static async create(context: vscode.ExtensionContext): Promise<KeeShepherd> {

        const logChannel = vscode.window.createOutputChannel('KeeShepherd');
        context.subscriptions.push(logChannel);
        logChannel.appendLine(`${new Date().toISOString()} KeeShepherd started`);

        const log = (s: string, withEof: boolean, withTimestamp: boolean) => {
            try {

                const timestamp = !!withTimestamp ? `${new Date().toISOString()} ` : '';

                if (!!withEof) {
                    logChannel.appendLine(timestamp + s);
                } else {
                    logChannel.append(timestamp + s);
                }
                
            } catch (err) {
                // Output channels are unreliable during shutdown, so need to wrap them with this try-catch
            }
        };

        const account = new AzureAccountWrapper();
        var metadataRepo: IKeyMetadataRepo;

        try {

            metadataRepo = await KeeShepherd.getKeyMetadataRepo(context, account, log);
            
        } catch (err) {

            const msg = `KeeShepherd failed to initialize its metadata storage. What would you like to do?`;
            const option1 = 'Reset storage settings and try again';
            const option2 = 'Unload KeeShepherd';

            if ((await vscode.window.showWarningMessage(msg, option1, option2)) !== option1) {

                logChannel.appendLine(`${new Date().toISOString()} Failed to initialize metadata storage. ${(err as any).message ?? err}`)

                throw err;
            }

            await this.cleanupSettings(context);

            // trying again
            try {
                
                metadataRepo = await KeeShepherd.getKeyMetadataRepo(context, account, log);

            } catch (err2) {

                vscode.window.showErrorMessage(`KeeShepherd still couldn't initialize its metadata storage`);

                logChannel.appendLine(`${new Date().toISOString()} Failed to initialize metadata storage. ${(err2 as any).message ?? err2}`)

                throw err2;
            }
        }

        const resourcesFolderPath = context.asAbsolutePath('resources');

        return new KeeShepherd(
            context,
            account, metadataRepo,
            await KeyMapRepo.create(path.join(context.globalStorageUri.fsPath, 'key-maps')),
            resourcesFolderPath,
            log
        );
    }

    async changeStorageType(context: vscode.ExtensionContext): Promise<void> {

        await this.doAndShowError(async () => {

            await KeeShepherd.cleanupSettings(context);

            this._repo = await KeeShepherd.getKeyMetadataRepo(context, this._account, this._log);

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

            this._log(`${secrets.length} secrets have been forgotten from ${filePath}`, true, true);
            vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets have been forgotten`);
            this.treeView.refresh();

        }, 'KeeShepherd failed to forget secrets');
    }

    async gotoSecret(secret: ControlledSecret): Promise<void>{

        await this.doAndShowError(async () => {

            if (!secret.filePath) {
                return;
            }

            const fileUri = vscode.Uri.parse(secret.filePath);
            const editor = await vscode.window.showTextDocument(fileUri);

            // Reading file contents through vscode.workspace.fs.readFile() seems more reliable than using editor.getText()
            const text = await KeeShepherdBase.readFile(fileUri);

            // Searching for this secret in a brute-force way. Deliberately not using secret map here (as it might be outdated).
            var secretPos = -1, secretLength = 0;

            for (var pos = 0; pos < text.length; pos++) {
    
                // checking if the secret appears at current position
                const anchorName = getAnchorName(secret.name);

                if (!!text.startsWith(anchorName, pos)) {

                    // This secret appears in its stashed form. Need to adjust further positions
                    secretPos = pos;
                    secretLength = anchorName.length;
                    break;

                } else {

                    // Calculating and trying to match the hash. Might take time, but no other options...
                    const currentHash = this._repo.calculateHash(text.substr(pos, secret.length));
                    
                    if (currentHash === secret.hash) {

                        secretPos = pos;
                        secretLength = secret.length;
                        break;
                    }
                }
            }

            var secretMap = await this._mapRepo.getSecretMapForFile(secret.filePath);

            // If the secret wasn't found, then updating the entire secret map
            if (secretPos < 0 || secretMap.length <= 0) {

                await this.updateSecretMapForFile(secret.filePath, text, {});

                // There might be stale secrets cached in the tree, so better to refresh it
                this.treeView.refresh();

            }

            // Explicitly masking secrets here, because onDidChangeActiveTextEditor will interfere with this handler
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

            this._log(`Unmasked secrets in ${editor.document.uri}`, true, true);

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
                    // Intentionally not awaiting
                    this.askUserAboutMissingSecrets(currentFile, missingSecrets);
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
            const secretsAndValues = await this.getSecretValuesAndCheckHashes(secrets);

            const secretsValuesMap = secretsAndValues.reduce((result, cv) => {

                // Getting managed secrets only
                if (cv.secret.controlType === ControlTypeEnum.Managed) {
                    
                    result[cv.secret.name] = cv.value;
                }

                return result;
            
            }, {} as { [name: string] : string });

            await this.stashUnstashSecretsInFile(currentFile, stash, secretsValuesMap);

            // Updating git hooks for this file
            await updateGitHooksForFile(document.uri, !stash, Object.keys(secretsValuesMap).length > 0);

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
            var fileText = await KeeShepherdBase.readFile(currentFileUri);

            const resolvedSecretNames: string[] = [];

            const regex = new RegExp(`${AnchorPrefix}\\((.+?)\\)`, 'g');
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

                this._log(`Resolved the following secrets: ${resolvedSecretNames.join(', ')} in ${currentFileUri}`, true, true);
                vscode.window.showInformationMessage(`KeeShepherd resolved the following secrets: ${resolvedSecretNames.join(', ')}`);

            } else {

                this._log(`Found no secrets to resolve in ${currentFileUri}`, true, true);
                vscode.window.showInformationMessage(`KeeShepherd found no secrets to resolve in this file`);
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

            this._log(`Stashing the following pending folders: ${folders.join(',')}`, true, true);

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

            const secretHash = this._repo.calculateHash(secretValue);

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
                const keyVaultName = await KeyVaultSecretValueProvider.pickUpKeyVault(subscription);
    
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
            await this.updateSecretMapForFile(currentFile, editor.document.getText(), {});

            // Also updating git hooks for this file, if it is a Managed secret
            if (controlType === ControlTypeEnum.Managed) {
                
                await updateGitHooksForFile(editor.document.uri, true, true);
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
            const secretHash = this._repo.calculateHash(secret.value);

            await this._repo.addSecret({
                name: localSecretName,
                type: secret.type,
                controlType,
                filePath: currentFile,
                hash: secretHash,
                length: secret.value.length,
                timestamp: new Date(),
                properties: secret.properties
            });
    
            // Also updating secret map for this file
            await this.updateSecretMapForFile(currentFile, editor.document.getText(), {});

            // Immediately masking secrets in this file
            await this.internalMaskSecrets(editor, await this._mapRepo.getSecretMapForFile(currentFile));

            await editor.document.save();
            this.treeView.refresh();

            // Also updating git hooks for this file, if it is a Managed secret
            if (controlType === ControlTypeEnum.Managed) {
                
                await updateGitHooksForFile(editor.document.uri, true, true);
            }

            vscode.window.showInformationMessage(`KeeShepherd: ${localSecretName} was added successfully.`);

        }, 'KeeShepherd failed to insert a secret');
    }

    async registerSecretAsEnvVariable(): Promise<void> {

        await this.doAndShowError(async () => {

            const secret = await this._valuesProvider.pickUpSecret();

            if (!secret) {
                return;
            }
            
            const localSecretName = await this.askUserForSecretName(secret.name);
            if (!localSecretName) {
                return;
            }

            // Adding metadata to the repo
            const secretHash = this._repo.calculateHash(secret.value);

            await this._repo.addSecret({
                name: localSecretName,
                type: secret.type,
                controlType: ControlTypeEnum.EnvVariable,
                filePath: '',
                hash: secretHash,
                length: secret.value.length,
                timestamp: new Date(),
                properties: secret.properties
            });
    
            this.treeView.refresh();

            vscode.window.showInformationMessage(`KeeShepherd registered ${localSecretName} as an environment variable.`);

        }, 'KeeShepherd failed to register secret as env variable');
    }

    async removeEnvVariables(treeItem: KeeShepherdTreeItem): Promise<void>{

        await this.doAndShowError(async () => {

            var secretNames: string[] = [];

            if (treeItem.nodeType === NodeTypeEnum.EnvVariables) {

                secretNames = (await this._repo.getSecrets(EnvVariableSpecialPath, true)).map(s => s.name);
                
            } else if (treeItem.nodeType === NodeTypeEnum.Secret && !!treeItem.isLocal && treeItem.contextValue?.startsWith('tree-env-variable')) {
                
                secretNames = [treeItem.label as string];

            } else {
                return;
            }
            
            const userResponse = await vscode.window.showWarningMessage(
                `Secrets ${secretNames.join(', ')} will be dropped from secret metadata storage. If they were mounted as global environment variables, those will be removed as well. Do you want to proceed?`,
                'Yes', 'No');
   
            if (userResponse !== 'Yes') {
                return;
            }
            
            await this._repo.removeSecrets(EnvVariableSpecialPath, secretNames);

            this._log(`${secretNames.length} secrets have been removed`, true, true);
            vscode.window.showInformationMessage(`KeeShepherd: ${secretNames.length} secrets have been removed`);
            this.treeView.refresh();

        }, 'KeeShepherd failed to forget secrets');
    }

    async openTerminal(): Promise<void> {

        await this.doAndShowError(async () => {

            const secrets = await this._repo.getSecrets(EnvVariableSpecialPath, true);
            const secretValues = await this.getSecretValuesAndCheckHashes(secrets);

            const env: { [name: string]: string } = {};
            for (const pair of secretValues) {

                env[pair.secret.name] = pair.value;
            }

            const terminal = vscode.window.createTerminal({
                name: 'KeeShepherd',
                env
            });
            this._context.subscriptions.push(terminal);

            terminal.show();

        }, 'KeeShepherd failed to open terminal window');
    }

    private static async cleanupSettings(context: vscode.ExtensionContext): Promise<void> {
        
        // Zeroing settings
        await context.globalState.update(SettingNames.StorageType, undefined);
        await context.globalState.update(SettingNames.StorageAccountName, undefined);
        await context.globalState.update(SettingNames.TableName, undefined);
        await context.globalState.update(SettingNames.SubscriptionId, undefined);
        await context.globalState.update(SettingNames.ResourceGroupName, undefined);
    }

    private static async getKeyMetadataRepo(context: vscode.ExtensionContext, account: AzureAccountWrapper, log: (s: string, withEof: boolean, withTimestamp: boolean) => void): Promise<IKeyMetadataRepo> {

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

            log(`Metadata storage: local (${storageFolder})`, true, true);

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

            log(`Metadata storage: Azure Table (${accountName}/${tableName})`, true, true);
        }

        // Updating all settings, but only after the instance was successfully created
        await context.globalState.update(SettingNames.StorageType, storageType);
        await context.globalState.update(SettingNames.StorageAccountName, accountName);
        await context.globalState.update(SettingNames.TableName, tableName);
        await context.globalState.update(SettingNames.SubscriptionId, subscriptionId);
        await context.globalState.update(SettingNames.ResourceGroupName, resourceGroupName);

        return result;
    }

    private doAndShowError(todo: () => Promise<void>, errorMessage: string): Promise<void> {

        // Chaining all incoming commands, to make sure they never interfere with each other
        this._commandChain = this._commandChain.then(

            () => todo().catch(err => {

                const msg = `${errorMessage}. ${err.message ?? err}`;
                this._log(msg, true, true);
                vscode.window.showErrorMessage(msg);
            }
                
        ));

        return this._commandChain;
    }

    private _commandChain: Promise<void> = Promise.resolve();
}

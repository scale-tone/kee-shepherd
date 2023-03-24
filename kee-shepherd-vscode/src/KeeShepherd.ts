import * as path from 'path';
import * as vscode from 'vscode';

import { StorageManagementClient } from '@azure/arm-storage';

import { SecretTypeEnum, ControlTypeEnum, AnchorPrefix, ControlledSecret, StorageTypeEnum, getAnchorName, SecretNameConflictError } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './metadata-repositories/IKeyMetadataRepo';
import { KeyMetadataLocalRepo } from './metadata-repositories/KeyMetadataLocalRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { KeeShepherdBase } from './KeeShepherdBase';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { KeyMetadataTableRepo } from './metadata-repositories/KeyMetadataTableRepo';
import { SecretTreeView, KeeShepherdTreeItem, KeeShepherdNodeTypeEnum } from './tree-views/SecretTreeView';
import { KeyVaultNodeTypeEnum, KeyVaultTreeItem, KeyVaultTreeView } from './tree-views/KeyVaultTreeView';
import { SecretValuesProvider } from './SecretValuesProvider';
import { updateGitHooksForFile } from './GitHooksForUnstashedSecrets';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';
import { ISecretValueProvider, SelectedSecretType } from './secret-value-providers/ISecretValueProvider';
import { Log, askUserForSecretName, askUserForDifferentNonEmptySecretName } from './helpers';
import { CodespacesTreeView } from './tree-views/CodespacesTreeView';
import { ShortcutsTreeView } from './tree-views/ShortcutsTreeView';
import { VsCodeSecretStorageTreeView } from './tree-views/VsCodeSecretStorageTreeView';

export const SettingNames = {
    StorageType: 'KeeShepherdStorageType',
    SubscriptionId: 'KeeShepherdTableStorageSubscriptionId',
    ResourceGroupName: 'KeeShepherdTableStorageResourceGroupName',
    StorageAccountName: 'KeeShepherdTableStorageAccountName',
    TableName: 'KeeShepherdTableName',
    EnvVarsAlreadyMigrated: 'KeeShepherdEnvVarsAlreadyMigrated',
    VsCodeSecretStorageSecretNames: 'KeeShepherdVsCodeSecretStorageSecretNames'
};

// Main functionality lies here
export class KeeShepherd extends KeeShepherdBase {

    constructor (
        context: vscode.ExtensionContext,
        private readonly _account: AzureAccountWrapper,
        repo: IKeyMetadataRepo,
        mapRepo: KeyMapRepo,
        resourcesFolder: string,
        log: Log
    ) {
        const valuesProvider = new SecretValuesProvider(context, _account, log);
        
        super(
            context,
            valuesProvider,
            repo,
            mapRepo,
            new SecretTreeView(_account, () => this._repo, resourcesFolder, log),
            new KeyVaultTreeView(_account, valuesProvider, resourcesFolder, log),
            new CodespacesTreeView(valuesProvider, resourcesFolder, log),
            new ShortcutsTreeView(
                context,
                () => this._repo,
                (secrets: ControlledSecret[]) => this.getSecretValuesAndCheckHashes(secrets),
                valuesProvider,
                resourcesFolder,
                log
            ),
            new VsCodeSecretStorageTreeView(context, valuesProvider, resourcesFolder, log),
            log
        );
    }

    get metadataRepo(): IKeyMetadataRepo {
        return this._repo;
    }

    get valuesProvider(): ISecretValueProvider {
        return this._valuesProvider;
    }

    async changeStorageType(context: vscode.ExtensionContext): Promise<void> {

        await KeeShepherd.cleanupSettings(context);

        this._repo = await KeeShepherd.getKeyMetadataRepo(context, this._account, this._log);

        this.treeView.refresh();
    }

    async forgetSecrets(treeItem: KeeShepherdTreeItem): Promise<void>{

        var secrets: ControlledSecret[] = [];
        var filePath = '';

        if (treeItem.nodeType === KeeShepherdNodeTypeEnum.File && !!treeItem.isLocal && !!treeItem.filePath) {
            
            filePath = treeItem.filePath;
            secrets = await this._repo.getSecrets(filePath, true);

        } else if (treeItem.nodeType === KeeShepherdNodeTypeEnum.Secret && !!treeItem.isLocal && !!treeItem.command) {
            
            secrets = treeItem.command.arguments;
            filePath = secrets[0].filePath;

        } else {
            return;
        }
        
        const userResponse = await vscode.window.showWarningMessage(
            `Secrets ${secrets.map(s => s.name).join(', ')} will be dropped from secret metadata storage. This will NOT affect the secret itself or the file contents. Do you want to proceed?`,
            'Yes', 'No');

        if (userResponse !== 'Yes') {
            return;
        }
        
        await this._repo.removeSecrets(filePath, secrets.map(s => s.name));

        this._log(`${secrets.length} secrets have been forgotten from ${filePath}`, true, true);
        vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets have been forgotten`);
        this.treeView.refresh();
    }

    async forgetAllSecrets(treeItem: KeeShepherdTreeItem): Promise<void>{

        if (treeItem.nodeType !== KeeShepherdNodeTypeEnum.Machine) {
            return;
        }

        const machineName = treeItem.label as string;
        
        const userResponse = await vscode.window.showWarningMessage(
            `All secrets on ${machineName} will be dropped from secret metadata storage. If the machine still contains secret values, those values WILL REMAIN there. Do you want to proceed?`,
            'Yes', 'No');

        if (userResponse !== 'Yes') {
            return;
        }

        if (!!treeItem.isLocal) {

            // Need to also drop VsCodeSecretStorage secrets from VsCodeSecretStorage
            this._repo.refreshCache();

            const vsCodeSecretStorageSecrets = (await this._repo.getAllCachedSecrets())
                .filter(s => s.type === SecretTypeEnum.VsCodeSecretStorage);

            for (const secret of vsCodeSecretStorageSecrets) {
            
                await this._context.secrets.delete(secret.name);
            }
        }

        await this._repo.removeAllSecrets(machineName);

        // Also cleaning up the key map
        if (!!treeItem.isLocal) {
            await this._mapRepo.cleanup();
        }

        this._log(`All secrets on ${machineName} have been forgotten`, true, true);
        vscode.window.showInformationMessage(`KeeShepherd: all secrets on ${machineName} have been forgotten`);
        this.treeView.refresh();
    }

    async gotoSecret(secret: ControlledSecret): Promise<void>{

        if (!secret.filePath) {
            return;
        }

        const fileUri = vscode.Uri.parse(secret.filePath);
        const editor = await vscode.window.showTextDocument(fileUri);

        // Reading file contents through vscode.workspace.fs.readFile() seems more reliable than using editor.getText()
        const { text } = await KeeShepherdBase.readFile(fileUri);

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
    }

    async unmaskSecretsInThisFile(): Promise<void> {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        editor.setDecorations(this._hiddenTextDecoration, []);
        editor.setDecorations(this._tempHiddenTextDecoration, []);

        this._log(`Unmasked secrets in ${editor.document.uri}`, true, true);
    }

    async maskSecretsInThisFile(updateMapIfSomethingNotFound: boolean): Promise<void> {

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
    }

    async stashUnstashSecretsInThisFile(stash: boolean): Promise<void> {

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
    }

    async resolveSecretsInThisFile(): Promise<void> {

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
        let { text } = await KeeShepherdBase.readFile(currentFileUri);

        const resolvedSecretNames: string[] = [];

        const regex = new RegExp(`${AnchorPrefix}\\((.+?)\\)`, 'g');
        let match: RegExpExecArray | null;
        while (match = regex.exec(text)) {

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
    }

    async stashUnstashSecretsInFolder(treeItem: KeeShepherdTreeItem, stash: boolean): Promise<void>{

        if ((treeItem.nodeType !== KeeShepherdNodeTypeEnum.Folder ) || !treeItem.isLocal || !treeItem.folderUri) {
            return;
        }

        const folders = [treeItem.folderUri];
        await this.stashUnstashAllSecretsInFolders(folders, stash);
    }

    async stashUnstashAllSecretsInThisProject(stash: boolean): Promise<void> {

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
    }

    async stashPendingFolders(): Promise<void> {

        const folders = await this._mapRepo.getPendingFolders();
        
        if (!folders || folders.length <= 0) {
            return;
        }

        this._log(`Stashing the following pending folders: ${folders.join(',')}`, true, true);

        await this.stashUnstashAllSecretsInFolders(folders, true);

        // Cleanup upon success
        await this._mapRepo.savePendingFolders([]);
    }

    async controlSecret(controlType: ControlTypeEnum): Promise<void> {

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

        const secretName = await askUserForSecretName();
        if (!secretName) {
            return;
        }

        // Managed secrets always go to KeyVault, supervised go there only by user's request
        var alsoAddToKeyVault = true;
        if (controlType === ControlTypeEnum.Supervised) {
            alsoAddToKeyVault = await vscode.window.showQuickPick(['Yes', 'No'], { title: 'Do you want to also put this secret value to a secure storage?' }) === 'Yes';
        }

        if (!alsoAddToKeyVault) {

            // Just adding the secret as unknown

            await this._repo.addSecret({
                name: secretName,
                type: SecretTypeEnum.Unknown,
                controlType,
                filePath: currentFile,
                hash: this._repo.calculateHash(secretValue),
                length: secretValue.length,
                timestamp: new Date()
            });
            
        } else {

            // Adding both to metadata storage and to Key Vault

            if (!await this.persistSecretValue(secretName, secretValue, controlType, currentFile)) {
                return;
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
    }

    async insertSecret(controlType: ControlTypeEnum, secretType?: SecretTypeEnum, secret?: SelectedSecretType): Promise<void> {

        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document || editor.document.uri.scheme === 'output') {
            throw new Error(`Couldn't find any open text editor`);
        }

        if (!!editor.document.isUntitled) {
            throw new Error('Cannot put secrets to untitled documents');
        }

        const currentFile = editor.document.uri.toString();
        if (!currentFile) {
            return;
        }

        if (!secret) {

            secret = await this._valuesProvider.pickUpSecret(controlType, undefined, secretType);

            if (!secret) {
                return;
            }
        }
        
        // Pre-masking the secret with a temporary mask
        editor.setDecorations(this._tempHiddenTextDecoration, [editor.selection]);

        // Pasting secret value at current cursor position
        var success = await editor.edit(edit => {
            edit.replace(editor.selection, secret!.value);
        });

        if (!success) {
            return;
        }

        let localSecretName = !!secret.alreadyAskedForName ? secret.name : await askUserForSecretName(secret.name);
        if (!localSecretName) {
            return;
        }

        // Adding metadata to the repo
        const secretHash = this._repo.calculateHash(secret.value);

        while (true) {

            try {

                // Trying to add the secret
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
                
                break;

            } catch (err) {

                // This indicates that a secret with same name but different hash already exists
                if (err instanceof SecretNameConflictError) {

                    // Demanding another name and trying again
                    localSecretName = await askUserForDifferentNonEmptySecretName(localSecretName);
                    
                } else {
                    throw err;
                }
            }
        }

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
    }

    async copySecretValue(treeItem: KeeShepherdTreeItem): Promise<void> {

        const secret = treeItem.secret;
        if (!secret) {
            return;
        }

        const secretValue = (await this.getSecretValuesAndCheckHashes([secret]))[0].value;

        if (!secretValue) {
            throw new Error(`Failed to get secret value`);
        }

        vscode.env.clipboard.writeText(secretValue);

        vscode.window.showInformationMessage(`KeeShepherd: value of ${secret.name} was copied to Clipboard`);
    }

    async insertKeyVaultSecretAsManaged(treeItem: KeyVaultTreeItem): Promise<void> {

        if (treeItem.nodeType !== KeyVaultNodeTypeEnum.Secret || !treeItem.subscriptionId || !treeItem.keyVaultName) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document || editor.document.uri.scheme === 'output') {
            throw new Error(`Input cursor is not on an editable text file`);
        }

        if (!!editor.document.isUntitled) {
            throw new Error('Cannot put secrets to untitled documents');
        }

        const currentFile = editor.document.uri.toString();
        if (!currentFile) {
            return;
        }

        const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
        const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.keyVaultName);

        const secret = await keyVaultClient.getSecret(treeItem.label as string);

        // Pre-masking the secret with a temporary mask
        editor.setDecorations(this._tempHiddenTextDecoration, [editor.selection]);

        // Pasting secret value at current cursor position
        var success = await editor.edit(edit => {
            edit.replace(editor.selection, secret.value!);
        });

        if (!success) {
            return;
        }

        // Adding metadata to the repo
        const secretHash = this._repo.calculateHash(secret.value!);

        await this._repo.addSecret({
            name: secret.name,
            type: SecretTypeEnum.AzureKeyVault,
            controlType: ControlTypeEnum.Managed,
            filePath: currentFile,
            hash: secretHash,
            length: secret.value!.length,
            timestamp: new Date(),
            properties: {
                keyVaultName: treeItem.keyVaultName,
                keyVaultSecretName: secret.name
            }
        });

        // Also updating secret map for this file
        await this.updateSecretMapForFile(currentFile, editor.document.getText(), {});

        // Immediately masking secrets in this file
        await this.internalMaskSecrets(editor, await this._mapRepo.getSecretMapForFile(currentFile));

        await editor.document.save();
        this.treeView.refresh();

        // Also updating git hooks for this file, since it is a Managed secret
        await updateGitHooksForFile(editor.document.uri, true, true);

        vscode.window.showInformationMessage(`KeeShepherd: ${secret.name} was added successfully.`);
    }

    static async cleanupSettings(context: vscode.ExtensionContext): Promise<void> {
        
        // Zeroing settings
        await context.globalState.update(SettingNames.StorageType, undefined);
        await context.globalState.update(SettingNames.StorageAccountName, undefined);
        await context.globalState.update(SettingNames.TableName, undefined);
        await context.globalState.update(SettingNames.SubscriptionId, undefined);
        await context.globalState.update(SettingNames.ResourceGroupName, undefined);
    }

    static async getKeyMetadataRepo(context: vscode.ExtensionContext, account: AzureAccountWrapper, log: Log): Promise<IKeyMetadataRepo> {

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

            result = await KeyMetadataLocalRepo.create(context, path.join(storageFolder, 'key-metadata'));

            log(`Metadata storage: local (${storageFolder})`, true, true);

            accountName = undefined;
            tableName = undefined;
            subscriptionId = undefined;
            resourceGroupName = undefined;

        } else {

            if (!accountName || !tableName || !subscriptionId || !resourceGroupName) {

                if (!await account.isSignedIn()) {
                    
                    await vscode.commands.executeCommand('azure-account.login');

                    const progressOptions = {
                        location: vscode.ProgressLocation.Notification,
                        title: `Waiting for Azure sign-in... `,
                        cancellable: true
                    };
            
                    await vscode.window.withProgress(progressOptions, async (progress, token) => {

                        do {
                            
                            await new Promise(r => setTimeout(r, 500));

                            if (token.isCancellationRequested) {
                                throw new Error('Cancelled by user');
                            }
                        }
                        while (!await account.subscriptionsAvailable());
                    });
                }
            
                const subscription = await account.pickUpSubscription();
                if (!subscription) {
                    throw new Error('No Azure subscription selected');
                }
                
                subscriptionId = subscription.subscription.subscriptionId;
                const storageManagementClient = new StorageManagementClient(subscription.session.credentials2, subscriptionId as string);
    
                const storageAccount = await account.picUpStorageAccount(storageManagementClient);
    
                if (!storageAccount) {
                    throw new Error('No Azure Storage account selected');
                }
    
                accountName = storageAccount.name;
    
                // Extracting resource group name
                const match = /\/resourceGroups\/([^\/]+)\/providers/gi.exec(storageAccount.id!);
                if (!match || match.length <= 0) {
                    throw new Error('Failed to extract resource group name');
                }
                resourceGroupName = match[1];
    
                tableName = await vscode.window.showInputBox({ title: 'Enter table name to store secret metadata in', value: 'KeeShepherdMetadata' });
                if (!tableName) {
                    throw new Error('No metadata table selected');
                }    
            }
    
            result = await KeyMetadataTableRepo.create(subscriptionId as any, resourceGroupName as any, accountName as any, tableName as any, account, context);

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

    private async persistSecretValue(secretName: string, secretValue: string, controlType: ControlTypeEnum, sourceFileName: string): Promise<boolean> {

        // Asking user where to store this secret's value
        const storageUserChoice = await this._valuesProvider.askUserWhereToStoreSecret(secretName);

        if (!storageUserChoice) {
            return false;
        }
        
        // First adding the metadata

        await this._repo.addSecret({
            name: secretName,
            type: storageUserChoice.secretType,
            controlType,
            filePath: sourceFileName,
            hash: this._repo.calculateHash(secretValue),
            length: secretValue.length,
            timestamp: new Date(),
            properties: storageUserChoice.secretProperties
        });

        // Then adding this secret to KeyVault
        try {

            await storageUserChoice.persistRoutine(secretValue);

        } catch (err) {
            
            // Dropping the just created secret upon failure
            this._repo.removeSecrets(sourceFileName, [secretName]);

            throw err;
        }

        return true;
    }
}

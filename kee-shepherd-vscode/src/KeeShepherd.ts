import * as path from 'path';
import * as vscode from 'vscode';

import { StorageManagementClient } from '@azure/arm-storage';

import { SecretTypeEnum, ControlTypeEnum, AnchorPrefix, ControlledSecret, StorageTypeEnum, getAnchorName, EnvVariableSpecialPath, toDictionary, SecretNameConflictError } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeyMetadataLocalRepo } from './KeyMetadataLocalRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { KeeShepherdBase } from './KeeShepherdBase';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { KeyMetadataTableRepo } from './KeyMetadataTableRepo';
import { SecretTreeView, KeeShepherdTreeItem, KeeShepherdNodeTypeEnum } from './SecretTreeView';
import { KeyVaultNodeTypeEnum, KeyVaultTreeItem, KeyVaultTreeView } from './KeyVaultTreeView';
import { SecretValuesProvider } from './SecretValuesProvider';
import { updateGitHooksForFile } from './GitHooksForUnstashedSecrets';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';
import { ISecretValueProvider, SelectedSecretType } from './secret-value-providers/ISecretValueProvider';
import { Log } from './helpers';
import { CodespacesNodeTypeEnum, CodespacesTreeItem, CodespacesTreeView } from './CodespacesTreeView';
import { CodespaceSecretValueProvider, CodespaceSecretVisibility } from './secret-value-providers/CodespaceSecretValueProvider';

const SettingNames = {
    StorageType: 'KeeShepherdStorageType',
    SubscriptionId: 'KeeShepherdTableStorageSubscriptionId',
    ResourceGroupName: 'KeeShepherdTableStorageResourceGroupName',
    StorageAccountName: 'KeeShepherdTableStorageAccountName',
    TableName: 'KeeShepherdTableName'
};

// Main functionality lies here
export class KeeShepherd extends KeeShepherdBase {

    constructor (
        private _context: vscode.ExtensionContext,
        private _account: AzureAccountWrapper,
        repo: IKeyMetadataRepo,
        mapRepo: KeyMapRepo,
        resourcesFolder: string,
        log: Log
    ) {

        super (
            new SecretValuesProvider(_account, log),
            repo,
            mapRepo,
            new SecretTreeView(_account, () => this._repo, resourcesFolder, log),
            new KeyVaultTreeView(_account, resourcesFolder, log),
            new CodespacesTreeView(resourcesFolder, log),
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

        }, 'KeeShepherd failed to forget secrets');
    }

    async forgetAllSecrets(treeItem: KeeShepherdTreeItem): Promise<void>{

        await this.doAndShowError(async () => {

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
            
            await this._repo.removeAllSecrets(machineName);

            // Also cleaning up the key map
            if (!!treeItem.isLocal) {
                await this._mapRepo.cleanup();
            }

            this._log(`All secrets on ${machineName} have been forgotten`, true, true);
            vscode.window.showInformationMessage(`KeeShepherd: all secrets on ${machineName} have been forgotten`);
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

        }, 'KeeShepherd failed to navigate to this secret');
    }

    async unmaskSecretsInThisFile(): Promise<void> {

        await this.doAndShowError(async () => {

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
    
            editor.setDecorations(this._hiddenTextDecoration, []);
            editor.setDecorations(this._tempHiddenTextDecoration, []);

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

        }, 'KeeShepherd failed to resolve secrets');
    }

    async stashUnstashSecretsInFolder(treeItem: KeeShepherdTreeItem, stash: boolean): Promise<void>{

        await this.doAndShowError(async () => {

            if ((treeItem.nodeType !== KeeShepherdNodeTypeEnum.Folder ) || !treeItem.isLocal || !treeItem.folderUri) {
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
                    hash: this._repo.calculateHash(secretValue),
                    length: secretValue.length,
                    timestamp: new Date()
                });
                
            } else {

                // Adding both to metadata storage and to Key Vault

                if (!await this.addKeyVaultSecret(secretName, secretValue, controlType, currentFile)) {
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
            
        }, 'KeeShepherd failed to add a secret');
    }

    async insertSecret(controlType: ControlTypeEnum, secretType?: SecretTypeEnum, secret?: SelectedSecretType): Promise<void> {

        await this.doAndShowError(async () => {

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

            let localSecretName = !!secret.alreadyAskedForName ? secret.name : await this.askUserForSecretName(secret.name);
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
                        localSecretName = await this.askUserForDifferentNonEmptySecretName(localSecretName);
                        
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

        }, 'KeeShepherd failed to insert a secret');
    }

    async registerSecretAsEnvVariable(): Promise<void> {

        await this.doAndShowError(async () => {

            // Disallowing to register an env variable as an env variable
            const secretTypesToExclude = [SecretTypeEnum.Codespaces];

            const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.EnvVariable, secretTypesToExclude);

            if (!secret) {
                return;
            }
            
            let localSecretName = !!secret.alreadyAskedForName ? secret.name : await this.askUserForSecretName(secret.name);
            if (!localSecretName) {
                return;
            }

            // Adding metadata to the repo
            const secretHash = this._repo.calculateHash(secret.value);

            while (true) {

                try {

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
                 
                    break;
                    
                } catch (err) {

                    // This indicates that a secret with same name but different hash already exists
                    if (err instanceof SecretNameConflictError) {

                        // Demanding another name and trying again
                        localSecretName = await this.askUserForDifferentNonEmptySecretName(localSecretName);
                        
                    } else {
                        throw err;
                    }
                }
            }
    
            this.treeView.refresh();

            vscode.window.showInformationMessage(`KeeShepherd registered ${localSecretName} as an environment variable.`);

        }, 'KeeShepherd failed to register secret as env variable');
    }

    async createEnvVariableFromClipboard(): Promise<void> {

        await this.doAndShowError(async () => {

            const secretValue = await vscode.env.clipboard.readText();

            if (!secretValue) {
                throw new Error('No text found in Clipboard');
            }

            const secretName = await this.askUserForSecretName();
            if (!secretName) {
                return;
            }

            if (!await this.addKeyVaultSecret(secretName, secretValue, ControlTypeEnum.EnvVariable, '')) {
                return;
            }

            this.treeView.refresh();

            vscode.window.showInformationMessage(`KeeShepherd registered ${secretName} as an environment variable.`);

        }, 'KeeShepherd failed to create an env variable');
    }

    async removeEnvVariables(treeItem: KeeShepherdTreeItem): Promise<void>{

        await this.doAndShowError(async () => {

            var secretNames: string[] = [];

            if (treeItem.nodeType === KeeShepherdNodeTypeEnum.EnvVariables) {

                secretNames = (await this._repo.getSecrets(EnvVariableSpecialPath, true)).map(s => s.name);
                
            } else if (treeItem.nodeType === KeeShepherdNodeTypeEnum.Secret && !!treeItem.isLocal && treeItem.contextValue?.startsWith('tree-env-variable')) {
                
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

            try {
                
                // Unmounting global env variables, if any
                await this.setGlobalEnvVariables(toDictionary(secretNames, () => ''));

            } catch (err) {

                this._log(`Failed to unmount secrets from global env variables. ${(err as any).message ?? err}`, true, true);
            }
            
            // Now removing secrets themselves
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

    async copySecretValue(treeItem: KeeShepherdTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

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

        }, 'KeeShepherd failed to copy secret value');
    }

    async mountAsGlobalEnv(treeItem: KeeShepherdTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            var secrets: ControlledSecret[];

            if (treeItem.nodeType === KeeShepherdNodeTypeEnum.EnvVariables) {

                secrets = (await this._repo.getSecrets(EnvVariableSpecialPath, true));
                
            } else if (treeItem.nodeType === KeeShepherdNodeTypeEnum.Secret && !!treeItem.isLocal && !!treeItem.secret) {
                
                secrets = [treeItem.secret];

            } else {
                return;
            }

            const secretValues = (await this.getSecretValuesAndCheckHashes(secrets));

            const variables: { [n: string]: string } = {};
            for (const pair of secretValues) {

                if (!pair.value) {
                    throw new Error(`Failed to get secret value`);
                }
    
                variables[pair.secret.name] = pair.value;
            }

            await this.setGlobalEnvVariables(variables);

            vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets were set as global environment variables. Restart your shell to see the effect.`);
            this.treeView.refresh();

        }, 'KeeShepherd failed to mount secret as global environment variable');
    }

    async unmountAsGlobalEnv(treeItem: KeeShepherdTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            var secrets: ControlledSecret[];

            if (treeItem.nodeType === KeeShepherdNodeTypeEnum.EnvVariables) {

                secrets = await this._repo.getSecrets(EnvVariableSpecialPath, true);
                
            } else if (treeItem.nodeType === KeeShepherdNodeTypeEnum.Secret && !!treeItem.isLocal && !!treeItem.secret) {
                
                secrets = [treeItem.secret];

            } else {
                return;
            }
            
            await this.setGlobalEnvVariables(toDictionary(secrets.map(s => s.name), () => ''));

            vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets were removed from global environment variables. Restart your shell to see the effect.`);
            this.treeView.refresh();

        }, 'KeeShepherd failed to unmount secret from global environment variables');
    }

    async registerEnvVariablesOnLocalMachine(treeItem: KeeShepherdTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            if (treeItem.nodeType !== KeeShepherdNodeTypeEnum.EnvVariables || !!treeItem.isLocal) {
                return;
            }

            const secrets = await this._repo.getSecrets(EnvVariableSpecialPath, true, treeItem.machineName);

            for (const secret of secrets) {
             
                await this._repo.addSecret(secret);
            }

            vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets were added.`);
            this.treeView.refresh();

        }, 'KeeShepherd failed to register secrets as environment variables');
    }

    async copyKeyVaultSecretValueOrUri(treeItem: KeyVaultTreeItem, copyUri: boolean): Promise<void> {

        await this.doAndShowError(async () => {

            if ((treeItem.nodeType !== KeyVaultNodeTypeEnum.Secret && treeItem.nodeType !== KeyVaultNodeTypeEnum.SecretVersion) ||
                !treeItem.subscriptionId ||
                !treeItem.keyVaultName ||
                !treeItem.secretId) {
                return;
            }

            const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
            const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.subscriptionId, treeItem.keyVaultName);

            const secret = await keyVaultClient.getSecret(treeItem.secretId);

            if (!!copyUri) {

                vscode.env.clipboard.writeText(
                    treeItem.nodeType === KeyVaultNodeTypeEnum.Secret ? 
                    `${secret.properties.vaultUrl}/secrets/${secret.name}` :
                    secret.properties.id!
                );

            } else {

                vscode.env.clipboard.writeText(secret.value as string);
            }

            vscode.window.showInformationMessage(`KeeShepherd: ${copyUri ? 'URI' : 'value'} of ${treeItem.secretId} was copied to Clipboard`);

        }, 'KeeShepherd failed to get the secret');
    }

    async createKeyVaultSecret(treeItem: KeyVaultTreeItem, pickUpSecretValue: boolean = false): Promise<void> {

        await this.doAndShowError(async () => {

            if (treeItem.nodeType !== KeyVaultNodeTypeEnum.KeyVault || !treeItem.subscriptionId || !treeItem.keyVaultName) {
                return;
            }

            let secretName;
            let secretValue;

            if (!!pickUpSecretValue) {

                const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
                if (!secret) {
                    return;
                }

                secretName = !!secret.alreadyAskedForName ? secret.name : await this.askUserForSecretName(secret.name);
                
                secretValue = secret.value;
                
            } else {

                secretName = await this.askUserForSecretName();

                secretValue = await vscode.window.showInputBox({
                    prompt: 'Enter secret value',
                    password: true
                });
            }

            if (!secretName) {
                return;
            }

            if (!secretValue) {
                return;
            }

            const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
            const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.subscriptionId, treeItem.keyVaultName);

            const checkResult = await KeyVaultSecretValueProvider.checkIfSecretExists(keyVaultClient, secretName);
            if (checkResult === 'not-ok-to-overwrite') {
                return;
            }
            
            await keyVaultClient.setSecret(secretName, secretValue);

            this.keyVaultTreeView.refresh();

            if (checkResult === 'does-not-exist') {
                
                this._log(`Created ${secretName} in ${treeItem.keyVaultName} Key Vault`, true, true);
                vscode.window.showInformationMessage(`KeeShepherd: ${secretName} was created in Key Vault`);

            } else {

                this._log(`Added a new version of ${secretName} to ${treeItem.keyVaultName} Key Vault`, true, true);
                vscode.window.showInformationMessage(`KeeShepherd: new version of ${secretName} was added to Key Vault`);
            }

        }, 'KeeShepherd failed to add secret to Key Vault');
    }

    async setKeyVaultSecretValue(treeItem: KeyVaultTreeItem, pickUpSecretValue: boolean = false): Promise<void> {

        await this.doAndShowError(async () => {

            if (treeItem.nodeType !== KeyVaultNodeTypeEnum.Secret || !treeItem.subscriptionId || !treeItem.keyVaultName) {
                return;
            }

            const secretName = treeItem.label as string;
            let secretValue;

            if (!!pickUpSecretValue) {

                const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
                if (!secret) {
                    return;
                }

                secretValue = secret.value;
                
            } else {

                secretValue = await vscode.window.showInputBox({
                    prompt: 'Enter secret value',
                    password: true
                });
            }

            if (!secretValue) {
                return;
            }

            const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
            const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.subscriptionId, treeItem.keyVaultName);

            await keyVaultClient.setSecret(secretName, secretValue);

            this.keyVaultTreeView.refresh();

            this._log(`Added a new version of ${secretName} to ${treeItem.keyVaultName} Key Vault`, true, true);
            vscode.window.showInformationMessage(`KeeShepherd: new version of ${secretName} was added to Key Vault`);

        }, 'KeeShepherd failed to set secret value');
    }

    async removeSecretFromKeyVault(treeItem: KeyVaultTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            if (treeItem.nodeType !== KeyVaultNodeTypeEnum.Secret || !treeItem.subscriptionId || !treeItem.keyVaultName) {
                return;
            }

            const userResponse = await vscode.window.showWarningMessage(
                `Secret ${treeItem.label} will be removed ("soft-deleted") from Key Vault. Do you want to proceed?`,
                'Yes', 'No');
   
            if (userResponse !== 'Yes') {
                return;
            }

            const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
            const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.subscriptionId, treeItem.keyVaultName);

            const progressOptions = {
                location: vscode.ProgressLocation.Notification,
                title: `Removing secret from Key Vault...`
            };
    
            await vscode.window.withProgress(progressOptions, async () => { 

                const poller = await keyVaultClient.beginDeleteSecret(treeItem.label as string);
                const removedSecret = await poller.pollUntilDone();

                this._log(`Removed ${removedSecret.name} from ${treeItem.keyVaultName} Key Vault`, true, true);
            });

            this.keyVaultTreeView.refresh();

            vscode.window.showInformationMessage(`KeeShepherd: ${treeItem.label} was removed from Key Vault`);

        }, 'KeeShepherd failed to remove secret from Key Vault');
    }

    async insertKeyVaultSecretAsManaged(treeItem: KeyVaultTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

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
            const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.subscriptionId, treeItem.keyVaultName);

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
                    subscriptionId: treeItem.subscriptionId,
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

        }, 'KeeShepherd failed');
    }

    async createOrUpdateCodespacesPersonalSecret(treeItem: CodespacesTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            if (!(
                (treeItem.nodeType === CodespacesNodeTypeEnum.SecretKind && treeItem.secretKind === 'Personal') ||
                (treeItem.nodeType === CodespacesNodeTypeEnum.Secret && !!treeItem.secretInfo)
            )) {
                return;
            }

            let isUpdating = treeItem.nodeType === CodespacesNodeTypeEnum.Secret;

            // This should be at the beginning, since it might require the user to re-authenticate
            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecretsAndRepos();

            let secretName = treeItem.secretInfo?.name;

            if (!secretName) {
                
                secretName = await this.askUserForSecretName();
            }

            if (!secretName) {
                return;
            }

            const secretValue = await vscode.window.showInputBox({
                prompt: 'Enter secret value',
                password: true
            });

            if (!secretValue) {
                return;
            }

            const selectedRepoIds = await this.pickUpPersonalRepoIds(treeItem.secretInfo?.selected_repositories_url, accessToken);
            if (!selectedRepoIds?.length) {
                return;
            }

            const selectedRepoIdsAsStrings = selectedRepoIds.map(id => id.toString());

            await CodespaceSecretValueProvider.setSecretValue('user', accessToken, secretName, secretValue, undefined, selectedRepoIdsAsStrings);
            
            this.codespacesTreeView.refresh();

            if (!!isUpdating) {
                
                vscode.window.showInformationMessage(`Codespaces secret ${secretName} was updated`);

            } else {

                vscode.window.showInformationMessage(`Codespaces secret ${secretName} was added`);
            }

        }, 'KeeShepherd failed to save Codespaces secret');
    }    

    async createOrUpdateCodespacesOrgSecret(treeItem: CodespacesTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            if (!treeItem.orgName) {
                return;
            }

            if (!(
                (treeItem.nodeType === CodespacesNodeTypeEnum.Organization) ||
                (treeItem.nodeType === CodespacesNodeTypeEnum.Secret && !!treeItem.secretInfo)
            )) {
                return;
            }

            let isUpdating = treeItem.nodeType === CodespacesNodeTypeEnum.Secret;

            // This should be at the beginning, since it might require the user to re-authenticate
            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgAndRepoSecrets();

            let secretName = treeItem.secretInfo?.name;

            if (!secretName) {
                
                secretName = await this.askUserForSecretName();
            }

            if (!secretName) {
                return;
            }

            const secretValue = await vscode.window.showInputBox({
                prompt: 'Enter secret value',
                password: true
            });

            if (!secretValue) {
                return;
            }

            const orgName = treeItem.orgName!;

            const selectedVisibilityOption = await vscode.window.showQuickPick([

                {
                    label: `All Repositories in ${orgName} organization`,
                    visibility: 'all' as CodespaceSecretVisibility
                },
                {
                    label: `All Private Repositories in ${orgName} organization`,
                    visibility: 'private' as CodespaceSecretVisibility
                },
                {
                    label: `Selected Repositories in ${orgName} organization`,
                    visibility: 'selected' as CodespaceSecretVisibility
                },

            ], { title: `Select visibility level for your secret (which repositories should have access to it)` });

            if (!selectedVisibilityOption) {
                return;
            }

            let selectedRepoIds: number[] | undefined = undefined;

            if (selectedVisibilityOption.visibility === 'selected') {

                selectedRepoIds = await this.pickUpOrgRepoIds(orgName, treeItem.secretInfo?.selected_repositories_url, accessToken);
                if (!selectedRepoIds?.length) {
                    return;
                }
            }

            await CodespaceSecretValueProvider.setSecretValue(`orgs/${orgName}`, accessToken, secretName, secretValue, selectedVisibilityOption.visibility, selectedRepoIds);
            
            this.codespacesTreeView.refresh();

            if (!!isUpdating) {
                
                vscode.window.showInformationMessage(`Codespaces secret ${secretName} was updated`);

            } else {

                vscode.window.showInformationMessage(`Codespaces secret ${secretName} was added to ${orgName} organization`);
            }

        }, 'KeeShepherd failed to save Codespaces secret');
    }    

    async createOrUpdateCodespacesRepoSecret(treeItem: CodespacesTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            if (!(
                (treeItem.nodeType === CodespacesNodeTypeEnum.SecretKind && treeItem.secretKind === 'Repository') ||
                (treeItem.nodeType === CodespacesNodeTypeEnum.Secret && !!treeItem.secretInfo)
            )) {
                return;
            }

            let isUpdating = treeItem.nodeType === CodespacesNodeTypeEnum.Secret;

            // This should be at the beginning, since it might require the user to re-authenticate
            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();

            let repoName = '';
            if (!!isUpdating) {
                
                repoName = treeItem.repoName!;

            } else {

                const repos = await CodespaceSecretValueProvider.getUserRepos(accessToken);

                const selectedRepo = await vscode.window.showQuickPick(repos.map(repo => {

                    return { label: repo.fullName };
        
                }), {
                    title: `Select repository`
                });
        
                if (!selectedRepo) {
                    return;
                }

                repoName = selectedRepo.label;
            }

            let secretName = treeItem.secretInfo?.name;

            if (!secretName) {
                
                secretName = await this.askUserForSecretName();
            }

            if (!secretName) {
                return;
            }

            const secretValue = await vscode.window.showInputBox({
                prompt: 'Enter secret value',
                password: true
            });

            if (!secretValue) {
                return;
            }

            await CodespaceSecretValueProvider.setSecretValue(`repos/${repoName}`, accessToken, secretName, secretValue);
            
            this.codespacesTreeView.refresh();

            if (!!isUpdating) {
                
                vscode.window.showInformationMessage(`Codespaces secret ${secretName} was updated`);

            } else {

                vscode.window.showInformationMessage(`Codespaces secret ${secretName} was added`);
            }

        }, 'KeeShepherd failed to save Codespaces secret');
    }    

    async removeCodespacesSecret(treeItem: CodespacesTreeItem): Promise<void> {

        await this.doAndShowError(async () => {

            if (treeItem.nodeType !== CodespacesNodeTypeEnum.Secret) {
                return;
            }

            let secretName = treeItem.label as string;

            const userResponse = await vscode.window.showWarningMessage(
                `Are you sure you want to remove Codespaces secret ${secretName}?`,
                'Yes', 'No');
   
            if (userResponse !== 'Yes') {
                return;
            }

            let secretsUri = '';
            let accessToken = '';

            switch (treeItem.secretKind) {
                case 'Personal':
                    secretsUri = 'user';
                    accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecrets();
                break;
                case 'Organization':
                    secretsUri = `orgs/${treeItem.orgName}`;
                    accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
                break;
                case 'Repository':
                    secretsUri = `repos/${treeItem.repoName}`;
                    accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
                break;
                default:
                    return;
            }

            await CodespaceSecretValueProvider.removeCodespacesSecret(secretsUri, secretName, accessToken);

            this.codespacesTreeView.refresh();
            
            vscode.window.showInformationMessage(`Codespaces secret ${secretName} was removed`);

        }, 'KeeShepherd failed to remove Codespaces secret');
    }

    async copyCodespacesSecretValue(treeItem: CodespacesTreeItem): Promise<void> {

        await this.doAndShowError(async () => {
            
            if (treeItem.nodeType !== CodespacesNodeTypeEnum.Secret || !treeItem.secretInfo?.name) {
                return;
            }

            const secretValue = process.env[treeItem.secretInfo.name];

            if (!secretValue) {
                throw new Error(`${treeItem.secretInfo.name} secret is not available on this machine`);
            }

            vscode.env.clipboard.writeText(secretValue);

            vscode.window.showInformationMessage(`KeeShepherd: value of ${treeItem.secretInfo.name} was copied to Clipboard`);

        }, 'KeeShepherd failed to copy secret value');
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

    private async addKeyVaultSecret(secretName: string, secretValue: string, controlType: ControlTypeEnum, sourceFileName: string): Promise<boolean> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return false;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const keyVaultName = await KeyVaultSecretValueProvider.pickUpKeyVault(subscription);

        if (!keyVaultName) {
            return false;
        }

        // First adding the metadata

        await this._repo.addSecret({
            name: secretName,
            type: SecretTypeEnum.AzureKeyVault,
            controlType,
            filePath: sourceFileName,
            hash: this._repo.calculateHash(secretValue),
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

            const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
            const keyVaultClient = await keyVaultProvider.getKeyVaultClient(subscriptionId, keyVaultName);

            await keyVaultClient.setSecret(secretName, secretValue);
            
        } catch (err) {
            
            // Dropping the just created secret upon failure
            this._repo.removeSecrets(controlType === ControlTypeEnum.EnvVariable ? EnvVariableSpecialPath : sourceFileName, [secretName]);

            throw err;
        }

        return true;
    }

    private async pickUpPersonalRepoIds(selectedReposUrl: string | undefined, accessToken: string): Promise<number[]> {

        const repos = await CodespaceSecretValueProvider.getUserRepos(accessToken);
        const selectedRepos = await CodespaceSecretValueProvider.getReposByUrl(selectedReposUrl, accessToken);
        const selectedRepoIds = selectedRepos.map(repo => repo.id);

        const selectedOptions = await vscode.window.showQuickPick(repos.map(repo => {

            const isSelected = selectedRepoIds.includes(repo.id);

            return {
                label: repo.fullName,
                repoId: repo.id,
                picked: isSelected,
                alwaysShow: true
            };

        }), {
            title: `Select repositories that will have access to this secret`,
            canPickMany: true
        });

        if (!selectedOptions) {
            return [];
        }

        return selectedOptions.map(option => option.repoId);
    }

    private pickUpOrgRepoIds(orgName: string, selectedReposUrl: string | undefined, accessToken: string): Promise<number[]> {
        return new Promise<number[]>((resolve, reject) => {

            let selectedRepoIds: number[] = [];

            const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { repoId: number }>();
            pick.canSelectMany = true;

            pick.onDidHide(() => {

                pick.dispose();
                resolve([]);
            });

            pick.onDidAccept(() => {

                pick.hide();
                resolve(selectedRepoIds);
            });

            pick.onDidChangeSelection(selectedItems => {

                if (!!selectedItems) {
                    selectedRepoIds = selectedItems.map(item => item.repoId);

                    // Marking all selected items as alwaysShow, so that they never get dropped from the view
                    for (const item of selectedItems) {
                        item.alwaysShow = true;
                    }
                    
                } else {
                    selectedRepoIds = [];
                }
            });

            // Tool for querying repositories
            const fetchSuggestedItems = (query: string) => {

                pick.busy = true;

                CodespaceSecretValueProvider.queryRepos(query, orgName, accessToken)
                    .then(repos => {

                        const selectedItems = pick.selectedItems.map(item => {
                            // Need to explicitly mark them as alwaysShow again
                            return { ...item, alwaysShow: true };
                        });

                        const newItems = repos.map(repo => {

                            return {
                                label: repo.fullName,
                                repoId: repo.id,
                                alwaysShow: false
                            };

                        }).filter(item => !selectedRepoIds.includes(item.repoId));

                        pick.items = selectedItems.concat(newItems);

                        // Need to restore selectedItems back to its previous state, otherwise already selected items are not show
                        pick.selectedItems = selectedItems;

                    })
                    .catch(err => {

                        // github search endpoint might produce 403 (which probably means throttling)
                        console.log(err);
                    })
                    .finally(() => {

                        pick.busy = false;
                    });
            };

            pick.onDidChangeValue(fetchSuggestedItems);

            pick.title = `Select ${orgName}'s repositories that will have access to this secret`;
            pick.placeholder = 'start typing repo name...';

            // Preloading previously selected repos
            CodespaceSecretValueProvider.getReposByUrl(selectedReposUrl, accessToken)
                .then(repos => {

                    selectedRepoIds = repos.map(repo => repo.id);

                    pick.items = repos.map(repo => {
                        
                        return {
                            label: repo.fullName,
                            repoId: repo.id,
                            picked: true,
                            alwaysShow: true,
                        };
                    });

                    pick.selectedItems = pick.items;

                })
                .catch(err => {

                    this._log(`Failed to get selected repositories for a Codespaces secret. ${err.message ?? err}`, true, true);
                })
                .finally(() => {

                    // Initially filling with everything (the first page of everything)
                    fetchSuggestedItems('');

                    pick.show();
                });
        });
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

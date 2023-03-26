import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { execSync } from 'child_process';

import { areEnvVariablesSet, askUserForSecretName, Log, timestampToString } from '../helpers';
import { ControlledSecret, ControlTypeEnum, SecretTypeEnum, ShortcutsSpecialMachineName, toDictionary } from '../KeyMetadataHelpers';
import { SecretValuesProvider } from '../SecretValuesProvider';
import { IKeyMetadataRepo } from '../metadata-repositories/IKeyMetadataRepo';
import { TreeViewBase } from './TreeViewBase';

type ShortcutsTreeNodeContextValues = 'shortcuts-root-folder' | 'shortcuts-folder' | 'shortcut';

export type ShortcutsTreeItem = vscode.TreeItem & {
    contextValue: ShortcutsTreeNodeContextValues,
    folderName?: string,
    secret?: ControlledSecret
};

const DefaultShortcutsFolderName = '[Default Shortcuts Folder]';

// Renders the 'Secret Shortcuts' TreeView
export class ShortcutsTreeView extends TreeViewBase implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(
        protected readonly _context: vscode.ExtensionContext,
        private readonly _getRepo: () => IKeyMetadataRepo,
        private readonly _getSecretValuesAndCheckHashes: (secrets: ControlledSecret[]) => Promise<{ secret: ControlledSecret, value: string }[]>,
        private readonly _valuesProvider: SecretValuesProvider,
        resourcesFolder: string,
        log: Log
    ) { 
        super(resourcesFolder, log);
    }

    protected _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
    
    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    // Renders the TreeView
    async getChildren(parent: ShortcutsTreeItem): Promise<ShortcutsTreeItem[]> {

        const result: ShortcutsTreeItem[] = [];

        try {
            switch (parent?.contextValue as ShortcutsTreeNodeContextValues) {
                
                case undefined: {

                    const folders = await this._getRepo().getFolders(ShortcutsSpecialMachineName);

                    for (const folder of folders) {

                        const node = {
                            label: folder,
                            folderName: folder,
                            contextValue: 'shortcuts-folder' as ShortcutsTreeNodeContextValues,
                            collapsibleState: vscode.TreeItemCollapsibleState.Expanded
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }

                    const node = {
                        label: DefaultShortcutsFolderName,
                        folderName: '',
                        tooltip: 'Default Shortcuts Folder',
                        contextValue: 'shortcuts-root-folder' as ShortcutsTreeNodeContextValues,
                        collapsibleState: vscode.TreeItemCollapsibleState.Expanded
                    };

                    result.splice(0, 0, node);
                }
                break;

                case 'shortcuts-folder':                
                case 'shortcuts-root-folder': {

                    const secrets = await this._getRepo().getSecrets(parent.folderName!, true, ShortcutsSpecialMachineName);

                    const existingEnvVars = await areEnvVariablesSet(secrets.map(s => s.name), this._log);

                    for (const secret of secrets) {
                     
                        let description = `${SecretTypeEnum[secret.type]}`;
        
                        let icon = 'secret.svg';
                        let tooltip = timestampToString(secret.timestamp);
                        let label = secret.name;

                        if (!existingEnvVars[secret.name]) {
                            
                            icon = 'secret-stashed.svg';
                            
                        } else {

                            icon = 'secret-unstashed.svg';
                            tooltip = 'mounted as Global Env Variable' + (!tooltip ? '' : ', ') + tooltip;
                        }

                        const azDoPatProps = secret.properties?.azDoPatProperties;
                        if (!!azDoPatProps) {

                            description = `${SecretTypeEnum[SecretTypeEnum.AzureDevOpsPAT]}`;

                            if (!!azDoPatProps.scope) {
                                
                                tooltip = `scopes: '${azDoPatProps.scope}'`;
                            }

                            if (!!azDoPatProps.validTo) {
                                
                                const validToDate = Date.parse(azDoPatProps.validTo);

                                if (!isNaN(validToDate) && new Date(validToDate) < new Date()) {

                                    label = `${secret.name}❗`;
                                    tooltip += `${!tooltip ? '' : ', '}expired`;
                                    
                                } else {

                                    tooltip += `${!tooltip ? '' : ', '}expires ${azDoPatProps.validTo.toString().slice(0, 10)}`;
                                }
                            }
                        }

                        const node = {
                            label,
                            description,
                            tooltip,
                            collapsibleState: vscode.TreeItemCollapsibleState.None,
                            secret,
                            folderName: parent.folderName,
                            contextValue: 'shortcut' as ShortcutsTreeNodeContextValues,
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', icon),
                                dark: path.join(this._resourcesFolder, 'dark', icon),
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.secret?.name! > node.secret?.name!);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
            }
                
        } catch (err) {
            vscode.window.showErrorMessage(`KeeShepherd failed to load the Shortcuts view. ${(err as any).message ?? err}`);
        }
        
        return result;
    }

    async createShortcutsFolder(): Promise<void> {

        const folderName = await vscode.window.showInputBox({
            value: `My Shortcuts Folder ${new Date().getMilliseconds()}`,
            prompt: 'Give your shortcuts folder a name',
    
            validateInput: (n: string) => {
    
                if (!n) {
                    return 'Provide a non-empty secret name';
                }

                if (n === DefaultShortcutsFolderName) {
                    return `A folder named "${n}" already exists. Provide a different name.`;
                }
    
                return null;
            }
        });
    
        if (!folderName) {
            return;
        }

        await this._getRepo().createFolder(folderName);

        this.refresh();
    }

    async removeShortcutsFolder(treeItem: ShortcutsTreeItem): Promise<void> {

        let secretNames;

        switch (treeItem.contextValue) {
            case 'shortcuts-folder':

                secretNames = (await this._getRepo().getSecrets(treeItem.folderName!, true, ShortcutsSpecialMachineName))
                    .map(s => s.name);
                
                break;
            
            case 'shortcut':

                secretNames = [treeItem.secret!.name as string];
                
                break;
            
            default:
                return;
        }

        if (!!secretNames.length) {

            let msg = secretNames.length > 1 ?
                `${secretNames.length} secrets will be dropped from metadata storage. If they were mounted as global environment variables on any other machine, their values will remain there. Do you want to proceed?` :
                `Secret ${secretNames[0]}. If it was mounted as global environment variable on any other machine, its value will remain there. Do you want to proceed?`;

            const userResponse = await vscode.window.showWarningMessage(msg, 'Yes', 'No');
    
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

            await this._getRepo().removeSecrets(treeItem.folderName!, secretNames, ShortcutsSpecialMachineName);
        }

        if (treeItem.contextValue === 'shortcuts-folder') {
            
            await this._getRepo().removeFolder(treeItem.label as string);
        }

        this.refresh();
    }

    async createSecretShortcut(treeItem: ShortcutsTreeItem): Promise<void> {

        if (treeItem.contextValue !== 'shortcuts-folder' && treeItem.contextValue !== 'shortcuts-root-folder') {
            return;
        }

        const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.EnvVariable);

        if (!secret) {
            return;
        }
        
        let localSecretName = !!secret.alreadyAskedForName ? secret.name : await askUserForSecretName(secret.name);
        if (!localSecretName) {
            return;
        }

        // Disallowing duplicates
        const existingSecrets = await this._getRepo().getSecrets(treeItem.folderName!, true, ShortcutsSpecialMachineName);
        if (existingSecrets.some(s => s.name.toLowerCase() === localSecretName!.toLowerCase())) {
            
            throw new Error(`Secret named ${localSecretName} already exists in this folder`);
        }

        // Adding metadata to the repo
        const secretHash = this._getRepo().calculateHash(secret.value);

        await this._getRepo().addSecret({
            name: localSecretName,
            type: secret.type,
            controlType: ControlTypeEnum.EnvVariable,
            filePath: treeItem.folderName!,
            hash: secretHash,
            length: secret.value.length,
            timestamp: new Date(),
            properties: secret.properties
        });

        this.refresh();
    }

    async copySecretValue(treeItem: ShortcutsTreeItem): Promise<void> {

        const secret = treeItem.secret;
        if (!secret) {
            return;
        }

        const secretValue = (await this._getSecretValuesAndCheckHashes([secret]))[0].value;

        if (!secretValue) {
            throw new Error(`Failed to get secret value`);
        }

        vscode.env.clipboard.writeText(secretValue);

        vscode.window.showInformationMessage(`KeeShepherd: value of ${secret.name} was copied to Clipboard`);
    }

    async mountAsGlobalEnv(treeItem: ShortcutsTreeItem): Promise<void> {

        var secrets: ControlledSecret[];

        switch (treeItem?.contextValue) {
            case 'shortcuts-folder':
            case 'shortcuts-root-folder':

                secrets = await this._getRepo().getSecrets(treeItem.folderName!, true, ShortcutsSpecialMachineName);
                break;
            
            case 'shortcut':

                secrets = [treeItem.secret!];
                break;
            
            default:
                return;
        }

        const secretValues = (await this._getSecretValuesAndCheckHashes(secrets));

        const variables: { [n: string]: string } = {};
        for (const pair of secretValues) {

            if (!pair.value) {
                throw new Error(`Failed to get secret value`);
            }

            variables[pair.secret.name] = pair.value;
        }

        await this.setGlobalEnvVariables(variables);

        this.refresh();
        vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets were set as global environment variables. Restart your shell to see the effect.`);
    }

    async unmountAsGlobalEnv(treeItem: ShortcutsTreeItem): Promise<void> {

        var secrets: ControlledSecret[];

        switch (treeItem?.contextValue) {
            case 'shortcuts-folder':
            case 'shortcuts-root-folder':

                secrets = await this._getRepo().getSecrets(treeItem.folderName!, true, ShortcutsSpecialMachineName);
                break;
            
            case 'shortcut':

                secrets = [treeItem.secret!];
                break;
            
            default:
                return;
        }
        
        await this.setGlobalEnvVariables(toDictionary(secrets.map(s => s.name), () => ''));

        this.refresh();
        vscode.window.showInformationMessage(`KeeShepherd: ${secrets.length} secrets were removed from global environment variables. Restart your shell to see the effect.`);
    }

    async openTerminal(treeItem?: ShortcutsTreeItem): Promise<void> {

        let secrets;

        switch (treeItem?.contextValue) {
            case 'shortcuts-folder':
            case 'shortcuts-root-folder':

                secrets = await this._getRepo().getSecrets(treeItem.folderName!, true, ShortcutsSpecialMachineName);
                break;
            
            case 'shortcut':
                return;
            
            default:

                secrets = await this._getRepo().getSecrets('', false, ShortcutsSpecialMachineName);
                break;
        }

        const secretValues = await this._getSecretValuesAndCheckHashes(secrets);

        const env: { [name: string]: string } = {};
        for (const pair of secretValues) {

            env[pair.secret.name] = pair.value;
        }

        const terminal = vscode.window.createTerminal({
            name: `KeeShepherd${!!treeItem ? `: ${treeItem.label}` : ''}` ,
            env
        });
        this._context.subscriptions.push(terminal);

        terminal.show();
    }

    async createFromClipboard(treeItem?: ShortcutsTreeItem): Promise<void> {

        const secretValue = await vscode.env.clipboard.readText();

        if (!secretValue) {
            throw new Error('No text found in Clipboard');
        }

        const secretName = await askUserForSecretName();
        if (!secretName) {
            return;
        }

        // Asking user where to store this secret's value
        const storageUserChoice = await this._valuesProvider.askUserWhereToStoreSecret(secretName);

        if (!storageUserChoice) {
            return;
        }
        
        // First adding the metadata

        await this._getRepo().addSecret({
            name: secretName,
            type: storageUserChoice.secretType,
            controlType: ControlTypeEnum.EnvVariable,
            filePath: treeItem?.folderName ?? '',
            hash: this._getRepo().calculateHash(secretValue),
            length: secretValue.length,
            timestamp: new Date(),
            properties: storageUserChoice.secretProperties
        });

        // Then adding this secret to KeyVault
        try {

            await storageUserChoice.persistRoutine(secretValue);

        } catch (err) {
            
            // Dropping the just created secret upon failure
            await this._getRepo().removeSecrets(treeItem?.folderName ?? '', [secretName], ShortcutsSpecialMachineName);

            throw err;
        }

        this.refresh();
        vscode.window.showInformationMessage(`KeeShepherd created ${secretName} secret with value taken from Clipboard.`);
    }
    
    private async setGlobalEnvVariables(variables: { [n: string] : string | undefined }): Promise<void> {

        if (process.platform === "win32") {

            for (const name of Object.keys(variables)) {
                
                var value = variables[name];
               
                if (!!value) {
                    // Escaping double quotes
                    value = value.replace(/\"/g, `\\"`);
                }
    
                var cmd = `setx ${name} "${value ?? ''}"`;
    
                this._log(`Executing setx ${name} "xxx"`, true, true);
                execSync(cmd);
                this._log(`Succeeded setx ${name} "xxx"`, true, true);
                
                if (!value) {
                    // Also need to remove from registry (otherwise the variable will be left as existing but empty)
    
                    cmd = `reg delete HKCU\\Environment /f /v ${name}`;
    
                    this._log(`Executing ${cmd}`, true, true);
                    execSync(cmd);
                    this._log(`Succeeded executing ${cmd}`, true, true);
                }
            }

        } else {

            await this.addSetEnvVariableCommands(os.homedir() + '/.bashrc', variables);
        }
    }

    private async addSetEnvVariableCommands(filePath: string, variables: { [n: string] : string | undefined }): Promise<void> {

        var fileText = '';
        try {

            fileText = Buffer.from(await fs.promises.readFile(filePath)).toString();
            
        } catch (err) {

            this._log(`Failed to read ${filePath}. ${(err as any).message ?? err}`, true, true);
        }

        var secretsAdded = false;

        for (const name of Object.keys(variables)) {
            
            fileText = fileText.replace(new RegExp(`(\r)?(\n)?export ${name}=.*`, 'g'), '');

            var value = variables[name];
            if (!!value) {
    
                // Escaping double quotes
                value = value.replace(/\"/g, `\\"`);
    
                if (fileText.length > 0 && fileText[fileText.length - 1] != '\n') {
                    fileText += '\n';
                }
                
                fileText += `export ${name}="${value}"`;
                
                secretsAdded = true;
            }
        }
        
        await fs.promises.writeFile(filePath, Buffer.from(fileText));
        this._log(`Secrets ${Object.keys(variables).join(', ')} were ${!!secretsAdded ? 'written to' : 'removed from'} ${filePath}`, true, true);
    }
}
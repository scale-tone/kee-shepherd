import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { SecretTypeEnum, ControlTypeEnum, ControlledSecret, getAnchorName } from '../KeyMetadataHelpers';
import { IKeyMetadataRepo } from '../metadata-repositories/IKeyMetadataRepo';
import { KeeShepherdBase } from '../KeeShepherdBase';
import { Log, timestampToString } from '../helpers';
import { AzureAccountWrapper } from '../AzureAccountWrapper';
import { TreeViewBase } from './TreeViewBase';

export enum KeeShepherdNodeTypeEnum {
    Machine = 1,
    Folder,
    File,
    Secret,
    InitialCommand
}

export type KeeShepherdTreeItem = vscode.TreeItem & {
    
    nodeType: KeeShepherdNodeTypeEnum,
    isLocal: boolean,
    filePath?: string,
    machineName?: string,
    folderUri?: string,
    secret?: ControlledSecret, 
    command?: {
        arguments: ControlledSecret[]
    }
};

// Renders the 'Secrets' TreeView
export class SecretTreeView extends TreeViewBase implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(private _account: AzureAccountWrapper, private _getRepo: () => IKeyMetadataRepo, resourcesFolder: string, log: Log) { 
        super(resourcesFolder, log);
    }

    protected _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    setSecretNodeState(filePath: string, secretName: string, stashed: boolean): void {

        const node = this._secretNodes[filePath + secretName];
        if (!!node) {

            node.iconPath = {
                light: path.join(this._resourcesFolder, 'light', !!stashed ? 'secret-stashed.svg' : 'secret-unstashed.svg'),
                dark: path.join(this._resourcesFolder, 'dark', !!stashed ? 'secret-stashed.svg' : 'secret-unstashed.svg')
            };

            this._onDidChangeTreeData.fire(node);
        }
    }

    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    // Renders the TreeView
    async getChildren(parent: KeeShepherdTreeItem): Promise<KeeShepherdTreeItem[]> {

        const result: KeeShepherdTreeItem[] = [];

        try {

            switch (parent?.nodeType) {
                
                case undefined: {

                    this._secretNodes = {};

                    const machineNames = await this._getRepo().getMachineNames();

                    for (const machineName of machineNames) {
                        
                        const isLocal = machineName.toLowerCase() === os.hostname().toLowerCase();
        
                        const collapsibleState = isLocal ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
        
                        const node = {
                            label: machineName,
                            nodeType: KeeShepherdNodeTypeEnum.Machine,
                            collapsibleState,
                            isLocal,
                            contextValue: !!isLocal ? 'tree-machine-local' : 'tree-machine',
                            description: isLocal ? '(this machine)' : '',
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'machine.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'machine.svg')
                            }
                        };

                        // Sorting by name on the fly, but placing local machine on top
                        const index = result.findIndex(n =>
                            (!n.isLocal && n.label! > node.label) ||
                            !!node.isLocal);
                        
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                case KeeShepherdNodeTypeEnum.Machine: {

                    const workspaceFolders = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) : [];
                    const machineName = parent.label as string;
        
                    const folderUris = await this._getRepo().getFolders(machineName);

                    for (const folderUri of folderUris) {
                        
                        var nodeType = KeeShepherdNodeTypeEnum.Folder;
                        var icon = 'folder.svg';
                        var contextValue = 'tree-folder';

                        var label = decodeURIComponent(folderUri);

                        if (label.startsWith('file:///')) {
                            
                            label = label.substr(8);
                        }
        
                        const collapsibleState = workspaceFolders.includes(folderUri) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
        
                        const node = {
                            label,
                            machineName,
                            nodeType,
                            folderUri,
                            collapsibleState,
                            isLocal: parent.isLocal,
                            contextValue: !!parent.isLocal ? contextValue + '-local' : contextValue,
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', icon),
                                dark: path.join(this._resourcesFolder, 'dark', icon)
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);

                        result.splice(index < 0 ? result.length : index, 0, node);
                    }

                    if (!!parent.isLocal && result.length <= 0) {

                        result.push({
                            label: 'Insert a Supervised Secret...',
                            tooltip: 'Insert a Supervised Secret at current cursor position in the text editor',
                            nodeType: KeeShepherdNodeTypeEnum.InitialCommand,
                            isLocal: true,
                            command: {
                                title: 'Insert a Supervised Secret...',
                                command: 'kee-shepherd-vscode.editor-context.insertSupervisedSecret',
                                arguments: []
                            }
                        });

                        result.push({
                            label: 'Insert a Managed Secret...',
                            tooltip: 'Insert a Managed Secret at current cursor position in the text editor',
                            nodeType: KeeShepherdNodeTypeEnum.InitialCommand,
                            isLocal: true,
                            command: {
                                title: 'Insert a Managed Secret...',
                                command: 'kee-shepherd-vscode.editor-context.insertManagedSecret',
                                arguments: []
                            }
                        });

                        const isSignedIn = await this._account.isSignedIn();
                        if (!isSignedIn) {

                            result.push({
                                label: 'Sign in to Azure...',
                                nodeType: KeeShepherdNodeTypeEnum.InitialCommand,
                                isLocal: true,
                                command: {
                                    title: 'Sign in to Azure...',
                                    command: 'kee-shepherd-vscode.signInToAzure',
                                    arguments: []
                                }
                            });
                        }
                    }
                }
                break;
                case KeeShepherdNodeTypeEnum.Folder: {

                    const folderUri = parent.folderUri!;
                    const secrets = await this._getRepo().getSecrets(folderUri, false, parent.machineName);
        
                    const filePaths: any = {};
                    for (var secret of secrets) {

                        const fileName = path.basename(secret.filePath);
                        const fileFolderUri = secret.filePath.substr(0, secret.filePath.length - fileName.length - 1);
                        if (fileFolderUri.toLowerCase() === folderUri.toLowerCase()) {
        
                            filePaths[secret.filePath] = decodeURIComponent(fileName);                    
                        }
                    }

                    for (const filePath of Object.keys(filePaths)) {
                        
                        const node = {
                            label: filePaths[filePath],
                            filePath,
                            machineName: parent.machineName,
                            nodeType: KeeShepherdNodeTypeEnum.File,
                            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                            isLocal: parent.isLocal,
                            contextValue: !!parent.isLocal ? 'tree-file-local' : 'tree-file',
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'file.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'file.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                case KeeShepherdNodeTypeEnum.File: {

                    // Obtaining the file text in parallel
                    const fileTextPromise = !parent.isLocal ?
                        Promise.resolve('') :
                        KeeShepherdBase.readFile(vscode.Uri.parse(parent.filePath!))
                            .then(r => r.text)
                            .catch(() => '');

                    const secrets = await this._getRepo().getSecrets(parent.filePath!, true, parent.machineName);

                    for (const secret of secrets) {

                        const description = `${ControlTypeEnum[secret.controlType]}, ${SecretTypeEnum[secret.type]}`;
        
                        // This is what happens when this tree node is being clicked
                        const command = !!parent.isLocal ? {
                            title: 'Open',
                            command: 'kee-shepherd-vscode.view-context.gotoSecret',
                            arguments: [secret]
                        } : undefined;

                        var icon = 'secret.svg';
                        var tooltip = timestampToString(secret.timestamp);

                        if (secret.controlType === ControlTypeEnum.Supervised) {
                            
                            var icon = 'secret-supervised.svg';

                        } else {

                            const fileText = await fileTextPromise;
                            if (!!fileText) {

                                const anchorName = getAnchorName(secret.name);

                                if (fileText.includes(anchorName)) {
                                    
                                    icon = 'secret-stashed.svg';
                                    tooltip = 'stashed' + (!tooltip ? '' : ', ') + tooltip;

                                } else {

                                    icon = 'secret-unstashed.svg';
                                    tooltip = 'unstashed' + (!tooltip ? '' : ', ') + tooltip;
                                }
                            }
                        }

                        const node = {
                            label: secret.name,
                            description,
                            tooltip,
                            nodeType: KeeShepherdNodeTypeEnum.Secret,
                            collapsibleState: vscode.TreeItemCollapsibleState.None,
                            secret,
                            command,
                            isLocal: parent.isLocal,
                            contextValue: !!parent.isLocal ? 'tree-secret-local' : 'tree-secret',
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', icon),
                                dark: path.join(this._resourcesFolder, 'dark', icon)
                            }
                        };

                        if (!!parent.isLocal) {

                            // Also saving this node in the secrets node map, to be able to refresh these tree nodes later
                            this._secretNodes[secret.filePath + secret.name] = node;
                        }

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
            }
                
        } catch (err) {
            vscode.window.showErrorMessage(`KeeShepherd failed to load the secrets view. ${(err as any).message ?? err}`);
        }

        return result;
    }

    private _secretNodes: { [id: string]: { iconPath: { light: string, dark: string } } } = {};

}
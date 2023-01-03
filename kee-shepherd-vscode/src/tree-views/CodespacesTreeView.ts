import axios from 'axios';
import * as path from 'path';
import * as vscode from 'vscode';

import { askUserForSecretName, Log } from '../helpers';
import { ControlTypeEnum } from '../KeyMetadataHelpers';
import { CodespaceSecretKind, CodespaceSecretKinds, CodespaceSecretInfo, CodespaceSecretValueProvider, CodespaceSecretVisibility, GitHubActionsSecretKinds, GitHubActionsSecretKind } from '../secret-value-providers/CodespaceSecretValueProvider';
import { SecretValuesProvider } from '../SecretValuesProvider';

export enum CodespacesNodeTypeEnum {
    CodespacesSecrets = 1,
    ActionsSecrets,

    CodespaceSecretKind,
    ActionsSecretKind,

    CodespacesOrganizationSecrets,
    CodespacesRepositorySecrets,

    ActionsOrganizationSecrets,
    ActionsRepositorySecrets,
    ActionsEnvironmentRepository,

    Secret,
    ActionsEnvironment,
    SecretRepository
}

export type CodespacesTreeItem = vscode.TreeItem & {
    
    nodeType: CodespacesNodeTypeEnum,
    secretKind?: CodespaceSecretKind | GitHubActionsSecretKind,
    secrets?: CodespaceSecretInfo[],
    orgName?: string,
    repoName?: string,
    repoId?: number,
    envName?: string,
    secretInfo?: CodespaceSecretInfo,
    environments?: string[]
};

// Renders the 'Codespaces Secrets' TreeView
export class CodespacesTreeView implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(
        private readonly _valuesProvider: SecretValuesProvider,
        private readonly _resourcesFolder: string,
        private readonly _log: Log
    ) { }

    protected _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
    
    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    // Renders the TreeView
    async getChildren(parent: CodespacesTreeItem): Promise<CodespacesTreeItem[]> {

        let result: CodespacesTreeItem[] = [];

        try {

            switch (parent?.nodeType) {
                
                case undefined: {

                    result.push({
                        label: `Codespaces`,
                        nodeType: CodespacesNodeTypeEnum.CodespacesSecrets,
                        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                    });

                    result.push({
                        label: `Actions`,
                        nodeType: CodespacesNodeTypeEnum.ActionsSecrets,
                        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                    });
                }
                break;
                case CodespacesNodeTypeEnum.CodespacesSecrets: {

                    result = CodespaceSecretKinds.map(secretKind => {

                        return {
                            label: `${secretKind} Secrets`,
                            secretKind,
                            contextValue: `codespaces-${secretKind.toLowerCase()}-secrets`,
                            nodeType: CodespacesNodeTypeEnum.CodespaceSecretKind,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                        };
                    });

                }
                break;
                case CodespacesNodeTypeEnum.ActionsSecrets: {

                    result = GitHubActionsSecretKinds.map(secretKind => {

                        return {
                            label: `${secretKind} Secrets`,
                            secretKind,
                            contextValue: `github-actions-${secretKind.toLowerCase()}-secrets`,
                            nodeType: CodespacesNodeTypeEnum.ActionsSecretKind,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                        };
                    });

                }
                break;
                case CodespacesNodeTypeEnum.CodespaceSecretKind: {

                    switch (parent.secretKind) {
                        case 'Personal': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecrets();
                            const secrets = await CodespaceSecretValueProvider.getCodespacesSecrets(`user`, accessToken);

                            for (const secret of secrets) {

                                const isAvailable = !!process.env[secret.name];

                                const node = {
                                    label: secret.name,
                                    secretInfo: secret,
                                    tooltip: `visibility: ${secret.visibility}, created ${secret.created_at.slice(0, 19)}`,
                                    nodeType: CodespacesNodeTypeEnum.Secret,
                                    secretKind: 'Personal' as CodespaceSecretKind,
                                    contextValue: 'codespaces-personal-secret',
                                    collapsibleState: !!secret.selected_repositories_url ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        
                                    iconPath: {
                                        light: path.join(this._resourcesFolder, 'light', isAvailable ? 'secret-unstashed.svg' : 'secret.svg'),
                                        dark: path.join(this._resourcesFolder, 'dark', isAvailable ? 'secret-unstashed.svg' : 'secret.svg')
                                    }
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }

                        }
                        break;
                        case 'Organization': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
                            const orgs = await CodespaceSecretValueProvider.getUserOrgs(accessToken);

                            for (const org of orgs) {
                                
                                const node = {
                                    label: org,
                                    orgName: org,
                                    nodeType: CodespacesNodeTypeEnum.CodespacesOrganizationSecrets,
                                    contextValue: 'codespaces-organization',
                                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }
                            
                        }
                        break;
                        case 'Repository': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
                            const repos = (await CodespaceSecretValueProvider.getUserRepos(accessToken)).map(r => r.fullName);

                            // Only showing repos with secrets in them, so need to load secrets for each repo right away
                            const promises = repos.map(repoFullName => CodespaceSecretValueProvider.getCodespacesSecrets(`repos/${repoFullName}`, accessToken).then(secrets => {
                                return {
                                    repoFullName,
                                    secrets
                                };
                            }).catch(err => {
                                return undefined;
                            }));

                            const reposAndSecrets = (await Promise.all(promises)).filter(res => !!(res?.secrets?.length));
                            
                            for (const repo of reposAndSecrets) {
                                
                                const node = {
                                    label: repo!.repoFullName,
                                    repoName: repo!.repoFullName,
                                    nodeType: CodespacesNodeTypeEnum.CodespacesRepositorySecrets,
                                    contextValue: 'codespaces-repository',
                                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                    secrets: repo!.secrets
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }
                        }
                        break;
                    }
                }
                break;
                case CodespacesNodeTypeEnum.ActionsSecretKind: {

                    switch (parent.secretKind) {
                        case 'Organization': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
                            const orgs = await CodespaceSecretValueProvider.getUserOrgs(accessToken);

                            for (const org of orgs) {
                                
                                const node = {
                                    label: org,
                                    orgName: org,
                                    nodeType: CodespacesNodeTypeEnum.ActionsOrganizationSecrets,
                                    contextValue: 'github-actions-organization',
                                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }
                        }
                        break;
                        case 'Repository': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
                            const repos = (await CodespaceSecretValueProvider.getUserRepos(accessToken));

                            // Only showing repos with secrets in them, so need to load secrets for each repo right away
                            const promises = repos.map(
                                repo => CodespaceSecretValueProvider.getActionsSecrets(`repos/${repo.fullName}/actions`, accessToken)
                                    .then(secrets => {
                                        return {
                                            repoFullName: repo.fullName,
                                            repoId: repo.id,
                                            secrets
                                        };
                                    }).catch(err => {
                                        return undefined;
                                    })
                            );

                            const reposAndSecrets = (await Promise.all(promises)).filter(res => !!(res?.secrets?.length));
                            
                            for (const repo of reposAndSecrets) {
                                
                                const node = {
                                    label: repo!.repoFullName,
                                    repoName: repo!.repoFullName,
                                    repoId: repo!.repoId,
                                    nodeType: CodespacesNodeTypeEnum.ActionsRepositorySecrets,
                                    contextValue: 'github-actions-repository',
                                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                    secrets: repo!.secrets
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }
                        }
                        break;
                        case 'Environment': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
                            const repos = (await CodespaceSecretValueProvider.getUserRepos(accessToken));

                            // Only showing repos with environments in them, so need to load environments for each repo right away
                            const promises = repos.map(
                                repo => this.getEnvironments(repo.fullName, accessToken)
                                    .then(environments => {
                                        return {
                                            repoFullName: repo.fullName,
                                            repoId: repo.id,
                                            environments
                                        };
                                    }).catch(err => {
                                        return undefined;
                                    })
                            );

                            const reposAndEnvironments = (await Promise.all(promises)).filter(res => !!(res?.environments?.length));
                            
                            for (const repo of reposAndEnvironments) {
                                
                                const node = {
                                    label: repo!.repoFullName,
                                    repoName: repo!.repoFullName,
                                    repoId: repo!.repoId,
                                    nodeType: CodespacesNodeTypeEnum.ActionsEnvironmentRepository,
                                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                    environments: repo!.environments
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }
                        }
                        break;
                    }
                }
                break;
                case CodespacesNodeTypeEnum.CodespacesOrganizationSecrets: {

                    const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
                    const secrets = await CodespaceSecretValueProvider.getCodespacesSecrets(`orgs/${parent.label}`, accessToken);

                    for (const secret of secrets) {

                        const isAvailable = !!process.env[secret.name];

                        const node = {
                            label: secret.name,
                            orgName: parent.orgName,
                            secretInfo: secret,
                            tooltip: `visibility: ${secret.visibility}, created ${secret.created_at.slice(0, 19)}`,
                            nodeType: CodespacesNodeTypeEnum.Secret,
                            secretKind: 'Organization' as CodespaceSecretKind,
                            contextValue: 'codespaces-organization-secret',
                            collapsibleState: !!secret.selected_repositories_url ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,

                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', isAvailable ? 'secret-unstashed.svg' : 'secret.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', isAvailable ? 'secret-unstashed.svg' : 'secret.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                case CodespacesNodeTypeEnum.CodespacesRepositorySecrets: {

                    if (!parent.secrets) {
                        return result;
                    }

                    for (const secret of parent.secrets) {

                        const isAvailable = !!process.env[secret.name];

                        const node = {
                            label: secret.name,
                            repoName: parent.repoName,
                            secretInfo: secret,
                            tooltip: `created ${secret.created_at.slice(0, 19)}`,
                            nodeType: CodespacesNodeTypeEnum.Secret,
                            secretKind: 'Repository' as CodespaceSecretKind,
                            contextValue: 'codespaces-repository-secret',
                            collapsibleState: vscode.TreeItemCollapsibleState.None,

                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', isAvailable ? 'secret-unstashed.svg' : 'secret.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', isAvailable ? 'secret-unstashed.svg' : 'secret.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                
                case CodespacesNodeTypeEnum.ActionsOrganizationSecrets: {

                    const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
                    const secrets = await CodespaceSecretValueProvider.getActionsSecrets(`orgs/${parent.label}/actions`, accessToken);

                    for (const secret of secrets) {

                        const node = {
                            label: secret.name,
                            orgName: parent.orgName,
                            secretInfo: secret,
                            tooltip: `visibility: ${secret.visibility}, created ${secret.created_at.slice(0, 19)}`,
                            nodeType: CodespacesNodeTypeEnum.Secret,
                            secretKind: 'Organization' as CodespaceSecretKind,
                            contextValue: 'github-actions-organization-secret',
                            collapsibleState: !!secret.selected_repositories_url ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,

                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'secret.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'secret.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;

                case CodespacesNodeTypeEnum.ActionsRepositorySecrets: {

                    if (!parent.secrets) {
                        return result;
                    }

                    for (const secret of parent.secrets) {

                        const node = {
                            label: secret.name,
                            repoName: parent.repoName,
                            secretInfo: secret,
                            tooltip: `created ${secret.created_at.slice(0, 19)}`,
                            nodeType: CodespacesNodeTypeEnum.Secret,
                            secretKind: 'Repository' as CodespaceSecretKind,
                            contextValue: 'github-actions-repository-secret',
                            collapsibleState: vscode.TreeItemCollapsibleState.None,

                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'secret.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'secret.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;

                case CodespacesNodeTypeEnum.ActionsEnvironmentRepository: {

                    if (!parent.environments) {
                        return result;
                    }

                    for (const environment of parent.environments) {

                        const node = {
                            label: environment,
                            envName: environment,
                            repoName: parent.repoName,
                            repoId: parent.repoId,
                            nodeType: CodespacesNodeTypeEnum.ActionsEnvironment,
                            contextValue: 'github-actions-environment',
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;

                case CodespacesNodeTypeEnum.ActionsEnvironment: {

                    const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
                    const secrets = await CodespaceSecretValueProvider.getActionsSecrets(`repositories/${parent.repoId}/environments/${parent.label}`, accessToken);

                    for (const secret of secrets) {

                        const node = {
                            label: secret.name,
                            repoName: parent.repoName,
                            repoId: parent.repoId,
                            envName: parent.envName,
                            secretInfo: secret,
                            tooltip: `visibility: ${secret.visibility}, created ${secret.created_at.slice(0, 19)}`,
                            nodeType: CodespacesNodeTypeEnum.Secret,
                            secretKind: 'Environment' as GitHubActionsSecretKind,
                            contextValue: 'github-actions-environment-secret',
                            collapsibleState: vscode.TreeItemCollapsibleState.None,

                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'secret.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'secret.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                
                case CodespacesNodeTypeEnum.Secret: {

                    if (!parent.secretInfo?.selected_repositories_url) {
                        return result;
                    }

                    const accessToken = parent.secretKind === 'Organization' ?
                        (await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets()) :
                        (await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecretsAndRepos());

                    const repos = await CodespaceSecretValueProvider.getReposByUrl(parent.secretInfo.selected_repositories_url, accessToken);

                    for (const repo of repos) {

                        const node = {
                            label: repo.fullName,
                            tooltip: `has access to ${parent.label} secret`,
                            nodeType: CodespacesNodeTypeEnum.SecretRepository,
                            collapsibleState: vscode.TreeItemCollapsibleState.None,
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
            }   

        } catch (err: any) {
            vscode.window.showErrorMessage(`KeeShepherd failed to load the Codespaces Secrets view. ${err.message ?? err}`);
        }
        
        return result;
    }

    async createOrUpdateCodespacesPersonalSecret(treeItem: CodespacesTreeItem, pickUpSecretValue: boolean = false): Promise<void> {

        let isUpdating = treeItem.nodeType === CodespacesNodeTypeEnum.Secret;

        // This should be at the beginning, since it might require the user to re-authenticate
        const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecretsAndRepos();

        let secretName;
        let secretValue;

        if (!!pickUpSecretValue) {

            const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
            if (!secret) {
                return;
            }

            if (!secretName) {
                secretName = !!secret.alreadyAskedForName ? secret.name : await askUserForSecretName(secret.name);
            }
            if (!secretName) {
                return;
            }
            
            secretValue = secret.value;
            
        } else {

            if (!secretName) {
                secretName = await askUserForSecretName();
            }
            if (!secretName) {
                return;
            }
    
            secretValue = await vscode.window.showInputBox({
                prompt: 'Enter secret value',
                password: true
            });
        }

        if (!secretValue) {
            return;
        }

        const selectedRepoIds = await CodespacesTreeView.pickUpPersonalRepoIds(treeItem.secretInfo?.selected_repositories_url, accessToken);
        if (!selectedRepoIds?.length) {
            return;
        }

        const selectedRepoIdsAsStrings = selectedRepoIds.map(id => id.toString());

        await CodespaceSecretValueProvider.setSecretValue('user/codespaces', accessToken, secretName, secretValue, undefined, selectedRepoIdsAsStrings);
        
        this.refresh();

        if (!!isUpdating) {
            
            vscode.window.showInformationMessage(`Secret ${secretName} was updated`);

        } else {

            vscode.window.showInformationMessage(`Secret ${secretName} was added`);
        }
    }    

    async createOrUpdateActionsEnvironmentSecret(treeItem: CodespacesTreeItem, pickUpSecretValue: boolean = false): Promise<void> {

        let isUpdating = treeItem.nodeType === CodespacesNodeTypeEnum.Secret;

        // This should be at the beginning, since it might require the user to re-authenticate
        const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();

        let secretName = treeItem.secretInfo?.name;
        let secretValue;

        if (!!pickUpSecretValue) {

            const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
            if (!secret) {
                return;
            }

            if (!secretName) {
                secretName = !!secret.alreadyAskedForName ? secret.name : await askUserForSecretName(secret.name);
            }
            if (!secretName) {
                return;
            }
            
            secretValue = secret.value;
            
        } else {

            if (!secretName) {
                secretName = await askUserForSecretName();
            }
            if (!secretName) {
                return;
            }
    
            secretValue = await vscode.window.showInputBox({
                prompt: 'Enter secret value',
                password: true
            });
        }

        if (!secretValue) {
            return;
        }

        await CodespaceSecretValueProvider.setSecretValue(`repositories/${treeItem.repoId}/environments/${treeItem.envName}`, accessToken, secretName, secretValue, undefined);
        
        this.refresh();

        if (!!isUpdating) {
            
            vscode.window.showInformationMessage(`Secret ${secretName} was updated`);

        } else {

            vscode.window.showInformationMessage(`Secret ${secretName} was added`);
        }
    }    
    
    async createOrUpdateOrgSecret(treeItem: CodespacesTreeItem, isCodespacesSecret: boolean, pickUpSecretValue: boolean = false): Promise<void> {

        let isUpdating = treeItem.nodeType === CodespacesNodeTypeEnum.Secret;

        // This should be at the beginning, since it might require the user to re-authenticate
        const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgAndRepoSecrets();

        let secretName = treeItem.secretInfo?.name;
        let secretValue;

        if (!!pickUpSecretValue) {

            const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
            if (!secret) {
                return;
            }

            if (!secretName) {
                secretName = !!secret.alreadyAskedForName ? secret.name : await askUserForSecretName(secret.name);
            }
            if (!secretName) {
                return;
            }
            
            secretValue = secret.value;
            
        } else {

            if (!secretName) {
                secretName = await askUserForSecretName();
            }
            if (!secretName) {
                return;
            }
    
            secretValue = await vscode.window.showInputBox({
                prompt: 'Enter secret value',
                password: true
            });
        }

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

            selectedRepoIds = await CodespacesTreeView.pickUpOrgRepoIds(orgName, treeItem.secretInfo?.selected_repositories_url, accessToken, this._log);
            if (!selectedRepoIds?.length) {
                return;
            }
        }

        await CodespaceSecretValueProvider.setSecretValue(`orgs/${orgName}/${isCodespacesSecret ? 'codespaces' : 'actions'}`, accessToken, secretName, secretValue, selectedVisibilityOption.visibility, selectedRepoIds);
        
        this.refresh();

        if (!!isUpdating) {
            
            vscode.window.showInformationMessage(`Secret ${secretName} was updated`);

        } else {

            vscode.window.showInformationMessage(`Secret ${secretName} was added to ${orgName} organization`);
        }
    }    

    async createOrUpdateRepoSecret(treeItem: CodespacesTreeItem, isCodespacesSecret: boolean, pickUpSecretValue: boolean = false): Promise<void> {

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
        let secretValue;

        if (!!pickUpSecretValue) {

            const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
            if (!secret) {
                return;
            }

            if (!secretName) {
                secretName = !!secret.alreadyAskedForName ? secret.name : await askUserForSecretName(secret.name);
            }
            if (!secretName) {
                return;
            }
            
            secretValue = secret.value;
            
        } else {

            if (!secretName) {
                secretName = await askUserForSecretName();
            }
            if (!secretName) {
                return;
            }
    
            secretValue = await vscode.window.showInputBox({
                prompt: 'Enter secret value',
                password: true
            });
        }

        if (!secretValue) {
            return;
        }

        await CodespaceSecretValueProvider.setSecretValue(`repos/${repoName}/${isCodespacesSecret ? 'codespaces' : 'actions'}`, accessToken, secretName, secretValue);
        
        this.refresh();

        if (!!isUpdating) {
            
            vscode.window.showInformationMessage(`Secret ${secretName} was updated`);

        } else {

            vscode.window.showInformationMessage(`Secret ${secretName} was added`);
        }
    }    
    
    async removeSecret(treeItem: CodespacesTreeItem): Promise<void> {

        let secretName = treeItem.label as string;

        const userResponse = await vscode.window.showWarningMessage(
            `Are you sure you want to remove secret ${secretName}?`,
            'Yes', 'No');

        if (userResponse !== 'Yes') {
            return;
        }

        const isCodespacesSecret = treeItem.contextValue?.startsWith('codespaces');

        let secretsUri = '';
        let accessToken = '';

        switch (treeItem.secretKind) {
            case 'Environment':
                secretsUri = `repositories/${treeItem.repoId}/environments/${treeItem.envName}`;
                accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
            break;
            case 'Personal':
                secretsUri = `user/codespaces`;
                accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecrets();
            break;
            case 'Organization':
                secretsUri = `orgs/${treeItem.orgName}/${isCodespacesSecret ? 'codespaces' : 'actions'}`;
                accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
            break;
            case 'Repository':
                secretsUri = `repos/${treeItem.repoName}/${isCodespacesSecret ? 'codespaces' : 'actions'}`;
                accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
            break;
            default:
                return;
        }

        await axios.delete(`https://api.github.com/${secretsUri}/secrets/${secretName}`, CodespaceSecretValueProvider.getRequestHeaders(accessToken));        

        this.refresh();
        
        vscode.window.showInformationMessage(`Secret ${secretName} was removed`);
    }

    async copyCodespacesSecretValue(treeItem: CodespacesTreeItem): Promise<void> {

        if (!treeItem.secretInfo?.name) {
            return;
        }

        const secretValue = process.env[treeItem.secretInfo.name];

        if (!secretValue) {
            throw new Error(`${treeItem.secretInfo.name} secret is not available on this machine`);
        }

        vscode.env.clipboard.writeText(secretValue);

        vscode.window.showInformationMessage(`KeeShepherd: value of ${treeItem.secretInfo.name} was copied to Clipboard`);
    }

    static async pickUpPersonalRepoIds(selectedReposUrl: string | undefined, accessToken: string): Promise<number[]> {

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

    static pickUpOrgRepoIds(orgName: string, selectedReposUrl: string | undefined, accessToken: string, log: Log): Promise<number[]> {
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

                    log(`Failed to get selected repositories for a Codespaces secret. ${err.message ?? err}`, true, true);
                })
                .finally(() => {

                    // Initially filling with everything (the first page of everything)
                    fetchSuggestedItems('');

                    pick.show();
                });
        });
    }

    private async getEnvironments(repoUri: string, accessToken: string): Promise<string[]> {

        const result: string[] = [];

        let pageNr = 0;
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const response = await axios.get(`https://api.github.com/repos/${repoUri}/environments?per_page=100&page=${pageNr}`, CodespaceSecretValueProvider.getRequestHeaders(accessToken));

            const nextBatch = response.data?.environments;
            if (!nextBatch?.length) {
                break;
            }

            result.push(...nextBatch.map((e: any) => e.name));
        }

        return result;
    }
}
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as util from 'util';
import axios from "axios";

const sodium = require('libsodium-wrappers');

const execAsync = util.promisify(cp.exec);

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { getAuthSession, Log } from '../helpers';

export const CodespaceSecretKinds = ['Personal', 'Organization', 'Repository'] as const;
export type CodespaceSecretKind = typeof CodespaceSecretKinds[number];

export const GitHubActionsSecretKinds = ['Environment', 'Organization', 'Repository'] as const;
export type GitHubActionsSecretKind = typeof GitHubActionsSecretKinds[number];

export const CodespaceSecretVisibilities = ['all', 'private', 'selected'] as const;
export type CodespaceSecretVisibility = typeof CodespaceSecretVisibilities[number];

export type CodespaceSecretInfo = { name: string, created_at: string, updated_at: string, visibility: string, selected_repositories_url?: string };

// Implements picking and retrieving secret values from GitHub Codespace Secrets
export class CodespaceSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper, private _log: Log) { }

    async getSecretValue(secret: SecretReference): Promise<string> {

        const name = secret.properties?.name ?? secret.name;

        // Codespace Secrets appear as env variables, so we just take the value from there
        return process.env[name] as string;
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const secretKindOptions = [
            {
                label: 'Personal',
                secretKind: 'Personal' as CodespaceSecretKind
            },
            {
                label: 'Organization',
                secretKind: 'Organization' as CodespaceSecretKind
            }
        ];
        
        const githubRepoName = await this.getGitHubRepoFullName();
        if (!!githubRepoName) {
            
            secretKindOptions.push({
                label: `Repository (${githubRepoName})`,
                secretKind: 'Repository' as CodespaceSecretKind
            });
        }
        
        const secretKindSelectedOption = (await vscode.window.showQuickPick(secretKindOptions, { title: 'Select Codespaces Secret Kind' }));
        if (!secretKindSelectedOption) {
            return;
        }
        
        const secretKind = secretKindSelectedOption.secretKind;
        let secretName = '';

        let options: { label: string, kind?: vscode.QuickPickItemKind, detail?: string, secretInfo?: CodespaceSecretInfo }[] = [];

        switch (secretKind) {
            case 'Personal':
                options = await this.getQuickPickOptionsForPersonalSecrets();
            break;
            case 'Organization':
                options = await this.getQuickPickOptionsForOrganizationSecrets();
            break;
            case 'Repository':
                options = await this.getQuickPickOptionsForRepoSecrets(githubRepoName);
            break;
        }

        if (!options.length) {

            throw new Error(`No Codespaces ${secretKind} secrets found`);
        }
    
        const selectedOption = await vscode.window.showQuickPick(options, { title: 'Select Codespaces Secret' });
        if (!selectedOption) {
            return;
        }
        
        secretName = selectedOption.label;

        const secretValue = process.env[secretName];
        if (!secretValue) {

            throw new Error(`Failed to get the value of ${secretName}. If you just created it, you might need to reload your Codespaces instance for that secret to take effect. Also make sure that this secret is available for current repository.`);
        }

        return {
            type: SecretTypeEnum.Codespaces,
            name: secretName,
            value: secretValue!,
            properties: {
                name: secretName,
                kind: secretKind,
                createdAt: selectedOption.secretInfo?.created_at,
                updatedAt: selectedOption.secretInfo?.updated_at,
                visibility: selectedOption.secretInfo?.visibility,
                selectedRepositoriesUri: selectedOption.secretInfo?.selected_repositories_url
            }
        };
    }

    static async getCodespacesSecrets(secretsUri: string, accessToken: string): Promise<CodespaceSecretInfo[]> {

        const result: CodespaceSecretInfo[] = [];

        let pageNr = 0;
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const response = await axios.get(`https://api.github.com/${secretsUri}/codespaces/secrets?per_page=100&page=${pageNr}`, this.getRequestHeaders(accessToken));

            const nextBatch = response.data?.secrets;
            if (!nextBatch?.length) {
                break;
            }

            result.push(...nextBatch);
        }

        return result;
    }

    static async getActionsSecrets(secretsUri: string, accessToken: string): Promise<CodespaceSecretInfo[]> {

        const result: CodespaceSecretInfo[] = [];

        let pageNr = 0;
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const response = await axios.get(`https://api.github.com/${secretsUri}/secrets?per_page=100&page=${pageNr}`, this.getRequestHeaders(accessToken));

            const nextBatch = response.data?.secrets;
            if (!nextBatch?.length) {
                break;
            }

            result.push(...nextBatch);
        }

        return result;
    }

    static async getGithubAccessTokenForPersonalSecrets(): Promise<string> {

        const githubSession = await getAuthSession('github', ['codespace:secrets'] );
        return githubSession.accessToken;        
    }

    static async getGithubAccessTokenForPersonalSecretsAndRepos(): Promise<string> {

        const githubSession = await getAuthSession('github', ['codespace:secrets repo'] );
        return githubSession.accessToken;        
    }

    static async getGithubAccessTokenForOrgSecrets(): Promise<string> {

        const githubSession = await getAuthSession('github', ['user admin:org']);
        return githubSession.accessToken;        
    }

    static async getGithubAccessTokenForRepoSecrets(): Promise<string> {

        const githubSession = await getAuthSession('github', ['repo'] );
        return githubSession.accessToken;        
    }

    static async getGithubAccessTokenForOrgAndRepoSecrets(): Promise<string> {

        const githubSession = await getAuthSession('github', ['user admin:org repo']);
        return githubSession.accessToken;        
    }    

    static async getUserOrgs(accessToken: string): Promise<string[]> {

        const result: string[] = [];

        let pageNr = 0;
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const response = await axios.get(`https://api.github.com/user/orgs?per_page=100&page=${pageNr}`, CodespaceSecretValueProvider.getRequestHeaders(accessToken));

            const nextBatch: { login: string }[] = response.data;
            if (!nextBatch?.length) {
                break;
            }

            result.push(...nextBatch.map(b => b.login));
        }

        return result;
    }

    static async getUserRepos(accessToken: string): Promise<{ id: number, fullName: string }[]> {

        const result: { id: number, fullName: string }[] = [];

        let pageNr = 0;
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const response = await axios.get(`https://api.github.com/user/repos?affiliation=owner,collaborator&per_page=100&page=${pageNr}`, CodespaceSecretValueProvider.getRequestHeaders(accessToken));

            const nextBatch: { id: number, full_name: string }[] = response.data;
            if (!nextBatch?.length) {
                break;
            }

            result.push(...nextBatch.map(b => {
                return { id: b.id, fullName: b.full_name };
            }));
        }

        return result;
    }

    private async getGitHubRepoFullName(): Promise<string> {

        const projectFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
        if (!projectFolder) {
            return '';
        }

        // looking for .git folder
        var localGitFolder = projectFolder;
        while (!fs.existsSync(path.join(localGitFolder, '.git'))) {
        
            const parentFolder = path.dirname(localGitFolder);

            if (!parentFolder || localGitFolder === parentFolder) {
                return '';
            }

            localGitFolder = parentFolder;
        }

        let originUrl = '';
        try {

            const execParams = { env: { GIT_DIR: path.join(localGitFolder, '.git') } };

            originUrl = (await execAsync('git config --get remote.origin.url', execParams))
                .stdout
                .toString()
                .replace(/\n+$/, '') // trims end-of-line, if any
                .replace(/\/+$/, ''); // trims the trailing slash, if any
                    
        } catch (err: any) {

            this._log(`Failed to get remote origin URL. ${err.message ?? err}`, true, true);
            
            return '';
        }

        // Dropping credentials, if any
        originUrl = originUrl.replace(/:\/\/[^\/]*@/i, '://');

        if (originUrl.toLowerCase().endsWith('.git')) {
            originUrl = originUrl.substring(0, originUrl.length - 4);
        }

        const githubUrl = 'https://github.com/';
        if (!originUrl.toLowerCase().startsWith(githubUrl)) {

            this._log(`Remote origin URL (${originUrl}) does not look like a GitHub repo`, true, true);
            
            return '';
        }

        return originUrl.substring(githubUrl.length);
    }

    static async setSecretValue(url: string,
        accessToken: string,
        secretName: string,
        secretValue: string,
        visibility?: CodespaceSecretVisibility,
        selectedRepoIds?: (string | number)[]
    ): Promise<void> {

        const publicKeyUrl = `https://api.github.com/${url}/secrets/public-key`;
        const publicKeyResponse = await axios.get(publicKeyUrl, CodespaceSecretValueProvider.getRequestHeaders(accessToken));
        const publicKey: { key_id: string, key: string } = publicKeyResponse.data;

        const keyBytes = Buffer.from(publicKey.key, 'base64');
        const secretValueBytes = Buffer.from(secretValue);

        await sodium.ready;

        const encryptedBytes = sodium.crypto_box_seal(secretValueBytes, keyBytes);
        const encryptedSecretValue = Buffer.from(encryptedBytes).toString('base64');

        const putSecretBody: any = {
            encrypted_value: encryptedSecretValue,
            key_id: publicKey.key_id
        };

        if (!!visibility) {
            putSecretBody.visibility = visibility;
        }

        if (!!selectedRepoIds) {
            putSecretBody.selected_repository_ids = selectedRepoIds;
        }

        const putSecretUrl = `https://api.github.com/${url}/secrets/${secretName}`;
        await axios.put(putSecretUrl, putSecretBody, CodespaceSecretValueProvider.getRequestHeaders(accessToken));
    }

    static async queryRepos(query: string, orgName: string, accessToken: string): Promise<{ id: number, fullName: string }[]> {

        const response = await axios.get(`https://api.github.com/search/repositories?q=${query}+org:${orgName}`, CodespaceSecretValueProvider.getRequestHeaders(accessToken));

        if (!response.data?.items?.length) {
            return [];
        }

        return response.data.items.map((item: any) => {
            return {
                id: item.id,
                fullName: item.full_name
            };
        });
    }

    static async getReposByUrl(selectedReposUrl: string | undefined, accessToken: string): Promise<{ id: number, fullName: string }[]> {

        if (!selectedReposUrl) {
            return [];
        }

        const response = await axios.get(selectedReposUrl, CodespaceSecretValueProvider.getRequestHeaders(accessToken));

        if (!response.data?.repositories?.length) {
            return [];
        }

        return response.data.repositories.map((item: any) => {
            return {
                id: item.id,
                fullName: item.full_name
            };
        });
    }

    static getRequestHeaders(accessToken: string): any {
        
        return { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' } };
    }

    private async getQuickPickOptionsForPersonalSecrets(): Promise<{ label: string, kind?: vscode.QuickPickItemKind, detail?: string, secretInfo?: CodespaceSecretInfo }[]> {

        const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecrets();

        const secrets = await (CodespaceSecretValueProvider.getCodespacesSecrets(`user`, accessToken).catch(err => {
        
            this._log(`Failed to load Codespaces personal secrets. ${err.message ?? err}`, true, true);

            return [];
        }));

        return secrets.map(secret => { 
            return {
                label : secret.name,
                detail: `created ${secret.created_at.slice(0, 19)}`,
                description: !!process.env[secret.name] ? 'available on this machine' : undefined,
                secretInfo: secret
            };
        });    
    }

    private async getQuickPickOptionsForOrganizationSecrets(): Promise<{ label: string, kind?: vscode.QuickPickItemKind, detail?: string, secretInfo?: CodespaceSecretInfo }[]> {

        const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();

        const orgs = await (CodespaceSecretValueProvider.getUserOrgs(accessToken).catch(err => {
        
            this._log(`Failed to get user organizations. ${err.message ?? err}`, true, true);

            return [];
        }));

        const secretPromises = orgs.map(org => CodespaceSecretValueProvider.getCodespacesSecrets(`orgs/${org}`, accessToken).catch(err => {

            this._log(`Failed to get Codespaces secrets for organization ${org}. ${err.message ?? err}`, true, true);

            return [];
        }));

        const allSecrets = await Promise.all(secretPromises);

        const options = [];
        for (let i = 0; i < orgs.length; i++) {
            
            const org = orgs[i];
            const secrets = allSecrets[i];
            if (!secrets.length) {
                continue;
            }

            options.push({
                label: org,
                kind: vscode.QuickPickItemKind.Separator
            });

            for (const secret of secrets) {

                options.push({
                    label : secret.name,
                    detail: `created ${secret.created_at.slice(0, 19)}`,
                    description: !!process.env[secret.name] ? 'available on this machine' : undefined,
                    secretInfo: secret
                });
            }
        }

        return options;
    }

    private async getQuickPickOptionsForRepoSecrets(repoFullName: string): Promise<{ label: string, kind?: vscode.QuickPickItemKind, detail?: string, secretInfo?: CodespaceSecretInfo }[]> {

        const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();

        const secrets = await CodespaceSecretValueProvider.getCodespacesSecrets(`repos/${repoFullName}`, accessToken).catch(err => {

            this._log(`Failed to get Codespaces secrets for repository ${repoFullName}. ${err.message ?? err}`, true, true);

            return [];
        });

        return secrets.map(secret => { 
            return {
                label : secret.name,
                detail: `created ${secret.created_at.slice(0, 19)}`,
                description: !!process.env[secret.name] ? 'available on this machine' : undefined,
                secretInfo: secret
            };
        });    
    }
} 

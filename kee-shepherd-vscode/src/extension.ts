import * as vscode from 'vscode';

import { ControlledSecret, ControlTypeEnum, SecretTypeEnum } from './KeyMetadataHelpers';
import { KeeShepherd } from './KeeShepherd';
import { AnchorCompletionProvider, MenuCommandCompletionProvider, ExistingSecretsCompletionProvider } from './CompletionProviders';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { Log } from './helpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeyMapRepo } from './KeyMapRepo';
import path = require('path');

var shepherd: KeeShepherd;

export async function activate(context: vscode.ExtensionContext) {

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

    shepherd = await createKeeShepherd(context, log);

    await shepherd.stashPendingFolders();
    await shepherd.maskSecretsInThisFile(false);

    const anchorCompletionProvider = new AnchorCompletionProvider(shepherd);
    const menuCompletionProvider = new MenuCommandCompletionProvider(shepherd);
    const existingSecretsCompletionProvider = new ExistingSecretsCompletionProvider(shepherd, log);

    context.subscriptions.push(

        vscode.languages.registerCompletionItemProvider('*', anchorCompletionProvider, '@'),
        vscode.languages.registerCompletionItemProvider('*', menuCompletionProvider, '('),
        vscode.commands.registerCommand(MenuCommandCompletionProvider.insertSecretCommandId, (controlType: ControlTypeEnum, position: vscode.Position, secretType?: SecretTypeEnum)  => menuCompletionProvider.handleInsertSecret(controlType, position, secretType)),
        vscode.languages.registerCompletionItemProvider('*', existingSecretsCompletionProvider, '('),
        vscode.commands.registerCommand(ExistingSecretsCompletionProvider.cloneSecretCommandId, (position: vscode.Position, secret: ControlledSecret)  => existingSecretsCompletionProvider.handleCloneSecret(position, secret)),

        vscode.commands.registerCommand('kee-shepherd-vscode.changeStorageType', () => shepherd.changeStorageType(context)),

        vscode.window.registerTreeDataProvider('kee-shepherd-tree-view', shepherd.treeView),
        vscode.window.registerTreeDataProvider('kee-shepherd-key-vault-tree-view', shepherd.keyVaultTreeView),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.superviseSecret', () => shepherd.controlSecret(ControlTypeEnum.Supervised)),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.controlSecret', () => shepherd.controlSecret(ControlTypeEnum.Managed)),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.insertSupervisedSecret', () => shepherd.insertSecret(ControlTypeEnum.Supervised)),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.insertManagedSecret', () => shepherd.insertSecret(ControlTypeEnum.Managed)),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.maskSecrets', () => shepherd.maskSecretsInThisFile(true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.unmaskSecrets', () => shepherd.unmaskSecretsInThisFile()),

        vscode.commands.registerCommand('kee-shepherd-vscode.maskSecrets', () => shepherd.maskSecretsInThisFile(true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.unmaskSecrets', () => shepherd.unmaskSecretsInThisFile()),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.stashSecrets', () => shepherd.stashUnstashSecretsInThisFile(true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.unstashSecrets', () => shepherd.stashUnstashSecretsInThisFile(false)),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.resolveSecrets', () => shepherd.resolveSecretsInThisFile()),

        vscode.commands.registerCommand('kee-shepherd-vscode.stashSecrets', () => shepherd.stashUnstashSecretsInThisFile(true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.unstashSecrets', () => shepherd.stashUnstashSecretsInThisFile(false)),
        vscode.commands.registerCommand('kee-shepherd-vscode.resolveSecrets', () => shepherd.resolveSecretsInThisFile()),

        vscode.commands.registerCommand('kee-shepherd-vscode.stashAllWorkspaceSecrets', () => shepherd.stashUnstashAllSecretsInThisProject(true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.unstashAllWorkspaceSecrets', () => shepherd.stashUnstashAllSecretsInThisProject(false)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.refresh', () => shepherd.treeView.refresh()),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.gotoSecret', (item) => shepherd.gotoSecret(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.forgetSecrets', (item) => shepherd.forgetSecrets(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.forgetSecret', (item) => shepherd.forgetSecrets(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.stashSecrets', (item) => shepherd.stashUnstashSecretsInFolder(item, true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unstashSecrets', (item) => shepherd.stashUnstashSecretsInFolder(item, false)),

        vscode.commands.registerCommand('kee-shepherd-vscode.registerSecretAsEnvVariable', () => shepherd.registerSecretAsEnvVariable()),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.registerSecretAsEnvVariable', () => shepherd.registerSecretAsEnvVariable()),
        vscode.commands.registerCommand('kee-shepherd-vscode.createEnvVariableFromClipboard', () => shepherd.createEnvVariableFromClipboard()),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createEnvVariableFromClipboard', () => shepherd.createEnvVariableFromClipboard()),
        
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeEnvVariables', (item) => shepherd.removeEnvVariables(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeEnvVariable', (item) => shepherd.removeEnvVariables(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.openTerminal', () => shepherd.openTerminal()),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.openTerminal', () => shepherd.openTerminal()),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copySecretValue', (item) => shepherd.copySecretValue(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.forgetAllSecrets', (item) => shepherd.forgetAllSecrets(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.mountAsGlobalEnvVariable', (item) => shepherd.mountAsGlobalEnv(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unmountAsGlobalEnvVariable', (item) => shepherd.unmountAsGlobalEnv(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.mountAsGlobalEnvVariables', (item) => shepherd.mountAsGlobalEnv(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unmountAsGlobalEnvVariables', (item) => shepherd.unmountAsGlobalEnv(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.registerAsEnvVariablesOnLocalMachine', (item) => shepherd.registerEnvVariablesOnLocalMachine(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createKeyVaultSecret', (item) => shepherd.createKeyVaultSecret(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createKeyVaultSecretFrom', (item) => shepherd.createKeyVaultSecret(item, true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.setKeyVaultSecretValue', (item) => shepherd.setKeyVaultSecretValue(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.setKeyVaultSecretValueFrom', (item) => shepherd.setKeyVaultSecretValue(item, true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyKeyVaultSecretValue', (item) => shepherd.copyKeyVaultSecretValueOrUri(item, false)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyKeyVaultSecretUri', (item) => shepherd.copyKeyVaultSecretValueOrUri(item, true)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeSecretFromKeyVault', (item) => shepherd.removeSecretFromKeyVault(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.insertKeyVaultSecretAsManaged', (item) => shepherd.insertKeyVaultSecretAsManaged(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.key-vault-refresh', () => shepherd.keyVaultTreeView.refresh()),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespacePersonalSecret', (item) => shepherd.createOrUpdateCodespacesPersonalSecret(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespacePersonalSecret', (item) => shepherd.createOrUpdateCodespacesPersonalSecret(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceOrgSecret', (item) => shepherd.createOrUpdateCodespacesOrgSecret(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespaceOrgSecret', (item) => shepherd.createOrUpdateCodespacesOrgSecret(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceRepoSecret', (item) => shepherd.createOrUpdateCodespacesRepoSecret(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespaceRepoSecret', (item) => shepherd.createOrUpdateCodespacesRepoSecret(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeCodespaceSecret', (item) => shepherd.removeCodespacesSecret(item)),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyCodespacesSecretValue', (item) => shepherd.copyCodespacesSecretValue(item)),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.codespaces-refresh', () => shepherd.codespacesTreeView.refresh()),

        vscode.window.onDidChangeActiveTextEditor((editor) => shepherd.maskSecretsInThisFile(true)),
 
        vscode.workspace.onDidSaveTextDocument((doc) => shepherd.maskSecretsInThisFile(true)),

        // Too powerful
//        vscode.workspace.onDidChangeTextDocument(async (evt) => {
//        }),
        
    );

    // By far only registering this view if any github-related extensions are installed
    const githubExtensionsExist = !!vscode.extensions.getExtension('vscode.github-authentication');
    if (!!githubExtensionsExist) {
        
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('kee-shepherd-codespaces-tree-view', shepherd.codespacesTreeView)
        );
    }

    const config = vscode.workspace.getConfiguration('kee-shepherd');
    const autoUnstashMode = config.get("autoUnstashMode");

    if (autoUnstashMode === "When a workspace is opened") {
        
        await shepherd.stashUnstashAllSecretsInThisProject(false);
    }
}

// this method is called when your extension is deactivated
export async function deactivate() {

    const config = vscode.workspace.getConfiguration('kee-shepherd');
    const autoStashMode = config.get("autoStashMode");

    if (autoStashMode === "When a workspace is closed") {
        
        await shepherd.stashUnstashAllSecretsInThisProject(true);

    }

    shepherd.dispose();
}

// KeeShepherd factory
async function createKeeShepherd(context: vscode.ExtensionContext, log: Log): Promise<KeeShepherd> {

    const account = new AzureAccountWrapper();
    var metadataRepo: IKeyMetadataRepo;

    try {

        metadataRepo = await KeeShepherd.getKeyMetadataRepo(context, account, log);
        
    } catch (err) {

        const msg = `KeeShepherd failed to initialize its metadata storage. What would you like to do?`;
        const option1 = 'Reset storage settings and try again';
        const option2 = 'Unload KeeShepherd';

        if ((await vscode.window.showWarningMessage(msg, option1, option2)) !== option1) {

            log(`Failed to initialize metadata storage. ${(err as any).message ?? err}`, true, true);

            throw err;
        }

        await KeeShepherd.cleanupSettings(context);

        // trying again
        try {
            
            metadataRepo = await KeeShepherd.getKeyMetadataRepo(context, account, log);

        } catch (err2) {

            vscode.window.showErrorMessage(`KeeShepherd still couldn't initialize its metadata storage. ${(err2 as any).message ?? err2}`);

            log(`Failed to initialize metadata storage. ${(err2 as any).message ?? err2}`, true, true);

            throw err2;
        }
    }

    const resourcesFolderPath = context.asAbsolutePath('resources');

    return new KeeShepherd(
        context,
        account,
        metadataRepo,
        await KeyMapRepo.create(path.join(context.globalStorageUri.fsPath, 'key-maps')),
        resourcesFolderPath,
        log
    );
}

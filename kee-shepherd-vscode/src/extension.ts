import * as vscode from 'vscode';

import { ControlledSecret, ControlTypeEnum, SecretTypeEnum } from './KeyMetadataHelpers';
import { KeeShepherd } from './KeeShepherd';
import { AnchorCompletionProvider, MenuCommandCompletionProvider, ExistingSecretsCompletionProvider } from './CompletionProviders';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { Log } from './helpers';
import { IKeyMetadataRepo } from './metadata-repositories/IKeyMetadataRepo';
import { KeyMapRepo } from './KeyMapRepo';
import path = require('path');
import { ActionProvider } from './ActionProvider';

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

    // Chaining all incoming commands, to make sure they never interfere with each other
    let commandChain = Promise.resolve();
    let doAndShowError = async (todo: () => Promise<void>, errorMessage: string) => { 

        commandChain = commandChain.then(

            () => todo().catch(err => {

                const msg = `${errorMessage}. ${err.message ?? err}`;
                log(msg, true, true);
                vscode.window.showErrorMessage(msg);
            }
        ));

        return commandChain;
    };


    const config = vscode.workspace.getConfiguration('kee-shepherd');
    const autoStashMode = config.get("autoStashMode");

    // Stashing what failed to be stashed during previous shutdown, but only if autostash is on
    if (autoStashMode === 'When a workspace is closed') {

        await doAndShowError(() => shepherd.stashPendingFolders(), `KeeShepherd failed to stash pending folders at startup`);
    }
        
    await doAndShowError(() => shepherd.maskSecretsInThisFile(false), `KeeShepherd failed to mask secrets at startup`);

    const anchorCompletionProvider = new AnchorCompletionProvider(shepherd);
    const menuCompletionProvider = new MenuCommandCompletionProvider(shepherd);
    const existingSecretsCompletionProvider = new ExistingSecretsCompletionProvider(shepherd, log);

    const actionProvider = new ActionProvider(shepherd);

    context.subscriptions.push(

        vscode.languages.registerCodeActionsProvider('*', actionProvider),

        vscode.languages.registerCompletionItemProvider('*', anchorCompletionProvider, '@'),
        vscode.languages.registerCompletionItemProvider('*', menuCompletionProvider, '('),
        vscode.commands.registerCommand(MenuCommandCompletionProvider.insertSecretCommandId, (controlType: ControlTypeEnum, position: vscode.Position, secretType?: SecretTypeEnum)  => menuCompletionProvider.handleInsertSecret(controlType, position, secretType)),
        vscode.languages.registerCompletionItemProvider('*', existingSecretsCompletionProvider, '('),
        vscode.commands.registerCommand(ExistingSecretsCompletionProvider.cloneSecretCommandId, (position: vscode.Position, secret: ControlledSecret)  => existingSecretsCompletionProvider.handleCloneSecret(position, secret)),

        vscode.commands.registerCommand('kee-shepherd-vscode.changeStorageType', () => doAndShowError(() => shepherd.changeStorageType(context), 'KeeShepherd failed to switch to another storage type')),

        shepherd.treeView.createTreeView('kee-shepherd-tree-view'),
        shepherd.keyVaultTreeView.createTreeView('kee-shepherd-key-vault-tree-view'),
        shepherd.shortcutsTreeView.createTreeView('kee-shepherd-shortcuts-tree-view'),
        shepherd.secretStorageTreeView.createTreeView('kee-shepherd-vscode-secret-storage-tree-view'),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.superviseSecret', () => doAndShowError(() => shepherd.controlSecret(ControlTypeEnum.Supervised), 'KeeShepherd failed to add a secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.controlSecret', () => doAndShowError(() => shepherd.controlSecret(ControlTypeEnum.Managed), 'KeeShepherd failed to add a secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.insertSupervisedSecret', () => doAndShowError(() => shepherd.insertSecret(ControlTypeEnum.Supervised), 'KeeShepherd failed to insert a secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.insertManagedSecret', () => doAndShowError(() => shepherd.insertSecret(ControlTypeEnum.Managed), 'KeeShepherd failed to insert a secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.maskSecrets', () => doAndShowError(() => shepherd.maskSecretsInThisFile(true), 'KeeShepherd failed to mask secrets')),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.unmaskSecrets', () => doAndShowError(() => shepherd.unmaskSecretsInThisFile(), 'KeeShepherd failed to unmask secrets')),

        vscode.commands.registerCommand('kee-shepherd-vscode.maskSecrets', () => doAndShowError(() => shepherd.maskSecretsInThisFile(true), 'KeeShepherd failed to mask secrets')),
        vscode.commands.registerCommand('kee-shepherd-vscode.unmaskSecrets', () => doAndShowError(() => shepherd.unmaskSecretsInThisFile(), 'KeeShepherd failed to unmask secrets')),

        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.stashSecrets', () => doAndShowError(() => shepherd.stashUnstashSecretsInThisFile(true), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.unstashSecrets', () => doAndShowError(() => shepherd.stashUnstashSecretsInThisFile(false), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.editor-context.resolveSecrets', () => doAndShowError(() => shepherd.resolveSecretsInThisFile(), 'KeeShepherd failed to resolve secrets')),

        vscode.commands.registerCommand('kee-shepherd-vscode.stashSecrets', () => doAndShowError(() => shepherd.stashUnstashSecretsInThisFile(true), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.unstashSecrets', () => doAndShowError(() => shepherd.stashUnstashSecretsInThisFile(false), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.resolveSecrets', () => doAndShowError(() => shepherd.resolveSecretsInThisFile(), 'KeeShepherd failed to resolve secrets')),

        vscode.commands.registerCommand('kee-shepherd-vscode.stashAllWorkspaceSecrets', () => doAndShowError(() => shepherd.stashUnstashAllSecretsInThisProject(true), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.unstashAllWorkspaceSecrets', () => doAndShowError(() => shepherd.stashUnstashAllSecretsInThisProject(false), 'KeeShepherd failed')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.refresh', () => doAndShowError(async () => shepherd.treeView.refresh(), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.gotoSecret', (item) => doAndShowError(() => shepherd.gotoSecret(item), 'KeeShepherd failed to navigate to this secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.forgetSecrets', (item) => doAndShowError(() => shepherd.forgetSecrets(item), 'KeeShepherd failed to forget secrets')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.forgetSecret', (item) => doAndShowError(() => shepherd.forgetSecrets(item), 'KeeShepherd failed to forget secrets')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.stashSecrets', (item) => doAndShowError(() => shepherd.stashUnstashSecretsInFolder(item, true), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unstashSecrets', (item) => doAndShowError(() => shepherd.stashUnstashSecretsInFolder(item, false), 'KeeShepherd failed')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copySecretValue', (item) => doAndShowError(() => shepherd.copySecretValue(item), 'KeeShepherd failed to copy secret value')),

        vscode.commands.registerCommand('kee-shepherd-vscode.copyMruToClipboard', () => doAndShowError(() => shepherd.copyMruSecretValue(), 'KeeShepherd failed to copy secret value')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.forgetAllSecrets', (item) => doAndShowError(() => shepherd.forgetAllSecrets(item), 'KeeShepherd failed to forget secrets')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createKeyVaultSecret', (item) => doAndShowError(() => shepherd.keyVaultTreeView.createKeyVaultSecret(item, false), 'KeeShepherd failed to add secret to Key Vault')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createKeyVaultSecretFrom', (item) => doAndShowError(() => shepherd.keyVaultTreeView.createKeyVaultSecret(item, true), 'KeeShepherd failed to add secret to Key Vault')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.setKeyVaultSecretValue', (item) => doAndShowError(() => shepherd.keyVaultTreeView.setKeyVaultSecretValue(item), 'KeeShepherd failed to set secret value')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.setKeyVaultSecretValueFrom', (item) => doAndShowError(() => shepherd.keyVaultTreeView.setKeyVaultSecretValue(item, true), 'KeeShepherd failed to set secret value')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyKeyVaultSecretValue', (item) => doAndShowError(() => shepherd.keyVaultTreeView.copyKeyVaultSecretValueOrUri(item, false), 'KeeShepherd failed to get the secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyKeyVaultSecretUri', (item) => doAndShowError(() => shepherd.keyVaultTreeView.copyKeyVaultSecretValueOrUri(item, true), 'KeeShepherd failed to get the secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeSecretFromKeyVault', (item) => doAndShowError(() => shepherd.keyVaultTreeView.removeSecretFromKeyVault(item), 'KeeShepherd failed to remove secret from Key Vault')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.insertKeyVaultSecretAsManaged', (item) => doAndShowError(() => shepherd.insertKeyVaultSecretAsManaged(item), 'KeeShepherd failed')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.key-vault-refresh', () => doAndShowError(async () => shepherd.keyVaultTreeView.refresh(), 'KeeShepherd failed')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespacePersonalSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesPersonalSecret(item), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespacePersonalSecretFrom', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesPersonalSecret(item, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespacePersonalSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesPersonalSecret(item), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createGitHubActionsEnvironmentSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateActionsEnvironmentSecret(item), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createGitHubActionsEnvironmentSecretFrom', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateActionsEnvironmentSecret(item, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateGitHubActionsEnvironmentSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateActionsEnvironmentSecret(item), 'KeeShepherd failed to save secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceOrgSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateOrgSecret(item, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceOrgSecretFrom', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateOrgSecret(item, true, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespaceOrgSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateOrgSecret(item, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createGitHubActionsOrgSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateOrgSecret(item, false), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createGitHubActionsOrgSecretFrom', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateOrgSecret(item, false, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateGitHubActionsOrgSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateOrgSecret(item, false), 'KeeShepherd failed to save secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceRepoSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateRepoSecret(item, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceRepoSecretFrom', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateRepoSecret(item, true, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespaceRepoSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateRepoSecret(item, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createGitHubActionsRepoSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateRepoSecret(item, false), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createGitHubActionsRepoSecretFrom', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateRepoSecret(item, false, true), 'KeeShepherd failed to save secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateGitHubActionsRepoSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateRepoSecret(item, false), 'KeeShepherd failed to save secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeCodespaceSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.removeSecret(item), 'KeeShepherd failed to remove secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeGitHubActionsSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.removeSecret(item), 'KeeShepherd failed to remove secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyCodespacesSecretValue', (item) => doAndShowError(() => shepherd.codespacesTreeView.copyCodespacesSecretValue(item), 'KeeShepherd failed to copy secret value')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.codespaces-refresh', () => doAndShowError(async () => shepherd.codespacesTreeView.refresh(), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.shortcuts-refresh', () => doAndShowError(async () => shepherd.shortcutsTreeView.refresh(), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.vscode-secret-storage-refresh', () => doAndShowError(async () => shepherd.secretStorageTreeView.refresh(), 'KeeShepherd failed')),

        vscode.commands.registerCommand('kee-shepherd-vscode.createSecretShortcutFromClipboard', () => doAndShowError(() => shepherd.shortcutsTreeView.createFromClipboard(), 'KeeShepherd failed to create a secret from Clipboard')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createSecretShortcutFromClipboard', (item) => doAndShowError(() => shepherd.shortcutsTreeView.createFromClipboard(item), 'KeeShepherd failed to create a secret from Clipboard')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createShortcutsFolder', () => doAndShowError(() => shepherd.shortcutsTreeView.createShortcutsFolder(), 'KeeShepherd failed to create shortcuts folder')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeShortcutsFolder', (item) => doAndShowError(() => shepherd.shortcutsTreeView.removeShortcutsFolder(item), 'KeeShepherd failed to remove shortcuts folder')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.addSecretShortcut', (item) => doAndShowError(() => shepherd.shortcutsTreeView.createSecretShortcut(item), 'KeeShepherd failed')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeSecretShortcut', (item) => doAndShowError(() => shepherd.shortcutsTreeView.removeShortcutsFolder(item), 'KeeShepherd failed to remove shortcut')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyShortcutSecretValue', (item) => doAndShowError(() => shepherd.shortcutsTreeView.copySecretValue(item), 'KeeShepherd failed to copy secret value')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.mountAsGlobalEnvVariable', (item) => doAndShowError(() => shepherd.shortcutsTreeView.mountAsGlobalEnv(item), 'KeeShepherd failed to mount secret as global environment variable')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unmountAsGlobalEnvVariable', (item) => doAndShowError(() => shepherd.shortcutsTreeView.unmountAsGlobalEnv(item), 'KeeShepherd failed to unmount secret from global environment variables')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.mountAsGlobalEnvVariables', (item) => doAndShowError(() => shepherd.shortcutsTreeView.mountAsGlobalEnv(item), 'KeeShepherd failed to mount secret as global environment variable')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unmountAsGlobalEnvVariables', (item) => doAndShowError(() => shepherd.shortcutsTreeView.unmountAsGlobalEnv(item), 'KeeShepherd failed to unmount secret from global environment variables')),

        vscode.commands.registerCommand('kee-shepherd-vscode.openTerminal', () => doAndShowError(() => shepherd.shortcutsTreeView.openTerminal(), 'KeeShepherd failed to open terminal window')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.openTerminal', (item) => doAndShowError(() => shepherd.shortcutsTreeView.openTerminal(item), 'KeeShepherd failed to open terminal window')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createVsCodeSecretStorageSecret', () => doAndShowError(() => shepherd.secretStorageTreeView.createSecret(false), 'KeeShepherd failed to create VsCode SecretStorage secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createVsCodeSecretStorageSecretFrom', () => doAndShowError(() => shepherd.secretStorageTreeView.createSecret(true), 'KeeShepherd failed to create VsCode SecretStorage secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeVsCodeSecretStorageSecret', (item) => doAndShowError(() => shepherd.secretStorageTreeView.removeSecret(item), 'KeeShepherd failed to remove VsCode SecretStorage secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyVsCodeSecretStorageSecretValue', (item) => doAndShowError(() => shepherd.secretStorageTreeView.copySecretValue(item), 'KeeShepherd failed to copy secret value')),

        vscode.commands.registerCommand('kee-shepherd-vscode.generateSecret', () => doAndShowError(() => shepherd.generateSecret(), 'KeeShepherd failed to generate a secret')),

        vscode.window.onDidChangeActiveTextEditor((editor) => doAndShowError(() => shepherd.maskSecretsInThisFile(true), 'KeeShepherd failed to mask secrets')),
 
        vscode.workspace.onDidSaveTextDocument((doc) => doAndShowError(() => shepherd.maskSecretsInThisFile(true), 'KeeShepherd failed to mask secrets')),

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

    const autoUnstashMode = config.get('autoUnstashMode');

    if (autoUnstashMode === 'When a workspace is opened') {
        
        await doAndShowError(() => shepherd.stashUnstashAllSecretsInThisProject(false), 'KeeShepherd failed to unstash secrets at startup');
    }

    const notifyAboutExpiringSecrets = config.get('notifyAboutExpiringSecrets');
    if (!!notifyAboutExpiringSecrets) {

        // Intentionally not awaiting
        shepherd.checkForExpiredSecrets().catch(err => {
            log(`Failed to check for expired secrets. ${err.message ?? err}`, true, true);
        });
    }
}

// this method is called when your extension is deactivated
export async function deactivate() {

    const config = vscode.workspace.getConfiguration('kee-shepherd');
    const autoStashMode = config.get('autoStashMode');

    if (autoStashMode === 'When a workspace is closed') {
        
        try {

            await shepherd.stashUnstashAllSecretsInThisProject(true);
            
        } catch (err: any) {

            console.log(`KeeShepherd failed to stash secrets at shutdown. ${err.message ?? err}`);
        }
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

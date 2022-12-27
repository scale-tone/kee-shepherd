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

    context.subscriptions.push(

        vscode.languages.registerCompletionItemProvider('*', anchorCompletionProvider, '@'),
        vscode.languages.registerCompletionItemProvider('*', menuCompletionProvider, '('),
        vscode.commands.registerCommand(MenuCommandCompletionProvider.insertSecretCommandId, (controlType: ControlTypeEnum, position: vscode.Position, secretType?: SecretTypeEnum)  => menuCompletionProvider.handleInsertSecret(controlType, position, secretType)),
        vscode.languages.registerCompletionItemProvider('*', existingSecretsCompletionProvider, '('),
        vscode.commands.registerCommand(ExistingSecretsCompletionProvider.cloneSecretCommandId, (position: vscode.Position, secret: ControlledSecret)  => existingSecretsCompletionProvider.handleCloneSecret(position, secret)),

        vscode.commands.registerCommand('kee-shepherd-vscode.changeStorageType', () => doAndShowError(() => shepherd.changeStorageType(context), 'KeeShepherd failed to switch to another storage type')),

        vscode.window.registerTreeDataProvider('kee-shepherd-tree-view', shepherd.treeView),
        vscode.window.registerTreeDataProvider('kee-shepherd-key-vault-tree-view', shepherd.keyVaultTreeView),

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

        vscode.commands.registerCommand('kee-shepherd-vscode.registerSecretAsEnvVariable', () => doAndShowError(() => shepherd.registerSecretAsEnvVariable(), 'KeeShepherd failed to register secret as env variable')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.registerSecretAsEnvVariable', () => doAndShowError(() => shepherd.registerSecretAsEnvVariable(), 'KeeShepherd failed to register secret as env variable')),
        vscode.commands.registerCommand('kee-shepherd-vscode.createEnvVariableFromClipboard', () => doAndShowError(() => shepherd.createEnvVariableFromClipboard(), 'KeeShepherd failed to create an env variable')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createEnvVariableFromClipboard', () => doAndShowError(() => shepherd.createEnvVariableFromClipboard(), 'KeeShepherd failed to create an env variable')),
        
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeEnvVariables', (item) => doAndShowError(() => shepherd.removeEnvVariables(item), 'KeeShepherd failed to forget secrets')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeEnvVariable', (item) => doAndShowError(() => shepherd.removeEnvVariables(item), 'KeeShepherd failed to forget secrets')),

        vscode.commands.registerCommand('kee-shepherd-vscode.openTerminal', () => doAndShowError(() => shepherd.openTerminal(), 'KeeShepherd failed to open terminal window')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.openTerminal', () => doAndShowError(() => shepherd.openTerminal(), 'KeeShepherd failed to open terminal window')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copySecretValue', (item) => doAndShowError(() => shepherd.copySecretValue(item), 'KeeShepherd failed to copy secret value')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.forgetAllSecrets', (item) => doAndShowError(() => shepherd.forgetAllSecrets(item), 'KeeShepherd failed to forget secrets')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.mountAsGlobalEnvVariable', (item) => doAndShowError(() => shepherd.mountAsGlobalEnv(item), 'KeeShepherd failed to mount secret as global environment variable')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unmountAsGlobalEnvVariable', (item) => doAndShowError(() => shepherd.unmountAsGlobalEnv(item), 'KeeShepherd failed to unmount secret from global environment variables')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.mountAsGlobalEnvVariables', (item) => doAndShowError(() => shepherd.mountAsGlobalEnv(item), 'KeeShepherd failed to mount secret as global environment variable')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.unmountAsGlobalEnvVariables', (item) => doAndShowError(() => shepherd.unmountAsGlobalEnv(item), 'KeeShepherd failed to unmount secret from global environment variables')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.registerAsEnvVariablesOnLocalMachine', (item) => doAndShowError(() => shepherd.registerEnvVariablesOnLocalMachine(item), 'KeeShepherd failed to register secrets as environment variables')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createKeyVaultSecret', (item) => doAndShowError(() => shepherd.createKeyVaultSecret(item), 'KeeShepherd failed to add secret to Key Vault')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createKeyVaultSecretFrom', (item) => doAndShowError(() => shepherd.createKeyVaultSecret(item, true), 'KeeShepherd failed to add secret to Key Vault')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.setKeyVaultSecretValue', (item) => doAndShowError(() => shepherd.setKeyVaultSecretValue(item), 'KeeShepherd failed to set secret value')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.setKeyVaultSecretValueFrom', (item) => doAndShowError(() => shepherd.setKeyVaultSecretValue(item, true), 'KeeShepherd failed to set secret value')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyKeyVaultSecretValue', (item) => doAndShowError(() => shepherd.copyKeyVaultSecretValueOrUri(item, false), 'KeeShepherd failed to get the secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyKeyVaultSecretUri', (item) => doAndShowError(() => shepherd.copyKeyVaultSecretValueOrUri(item, true), 'KeeShepherd failed to get the secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeSecretFromKeyVault', (item) => doAndShowError(() => shepherd.removeSecretFromKeyVault(item), 'KeeShepherd failed to remove secret from Key Vault')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.insertKeyVaultSecretAsManaged', (item) => doAndShowError(() => shepherd.insertKeyVaultSecretAsManaged(item), 'KeeShepherd failed')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.key-vault-refresh', () => doAndShowError(async () => shepherd.keyVaultTreeView.refresh(), 'KeeShepherd failed')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespacePersonalSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesPersonalSecret(item), 'KeeShepherd failed to save Codespaces secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespacePersonalSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesPersonalSecret(item), 'KeeShepherd failed to save Codespaces secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceOrgSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesOrgSecret(item), 'KeeShepherd failed to save Codespaces secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespaceOrgSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesOrgSecret(item), 'KeeShepherd failed to save Codespaces secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.createCodespaceRepoSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesRepoSecret(item), 'KeeShepherd failed to save Codespaces secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.updateCodespaceRepoSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.createOrUpdateCodespacesRepoSecret(item), 'KeeShepherd failed to save Codespaces secret')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.removeCodespaceSecret', (item) => doAndShowError(() => shepherd.codespacesTreeView.removeCodespacesSecret(item), 'KeeShepherd failed to remove Codespaces secret')),
        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.copyCodespacesSecretValue', (item) => doAndShowError(() => shepherd.codespacesTreeView.copyCodespacesSecretValue(item), 'KeeShepherd failed to copy secret value')),

        vscode.commands.registerCommand('kee-shepherd-vscode.view-context.codespaces-refresh', () => doAndShowError(async () => shepherd.codespacesTreeView.refresh(), 'KeeShepherd failed')),

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

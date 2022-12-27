import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { SecretTypeEnum, ControlTypeEnum, ControlledSecret, AnchorPrefix, getAnchorName } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { SecretMapEntry } from './KeyMapRepo';
import { SecretTreeView } from './SecretTreeView';
import { KeyVaultTreeView } from './KeyVaultTreeView';
import { SecretValuesProvider } from './SecretValuesProvider';
import { updateGitHooksForFile } from './GitHooksForUnstashedSecrets';
import { execSync } from 'child_process';
import { Log } from './helpers';
import { CodespacesTreeView } from './CodespacesTreeView';

// Low-level tools and helpers for KeeShepherd, just to split the code somehow
export abstract class KeeShepherdBase {

    static async readFile(fileUri: vscode.Uri): Promise<{ text: string, byteOrderMark?: Uint8Array }> {

        // Trying with vscode and falling back to fs (because vscode will fail during unload)
        var fileBytes: Uint8Array;
        try {
            fileBytes = await vscode.workspace.fs.readFile(fileUri);
        } catch (err) {
            fileBytes = await fs.promises.readFile(fileUri.fsPath);
        }

        let textArray = Buffer.from(fileBytes);
        let byteOrderMark = undefined;

        // Handling BOMs, if any
        if ((fileBytes[0] === 0xEF) && (fileBytes[1] === 0xBB)) {

            textArray = textArray.slice(3);
            byteOrderMark = new Uint8Array([0xEF, 0xBB, 0xBF]);

        } else if ((fileBytes[0] === 0xFE) && (fileBytes[1] === 0xFF)) {

            textArray = textArray.slice(2);
            byteOrderMark = new Uint8Array([0xFE, 0xFF]);

        } else if ((fileBytes[0] === 0xFF) && (fileBytes[1] === 0xFE)) { 

            textArray = textArray.slice(2);
            byteOrderMark = new Uint8Array([0xFF, 0xFE]);
        }

        const text = textArray.toString();
    
        return { text, byteOrderMark };
    }
    
    static async writeFile(fileUri: vscode.Uri, text: string, byteOrderMark?: Uint8Array): Promise<void> {
    
        // Trying with vscode and falling back to fs (because vscode will fail during unload)
        let outputFileBytes = Buffer.from(text);

        if (!!byteOrderMark) {
            
            outputFileBytes = Buffer.concat([byteOrderMark, outputFileBytes]);
        }

        try {
            await vscode.workspace.fs.writeFile(fileUri, outputFileBytes);
        } catch (err) {
            await fs.promises.writeFile(fileUri.fsPath, outputFileBytes);
        }
    }
    
    protected constructor(protected readonly _valuesProvider: SecretValuesProvider,
        protected _repo: IKeyMetadataRepo,
        protected readonly _mapRepo: KeyMapRepo,
        public readonly treeView: SecretTreeView,
        public readonly keyVaultTreeView: KeyVaultTreeView,
        public readonly codespacesTreeView: CodespacesTreeView,
        protected readonly _log: Log
    ) { }

    dispose(): void {
        this._hiddenTextDecoration.dispose();
        this._blueTextDecoration.dispose();
    }

    protected readonly _hiddenTextDecoration = vscode.window.createTextEditorDecorationType({
        opacity: '0',
        backgroundColor: 'grey'
    });

    protected readonly _blueTextDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('focusBorder')
    });

    protected readonly _tempHiddenTextDecoration = vscode.window.createTextEditorDecorationType({
        opacity: '0',
        backgroundColor: 'grey'
    });

    protected async internalMaskSecrets(editor: vscode.TextEditor, secretsMap: SecretMapEntry[]): Promise<string[]> {
        
        const maskDecorations: vscode.Range[] = [];
        const stashedDecorations: vscode.Range[] = [];
        const missingSecrets: string[] = [];

        // Need to sort the map by positions
        secretsMap.sort((a, b) => a.pos - b.pos);

        // Need to adjust positions, if there're some stashed secrets in there
        var posShift = 0;

        for (var secretPos of secretsMap) {

            const secretText = editor.document.getText(new vscode.Range(
                editor.document.positionAt(secretPos.pos + posShift),
                editor.document.positionAt(secretPos.pos + posShift + secretPos.length)
            ));

            const anchorName = getAnchorName(secretPos.name);

            if (anchorName === editor.document.getText(
                new vscode.Range(
                    editor.document.positionAt(secretPos.pos + posShift),
                    editor.document.positionAt(secretPos.pos + posShift + anchorName.length)
                )
            )) {
                // If this secret is stashed, then marking it and adjusting posShift

                stashedDecorations.push(new vscode.Range(
                    editor.document.positionAt(secretPos.pos + posShift),
                    editor.document.positionAt(secretPos.pos + posShift + anchorName.length)
                ));

                posShift += anchorName.length - secretPos.length;

            } else if (this._repo.calculateHash(secretText) !== secretPos.hash) {
                
                missingSecrets.push(secretPos.name);
            
            } else {

                // Masking this secret
                maskDecorations.push(new vscode.Range(
                    editor.document.positionAt(secretPos.pos + posShift),
                    editor.document.positionAt(secretPos.pos + secretPos.length + posShift)
                ));
            }
        }

        editor.setDecorations(this._hiddenTextDecoration, maskDecorations);
        editor.setDecorations(this._blueTextDecoration, stashedDecorations);

        // Also removing temporary masks
        editor.setDecorations(this._tempHiddenTextDecoration, []);

        this._log(`Masked ${maskDecorations.length} secrets, marked ${stashedDecorations.length} stashed secrets`, false, true);
        if (!!missingSecrets.length) {
            this._log(`, ${missingSecrets.length} secrets are missing`, false, false);
        }
        this._log(` in ${editor.document.uri}`, true, false);

        return missingSecrets;
    }

    protected async askUserForDifferentNonEmptySecretName(defaultSecretName: string): Promise<string> {

        while (true) {

            const secretName = await vscode.window.showInputBox({
                value: defaultSecretName,
                prompt: `Secret named ${defaultSecretName} already exists. Provide a different name.`,
    
                ignoreFocusOut: true,
                validateInput: (n: string) => {
    
                    if (!n) {
                        return 'Provide a non-empty secret name';
                    }
    
                    if (n.startsWith(AnchorPrefix)) {
                        return `Secret name should not start with ${AnchorPrefix}`;
                    }
    
                    if (n === defaultSecretName) {
                        return 'Secret with that name already exists. Provide a different name.';
                    }
    
                    return null;
                }
            });

            if (!!secretName) {
                
                return secretName;
            }                
        }
    }
    
    protected async getSecretValuesAndCheckHashes(secrets: ControlledSecret[]): Promise<{ secret: ControlledSecret, value: string }[]> {

        var result: { secret: ControlledSecret, value: string }[] = [];

        const promises = secrets.map(async secret => {
            result.push({ secret, value: await this._valuesProvider.getSecretValue(secret) });
        });
  
        await Promise.all(promises);

        // Checking if hashes still match. And updating metadata storage if not.
        for (const pair of result) {
  
            if (!pair.value) {

                this._log(`Failed to retrieve the value of ${pair.secret.name} from ${SecretTypeEnum[pair.secret.type]}`, true, true);
                continue;

            } else {

                this._log(`Retrieved the value of ${pair.secret.name} from ${SecretTypeEnum[pair.secret.type]}`, true, true);
            }

            const hash = this._repo.calculateHash(pair.value);

            if (pair.secret.hash !== hash) {

                await this._repo.updateHashAndLength(pair.secret.hash, hash, pair.value.length);

                pair.secret.hash = hash;
                pair.secret.length = pair.value.length;

                this._log(`Detected that the value of ${pair.secret.name} has changed and updated its metadata storage accordingly.`, true, true);
            }
        }

        return result;
    }

    protected maskAllText(editor: vscode.TextEditor): void {
        
        editor.setDecorations(this._hiddenTextDecoration, [new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
        )]);
    }

    private async internalStashUnstashSecrets(filePath: string, text: string, secrets: { [name: string]: string }, stash: boolean): Promise<string> {

        var outputText = '';

        var secretsFound = 0;
        const missingSecrets: { [name: string]: string } = { ...secrets };

        var pos = 0, prevPos = 0;
        while (pos < text.length) {

            var somethingFound = false;

            // checking if any of the secrets appears at current position
            for (var secretName in secrets) {

                const anchorName = getAnchorName(secretName);

                const secretValue = secrets[secretName];
                if (!secretValue) {
                    throw new Error(`Failed to get the value of ${secretName}`);
                }

                const toFind = stash ? secretValue : anchorName;
                const toReplace = stash ? anchorName : secretValue;

                if (!!text.startsWith(toFind, pos)) {

                    // Copying a replacement into output
                    outputText += text.substring(prevPos, pos) + toReplace;

                    secretsFound++;

                    pos += toFind.length;
                    prevPos = pos;
                    delete missingSecrets[secretName];

                    somethingFound = true;

                } else if (!!text.startsWith(toReplace, pos)) {

                    // This secret is already in its resulting form, so just skipping it
                    outputText += text.substring(prevPos, pos) + toReplace;

                    pos += toReplace.length;
                    prevPos = pos;
                    delete missingSecrets[secretName];

                    somethingFound = true;
                }
            }

            if (!somethingFound) {
                pos++;
            }
        }

        outputText += text.substr(prevPos);

        // Checking if any of these secrets were not found and need to be removed
        const missingSecretNames = Object.keys(missingSecrets);

        this._log(`${stash ? 'Stashed' : 'Unstashed'} ${secretsFound} secrets`, false, true);

        if (missingSecretNames.length > 0) {

            this._log(` , ${missingSecretNames.length} secrets are missing`, false, false);
            
            await this.askUserAboutMissingSecrets(filePath, missingSecretNames);
        }

        this._log(` in ${filePath}`, true, false);

        // Updating secrets map
        await this.updateSecretMapForFile(filePath, outputText, secrets);

        return outputText;
    }

    protected async stashUnstashAllSecretsInFolders(folders: string[], stash: boolean): Promise<void> {
        
        const secretPromises = folders.map(f => this._repo.getSecrets(f, false));
        const secrets = (await Promise.all(secretPromises)).flat();

        // This must be done sequentially by now
        const secretsAndValues = await this.getSecretValuesAndCheckHashes(secrets);

        // Grouping secrets by filename
        const secretsPerFile = secretsAndValues.reduce((result, cv) => {
        
            if (!result[cv.secret.filePath]) {
                result[cv.secret.filePath] = {};
            }

            // Getting managed secrets only
            if (cv.secret.controlType === ControlTypeEnum.Managed) {
                
                result[cv.secret.filePath][cv.secret.name] = cv.value;
            }

            return result;
        
        }, {} as { [f: string]: { [name: string]: string } });

        const filePaths = Object.keys(secretsPerFile);

        // flipping secrets in each file
        const promises = filePaths
            .map(filePath => this.stashUnstashSecretsInFile(filePath, stash, secretsPerFile[filePath]));
        
        const secretCount = (await Promise.all(promises)).reduce((p, c) => p + c, 0);

        // Also updating git hooks for these files
        for (const filePath of filePaths) {

            const fileUri = vscode.Uri.parse(filePath);
            await updateGitHooksForFile(fileUri, !stash, Object.keys(secretsPerFile[filePath]).length > 0);
        }

        if (secretCount > 0) {
            
            vscode.window.showInformationMessage(`KeeShepherd ${stash ? 'stashed' : 'unstashed'} ${secretCount} secrets in ${filePaths.length} files`);
        }
    }
    
    protected async stashUnstashSecretsInFile(filePath: string, stash: boolean, managedSecretValues: { [name: string]: string }): Promise<number> {

        try {

            var currentEditor: vscode.TextEditor | undefined;

            // This can fail during unload
            try {
                currentEditor = vscode.window.activeTextEditor;
                if (!!currentEditor && (currentEditor.document.uri.toString() !== filePath)) {
                    currentEditor = undefined;
                }
                    
            } catch (err) { }

            const fileUri = vscode.Uri.parse(filePath);

            // Reading current file contents.
            let { text, byteOrderMark } = await KeeShepherdBase.readFile(fileUri);
            
            // Replacing @KeeShepherd() links with secret values
            const outputFileText = await this.internalStashUnstashSecrets(filePath, text, managedSecretValues, stash);

            // Temporarily hiding everything. This seems to be the only way to prevent secret values from flashing.
            // Only doing this if the text has actually changed, because otherwise onDidChangeTextDocument event won't be triggered.
            if (!!currentEditor && (outputFileText !== text)) {

                this.maskAllText(currentEditor);
            }

            // Subscribing to document refresh event, if this is the active document. Needs to be done _before_ saving the text.
            if (!!currentEditor) {
                
                const eventToken = vscode.workspace.onDidChangeTextDocument(async (evt) => {

                    if (evt.document.uri.toString() === filePath) {

                        eventToken.dispose();
    
                        var secretMap = await this._mapRepo.getSecretMapForFile(filePath);
                        await this.internalMaskSecrets(currentEditor!, secretMap);
                    }
                });
            }

            // Saving file contents back
            await KeeShepherdBase.writeFile(fileUri, outputFileText, byteOrderMark);

            // Refreshing secret tree view
            for (const secretName in managedSecretValues) {
                this.treeView.setSecretNodeState(filePath, secretName, stash);
            }

            // Returning the number of affected secrets
            return Object.keys(managedSecretValues).length;
            
        } catch (err) {
            vscode.window.showErrorMessage(`KeeShepherd failed to ${!stash ? 'unstash' : 'stash'} secrets in ${filePath}. ${(err as any).message ?? err}`);
            return 0;
        }
    }

    protected async updateSecretMapForFile(filePath: string, text: string, secretValues: { [name: string]: string }): Promise<string[]> {

        const secrets = await this._repo.getSecrets(filePath, true);
        
        const outputMap: SecretMapEntry[] = []
        const secretsFound: string[] = [];

        // Searching for all secrets in this text
        var pos = 0, posShift = 0;
        while (pos < text.length) {

            var somethingFound = false;

            // checking if any of the secrets appears at current position
            for (var secret of secrets) {

                const anchorName = getAnchorName(secret.name);
                const secretValue = secretValues[secret.name];

                if (!!text.startsWith(anchorName, pos)) {

                    // This secret appears in its stashed form. Let's write it down and adjust further positions

                    outputMap.push({ name: secret.name, hash: secret.hash, pos: pos + posShift, length: secret.length });

                    pos += anchorName.length;
                    secretsFound.push(secret.name);
                    somethingFound = true;

                    posShift += secret.length - anchorName.length;

                }
                else if (!!secretValue) {
                    
                    // If we know the secret value, then just checking whether it matches
                    if (!!text.startsWith(secretValue, pos)) {

                        // Found this secret's position. Let's write it down.
                        outputMap.push({ name: secret.name, hash: secret.hash, pos: pos + posShift, length: secretValue.length });

                        pos += secretValue.length;
                        secretsFound.push(secret.name);
                        somethingFound = true;
                    }

                } else {

                    // Otherwise calculating and trying to match the hash. Might take time, but no other options...
                    const currentHash = this._repo.calculateHash(text.substr(pos, secret.length));
                    
                    if (currentHash === secret.hash) {

                        // Found this secret's position. Let's write it down.
                        outputMap.push({ name: secret.name, hash: secret.hash, pos: pos + posShift, length: secret.length });

                        pos += secret.length;
                        secretsFound.push(secret.name);
                        somethingFound = true;
                    }
                }
            }

            if (!somethingFound) {
                pos++;
            }
        }

        await this._mapRepo.saveSecretMapForFile(filePath, outputMap);

        this._log(`Updated secret map (${outputMap.length} secrets) for ${filePath}.`, true, true);

        // returning secrets that were not found
        return secrets.filter(s => !secretsFound.includes(s.name)).map(s => s.name);
    }
    
    protected async askUserAboutMissingSecrets(filePath: string, missingSecrets: string[]): Promise<void> {

        const userResponse = await vscode.window.showErrorMessage(
            `The following secrets: ${missingSecrets.join(', ')} were not found in ${path.basename(filePath)}. Do you want to forget them?`,
            'Yes', 'No');
        
        if (userResponse === 'Yes') {
            
            await this._repo.removeSecrets(filePath, missingSecrets);

            this._log(`${missingSecrets.length} secrets have been forgotten`, true, true);
            vscode.window.showInformationMessage(`KeeShepherd: ${missingSecrets.length} secrets have been forgotten from ${filePath}`);
            this.treeView.refresh();
        }
    }

    protected async setGlobalEnvVariables(variables: { [n: string] : string | undefined }): Promise<void> {

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
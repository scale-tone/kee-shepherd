import * as path from 'path';
import * as vscode from 'vscode';

import { KeyMetadataRepo, SecretTypeEnum, ControlTypeEnum, ControlledSecret } from './KeyMetadataRepo';
import { KeyMapRepo } from './KeyMapRepo';
import { SecretMapEntry } from './KeyMapRepo';

export class KeyShepherd {

    private readonly _hiddenTextDecoration: vscode.TextEditorDecorationType;
    
    private constructor(private readonly _repo: KeyMetadataRepo, private readonly _mapRepo: KeyMapRepo) {
        
        this._hiddenTextDecoration = vscode.window.createTextEditorDecorationType({
            opacity: '0'
        });
    }

    dispose(): void {
        this._hiddenTextDecoration.dispose();
    }

    static async create(context: vscode.ExtensionContext): Promise<KeyShepherd> {

        // Using Azure Account extension to connect to Azure, get subscriptions etc.
        const azureAccountExtension = vscode.extensions.getExtension('ms-vscode.azure-account');

        // Typings for azureAccount are here: https://github.com/microsoft/vscode-azure-account/blob/master/src/azure-account.api.d.ts
        const azureAccount = !!azureAccountExtension ? azureAccountExtension.exports : undefined;

        console.log(azureAccount);

        return new KeyShepherd(
            await KeyMetadataRepo.create(path.join(context.extensionPath, 'key-metadata')),
            await KeyMapRepo.create(path.join(context.extensionPath, 'key-maps')));
    }

    async showSecretsInThisFile(): Promise<void> {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        editor.setDecorations(this._hiddenTextDecoration, []);
    }

    async hideSecretsInThisFile(): Promise<void> {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const currentFile = editor.document.uri.toString();
        if (!currentFile) {
            return;
        }

        const secretsMap = await this._mapRepo.getSecretMapForFile(currentFile);

        const decorations = secretsMap.map(secretPos => new vscode.Range(editor.document.positionAt(secretPos.pos), editor.document.positionAt(secretPos.pos + secretPos.length)));

        editor.setDecorations(this._hiddenTextDecoration, decorations);
    }

    async toggleAllSecretsInThisProject(disguise: boolean): Promise<void> {

        if (!vscode.workspace.workspaceFolders) {
            return;
        }

        try {

            const secretsPromise = Promise.all(vscode.workspace.workspaceFolders.map(f => this._repo.getSecretsInFolder(f.uri.toString())));
            const secrets = (await secretsPromise).flat();

            // Grouping secrets by filename
            const secretsPerFile = secrets.reduce((result, currentSecret) => {
            
                if (!result[currentSecret.filePath]) {
                    result[currentSecret.filePath] = [];
                }

                result[currentSecret.filePath].push(currentSecret);

                return result;
            
            }, {} as { [f: string] : ControlledSecret[] });

            // flipping secrets in each file
            const promises = Object.keys(secretsPerFile)
                .map(filePath => disguise ? this.disguiseSecretsInFile(filePath, secretsPerFile[filePath]) : this.revealSecretsInFile(filePath, secretsPerFile[filePath]));
            
            await Promise.all(promises);

        } catch (err) {
            vscode.window.showErrorMessage(`KeyShepherd failed. ${(err as any).message ?? err}`);
        }
    }

    async superviseSecret(): Promise<void> {
        
        return this.addSecret(ControlTypeEnum.Supervised);
    }

    async controlSecret(): Promise<void> {
        
        return this.addSecret(ControlTypeEnum.Controlled);
    }

    private async getSecretValue(secret: ControlledSecret): Promise<string> {

        if (!secret.link) {
            throw new Error(`Cannot retrieve the value of ${secret}`);
        }

        return secret.link;
    }

    private async getSecretValues(secrets: ControlledSecret[]): Promise<{[name: string]: string}> {

        var result: {[name: string]: string} = {};

        const promises = secrets
            .map(async s => {
                result[s.name] = await this.getSecretValue(s);
            });
        
        await Promise.all(promises);

        return result;
    }

    private toggleSecretsInText(text: string, secrets: { [name: string]: string }, secretsToAnchors: boolean): string {

        var outputText = '';

        var pos = 0, prevPos = 0;
        while (pos < text.length) {

            var somethingFound = false;

            // checking if any of the secrets appears at current position
            for (var secretName in secrets) {

                const anchorName = `@KeyShepherd(${secretName})`;

                const toFind = secretsToAnchors ? secrets[secretName]: anchorName;
                const toReplace = secretsToAnchors ? anchorName : secrets[secretName];

                if (!!text.startsWith(toFind, pos)) {

                    outputText += text.substring(prevPos, pos) + toReplace;

                    pos += toFind.length;
                    prevPos = pos;
                    somethingFound = true;
                }
            }

            if (!somethingFound) {
                pos++;
            }
        }

        outputText += text.substr(prevPos);

        return outputText;
    }

    private async disguiseSecretsInFile(filePath: string, secrets: ControlledSecret[]): Promise<void> {

        try {
            // Obtaining secret values for controlled secrets only
            const controlledSecretValues = await this.getSecretValues(secrets.filter(s => s.controlType === ControlTypeEnum.Controlled));

            const fileUri = vscode.Uri.parse(filePath);

            // Reading current file contents
            const fileBytes = await vscode.workspace.fs.readFile(fileUri);
            var fileText = Buffer.from(fileBytes).toString('utf8');

            // Replacing secret values with @KeyShepherd() links
            const outputFileText = this.toggleSecretsInText(fileText, controlledSecretValues, true);

            // Saving file contents back
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(outputFileText, 'utf8'));

            // Also dropping secret map for this file, as it is now incorrect
            await this._mapRepo.saveSecretMapForFile(filePath, []);

        } catch (err) {
            vscode.window.showErrorMessage(`KeyShepherd failed to disguise secrets in ${filePath}. ${(err as any).message ?? err}`);
        }
    }

    private async revealSecretsInFile(filePath: string, secrets: ControlledSecret[]): Promise<void> {

        try {

            // Obtaining secret values first
            const secretValues = await this.getSecretValues(secrets);

            const fileUri = vscode.Uri.parse(filePath);

            // Reading current file contents
            const fileBytes = await vscode.workspace.fs.readFile(fileUri);
            var fileText = Buffer.from(fileBytes).toString('utf8');

            // Replacing @KeyShepherd() links with secret values
            const outputFileText = this.toggleSecretsInText(fileText, secretValues, false);

            // Saving file contents back
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(outputFileText, 'utf8'));

            // Also updating and saving secrets map into another file
            await this.updateSecretMapForFile(filePath, outputFileText, secretValues);

        } catch (err) {
            vscode.window.showErrorMessage(`KeyShepherd failed to reveal secrets in ${filePath}. ${(err as any).message ?? err}`);
        }
    }

    private async updateSecretMapForFile(filePath: string, text: string, secrets: { [name: string]: string }): Promise<void> {
        
        const outputMap: SecretMapEntry[] = []

        // Searching for all secrets in this text
        var pos = 0;
        while (pos < text.length) {

            var somethingFound = false;

            // checking if any of the secrets appears at current position
            for (var secretName in secrets) {

                const secretValue = secrets[secretName];

                if (!!text.startsWith(secretValue, pos)) {

                    outputMap.push({ name: secretName, pos, length: secretValue.length });

                    pos += secretValue.length;
                    somethingFound = true;
                }
            }

            if (!somethingFound) {
                pos++;
            }
        }

        await this._mapRepo.saveSecretMapForFile(filePath, outputMap);
    }
    
    private async addSecret(controlType: ControlTypeEnum): Promise<void> {

        const editor = vscode.window.activeTextEditor;
        if (!editor || (!!editor.selection.isEmpty)) {
            return;
        }

        const currentFile = editor.document.uri.toString();
        if (!currentFile) {
            return;
        }

        const secretName = await vscode.window.showInputBox({ value: `${vscode.workspace.name}-secret${this._repo.secretCount + 1}`, prompt: 'Give your secret a name' });

        if (!secretName) {
            return;
        }

        try {

            await this._repo.addSecret({
                name: secretName,
                type: SecretTypeEnum.Custom,
                controlType,
                filePath: currentFile,
                link: editor.document.getText(editor.selection)
            });

            // Also updating secret map for this file
            const secrets = await this._repo.getSecretsInFile(currentFile);
            const secretValues = await this.getSecretValues(secrets);
            await this.updateSecretMapForFile(currentFile, editor.document.getText(), secretValues);

            vscode.window.showInformationMessage(`KeyShepherd: ${secretName} was added successfully.`);

        } catch (err) {
            vscode.window.showErrorMessage(`KeyShepherd failed to add ${secretName}. ${(err as any).message ?? err}`);
        }
    }
}
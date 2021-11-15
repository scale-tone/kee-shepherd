import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export enum SecretTypeEnum {
    Unknown = 0,
    AzureKeyVault,
    AzureStorage,
}

export enum ControlTypeEnum {
    Supervised = 0,
    Controlled,
}

export type ControlledSecret = {

    name: string;
    type: SecretTypeEnum;
    controlType: ControlTypeEnum;
    filePath: string;
    properties: any;
}

export function getHashCode(str: string): number {

    var hashCode = 0;
    for (var i = 0; i < str.length; i++) {
        hashCode = ((hashCode << 5) - hashCode) + str.charCodeAt(i);
        // Convert to positive 32-bit integer
        hashCode &= 0x7FFFFFFF;
    }

    return hashCode;
}

export function encodePathSegment(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
}

export function getFullPathThatFits(baseFolderName: string, proposedFolderName: string, fileName: string): string {

    var result = path.join(baseFolderName, proposedFolderName, fileName);

    // Limiting the full path length
    const maxPathLength = 250;
    if (result.length > maxPathLength) {

        // If doesn't fit, using folder's hash instead
        proposedFolderName = getHashCode(proposedFolderName).toString();
        result = path.join(baseFolderName, proposedFolderName, fileName);
    }
 
    return result;
}

export class KeyMetadataRepo {

    get secretCount() { return this._secrets.length; }

    private constructor(private _storageFolder: string, private _secrets: ControlledSecret[]) { }

    static async create(storageFolder: string): Promise<KeyMetadataRepo> {

        if (!fs.existsSync(storageFolder)) {
            await fs.promises.mkdir(storageFolder, {recursive: true});
        }

        // Reading existing metadata from given folder

        const folders = (await fs.promises.readdir(storageFolder))
            .map(folderName => path.join(storageFolder, folderName))
            .filter(async folderPath => !(await fs.promises.lstat(folderPath)).isDirectory());
        
        const secrets = await Promise.all(folders.map(KeyMetadataRepo.readSecretFilesFromFolder));
        
        return new KeyMetadataRepo(storageFolder, secrets.flat());
    }

    async getSecretsInFolder(folder: string): Promise<ControlledSecret[]> {

        return this._secrets.filter(s => s.filePath.toLowerCase().startsWith(folder.toLowerCase()));
    }

    async getSecretsInFile(file: string): Promise<ControlledSecret[]> {

        return this._secrets.filter(s => s.filePath.toLowerCase() === file.toLowerCase());
    }

    async addSecret(secret: ControlledSecret): Promise<void> {

        const secretFilePath = getFullPathThatFits(this._storageFolder, encodePathSegment(path.dirname(secret.filePath)), `${encodePathSegment(secret.name)}.json`);

        if (!fs.existsSync(path.dirname(secretFilePath))) {
            await fs.promises.mkdir(path.dirname(secretFilePath));
        }

        return fs.promises
            .writeFile(secretFilePath, JSON.stringify(secret, null, 3), { flag: 'wx'} )
            .then(() => {
                this._secrets.push(secret);
            });
    }

    private static async readSecretFilesFromFolder(folderPath: string): Promise<ControlledSecret[]> {

        const jsonFileNames = (await fs.promises.readdir(folderPath)).filter(name => path.extname(name).toLowerCase() === '.json');
        const secretPromises = jsonFileNames.map(fileName => fs.promises.readFile(path.join(folderPath, fileName), 'utf8'));
        return (await Promise.all(secretPromises)).map(json => JSON.parse(json));
    }
}
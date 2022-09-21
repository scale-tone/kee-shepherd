import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as Crypto from 'crypto';
import * as vscode from 'vscode';
import { ControlledSecret, getFullPathThatFits, encodePathSegment, getSha256Hash, MinSecretLength, EnvVariableSpecialPath, ControlTypeEnum, SecretNameConflictError } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { SaltKey } from './KeyMetadataTableRepo';

// Stores secret metadata locally in JSON files
export class KeyMetadataLocalRepo implements IKeyMetadataRepo {

    async findBySecretName(name: string): Promise<ControlledSecret[]> {

        return this._secrets.filter(s => s.name === name);
    }

    async getMachineNames(): Promise<string[]>{
        return [os.hostname()];
    }

    async getFolders(machineName: string): Promise<string[]> {

        return this._secrets
            .map(s => s.controlType === ControlTypeEnum.EnvVariable ? EnvVariableSpecialPath : path.dirname(s.filePath))
            .filter((folder, index, folders) => folders.indexOf(folder) === index);
    }

    async updateHashAndLength(oldHash: string, newHash: string, newLength: number): Promise<void> {

        const updatedSecrets = this._secrets
            .filter(s => s.hash === oldHash)
            .map(s => {

                s.hash = newHash;
                s.length = newLength;
                return s;
            });

        const promises = updatedSecrets.map(secret => {

            const secretFilePath = getFullPathThatFits(this._storageFolder, encodePathSegment(secret.filePath), `${encodePathSegment(secret.name)}.json`);

            return fs.promises.writeFile(secretFilePath, JSON.stringify(secret, null, 3));
        });

        await Promise.all(promises);
    }

    calculateHash(str: string): string {

        return getSha256Hash(str + this._salt);
    }

    private constructor(private _storageFolder: string, 
        private _secrets: ControlledSecret[],
        private _salt: string) { }

    static async create(context: vscode.ExtensionContext, storageFolder: string): Promise<KeyMetadataLocalRepo> {

        if (!fs.existsSync(storageFolder)) {
            await fs.promises.mkdir(storageFolder, {recursive: true});
        }

        // Getting list of folders
        const folders = await KeyMetadataLocalRepo.getSubFolders(storageFolder);

        // Reading all secrets from those folders
        const secrets = await Promise.all(folders.map(KeyMetadataLocalRepo.readSecretFilesFromFolder));

        const salt = await KeyMetadataLocalRepo.getSalt(context, storageFolder);
        
        return new KeyMetadataLocalRepo(storageFolder, secrets.flat(), salt);
    }

    async getSecrets(path: string, exactMatch: boolean, machineName?: string): Promise<ControlledSecret[]> {

        if (path === EnvVariableSpecialPath) {
            return this._secrets.filter(s => s.controlType === ControlTypeEnum.EnvVariable );
        }

        return this._secrets.filter(s => !!exactMatch ?
            s.filePath.toLowerCase() === path.toLowerCase() :
            s.filePath.toLowerCase().startsWith(path.toLowerCase())
        );
    }

    async addSecret(secret: ControlledSecret): Promise<void> {

        if (secret.length < MinSecretLength) {
            throw new Error(`Secret should be at least ${MinSecretLength} symbols long`);
        }

        // Allowing secrets with same name and hash, but disallowing secrets with same name and different hash
        const secretsWithSameName = this._secrets.filter(s => s.filePath === secret.filePath && s.name === secret.name);
        if (!!secretsWithSameName.find(s => s.hash !== secret.hash)) {
            
            throw new SecretNameConflictError('A secret with same name but different hash already exists');
        }

        const secretFilePath = getFullPathThatFits(this._storageFolder,
            encodePathSegment(secret.controlType === ControlTypeEnum.EnvVariable ? EnvVariableSpecialPath : secret.filePath),
            `${encodePathSegment(secret.name)}.json`
        );

        if (!fs.existsSync(path.dirname(secretFilePath))) {
            await fs.promises.mkdir(path.dirname(secretFilePath));
        }

        await fs.promises.writeFile(secretFilePath, JSON.stringify(secret, null, 3));

        this._secrets.push(secret);
    }

    async removeSecrets(filePath: string, names: string[], machineName?: string): Promise<void> {

        const promises = names.map(secretName => {

            const secretFilePath = getFullPathThatFits(this._storageFolder, encodePathSegment(filePath), `${encodePathSegment(secretName)}.json`);

            return fs.promises.rm(secretFilePath, { force: true });
        });

        await Promise.all(promises);
        
        await this.cleanupEmptyFolders();

        if (filePath === EnvVariableSpecialPath) {
            
            this._secrets = this._secrets.filter(s => !(s.controlType === ControlTypeEnum.EnvVariable && names.includes(s.name)));

        } else {

            this._secrets = this._secrets.filter(s => !(s.filePath === filePath && names.includes(s.name)));
        }
    }

    async removeAllSecrets(machineName?: string): Promise<void> {

        const folders = await KeyMetadataLocalRepo.getSubFolders(this._storageFolder);

        const promises = folders.map(async folderPath => {
            await fs.promises.rm(folderPath, { recursive: true })
        });

        await Promise.all(promises);

        this._secrets = [];
    }

    async getAllCachedSecrets(): Promise<ControlledSecret[]> {

        return this._secrets;
    }

    refreshCache(): void {
        // Do nothing, because all secrets are kept in memory anyway
    }

    private static async readSecretFilesFromFolder(folderPath: string): Promise<ControlledSecret[]> {

        const jsonFileNames = (await fs.promises.readdir(folderPath)).filter(name => path.extname(name).toLowerCase() === '.json');
        const secretPromises = jsonFileNames.map(fileName => fs.promises.readFile(path.join(folderPath, fileName), 'utf8'));
        return (await Promise.all(secretPromises)).map(json => JSON.parse(json));
    }

    private static async getSubFolders(parentFolderName: string): Promise<string[]> {

        const folderPromises = (await fs.promises.readdir(parentFolderName))
            .map(folderName => {

                const folderPath = path.join(parentFolderName, folderName);

                return fs.promises.lstat(folderPath)
                    .then(stat => stat.isDirectory() ? folderPath : '')
            });

        return (await Promise.all(folderPromises))
            .filter(f => !!f);
    }

    private async cleanupEmptyFolders(): Promise<void> {

        const folders = await KeyMetadataLocalRepo.getSubFolders(this._storageFolder);

        const promises = folders.map(async folderPath => {
            try {

                await fs.promises.rmdir(folderPath)

            } catch (err) {
            }
        });

        await Promise.all(promises);
    }

    private static async getSalt(context: vscode.ExtensionContext, storageFolder: string): Promise<string> {

        let salt = await context.secrets.get(SaltKey);
        
        if (!!salt) {
            return salt;
        }

        const saltFileName = path.join(storageFolder, 'salt.dat');

        if (fs.existsSync(saltFileName)) {

            // Moving salt from file into vscode's SecretStorage

            salt = await fs.promises.readFile(saltFileName, 'utf8');

            await context.secrets.store(SaltKey, salt);

            await fs.promises.rm(saltFileName, { force: true });

            return salt;
        }

        // Using an exclusively created file to make up a critical section
        const lockFileName = path.join(storageFolder, 'lock.dat');
        try {

            await fs.promises.writeFile(lockFileName, ' ', { flag: 'wx' });
            
            // Doing double-check
            salt = await context.secrets.get(SaltKey);
        
            if (!!salt) {
                return salt;
            }

            salt = Crypto.randomBytes(128).toString('hex');

            // Storing the salt in SecretStorage
            await context.secrets.store(SaltKey, salt);

            return salt;
    
        } catch (err) {

            // This can happen in a very-very rare case. In which case it would be better to throw than to end up with two different salts
            throw new Error('Failed to initialize salt');
        
        } finally {

            await fs.promises.rm(lockFileName, { force: true });
        }
    }
}
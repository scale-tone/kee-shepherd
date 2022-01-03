import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as Crypto from 'crypto';
import { ControlledSecret, getFullPathThatFits, encodePathSegment, getSha256Hash, MinSecretLength } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';

// Stores secret metadata locally in JSON files
export class KeyMetadataLocalRepo implements IKeyMetadataRepo {

    private _salt: string = '';

    private get salt(): string {

        if (!!this._salt) {
            return this._salt;
        }

        const saltFileName = path.join(this._storageFolder, 'salt.dat');

        try {
           
            const newSalt = Crypto.randomBytes(128).toString('hex');

            // Making sure the file is being created exclusively
            fs.writeFileSync(saltFileName, newSalt, { flag: 'wx' });
            
        } catch (err) {
        }

        this._salt = fs.readFileSync(saltFileName, 'utf8');

        return this._salt;
    }

    async findBySecretName(name: string): Promise<ControlledSecret[]> {

        return this._secrets.filter(s => s.name === name);
    }

    async getMachineNames(): Promise<string[]>{
        return [os.hostname()];
    }

    async getFolders(machineName: string): Promise<string[]> {

        return this._secrets
            .map(s => path.dirname(s.filePath))
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

        return getSha256Hash(str + this.salt);
    }

    private constructor(private _storageFolder: string, private _secrets: ControlledSecret[]) { }

    static async create(storageFolder: string): Promise<KeyMetadataLocalRepo> {

        if (!fs.existsSync(storageFolder)) {
            await fs.promises.mkdir(storageFolder, {recursive: true});
        }

        // Getting list of folders
        const folders = await KeyMetadataLocalRepo.getSubFolders(storageFolder);

        // Reading all secrets from those folders
        const secrets = await Promise.all(folders.map(KeyMetadataLocalRepo.readSecretFilesFromFolder));
        
        return new KeyMetadataLocalRepo(storageFolder, secrets.flat());
    }

    async getSecrets(path: string, exactMatch: boolean, machineName?: string): Promise<ControlledSecret[]> {

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
        if (!!secretsWithSameName.find(s => s.hash != secret.hash)) {
            
            throw new Error('A secret with same name but different hash already exists in this file');

        }

        const secretFilePath = getFullPathThatFits(this._storageFolder, encodePathSegment(secret.filePath), `${encodePathSegment(secret.name)}.json`);

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

        this._secrets = this._secrets.filter(s => !(s.filePath === filePath && names.includes(s.name)));
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
}
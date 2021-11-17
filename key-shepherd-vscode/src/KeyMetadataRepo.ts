import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as Crypto from 'crypto';
import { ControlledSecret, getFullPathThatFits, encodePathSegment } from './KeyMetadataHelpers';

export class KeyMetadataRepo {

    get secretCount() { return this._secrets.length; }

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

    getHash(str: string): string {

        return Crypto.createHash('sha256').update(str + this.salt).digest('base64');
    }

    private constructor(private _storageFolder: string, private _secrets: ControlledSecret[]) { }

    static async create(storageFolder: string): Promise<KeyMetadataRepo> {

        if (!fs.existsSync(storageFolder)) {
            await fs.promises.mkdir(storageFolder, {recursive: true});
        }

        // Getting list of folders
        const folders = await KeyMetadataRepo.getSubFolders(storageFolder);

        // Reading all secrets from those folders
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

        if (secret.length < 3) {
            throw new Error(`Secret should be at least 3 symbols long`);
        }

        // Allowing secrets with same name and hash, but disallowing secrets with same name and different hash
        const secretsWithSameName = this._secrets.filter(s => s.filePath === secret.filePath && s.name === secret.name);
        if (!!secretsWithSameName.find(s => s.hash != secret.hash)) {
            
            throw new Error('A secret with same name but different hash already exists in this file');

        } else if (secretsWithSameName.length > 0) {

            return;
        }

        const secretFilePath = getFullPathThatFits(this._storageFolder, encodePathSegment(secret.filePath), `${encodePathSegment(secret.name)}.json`);

        if (!fs.existsSync(path.dirname(secretFilePath))) {
            await fs.promises.mkdir(path.dirname(secretFilePath));
        }

        await fs.promises.writeFile(secretFilePath, JSON.stringify(secret, null, 3), { flag: 'wx' });

        this._secrets.push(secret);
    }

    async removeSecrets(filePath: string, names: string[]): Promise<void> {

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

        const folders = await KeyMetadataRepo.getSubFolders(this._storageFolder);

        const promises = folders.map(async folderPath => {
            try {

                await fs.promises.rmdir(folderPath)

            } catch (err) {
            }
        });

        await Promise.all(promises);
    }
}
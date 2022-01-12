import * as fs from 'fs';
import * as path from 'path';

import { getWeakHash, getFullPathThatFits, encodePathSegment } from './KeyMetadataHelpers';

export type SecretMapEntry = {
    name: string;
    hash: string;
    pos: number;
    length: number;
}

// Implements storing key maps (secret coordinates within a file) in local JSON files
export class KeyMapRepo {

    private constructor(private _storageFolder: string) {}

    async getPendingFolders(): Promise<string[]> {

        const filePath = this.getFileNameForPendingFolders();

        if (!fs.existsSync(filePath)) {
            return [];
        }

        const json = await fs.promises.readFile(filePath, 'utf8')

        return JSON.parse(json);
    }

    async savePendingFolders(folders: string[]): Promise<void> {

        const filePath = this.getFileNameForPendingFolders();

        if (folders.length <= 0) {

            await fs.promises.rm(filePath, {force: true});
        } else {

            await fs.promises.writeFile(filePath, JSON.stringify(folders, null, 3));
        }
    }

    static async create(storageFolder: string): Promise<KeyMapRepo> {
        
        if (!fs.existsSync(storageFolder)) {
            await fs.promises.mkdir(storageFolder, {recursive: true});
        }

        return new KeyMapRepo(storageFolder);
    }

    async getSecretMapForFile(filePath: string): Promise<SecretMapEntry[]> {

        const mapFilePath = this.getFileNameForSecretMap(filePath);

        if (!fs.existsSync(mapFilePath)) {
            return [];
        }

        const mapJson = await fs.promises.readFile(mapFilePath, 'utf8')

        return JSON.parse(mapJson);
    }

    async saveSecretMapForFile(filePath: string, map: SecretMapEntry[]): Promise<void> {

        const mapFilePath = this.getFileNameForSecretMap(filePath);
        const mapFileFolder = path.dirname(mapFilePath);

        if (!fs.existsSync(mapFileFolder)) {
            await fs.promises.mkdir(mapFileFolder);
        }

        if (!map.length) {
            await fs.promises.rm(mapFilePath, {force: true});

            if (!(await fs.promises.readdir(mapFileFolder)).length) {
                // Removing the empty folder as well
                await fs.promises.rmdir(mapFileFolder);
            }

            return;
        }

        await fs.promises.writeFile(mapFilePath, JSON.stringify(map, null, 3));
    }

    async cleanup(): Promise<void> {

        await fs.promises.rm(this._storageFolder, { recursive: true });
        await fs.promises.mkdir(this._storageFolder, { recursive: true });
    }

    private getFileNameForSecretMap(filePath: string): string {

        return getFullPathThatFits(this._storageFolder, encodePathSegment(path.dirname(filePath)), `${encodePathSegment(path.basename(filePath))}-${getWeakHash(filePath)}.json`);
    }

    private getFileNameForPendingFolders(): string {

        return path.join(this._storageFolder, `folders-to-be-stashed.json`);
    }
}
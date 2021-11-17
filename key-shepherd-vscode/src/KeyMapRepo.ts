import * as fs from 'fs';
import * as path from 'path';

import { getHashCode, getFullPathThatFits, encodePathSegment } from './KeyMetadataHelpers';

export type SecretMapEntry = {
    name: string;
    hash: string;
    pos: number;
    length: number;
}

export class KeyMapRepo {

    private constructor(private _storageFolder: string) {}

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

        return fs.promises
            .writeFile(mapFilePath, JSON.stringify(map, null, 3));
    }

    private getFileNameForSecretMap(filePath: string): string {

        return getFullPathThatFits(this._storageFolder, encodePathSegment(path.dirname(filePath)), `${encodePathSegment(path.basename(filePath))}-${getHashCode(filePath)}.json`);
    }
}
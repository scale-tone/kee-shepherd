import { ControlledSecret, SecretTypeEnum, ControlTypeEnum } from "../KeyMetadataHelpers";

export type SelectedSecretType = { type: SecretTypeEnum, name: string, value: string, properties: any, alreadyAskedForName?: boolean };

// Implements picking and retrieving secret values from various sources
export interface ISecretValueProvider {

    getSecretValue(secret: ControlledSecret): Promise<string>;
    pickUpSecret(controlType: ControlTypeEnum): Promise<SelectedSecretType | undefined>;
}
